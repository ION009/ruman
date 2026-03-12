import { randomUUID } from "node:crypto";

import { NextRequest, NextResponse } from "next/server";

import {
  listSitesForUser,
  requireCurrentSession,
  requireUserSite,
} from "@/lib/control-plane/auth";
import { saveNeoConversationTurn } from "@/lib/control-plane/neo-chat";
import { isControlPlaneConnectionError } from "@/lib/control-plane/db";
import { validateRequestCSRF } from "@/lib/csrf/server";
import type {
  DashboardSite,
  DashboardViewer,
  NeoClientAction,
  NeoChatMessage,
  NeoChatResponse,
  NeoChatRequest,
  NeoVisualArtifact,
  NeoVisualArtifactDraft,
  RangeKey,
} from "@/lib/dashboard/types";
import {
  analyticsProxyEnabled,
  getDashboardContext,
  readDashboardToken,
  withAnalyticsTokenFallback,
} from "@/lib/dashboard/server";
import {
  executeNeoToolCall,
  neoTools,
  type NeoAccessContext,
} from "@/lib/dashboard/neo-tools";
import { isControlPlaneEnabled } from "@/lib/session";

const MAX_CONVERSATION_MESSAGES = 10;
const MAX_MESSAGE_CHARS = 4_000;
const MAX_TOOL_STEPS = 8;
const KNOWN_SURFACES = [
  "/dashboard",
  "/map",
  "/goals",
  "/events",
  "/heatmaps",
  "/session-replay",
  "/realtime",
  "/funnels",
  "/journeys",
  "/retention",
  "/ai-insight",
  "/users",
  "/cohorts",
  "/alerts",
  "/integrations",
  "/settings",
];

type ChatRole = "system" | "user" | "assistant" | "tool";

type AIProviderID = "groq" | "longcat";
type AIProviderKind = "groq" | "openai-compatible";
type QueryTier = "light" | "heavy";

type AIToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

type AIMessage = {
  role: ChatRole;
  content?: string | null | Array<{ type?: string; text?: string }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: AIToolCall[];
};

type AIChatResponse = {
  id?: string;
  choices?: Array<{
    message?: AIMessage;
  }>;
  error?: {
    message?: string;
  };
};

type AIStreamChunk = {
  choices?: Array<{
    delta?: {
      content?: AIMessage["content"];
    };
    finish_reason?: string | null;
  }>;
  error?: {
    message?: string;
  };
};

type AIProviderConfig = {
  id: AIProviderID;
  kind: AIProviderKind;
  label: string;
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort?: string;
};

type ProviderRegistry = {
  groq: AIProviderConfig | null;
  longcat: AIProviderConfig | null;
};

type QueryRoutingDecision = {
  tier: QueryTier;
  reason: string;
};

type PreparedNeoResponse = {
  planner: AIProviderConfig;
  usedTools: string[];
  finalMessages: AIMessage[];
  fallbackContent: string;
  needsSynthesis: boolean;
  clientActions: NeoClientAction[];
  visualArtifacts: NeoVisualArtifactDraft[];
};

class ProviderStreamError extends Error {
  emittedContent: string;

  constructor(message: string, emittedContent = "") {
    super(message);
    this.name = "ProviderStreamError";
    this.emittedContent = emittedContent;
  }
}

function normalizeRange(value: string | undefined): RangeKey {
  if (value?.startsWith("custom:")) {
    return value as RangeKey;
  }
  if (value === "24h" || value === "30d") {
    return value;
  }
  return "7d";
}

function truncate(value: string, limit = MAX_MESSAGE_CHARS) {
  return value.trim().slice(0, limit);
}

function labelForSite(site: DashboardSite) {
  if (site.name && site.name.trim() && site.name !== site.id) {
    return site.name;
  }

  const origin = site.origins?.[0] ?? "";
  if (origin) {
    try {
      return new URL(origin).host.replace(/^www\./i, "");
    } catch {
      return origin;
    }
  }

  return site.id;
}

