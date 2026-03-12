"use client";

import { useQueryClient } from "@tanstack/react-query";
import { ArrowUp, BarChart3, Check, Copy, Pencil, RotateCcw, Sparkles, X } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";

import { NeoVisualModal } from "@/components/dashboard/neo-visual-modal";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useDashboardContext, useDashboardNeoThread } from "@/hooks/use-dashboard";
import { setClientCSRFToken } from "@/lib/csrf/client";
import { dashboardKeys, rollbackDashboardNeoThread, streamNeoChatMessage } from "@/lib/dashboard/client";
import type { DashboardSite, NeoChatMessage, NeoChatThread } from "@/lib/dashboard/types";
import { cn } from "@/lib/utils";
import { useDashboardStore } from "@/stores/dashboard-store";

type NeoPanelStatus = "idle" | "loading" | "streaming";
type RichSegment =
  | { type: "text"; value: string }
  | { type: "code"; value: string; language: string };

const starterPrompts = [
  "Summarize the current site in plain English.",
  "Which page needs attention first?",
  "Show me the tracker install snippet.",
  "What tools did you use for the last answer?",
];

function labelForSite(site: DashboardSite | undefined) {
  if (!site) {
    return "No site";
  }

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

function formatToolLabel(toolName: string) {
  return toolName
    .replace(/^(get_|update_)/, "")
    .replaceAll("_", " ")
    .trim();
}

function parseRichSegments(content: string): RichSegment[] {
  const segments: RichSegment[] = [];
  const fence = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
  let cursor = 0;

  for (const match of content.matchAll(fence)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ type: "text", value: content.slice(cursor, index) });
    }

    segments.push({
      type: "code",
      language: (match[1] ?? "").trim(),
      value: match[2]?.trimEnd() ?? "",
    });
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    segments.push({ type: "text", value: content.slice(cursor) });
  }

  return segments.length ? segments : [{ type: "text", value: content }];
}

function findEditableMessageIndex(messages: NeoChatMessage[], messageId: string) {
  return messages.findIndex((message) => message.id === messageId && message.role === "user");
}

function updateThreadCache(current: NeoChatThread | undefined, messages: NeoChatMessage[]): NeoChatThread {
  return {
    threadId: current?.threadId ?? null,
    canPersist: current?.canPersist ?? true,
    messages,
  };
}

function cleanTextBlock(input: string) {
  return input
    .replace(/\r/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*---+\s*$/gm, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .trim();
}

function TextBlock({ value }: { value: string }) {
  const normalized = cleanTextBlock(value);
  if (!normalized) {
    return null;
  }

  const sections = normalized
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);

  return (
    <div className="space-y-3">
      {sections.map((section, index) => {
        const lines = section
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean);
        const bulletItems = lines.map((line) => {
          if (/^[-*]\s+/.test(line)) {
            return line.replace(/^[-*]\s+/, "");
          }
          if (/^\d+[.)]\s+/.test(line)) {
            return line.replace(/^\d+[.)]\s+/, "");
          }
          return null;
        });

        if (bulletItems.every(Boolean)) {
          return (
            <ul
              key={`${section}-${index}`}
              className="space-y-1.5 pl-4 text-[13px] leading-6 text-text-primary/80 [overflow-wrap:anywhere]"
            >
              {bulletItems.map((item, itemIndex) => (
                <li key={`${item}-${itemIndex}`} className="list-disc">
                  {item}
                </li>
              ))}
            </ul>
          );
        }

        return (
          <p
            key={`${section}-${index}`}
            className="whitespace-pre-wrap text-[13px] leading-6 text-text-primary/80 [overflow-wrap:anywhere]"
          >
            {lines.join(" ")}
          </p>
        );
      })}
    </div>
  );
}

