import Anthropic from "@anthropic-ai/sdk";
import type { Domain, DomainDraft, ExtractionMetadata, ExtractionSource } from "./domain";
import type { Module } from "./modules/types";
import { getModule } from "./modules/registry.server";
import { renderSourcePage } from "./sources";

/**
 * Generic extraction runner: scientific paper text in → standardized records
 * out, for whichever domain is requested. The domain's Module supplies the
 * system prompt, tool schema, and ingest; this file owns only the provider
 * plumbing for OpenAI-compatible and Anthropic extraction.
 */

export interface ExtractResult {
  records: DomainDraft<any, any>[];
  source: ExtractionSource;
  model?: string;
}

export interface VisualPageInput {
  page: number;
  dataUrl: string;
}

export interface ExtractOptions {
  /** Test/integration override. Production derives these images from sourceId. */
  visualPages?: VisualPageInput[];
  /** Resolve pages from an isolated teaching upload using the same vision settings. */
  renderPage?: (page: number, scale: number) => Promise<Uint8Array | null>;
}

type OpenAIUserContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

const VISUAL_METRICS: Record<Domain, RegExp[]> = {
  tribology: [/friction\s+coefficients?/gi, /coefficient\s+of\s+friction/gi, /\bcof\b/gi, /μ/gi],
  conductivity: [/ionic\s+conductivit(?:y|ies)/gi, /conductivit(?:y|ies)/gi, /σ/gi],
  diffusion: [/diffusion\s+coefficients?/gi, /diffusivit(?:y|ies)/gi, /self[-\s]?diffusion/gi],
};

function matchIndices(text: string, patterns: RegExp[]): number[] {
  const indices: number[] = [];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    for (const match of text.matchAll(pattern)) indices.push(match.index ?? 0);
  }
  return indices;
}

/** Select pages where a target metric is discussed close to a numbered figure. */
export function selectVisualPageNumbers(domain: Domain, taggedText: string, limit = 3): number[] {
  if (limit <= 0) return [];
  const pageMatches = [...taggedText.matchAll(/^\[PAGE\s+(\d+)]\s*$/gim)];
  if (!pageMatches.length) return [];

  const scored: Array<{ page: number; score: number }> = [];
  for (let index = 0; index < pageMatches.length; index += 1) {
    const marker = pageMatches[index];
    const start = (marker.index ?? 0) + marker[0].length;
    const end = pageMatches[index + 1]?.index ?? taggedText.length;
    const pageText = taggedText.slice(start, end);
    const metricIndices = matchIndices(pageText, VISUAL_METRICS[domain]);
    const figureIndices = matchIndices(pageText, [/\bfig(?:ure)?\.?\s*s?\d+[a-z]?/gi]);
    if (!metricIndices.length || !figureIndices.length) continue;

    let proximityScore = 0;
    for (const metricAt of metricIndices) {
      for (const figureAt of figureIndices) {
        const distance = Math.abs(metricAt - figureAt);
        if (distance <= 1200) proximityScore = Math.max(proximityScore, 1200 - distance);
      }
    }
    if (!proximityScore) continue;
    scored.push({
      page: Number(marker[1]),
      score: proximityScore + Math.min(metricIndices.length, 8) * 20 + Math.min(figureIndices.length, 8) * 10,
    });
  }

  return scored
    .sort((a, b) => b.score - a.score || a.page - b.page)
    .slice(0, Math.max(0, Math.floor(limit)))
    .map(({ page }) => page);
}

function visionEnabledForModel(model: string): boolean {
  const mode = process.env.EXTRACT_VISION_MODE?.trim().toLowerCase();
  if (mode === "off" || mode === "false" || mode === "0") return false;
  if (mode === "on" || mode === "true" || mode === "1") return true;
  return /(?:^|[/_-])kimi-k(?:2\.(?:5|6)|3)(?:$|[/_.-])|moonshot-v1-.*vision|gpt-(?:4o|4\.1|5)|claude-/i.test(model);
}

function visualPageLimit(): number {
  const configured = Number(process.env.EXTRACT_VISUAL_PAGE_LIMIT);
  if (!Number.isFinite(configured)) return 3;
  return Math.max(0, Math.min(6, Math.floor(configured)));
}