function toDashboardSite(site: { id: string; name?: string; origins: string[] }) {
  return {
    id: site.id,
    name: site.name,
    origins: site.origins,
  } satisfies DashboardSite;
}

function pickCurrentSite(sites: DashboardSite[], requestedSiteId: string) {
  if (!sites.length) {
    return null;
  }
  if (!requestedSiteId.trim()) {
    return sites[0];
  }
  return sites.find((site) => site.id === requestedSiteId) ?? sites[0];
}

function floatFromEnv(key: string, fallback: number) {
  const parsed = Number.parseFloat(process.env[key] ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function intFromEnv(key: string, fallback: number) {
  const parsed = Number.parseInt(process.env[key] ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function groqRuntimeConfig(): AIProviderConfig | null {
  const apiKey = (process.env.ANLTICSHEAT_NEO_GROQ_API_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }

  return {
    id: "groq",
    kind: "groq",
    label: "Groq",
    baseURL: (process.env.ANLTICSHEAT_NEO_GROQ_BASE_URL ?? "https://api.groq.com/openai/v1").replace(/\/$/, ""),
    apiKey,
    model: (process.env.ANLTICSHEAT_NEO_GROQ_MODEL ?? "qwen/qwen3-32b").trim(),
    temperature: floatFromEnv("ANLTICSHEAT_NEO_GROQ_TEMPERATURE", 0.2),
    maxTokens: intFromEnv("ANLTICSHEAT_NEO_GROQ_MAX_COMPLETION_TOKENS", 2048),
    reasoningEffort: (process.env.ANLTICSHEAT_NEO_GROQ_REASONING_EFFORT ?? "default").trim() || "default",
  };
}

function longcatRuntimeConfig(): AIProviderConfig | null {
  const apiKey = (process.env.ANLTICSHEAT_NEO_LONGCAT_API_KEY ?? "").trim();
  if (!apiKey) {
    return null;
  }

  return {
    id: "longcat",
    kind: "openai-compatible",
    label: "LongCat",
    baseURL: (process.env.ANLTICSHEAT_NEO_LONGCAT_BASE_URL ?? "https://api.longcat.chat/openai").replace(/\/$/, ""),
    apiKey,
    model: (process.env.ANLTICSHEAT_NEO_LONGCAT_MODEL ?? "LongCat-Flash-Lite").trim(),
    temperature: floatFromEnv("ANLTICSHEAT_NEO_LONGCAT_TEMPERATURE", 0.2),
    maxTokens: intFromEnv("ANLTICSHEAT_NEO_LONGCAT_MAX_TOKENS", 4096),
  };
}

function providerRegistry(): ProviderRegistry {
  return {
    groq: groqRuntimeConfig(),
    longcat: longcatRuntimeConfig(),
  };
}

function sanitizeConversation(messages: unknown) {
  const safeMessages = Array.isArray(messages) ? messages : [];

  return safeMessages
    .filter(
      (message): message is NeoChatRequest["messages"][number] =>
        typeof message === "object" &&
        message !== null &&
        "role" in message &&
        "content" in message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string",
    )
    .map((message) => ({
      role: message.role,
      content: truncate(message.content),
    }))
    .filter((message) => message.content.length > 0)
    .slice(-MAX_CONVERSATION_MESSAGES);
}

function extractTextContent(
  content: AIMessage["content"],
  options: { trim?: boolean; sanitize?: boolean } = {},
) {
  const trim = options.trim ?? true;
  const sanitize = options.sanitize ?? true;
  let text = "";

  if (typeof content === "string") {
    text = content;
  } else if (Array.isArray(content)) {
    text = content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n");
  }

  const normalized = sanitize ? sanitizeAssistantContent(text) : text;
  return trim ? normalized.trim() : normalized;
}

function sanitizeAssistantContent(input: string) {
  return input
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/^\s*(thinking|thought process|reasoning)\s*:\s*$/gim, "")
    .replace(/^\s*(thinking|thought process|reasoning)\s*:\s*.*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function classifyConversation(
  conversation: Array<{ role: "user" | "assistant"; content: string }>,
): QueryRoutingDecision {
  const lastUserMessage = conversation
    .slice()
    .reverse()
    .find((message) => message.role === "user")?.content ?? "";
  const normalized = lastUserMessage.toLowerCase();
  const wordCount = normalized.match(/\S+/g)?.length ?? 0;

  const heavyPatterns = [
    /\banalys(?:e|is|ing)\b/i,
    /\bsummar(?:y|ize|ise|ised|ized)\b/i,
    /\bcompare\b/i,
    /\btrend(?:s|ing)?\b/i,
    /\binsight(?:s)?\b/i,
    /\breport\b/i,
    /\baudit\b/i,
    /\breview\b/i,
    /\brecommend(?:ation|ations)?\b/i,
    /\bexplain\b/i,
    /\bbreak\s+down\b/i,
    /\bwhat\s+happened\b/i,
    /\bchart(?:s)?\b/i,
    /\bgraph(?:s)?\b/i,
    /\bdiagram(?:s)?\b/i,
    /\bvisual(?:s|ise|ize)?\b/i,
    /\bplot\b/i,
    /\bfunnel\b/i,
    /\bheatmap\b/i,
    /\bjourney\b/i,
    /\bretention\b/i,
  ];
  const lightPatterns = [
    /\bprofile\b/i,
    /\brename\b/i,
    /\bchange\s+my\s+name\b/i,
    /\btracker\b.*\bsnippet\b/i,
    /\btracking\b.*\bscript\b/i,
    /\btracker\b.*\bscript\b/i,
    /\binstall\b.*\bscript\b/i,
    /\bscript\s+tag\b/i,
    /\bfull\s+script\b/i,
    /\binstall\s+snippet\b/i,
    /\bcode\s+snippet\b/i,
    /\bshort\s+answer\b/i,
  ];

  if (lightPatterns.some((pattern) => pattern.test(lastUserMessage))) {
    return { tier: "light", reason: "explicit profile or snippet task" };
  }
  if (heavyPatterns.some((pattern) => pattern.test(lastUserMessage))) {
    return { tier: "heavy", reason: "analysis or summary intent" };
  }
  if (lastUserMessage.length >= 220 || wordCount >= 36) {
    return { tier: "heavy", reason: "long-form prompt" };
  }
  return { tier: "light", reason: "short operational request" };
}

function plannerProviders(decision: QueryRoutingDecision, registry: ProviderRegistry) {
  const preferred =
    decision.tier === "heavy"
      ? [registry.longcat, registry.groq]
      : [registry.groq, registry.longcat];

  return preferred.filter((provider): provider is AIProviderConfig => Boolean(provider));
}

function synthesisProviders(
  decision: QueryRoutingDecision,
  registry: ProviderRegistry,
) {
  const preferred =
    decision.tier === "heavy"
      ? [registry.longcat, registry.groq]
      : [registry.groq, registry.longcat];

  return preferred.filter((provider): provider is AIProviderConfig => Boolean(provider));
}

function maybeParseJSON<T>(raw: string) {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function isVisualArtifactDraft(value: unknown): value is NeoVisualArtifactDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const candidate = value as {
    preset?: unknown;
    theme?: unknown;
    title?: unknown;
    payload?: unknown;
  };

  return (
    typeof candidate.preset === "string" &&
    typeof candidate.theme === "string" &&
    typeof candidate.title === "string" &&
    candidate.payload != null &&
    typeof candidate.payload === "object" &&
    !Array.isArray(candidate.payload)
  );
}

function collectVisualArtifacts(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return [];
  }

  const candidate = result as {
    visualArtifact?: unknown;
    visualArtifacts?: unknown;
  };

  const collected: NeoVisualArtifactDraft[] = [];
  if (isVisualArtifactDraft(candidate.visualArtifact)) {
    collected.push(candidate.visualArtifact);
  }
  if (Array.isArray(candidate.visualArtifacts)) {
    for (const visual of candidate.visualArtifacts) {
      if (isVisualArtifactDraft(visual)) {
        collected.push(visual);
      }
    }
  }
  return collected;
}

function summarizeVisualArtifact(visual: NeoVisualArtifactDraft) {
  return {
    preset: visual.preset,
    theme: visual.theme,
    title: visual.title,
    description: visual.description ?? null,
  };
}

function sanitizeToolResultForModel(result: unknown) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return result;
  }

  const cleaned: Record<string, unknown> = { ...(result as Record<string, unknown>) };
  if (isVisualArtifactDraft(cleaned.visualArtifact)) {
    cleaned.visualArtifact = summarizeVisualArtifact(cleaned.visualArtifact);
  }
  if (Array.isArray(cleaned.visualArtifacts)) {
    cleaned.visualArtifacts = cleaned.visualArtifacts
      .filter((visual): visual is NeoVisualArtifactDraft => isVisualArtifactDraft(visual))
      .map(summarizeVisualArtifact);
  }
  return cleaned;
}

function materializeVisualArtifacts(visuals: NeoVisualArtifactDraft[], createdAt: string): NeoVisualArtifact[] {
  return visuals.map(
    (visual) =>
      ({
        ...visual,
        id: randomUUID(),
        createdAt,
      }) as NeoVisualArtifact,
  );
}

function buildSystemPrompt(context: NeoAccessContext) {
  return [
    "You are Neo, the in-product analytics copilot for AnlticsHeat.",
    "Work from the provided context and tool outputs. Do not invent metrics, snippets, or account details.",
    `Current dashboard path: ${context.pathname || "/dashboard"}.`,
    `Selected site: ${labelForSite(context.currentSite)} (${context.currentSite.id}).`,
    `Selected range: ${context.selectedRange}.`,
    `Auth mode: ${context.mode}.`,
    `Product surfaces: ${KNOWN_SURFACES.join(", ")}.`,
    "Use tools for analytics metrics, site pages, tracker installation, settings, or profile information.",
    "Use list_visual_presets and create_visual_artifact when a prebuilt chart, graph, or diagram would help the user understand the answer.",
    "Never invent your own chart type. Only use the fixed visual presets exposed by the tools.",
    "Keep the normal text answer in chat even when you create one or more visuals.",
    "Only call update_profile_name when the user explicitly asks to change their profile name.",
    "Only call switch_theme when the user explicitly asks to change the theme.",
    "Only call logout_user when the user explicitly asks to log out or sign out.",
    "Never mention screenshots, replay video, DOM snapshots, or raw personal data as inputs. Use structured metrics only.",
    "Never reveal chain-of-thought, reasoning traces, or <think> blocks. Return only the final assistant answer.",
    "Respond like a normal chat assistant, not a report template.",
    "Do not use markdown headings, emoji section numbers, horizontal rules, or checklist formatting.",
    "Use short paragraphs. Use simple bullets only when they materially help.",
    "If the user asks for the tracker snippet, tracking script, install tag, script tag, or full site script, call get_tracker_script or get_tracker_installation and return the exact script tag in a fenced html code block without shortening or paraphrasing it.",
    "If a requested action is unavailable in the current auth mode, say so plainly.",
    "Keep answers concise, practical, and grounded in the returned data.",
  ].join(" ");
}

function buildCompletionRequestBody(
  messages: AIMessage[],
  config: AIProviderConfig,
  options: {
    includeTools?: boolean;
    stream?: boolean;
  } = {},
) {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature,
  };

  if (options.includeTools) {
    body.tools = neoTools;
    body.tool_choice = "auto";
  }
  if (options.stream) {
    body.stream = true;
  }

  if (config.kind === "groq") {
    body.top_p = 0.95;
    body.max_completion_tokens = config.maxTokens;
    if (config.reasoningEffort) {
      body.reasoning_effort = config.reasoningEffort;
    }
  } else {
    body.max_tokens = config.maxTokens;
  }

  return body;
}

async function callProvider(
  messages: AIMessage[],
  config: AIProviderConfig,
  options: {
    includeTools?: boolean;
  } = {},
) {
  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildCompletionRequestBody(messages, config, options)),
  });

  const payload = (await response.json().catch(() => ({}))) as AIChatResponse;
  if (!response.ok) {
    const message =
      payload.error?.message?.trim() ||
      `Neo could not reach the ${config.label} chat completion endpoint.`;
    throw new Error(message);
  }

  return payload;
}