function RichMessageContent({ content }: { content: string }) {
  const segments = parseRichSegments(content);

  return (
    <div className="space-y-3">
      {segments.map((segment, index) => {
        if (segment.type === "code") {
          return (
            <div
              key={`code-${index}`}
              className="overflow-hidden rounded-2xl border border-border-default bg-[#1C1917] dark:bg-[#111113]"
            >
              {segment.language ? (
                <div className="border-b border-white/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">
                  {segment.language}
                </div>
              ) : null}
              <pre className="overflow-x-auto px-3 py-3 text-[12px] leading-6 text-white/85">
                <code>{segment.value}</code>
              </pre>
            </div>
          );
        }

        return <TextBlock key={`text-${index}`} value={segment.value} />;
      })}
    </div>
  );
}

function LoadingBubble({ toolNames }: { toolNames?: string[] }) {
  return (
    <span className="neo-thinking-label">
      Thinking{toolNames?.length ? ` / ${toolNames.map(formatToolLabel).join(" / ")}` : ""}
    </span>
  );
}

function MessageBubble({
  message,
  isPending,
  onOpenVisuals,
  onCopy,
  onEdit,
  onRollback,
  isEditing,
  copied,
}: {
  message: NeoChatMessage;
  isPending?: boolean;
  onOpenVisuals?: (message: NeoChatMessage) => void;
  onCopy?: (message: NeoChatMessage) => void;
  onEdit?: (message: NeoChatMessage) => void;
  onRollback?: (message: NeoChatMessage) => void;
  isEditing?: boolean;
  copied?: boolean;
}) {
  const isAssistant = message.role === "assistant";

  if (isAssistant && isPending && !message.content) {
    return (
      <div className="mr-auto flex max-w-[92%] items-center gap-3 py-1">
        <LoadingBubble toolNames={message.toolNames} />
      </div>
    );
  }

  return (
    <div className={cn("group flex min-w-0 max-w-[92%] flex-col", isAssistant ? "items-start" : "items-end")}>
      <div
        className={cn(
          "min-w-0 w-full overflow-hidden rounded-[1.3rem] px-4 py-3 shadow-sm",
          isAssistant
            ? "mr-auto border border-border-default/60 bg-surface-primary/92 backdrop-blur-sm"
            : "ml-auto bg-foreground text-background shadow-[0_18px_30px_rgba(0,0,0,0.18)]",
          isEditing && "ring-2 ring-accent-teal/35 ring-offset-2 ring-offset-surface-secondary",
        )}
      >
        {isAssistant && isPending ? (
          <p className="whitespace-pre-wrap text-[13px] leading-6 text-text-secondary [overflow-wrap:anywhere]">
            {message.content}
          </p>
        ) : isAssistant ? (
          <RichMessageContent content={message.content} />
        ) : (
          <p className="whitespace-pre-wrap text-[13px] leading-6 [overflow-wrap:anywhere]">{message.content}</p>
        )}

        {isAssistant && !isPending && message.toolNames?.length ? (
          <div className="mt-3 border-t border-border/40 pt-2 text-[11px] text-text-muted">
            Tools used: {message.toolNames.map(formatToolLabel).join(" / ")}
          </div>
        ) : null}

        {isAssistant && !isPending && message.visuals?.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 rounded-full border-border/60 px-3 text-[11px] normal-case tracking-normal"
              onClick={() => onOpenVisuals?.(message)}
            >
              <BarChart3 className="size-3.5" />
              {message.visuals.length > 1 ? `See visuals (${message.visuals.length})` : "See visual"}
            </Button>
          </div>
        ) : null}
      </div>

      {!isPending ? (
        <div
          className={cn(
            "mt-1 flex flex-wrap items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
            isAssistant ? "justify-start" : "justify-end",
            copied && "opacity-100",
            isEditing && "opacity-100",
          )}
        >
          <button
            type="button"
            className="inline-flex h-7 items-center gap-1 rounded-full border border-border/60 bg-surface-primary px-2.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary"
            onClick={() => onCopy?.(message)}
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copied" : "Copy"}
          </button>

          {!isAssistant ? (
            <button
              type="button"
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] transition-colors",
                isEditing
                  ? "border-accent-teal/40 bg-accent-teal/10 text-accent-teal"
                  : "border-border/60 bg-surface-primary text-text-secondary hover:bg-surface-tertiary hover:text-text-primary",
              )}
              onClick={() => onEdit?.(message)}
            >
              <Pencil className="size-3.5" />
              Edit
            </button>
          ) : null}

          {!isAssistant ? (
            <button
              type="button"
              className="inline-flex h-7 items-center gap-1 rounded-full border border-border/60 bg-surface-primary px-2.5 text-[11px] text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary"
              onClick={() => onRollback?.(message)}
            >
              <RotateCcw className="size-3.5" />
              Rollback
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function NeoPanel({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { setTheme } = useTheme();
  const contextQuery = useDashboardContext();
  const historyQuery = useDashboardNeoThread(isOpen);
  const selectedSiteId = useDashboardStore((state) => state.selectedSiteId);
  const selectedRange = useDashboardStore((state) => state.selectedRange);
  const [messages, setMessages] = useState<NeoChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<NeoPanelStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [visualMessage, setVisualMessage] = useState<NeoChatMessage | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const scrollRootRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const hydratedSiteRef = useRef("");
  const copyResetRef = useRef<number | null>(null);

  const currentSite =
    contextQuery.data?.sites.find((site) => site.id === selectedSiteId) ?? contextQuery.data?.sites[0];
  const canPersistThread =
    historyQuery.data?.canPersist ?? contextQuery.data?.mode === "control-plane";
  const editingMessage =
    editingMessageId != null
      ? messages.find((message) => message.id === editingMessageId && message.role === "user") ?? null
      : null;

  function syncMessages(nextValue: NeoChatMessage[] | ((current: NeoChatMessage[]) => NeoChatMessage[])) {
    setMessages((current) => {
      const nextMessages = typeof nextValue === "function" ? nextValue(current) : nextValue;
      if (selectedSiteId) {
        queryClient.setQueryData<NeoChatThread>(dashboardKeys.neoThread(selectedSiteId), (cached) =>
          updateThreadCache(cached, nextMessages),
        );
      }
      return nextMessages;
    });
  }

  function focusComposer() {
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      const cursor = textarea.value.length;
      textarea.setSelectionRange(cursor, cursor);
    });
  }

  useEffect(() => {
    if (contextQuery.data?.csrfToken) {
      setClientCSRFToken(contextQuery.data.csrfToken);
    }
  }, [contextQuery.data?.csrfToken]);

  useEffect(() => {
    return () => {
      if (copyResetRef.current != null) {
        window.clearTimeout(copyResetRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [draft]);

  useEffect(() => {
    const container = scrollRootRef.current;
    if (!container) {
      return;
    }

    const behavior = status === "streaming" ? "auto" : "smooth";
    const frame = window.requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [messages, status]);

  useEffect(() => {
    if (selectedSiteId !== hydratedSiteRef.current) {
      setMessages([]);
      setDraft("");
      setError(null);
      setVisualMessage(null);
      setEditingMessageId(null);
      setCopiedMessageId(null);
      hydratedSiteRef.current = "";
    }
  }, [selectedSiteId]);

  useEffect(() => {
    if (!historyQuery.data || status !== "idle" || hydratedSiteRef.current === selectedSiteId) {
      return;
    }

    setMessages(historyQuery.data.messages);
    setEditingMessageId(null);
    hydratedSiteRef.current = selectedSiteId;
  }, [historyQuery.data, selectedSiteId, status]);

  async function handleCopy(message: NeoChatMessage) {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopiedMessageId(message.id);
      if (copyResetRef.current != null) {
        window.clearTimeout(copyResetRef.current);
      }
      copyResetRef.current = window.setTimeout(() => {
        setCopiedMessageId((current) => (current === message.id ? null : current));
      }, 1600);
    } catch {
      setError("Could not copy that message.");
    }
  }

  function handleEdit(message: NeoChatMessage) {
    if (status !== "idle" || message.role !== "user") {
      return;
    }

    setEditingMessageId(message.id);
    setDraft(message.content);
    setError(null);
    focusComposer();
  }

  function cancelEditing() {
    setEditingMessageId(null);
    setDraft("");
    setError(null);
  }

  async function handleRollback(message: NeoChatMessage) {
    if (status !== "idle" || message.role !== "user") {
      return;
    }

    const messageIndex = findEditableMessageIndex(messages, message.id);
    if (messageIndex < 0) {
      return;
    }

    const previousMessages = messages;
    const rolledBackMessages = messages.slice(0, messageIndex);
    syncMessages(rolledBackMessages);
    setDraft(message.content);
    setEditingMessageId(null);
    setError(null);
    focusComposer();

    if (!selectedSiteId || !canPersistThread) {
      return;
    }

    try {
      const thread = await rollbackDashboardNeoThread({
        siteId: selectedSiteId,
        messageId: message.id,
      });

      setMessages(thread.messages);
      queryClient.setQueryData(dashboardKeys.neoThread(selectedSiteId), thread);
      hydratedSiteRef.current = selectedSiteId;
    } catch (requestError) {
      syncMessages(previousMessages);
      setError(requestError instanceof Error ? requestError.message : "Could not roll back that message.");
    }
  }

  async function handleSend(rawContent: string) {
    const content = rawContent.trim();
    if (!content || status !== "idle" || !selectedSiteId) {
      return;
    }

    const replaceMessageId =
      editingMessageId && findEditableMessageIndex(messages, editingMessageId) >= 0 ? editingMessageId : "";
    const baseMessages =
      replaceMessageId ? messages.slice(0, findEditableMessageIndex(messages, replaceMessageId)) : messages;
    const previousMessages = messages;
    const previousEditingMessageId = editingMessageId;

    const userMessage: NeoChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const assistantPlaceholderId = crypto.randomUUID();
    const assistantPlaceholder: NeoChatMessage = {
      id: assistantPlaceholderId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      toolNames: [],
    };

    const nextMessages = [...baseMessages, userMessage, assistantPlaceholder];
    syncMessages(nextMessages);
    setDraft("");
    setError(null);
    setStatus("loading");
    setEditingMessageId(null);

    try {
      const response = await streamNeoChatMessage(
        {
          messages: nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          siteId: selectedSiteId,
          range: selectedRange,
          pathname,
          replaceMessageId: replaceMessageId || undefined,
        },
        {
          onStatus: (value) => setStatus(value),
          onMeta: (toolNames) => {
            syncMessages((current) =>
              current.map((message) =>
                message.id === assistantPlaceholderId
                  ? {
                      ...message,
                      toolNames,
                    }
                  : message,
              ),
            );
          },
          onDelta: (text) => {
            setStatus("streaming");
            syncMessages((current) =>
              current.map((message) =>
                message.id === assistantPlaceholderId
                  ? {
                      ...message,
                      content: `${message.content}${text}`,
                    }
                  : message,
              ),
            );
          },
        },
      );

      syncMessages((current) =>
        current.map((message) => {
          if (response.userMessage && message.id === userMessage.id) {
            return response.userMessage;
          }
          if (message.id === assistantPlaceholderId) {
            return response.message;
          }
          return message;
        }),
      );

      if (response.message.clientActions?.length) {
        for (const action of response.message.clientActions) {
          if (action.type === "theme") {
            setTheme(action.theme);
            continue;
          }
          if (action.type === "logout") {
            await fetch("/api/auth/logout", { method: "POST" });
            onClose();
            router.push("/auth/sign-in");
            router.refresh();
            return;
          }
        }
      }
    } catch (requestError) {
      syncMessages(previousMessages);
      setDraft(content);
      setEditingMessageId(previousEditingMessageId);
      setError(requestError instanceof Error ? requestError.message : "Neo request failed.");
    } finally {
      setStatus("idle");
    }
  }

  const isBusy = status !== "idle";

  return (
    <>
      {isOpen ? (
        <div
          className="fixed inset-0 z-50 bg-foreground/14"
          onClick={onClose}
        />
      ) : null}

      <aside
        className={cn(
          "fixed right-0 top-0 z-50 flex h-full w-full max-w-[26rem] flex-col overflow-hidden border-l border-border/60 bg-surface-secondary shadow-[0_24px_60px_rgba(28,25,23,0.10)] transition-transform duration-200 will-change-transform",
          isOpen ? "translate-x-0" : "translate-x-full",
        )}
        aria-hidden={!isOpen}
      >
        <div className="relative border-b border-border/60 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-[0.95rem] bg-foreground text-white shadow-[0_14px_24px_rgba(28,25,23,0.14)]">
                <Sparkles className="size-4.5" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold tracking-tight text-text-primary">Neo</p>
                <p className="truncate text-[11px] text-text-secondary">
                  {labelForSite(currentSite)} / {selectedRange.toUpperCase()}
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              className="rounded-[0.95rem] border border-border/60 bg-surface-primary/90 text-text-secondary hover:bg-surface-secondary"
              onClick={onClose}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div ref={scrollRootRef} className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            {messages.length === 0 ? (
              <div className="rounded-[1.2rem] border border-border-default/60 bg-surface-primary/88 p-4 shadow-sm backdrop-blur-sm">
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-text-secondary">
                  <Sparkles className="size-3.5 text-accent-teal" />
                  Quick starts
                </div>
                <div className="mt-3 grid gap-2">
                  {starterPrompts.map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      className="rounded-[0.95rem] border border-border/60 bg-surface-tertiary px-3 py-2.5 text-left text-[13px] text-text-primary transition-colors hover:bg-surface-primary"
                      onClick={() => void handleSend(prompt)}
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {messages.map((message) => (
              <div
                key={message.id}
                className={cn("flex", message.role === "assistant" ? "justify-start" : "justify-end")}
              >
                <MessageBubble
                  message={message}
                  isPending={isBusy && message.role === "assistant" && message.content.length === 0}
                  onOpenVisuals={setVisualMessage}
                  onCopy={handleCopy}
                  onEdit={handleEdit}
                  onRollback={handleRollback}
                  isEditing={editingMessageId === message.id}
                  copied={copiedMessageId === message.id}
                />
              </div>
            ))}

            {error ? (
              <div className="rounded-[1rem] border border-status-error/20 bg-status-error-bg px-4 py-3 text-sm text-status-error">
                {error}
              </div>
            ) : null}

            {historyQuery.error && messages.length === 0 ? (
              <div className="rounded-[1rem] border border-status-error/20 bg-status-error-bg px-4 py-3 text-sm text-status-error">
                {historyQuery.error.message}
              </div>
            ) : null}
          </div>
        </div>

        <div className="border-t border-border-default/60 bg-surface-primary/92 px-4 py-3 backdrop-blur-sm">
          {editingMessage ? (
            <div className="mb-2 flex items-start justify-between gap-3 rounded-[0.95rem] border border-accent-teal/20 bg-accent-teal/5 px-3 py-2 text-[11px] text-text-secondary">
              <p className="leading-5">
                <span className="font-semibold text-text-primary">Editing an earlier message.</span> Sending now will
                replace that message and every reply after it.
              </p>
              <button
                type="button"
                className="shrink-0 rounded-full px-2 py-1 text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary"
                onClick={cancelEditing}
              >
                Cancel
              </button>
            </div>
          ) : null}

          <div className="rounded-[1rem] border border-border/60 bg-surface-primary px-3 py-2 shadow-sm">
            <div className="flex items-end gap-2">
              <Textarea
                ref={textareaRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  editingMessage
                    ? "Update the message, then send to replace the later replies..."
                    : "Ask about metrics, settings, pages, snippets, charts, or visual explanations..."
                }
                className="min-h-0 h-[44px] max-h-40 resize-none overflow-y-auto border-none bg-transparent px-0 py-1.5 text-[13px] shadow-none focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend(draft);
                  }
                }}
              />

              <button
                type="button"
                className="inline-flex size-10 shrink-0 items-center justify-center rounded-[0.95rem] bg-foreground text-white transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:bg-text-muted"
                onClick={() => void handleSend(draft)}
                disabled={isBusy || !draft.trim() || !selectedSiteId}
              >
                <ArrowUp className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </aside>

      <NeoVisualModal message={visualMessage} open={Boolean(visualMessage)} onClose={() => setVisualMessage(null)} />
    </>
  );
}
