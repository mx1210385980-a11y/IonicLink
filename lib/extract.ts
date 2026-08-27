import Anthropic from "@anthropic-ai/sdk";
import type { Domain, DomainDraft, ExtractionMetadata, ExtractionSource } from "./domain";
import type { Module } from "./modules/types";
import { getModule } from "./modules/registry.server";

/**
 * Generic extraction runner: scientific paper text in → standardized records
 * out, for whichever domain is requested. The domain's Module supplies the
 * system prompt, tool schema, mock extractor, and ingest; this file owns only
 * the provider plumbing (OpenAI-compatible / Anthropic / offline mock). Falls
 * back to the module's deterministic mock when no key is configured, so the
 * whole flow runs offline.
 */

export interface ExtractResult {
  records: DomainDraft<any, any>[];
  source: ExtractionSource;
  model?: string;
}

export function isLiveExtractionEnabled(): boolean {
  return Boolean(getOpenAIConfig() || process.env.ANTHROPIC_API_KEY);
}

export async function extractRecords(
  domain: Domain,
  text: string,
  sourceId?: string
): Promise<ExtractResult> {
  const trimmed = text.trim();
  if (!trimmed) return { records: [], source: "mock" };

  const mod = getModule(domain);
  // The module's hard gate: drafts the domain refuses (e.g. diffusion records
  // without any D value) never reach the review queue, whatever the model did.
  const accept = (r: DomainDraft<any, any>): boolean => mod.acceptDraft?.(r) ?? true;
  const finish = (
    records: DomainDraft<any, any>[],
    source: ExtractionSource,
    model?: string
  ): ExtractResult => {
    const extraction: ExtractionMetadata = { source, ...(model ? { model } : {}) };
    return {
      records: records.filter(accept).map((record) => ({
        ...record,
        ...(sourceId ? { sourceId } : {}),
        extraction,
      })),
      source,
      ...(model ? { model } : {}),
    };
  };

  if (!isLiveExtractionEnabled()) {
    return finish(mod.mockExtract(trimmed).map(mod.ingest), "mock");
  }

  const model = process.env.EXTRACT_MODEL || "claude-sonnet-4-6";
  const openAIConfig = getOpenAIConfig();
  if (openAIConfig) {
    const fields = await extractWithOpenAICompatible(trimmed, model, openAIConfig, mod);
    return finish(fields.map(mod.ingest), "openai-compatible", model);
  }

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
  const body = trimmed.slice(0, 120_000);

  const response = await client.messages.create({
    model,
    max_tokens: 8000,
    system: mod.systemPrompt,
    tools: [
      {
        name: mod.toolName,
        description: mod.toolDescription,
        input_schema: mod.toolSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: mod.toolName },
    messages: [{ role: "user", content: mod.userPrompt(body) }],
  });

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use"
  );
  const fields = (toolUse?.input as { records?: any[] })?.records ?? [];
  return finish(fields.map(mod.ingest), "anthropic", model);
}

interface OpenAIConfig {
  apiKey: string;
  baseURL: string;
}

interface OpenAIToolCall {
  function?: { arguments?: string };
}

interface OpenAIChatCompletion {
  choices?: Array<{ message?: { content?: string | null; tool_calls?: OpenAIToolCall[] } }>;
}

function isKimiK3(model: string): boolean {
  return model.toLowerCase().startsWith("kimi-k3");
}

/**
 * Output-token budget for one extraction call. Kimi-k3 is a thinking model:
 * reasoning and the visible answer SHARE this budget, so the old 8000 cap
 * truncated long papers mid-JSON and surfaced as "0 records". 32k leaves
 * ample room for thinking plus a full record list; override with
 * EXTRACT_MAX_TOKENS if a provider rejects it.
 */
function extractMaxTokens(): number {
  const fromEnv = Number(process.env.EXTRACT_MAX_TOKENS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : 32768;
}

function getOpenAIConfig(): OpenAIConfig | null {
  const apiKey = process.env.OPENAI_API_KEY || process.env.openai_api_key;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.openai_base_url;
  if (!apiKey || !baseURL) return null;
  return { apiKey, baseURL: baseURL.replace(/\/+$/, "") };
}

async function extractWithOpenAICompatible(
  text: string,
  model: string,
  config: OpenAIConfig,
  mod: Module<any, any>
): Promise<any[]> {
  const body = text.slice(0, 120_000);
  const kimiK3 = isKimiK3(model);

  let response: Response;
  try {
    response = await fetch(`${config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        // Stream for thinking models: a non-streamed call only gets its
        // response headers AFTER the whole generation finishes, so a long
        // think + 32k-token answer blew past undici's headers timeout
        // (UND_ERR_HEADERS_TIMEOUT). Streaming returns headers immediately.
        ...(kimiK3
          ? { max_completion_tokens: extractMaxTokens(), stream: true }
          : { temperature: 0, max_tokens: extractMaxTokens() }),
        messages: [
          { role: "system", content: mod.systemPrompt },
          { role: "user", content: mod.userPrompt(body) },
        ],
        tools: [
          {
            type: "function",
            function: {
              name: mod.toolName,
              description: mod.toolDescription,
              parameters: mod.toolSchema,
            },
          },
        ],
        tool_choice: kimiK3
          ? "required"
          : { type: "function", function: { name: mod.toolName } },
      }),
    });
  } catch (err) {
    const cause = (err as { cause?: { code?: string } })?.cause?.code;
    throw new Error(
      `LLM endpoint unreachable: ${config.baseURL}${cause ? ` (${cause})` : ""}. ` +
        `The extraction code is fine — check the relay service status / network / VPN, then retry.`
    );
  }

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OpenAI-compatible extraction failed (${response.status}): ${detail}`);
  }

  if (kimiK3) {
    const args = await readStreamedToolArguments(response);
    if (!args) return [];
    const parsed = JSON.parse(args) as { records?: any[] };
    return parsed.records ?? [];
  }

  const data = (await response.json()) as OpenAIChatCompletion;
  const message = data.choices?.[0]?.message;
  const args = message?.tool_calls?.[0]?.function?.arguments || message?.content;
  if (!args) return [];

  const parsed = JSON.parse(args) as { records?: any[] };
  return parsed.records ?? [];
}

/**
 * Reassembles a streamed (SSE) chat completion. Kimi-k3 requests use
 * stream:true — a thinking model with a 32k-token budget takes minutes, and a
 * non-streamed call only sends its response headers AFTER generation fully
 * completes, tripping undici's headersTimeout (UND_ERR_HEADERS_TIMEOUT).
 * Streaming returns headers immediately; the tool-call arguments then arrive
 * as incremental deltas we concatenate here. Falls back to the content
 * channel if the model answered in prose instead of a tool call.
 */
async function readStreamedToolArguments(response: Response): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const decoder = new TextDecoder();
  let buffer = "";
  let args = "";
  let content = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const delta = (JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string | null; tool_calls?: OpenAIToolCall[] } }>;
        }).choices?.[0]?.delta;
        const piece = delta?.tool_calls?.[0]?.function?.arguments;
        if (typeof piece === "string") args += piece;
        if (typeof delta?.content === "string") content += delta.content;
      } catch {
        // Tolerate a partial JSON line; the stream continues.
      }
    }
  }
  return args || content || null;
}