async function prepareNeoResponse(
  conversation: Array<{ role: "user" | "assistant"; content: string }>,
  context: NeoAccessContext,
  planner: AIProviderConfig,
): Promise<PreparedNeoResponse> {
  const messages: AIMessage[] = [
    { role: "system", content: buildSystemPrompt(context) },
    ...conversation.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  ];
  const usedTools: string[] = [];
  const clientActions: NeoClientAction[] = [];
  const visualArtifacts: NeoVisualArtifactDraft[] = [];

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const completion = await callProvider(messages, planner, { includeTools: true });
    const assistantMessage = completion.choices?.[0]?.message;

    if (!assistantMessage) {
      throw new Error("Neo did not receive a valid completion message.");
    }

    const toolCalls = assistantMessage.tool_calls ?? [];
    if (!toolCalls.length) {
      const content = extractTextContent(assistantMessage.content);
      if (!content) {
        throw new Error("Neo returned an empty response.");
      }
      return {
        planner,
        finalMessages: messages,
        fallbackContent: content,
        usedTools: [...new Set(usedTools)],
        needsSynthesis: usedTools.length > 0,
        clientActions,
        visualArtifacts,
      };
    }

    messages.push({
      role: "assistant",
      content: extractTextContent(assistantMessage.content),
      tool_calls: toolCalls,
    });

    for (const toolCall of toolCalls) {
      const toolName = toolCall.function.name;
      let result: unknown;
      try {
        result = await executeNeoToolCall(toolName, toolCall.function.arguments, context);
        const visuals = collectVisualArtifacts(result);
        for (const visual of visuals) {
          if (
            !visualArtifacts.some(
              (existing) =>
                existing.preset === visual.preset &&
                existing.theme === visual.theme &&
                existing.title === visual.title,
            )
          ) {
            visualArtifacts.push(visual);
          }
        }
        if (
          result &&
          typeof result === "object" &&
          "clientAction" in result &&
          result.clientAction &&
          typeof result.clientAction === "object"
        ) {
          const action = result.clientAction as NeoClientAction;
          if (
            !clientActions.some((existing) =>
              existing.type === action.type &&
              (existing.type !== "theme" || action.type !== "theme" || existing.theme === action.theme),
            )
          ) {
            clientActions.push(action);
          }
        }
      } catch (error) {
        result = {
          ok: false,
          error: error instanceof Error ? error.message : "Tool execution failed.",
        };
      }

      usedTools.push(toolName);
      messages.push({
        role: "tool",
        tool_call_id: toolCall.id,
        name: toolName,
        content: JSON.stringify(sanitizeToolResultForModel(result)),
      });
    }
  }

  throw new Error("Neo reached its tool-call limit before producing a final answer.");
}

