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
        temperature: 0,
        max_tokens: 8000,
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
        tool_choice: { type: "function", function: { name: mod.toolName } },
      }),
    });
  } catch (err) {
    // Surface WHERE it failed — a bare "fetch failed" reads like an app bug
    // when the actual problem is the relay endpoint being unreachable.
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

  const data = (await response.json()) as OpenAIChatCompletion;
  const message = data.choices?.[0]?.message;
  const args = message?.tool_calls?.[0]?.function?.arguments || message?.content;
  if (!args) return [];

  const parsed = JSON.parse(args) as { records?: any[] };
  return parsed.records ?? [];
}