function visualPageScale(): number {
  const configured = Number(process.env.EXTRACT_VISUAL_PAGE_SCALE);
  if (!Number.isFinite(configured)) return 3;
  return Math.max(1, Math.min(4, configured));
}

async function resolveVisualPages(
  domain: Domain,
  taggedText: string,
  sourceId: string | undefined,
  model: string,
  options: ExtractOptions | undefined,
): Promise<VisualPageInput[]> {
  if (!visionEnabledForModel(model)) return [];
  if (options?.visualPages) return options.visualPages;
  if (!sourceId && !options?.renderPage) return [];

  const pageNumbers = selectVisualPageNumbers(domain, taggedText, visualPageLimit());
  const pages: VisualPageInput[] = [];
  for (const page of pageNumbers) {
    const png = options?.renderPage
      ? await options.renderPage(page, visualPageScale())
      : await renderSourcePage(domain, sourceId!, page, visualPageScale());
    if (!png) continue;
    pages.push({ page, dataUrl: `data:image/png;base64,${Buffer.from(png).toString("base64")}` });
  }
  return pages;
}

function openAIUserContent(prompt: string, visualPages: VisualPageInput[]): string | OpenAIUserContentPart[] {
  if (!visualPages.length) return prompt;
  const content: OpenAIUserContentPart[] = [{ type: "text", text: prompt }];
  for (const visual of visualPages) {
    content.push({
      type: "text",
      text: `[VISUAL PAGE ${visual.page}] Inspect every relevant chart, axis, legend, marker, bar, and error bar on this PDF page.`,
    });
    content.push({ type: "image_url", image_url: { url: visual.dataUrl } });
  }
  return content;
}

export const LIVE_EXTRACTION_REQUIRED_MESSAGE =
  "Live extraction is not configured. Set KIMI_API_KEY (or MOONSHOT_API_KEY), OPENAI_API_KEY and OPENAI_BASE_URL, or ANTHROPIC_API_KEY.";

export function isLiveExtractionEnabled(): boolean {
  return Boolean(getOpenAIConfig() || process.env.ANTHROPIC_API_KEY);
}

export async function extractRecords(
  domain: Domain,
  text: string,
  sourceId?: string,
  options?: ExtractOptions,
): Promise<ExtractResult> {
  if (!isLiveExtractionEnabled()) {
    throw new Error(LIVE_EXTRACTION_REQUIRED_MESSAGE);
  }

  const trimmed = text.trim();
  const model = process.env.EXTRACT_MODEL || "claude-sonnet-4-6";
  const openAIConfig = getOpenAIConfig();
  if (!trimmed) {
    return {
      records: [],
      source: openAIConfig ? "openai-compatible" : "anthropic",
      model,
    };
  }

  const mod = getModule(domain);
  const visualPages = await resolveVisualPages(domain, trimmed, sourceId, model, options);
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

  if (openAIConfig) {
    const fields = await extractWithOpenAICompatible(trimmed, model, openAIConfig, mod, visualPages);
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
    messages: [
      {
        role: "user",
        content: visualPages.length
          ? [
              { type: "text", text: mod.userPrompt(body) },
              ...visualPages.flatMap((visual) => [
                {
                  type: "text" as const,
                  text: `[VISUAL PAGE ${visual.page}] Inspect every relevant chart, axis, legend, marker, bar, and error bar on this PDF page.`,
                },
                {
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: "image/png" as const,
                    data: visual.dataUrl.slice(visual.dataUrl.indexOf(",") + 1),
                  },
                },
              ]),
            ]
          : mod.userPrompt(body),
      },
    ],
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
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
  }>;
}

const OPENAI_COMPLETION_ATTEMPTS = 2;

interface OpenAICompletionFailure {
  reason: string;
  finishReason: string | null;
  argsChars: number;
}

class OpenAICompletionError extends Error {
  constructor(readonly failure: OpenAICompletionFailure) {
    super(completionFailureMessage(failure));
    this.name = "OpenAICompletionError";
  }
}

function completionFailureMessage(failure: OpenAICompletionFailure): string {
  return `${failure.reason} (finish_reason=${failure.finishReason ?? "missing"}, tool argument chars=${failure.argsChars})`;
}