function chunkAssistantText(content: string) {
  const words = content.match(/\S+\s*/g) ?? [content];
  const chunks: string[] = [];
  let current = "";

  for (const word of words) {
    if ((current + word).length > 28 && current) {
      chunks.push(current);
      current = word;
      continue;
    }
    current += word;
  }

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeStreamEvent(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  event: Record<string, unknown>,
) {
  controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
}

function parseStreamPayload(rawLine: string) {
  const line = rawLine.trim();
  if (!line.startsWith("data:")) {
    return null;
  }

  const payload = line.slice(5).trim();
  if (!payload || payload === "[DONE]") {
    return "[DONE]";
  }

  return maybeParseJSON<AIStreamChunk>(payload);
}

async function streamProviderText(
  messages: AIMessage[],
  config: AIProviderConfig,
) {
  const response = await fetch(`${config.baseURL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(buildCompletionRequestBody(messages, config, { stream: true })),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as AIChatResponse;
    const message =
      payload.error?.message?.trim() ||
      `Neo could not reach the ${config.label} streaming endpoint.`;
    throw new ProviderStreamError(message);
  }

  if (!response.body) {
    throw new ProviderStreamError(`${config.label} stream was unavailable.`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let emittedContent = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });

      let boundary = buffer.indexOf("\n");
      while (boundary >= 0) {
        const rawLine = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);

        const payload = parseStreamPayload(rawLine);
        if (payload === "[DONE]") {
          return sanitizeAssistantContent(emittedContent);
        }
        if (payload?.error?.message) {
          throw new ProviderStreamError(payload.error.message, emittedContent);
        }

        const text = extractTextContent(payload?.choices?.[0]?.delta?.content, { trim: false, sanitize: false });
        if (text) {
          emittedContent += text;
        }

        boundary = buffer.indexOf("\n");
      }

      if (done) {
        break;
      }
    }

    const trailingPayload = parseStreamPayload(buffer);
    if (
      trailingPayload &&
      trailingPayload !== "[DONE]" &&
      trailingPayload.error?.message
    ) {
      throw new ProviderStreamError(trailingPayload.error.message, emittedContent);
    }
    const trailingText =
      trailingPayload && trailingPayload !== "[DONE]"
        ? extractTextContent(trailingPayload.choices?.[0]?.delta?.content, { trim: false, sanitize: false })
        : "";
    if (trailingText) {
      emittedContent += trailingText;
    }

    if (!emittedContent.trim()) {
      throw new ProviderStreamError(`${config.label} returned an empty streamed response.`);
    }

    return sanitizeAssistantContent(emittedContent);
  } catch (error) {
    if (error instanceof ProviderStreamError) {
      throw error;
    }
    throw new ProviderStreamError(
      error instanceof Error ? error.message : `${config.label} streaming failed.`,
      emittedContent,
    );
  }
}

async function emitChunkedText(
  content: string,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
) {
  for (const chunk of chunkAssistantText(content)) {
    writeStreamEvent(controller, encoder, { type: "delta", text: chunk });
    await sleep(14);
  }
}

async function synthesizeNeoReply(
  prepared: PreparedNeoResponse,
  providers: AIProviderConfig[],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
) {
  const fallbackContent = sanitizeAssistantContent(prepared.fallbackContent);
  if (!prepared.needsSynthesis && fallbackContent.trim()) {
    await emitChunkedText(fallbackContent, controller, encoder);
    return fallbackContent;
  }

  let lastError: unknown = null;

  for (const provider of providers) {
    try {
      const content = await streamProviderText(prepared.finalMessages, provider);
      if (content.trim()) {
        await emitChunkedText(content, controller, encoder);
        return content;
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (fallbackContent.trim()) {
    await emitChunkedText(fallbackContent, controller, encoder);
    return fallbackContent;
  }

  throw lastError instanceof Error ? lastError : new Error("Neo could not generate a response.");
}

async function resolveAccessContext(
  request: NextRequest,
  payload: NeoChatRequest,
): Promise<NeoAccessContext> {
  const requestedSiteId = (payload.siteId ?? "").trim();
  const selectedRange = normalizeRange(payload.range);
  const pathname = truncate(payload.pathname ?? "/dashboard", 120) || "/dashboard";
  const requestOrigin = new URL(request.url).origin;

  if (!analyticsProxyEnabled()) {
    throw new Error("Analytics proxy is not configured.");
  }

  if (isControlPlaneEnabled()) {
    try {
      const session = await requireCurrentSession();
      const sites = (await listSitesForUser(session.user.id)).map(toDashboardSite);
      const currentSite = toDashboardSite(await requireUserSite(session.user.id, requestedSiteId));

      return {
        mode: "control-plane",
        viewer: session.user,
        sites,
        currentSite,
        selectedRange,
        pathname,
        requestOrigin,
        surfaces: KNOWN_SURFACES,
        runAnalytics: (operation) => withAnalyticsTokenFallback(operation),
      };
    } catch (error) {
      if (!isControlPlaneConnectionError(error)) {
        throw error;
      }
    }
  }

  const token = await readDashboardToken();
  if (!token) {
    throw new Error("Dashboard session required.");
  }

  const context = await getDashboardContext(token);
  const currentSite = pickCurrentSite(context.sites, requestedSiteId);
  if (!currentSite) {
    throw new Error("No accessible sites were found for this session.");
  }

  return {
    mode: "token",
    viewer: context.viewer,
    sites: context.sites,
    currentSite,
    selectedRange,
    pathname,
    requestOrigin,
    surfaces: KNOWN_SURFACES,
    runAnalytics: (operation) => operation(token),
  };
}

export async function POST(request: NextRequest) {
  const csrf = validateRequestCSRF(request);
  if (!csrf.ok) {
    return NextResponse.json({ error: csrf.error }, { status: 403 });
  }

  const providers = providerRegistry();
  const availableProviders = [providers.groq, providers.longcat].filter(
    (provider): provider is AIProviderConfig => Boolean(provider),
  );
  if (!availableProviders.length) {
    return NextResponse.json(
      { error: "Neo is not configured. Add the Groq or LongCat API key to the web env file." },
      { status: 503 },
    );
  }

  const payload = (await request.json().catch(() => ({}))) as Partial<NeoChatRequest>;
  const conversation = sanitizeConversation(payload.messages);
  if (!conversation.length || conversation.at(-1)?.role !== "user") {
    return NextResponse.json({ error: "Send a user message to Neo." }, { status: 400 });
  }

  const routing = classifyConversation(conversation);
  const plannerOrder = plannerProviders(routing, providers);
  const synthesisOrder = synthesisProviders(routing, providers);

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        writeStreamEvent(controller, encoder, { type: "status", value: "loading" });

        const accessContext = await resolveAccessContext(request, {
          messages: conversation,
          siteId: payload.siteId ?? "",
          range: normalizeRange(payload.range),
          pathname: payload.pathname,
        });
        let prepared: PreparedNeoResponse | null = null;
        let plannerError: unknown = null;

        for (const planner of plannerOrder) {
          try {
            prepared = await prepareNeoResponse(conversation, accessContext, planner);
            break;
          } catch (error) {
            plannerError = error;
          }
        }

        if (!prepared) {
          throw plannerError instanceof Error ? plannerError : new Error("Neo could not prepare a reply.");
        }

        const toolNames = [...new Set(prepared.usedTools)];
        if (toolNames.length) {
          writeStreamEvent(controller, encoder, { type: "meta", toolNames });
        }

        writeStreamEvent(controller, encoder, { type: "status", value: "streaming" });
        const orderedSynthesisProviders = [
          ...synthesisOrder,
          ...availableProviders.filter(
            (provider) => !synthesisOrder.some((candidate) => candidate.id === provider.id),
          ),
        ];
        const content = await synthesizeNeoReply(prepared, orderedSynthesisProviders, controller, encoder);
        const createdAt = new Date().toISOString();
        const userContent = conversation.at(-1)?.content ?? "";
        let message: NeoChatMessage = {
          id: randomUUID(),
          role: "assistant",
          content,
          createdAt,
          toolNames,
          clientActions: prepared.clientActions,
          visuals: materializeVisualArtifacts(prepared.visualArtifacts, createdAt),
        };
        let userMessage: NeoChatMessage | undefined;

        if (accessContext.mode === "control-plane" && accessContext.viewer?.id && userContent.trim()) {
          try {
            const persisted = await saveNeoConversationTurn({
              siteId: accessContext.currentSite.id,
              viewerId: accessContext.viewer.id,
              userContent,
              assistantContent: content,
              toolNames,
              visuals: prepared.visualArtifacts,
              replaceMessageId: typeof payload.replaceMessageId === "string" ? payload.replaceMessageId.trim() : "",
            });
            userMessage = persisted.userMessage;
            message = {
              ...persisted.assistantMessage,
              clientActions: prepared.clientActions,
            };
          } catch {
            // Neo should still answer even if persistence fails.
          }
        }

        const response: NeoChatResponse = { message, userMessage };
        writeStreamEvent(controller, encoder, { type: "done", ...response });
      } catch (error) {
        writeStreamEvent(controller, encoder, {
          type: "error",
          error: error instanceof Error ? error.message : "Neo request failed.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