function recoveryPrompt(prompt: string, attempt: number): string {
  if (attempt === 1) return prompt;
  return `${prompt}\n\nRETRY REQUIREMENT: Return one complete, compact tool call. Keep optional prose concise, avoid duplicate records, and ensure the JSON is fully closed.`;
}

function isKimiK3(model: string): boolean {
  return model.toLowerCase().startsWith("kimi-k3");
}

function getOpenAIConfig(): OpenAIConfig | null {
  const kimiApiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY;
  const apiKey = process.env.OPENAI_API_KEY || process.env.openai_api_key;
  const baseURL = process.env.OPENAI_BASE_URL || process.env.openai_base_url;
  if (apiKey && baseURL) {
    return { apiKey, baseURL: baseURL.replace(/\/+$/, "") };
  }
  if (kimiApiKey) {
    return { apiKey: kimiApiKey, baseURL: "https://api.moonshot.cn/v1" };
  }
  return null;
}

async function fetchWithRetry(input: string, init: RequestInit): Promise<Response> {
  const maxAttempts = 4;
  const configuredRetryBaseMs = Number(process.env.EXTRACT_RETRY_BASE_MS);
  const retryBaseMs =
    Number.isFinite(configuredRetryBaseMs) && configuredRetryBaseMs >= 0
      ? configuredRetryBaseMs
      : 2000;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      const retryable = response.status === 429 || [502, 503, 504].includes(response.status);
      if (!retryable || attempt === maxAttempts) return response;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, retryBaseMs * 2 ** (attempt - 1)));
  }
  throw lastError ?? new Error("LLM request failed after retries.");
}

async function extractWithOpenAICompatible(
  text: string,
  model: string,
  config: OpenAIConfig,
  mod: Module<any, any>,
  visualPages: VisualPageInput[],
): Promise<any[]> {
  let lastFailure: OpenAICompletionFailure | null = null;
  for (let attempt = 1; attempt <= OPENAI_COMPLETION_ATTEMPTS; attempt += 1) {
    try {
      return await extractWithOpenAICompatibleAttempt(text, model, config, mod, visualPages, attempt);
    } catch (error) {
      if (!(error instanceof OpenAICompletionError)) throw error;
      lastFailure = error.failure;
    }
  }

  throw new Error(
    `OpenAI-compatible extraction returned an unusable completion after ${OPENAI_COMPLETION_ATTEMPTS} attempts: ${completionFailureMessage(lastFailure!)}`
  );
}

async function extractWithOpenAICompatibleAttempt(
  text: string,
  model: string,
  config: OpenAIConfig,
  mod: Module<any, any>,
  visualPages: VisualPageInput[],
  attempt: number,
): Promise<any[]> {
  const body = text.slice(0, 120_000);
  const kimiK3 = isKimiK3(model);

  let response: Response;
  try {
    response = await fetchWithRetry(`${config.baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        ...(kimiK3
          ? {
              max_completion_tokens: 8000,
              reasoning_effort: process.env.KIMI_REASONING_EFFORT || "low",
            }
          : { temperature: 0, max_tokens: 8000 }),
        messages: [
          { role: "system", content: mod.systemPrompt },
          {
            role: "user",
            content: openAIUserContent(recoveryPrompt(mod.userPrompt(body), attempt), visualPages),
          },
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

  let data: OpenAIChatCompletion;
  try {
    data = (await response.json()) as OpenAIChatCompletion;
  } catch {
    throw new OpenAICompletionError({
      reason: "provider returned an incomplete JSON response",
      finishReason: null,
      argsChars: 0,
    });
  }

  const choice = data.choices?.[0];
  const finishReason = choice?.finish_reason ?? null;
  const message = choice?.message;
  const args = message?.tool_calls?.[0]?.function?.arguments || message?.content || "";
  if (finishReason === "length") {
    throw new OpenAICompletionError({
      reason: "provider stopped before completing the tool JSON",
      finishReason,
      argsChars: args.length,
    });
  }
  if (!args) {
    throw new OpenAICompletionError({
      reason: "provider returned no tool arguments",
      finishReason,
      argsChars: 0,
    });
  }

  try {
    const parsed = JSON.parse(args) as { records?: any[] };
    return parsed.records ?? [];
  } catch {
    throw new OpenAICompletionError({
      reason: "provider returned malformed tool JSON",
      finishReason,
      argsChars: args.length,
    });
  }
}
