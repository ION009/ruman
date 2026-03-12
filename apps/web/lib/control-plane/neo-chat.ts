import { randomUUID } from "node:crypto";

import { getControlPlaneSql } from "@/lib/control-plane/db";
import type {
  NeoChatMessage,
  NeoChatThread,
  NeoVisualArtifact,
  NeoVisualArtifactDraft,
  NeoVisualPreset,
  NeoVisualTheme,
} from "@/lib/dashboard/types";

type RawNeoThreadRow = {
  id: string;
};

type RawNeoMessageRow = {
  id: string;
  thread_id: string;
  site_id: string;
  role: "user" | "assistant";
  content: string;
  tool_names_json: unknown;
  created_at: string | Date;
};

type RawNeoVisualRow = {
  id: string;
  thread_id: string;
  message_id: string;
  site_id: string;
  preset: string;
  theme: string;
  title: string;
  description: string | null;
  payload_json: unknown;
  created_at: string | Date;
};

function missingNeoChatTables(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return (
    code === "42P01" ||
    message.includes("analytics_neo_threads") ||
    message.includes("analytics_neo_messages") ||
    message.includes("analytics_neo_visual_artifacts")
  );
}

async function ensureNeoChatTables() {
  const sql = getControlPlaneSql();
  await sql`
    CREATE TABLE IF NOT EXISTS analytics_neo_threads
    (
      id              text PRIMARY KEY,
      site_id         text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
      viewer_id       text        NOT NULL,
      created_at      timestamptz NOT NULL DEFAULT now(),
      updated_at      timestamptz NOT NULL DEFAULT now(),
      last_message_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT analytics_neo_threads_site_viewer_key UNIQUE (site_id, viewer_id)
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS analytics_neo_threads_site_updated_idx
      ON analytics_neo_threads (site_id, updated_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_neo_messages
    (
      id              text PRIMARY KEY,
      thread_id       text        NOT NULL REFERENCES analytics_neo_threads(id) ON DELETE CASCADE,
      site_id         text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
      role            text        NOT NULL,
      content         text        NOT NULL,
      tool_names_json jsonb       NOT NULL DEFAULT '[]'::jsonb,
      created_at      timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT analytics_neo_messages_role_check CHECK (role IN ('user', 'assistant'))
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS analytics_neo_messages_thread_created_idx
      ON analytics_neo_messages (thread_id, created_at ASC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS analytics_neo_visual_artifacts
    (
      id           text PRIMARY KEY,
      thread_id    text        NOT NULL REFERENCES analytics_neo_threads(id) ON DELETE CASCADE,
      message_id   text        NOT NULL REFERENCES analytics_neo_messages(id) ON DELETE CASCADE,
      site_id      text        NOT NULL REFERENCES analytics_sites(id) ON DELETE CASCADE,
      preset       text        NOT NULL,
      theme        text        NOT NULL,
      title        text        NOT NULL,
      description  text,
      payload_json jsonb       NOT NULL DEFAULT '{}'::jsonb,
      created_at   timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS analytics_neo_visual_artifacts_message_created_idx
      ON analytics_neo_visual_artifacts (message_id, created_at ASC)
  `;
}

async function retryAfterEnsuringTable<T>(run: () => Promise<T>, fallbackMessage: string) {
  try {
    return await run();
  } catch (error) {
    if (!missingNeoChatTables(error)) {
      throw error;
    }
  }

  await ensureNeoChatTables();

  try {
    return await run();
  } catch (error) {
    if (missingNeoChatTables(error)) {
      throw new Error(fallbackMessage);
    }
    throw error;
  }
}

function parseToolNames(value: unknown) {
  if (Array.isArray(value)) {
    return value.map((entry) => String(entry).trim()).filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    try {
      return parseToolNames(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

function parseVisualPayload(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    try {
      return parseVisualPayload(JSON.parse(value));
    } catch {
      return {};
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function normalizeVisual(visual: RawNeoVisualRow): NeoVisualArtifact {
  return {
    id: visual.id,
    preset: visual.preset as NeoVisualPreset,
    theme: visual.theme as NeoVisualTheme,
    title: visual.title,
    description: visual.description ?? undefined,
    createdAt: new Date(visual.created_at).toISOString(),
    payload: parseVisualPayload(visual.payload_json),
  } as NeoVisualArtifact;
}

function normalizeMessage(
  row: RawNeoMessageRow,
  visuals: NeoVisualArtifact[],
): NeoChatMessage {
  const toolNames = parseToolNames(row.tool_names_json);
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: new Date(row.created_at).toISOString(),
    toolNames,
    visuals,
  };
}

async function getOrCreateNeoThread(siteId: string, viewerId: string) {
  const sql = getControlPlaneSql();
  const rows = await retryAfterEnsuringTable(
    async () =>
      (await sql`
        INSERT INTO analytics_neo_threads (id, site_id, viewer_id, updated_at, last_message_at)
        VALUES (${randomUUID()}, ${siteId}, ${viewerId}, now(), now())
        ON CONFLICT (site_id, viewer_id) DO UPDATE
        SET viewer_id = EXCLUDED.viewer_id
        RETURNING id
      `) as RawNeoThreadRow[],
    "Neo chat persistence is not configured.",
  );
  return rows[0]?.id ?? null;
}

async function listThreadMessages(threadId: string) {
  const sql = getControlPlaneSql();
  return retryAfterEnsuringTable(
    async () =>
      (await sql`
        SELECT id, thread_id, site_id, role, content, tool_names_json, created_at
        FROM analytics_neo_messages
        WHERE thread_id = ${threadId}
        ORDER BY created_at ASC, id ASC
      `) as RawNeoMessageRow[],
    "Neo chat persistence is not configured.",
  );
}

async function refreshThreadTimestamps(threadId: string) {
  const sql = getControlPlaneSql();
  await retryAfterEnsuringTable(
    async () => {
      await sql`
        UPDATE analytics_neo_threads
        SET updated_at = now(),
            last_message_at = COALESCE(
              (SELECT MAX(created_at) FROM analytics_neo_messages WHERE thread_id = ${threadId}),
              created_at
            )
        WHERE id = ${threadId}
      `;
    },
    "Neo chat persistence is not configured.",
  );
}

async function pruneThreadFromMessage(
  threadId: string,
  messageId: string,
  options: { includeTarget: boolean },
) {
  const sql = getControlPlaneSql();
  const messageRows = await listThreadMessages(threadId);
  const targetIndex = messageRows.findIndex((row) => row.id === messageId);

  if (targetIndex < 0) {
    throw new Error("The selected Neo message no longer exists.");
  }

  if (messageRows[targetIndex]?.role !== "user") {
    throw new Error("Only user messages can be edited or rolled back.");
  }

  const deleteFromIndex = options.includeTarget ? targetIndex : targetIndex + 1;
  const rowsToDelete = messageRows.slice(deleteFromIndex);

  for (const row of rowsToDelete) {
    await retryAfterEnsuringTable(
      async () => {
        await sql`
          DELETE FROM analytics_neo_messages
          WHERE thread_id = ${threadId}
            AND id = ${row.id}
        `;
      },
      "Neo chat persistence is not configured.",
    );
  }

  await refreshThreadTimestamps(threadId);
}

export async function listNeoThread(siteId: string, viewerId: string): Promise<NeoChatThread> {
  const sql = getControlPlaneSql();

  try {
    const threadId = await getOrCreateNeoThread(siteId, viewerId);
    if (!threadId) {
      return {
        threadId: null,
        canPersist: false,
        messages: [],
      };
    }

    const messageRows = await listThreadMessages(threadId);

    const visualRows =
      messageRows.length > 0
        ? await retryAfterEnsuringTable(
            async () =>
              (await sql`
                SELECT id, thread_id, message_id, site_id, preset, theme, title, description, payload_json, created_at
                FROM analytics_neo_visual_artifacts
                WHERE thread_id = ${threadId}
                ORDER BY created_at ASC, id ASC
              `) as RawNeoVisualRow[],
            "Neo visual persistence is not configured.",
          )
        : [];

    const visualsByMessage = new Map<string, NeoVisualArtifact[]>();
    for (const row of visualRows) {
      const list = visualsByMessage.get(row.message_id) ?? [];
      list.push(normalizeVisual(row));
      visualsByMessage.set(row.message_id, list);
    }

    return {
      threadId,
      canPersist: true,
      messages: messageRows.map((row) => normalizeMessage(row, visualsByMessage.get(row.id) ?? [])),
    };
  } catch (error) {
    if (
      missingNeoChatTables(error) ||
      (error instanceof Error && error.message === "Neo chat persistence is not configured.")
    ) {
      return {
        threadId: null,
        canPersist: false,
        messages: [],
      };
    }
    throw error;
  }
}

export async function saveNeoConversationTurn(input: {
  siteId: string;
  viewerId: string;
  userContent: string;
  assistantContent: string;
  toolNames?: string[];
  visuals?: NeoVisualArtifactDraft[];
  replaceMessageId?: string;
}) {
  const sql = getControlPlaneSql();
  const threadId = await getOrCreateNeoThread(input.siteId, input.viewerId);
  if (!threadId) {
    throw new Error("Neo chat persistence is unavailable.");
  }

  const replaceMessageId = input.replaceMessageId?.trim() ?? "";
  if (replaceMessageId) {
    await pruneThreadFromMessage(threadId, replaceMessageId, { includeTarget: true });
  }

  const userCreatedAt = new Date().toISOString();
  const assistantCreatedAt = new Date(Date.now() + 1).toISOString();
  const userMessageId = randomUUID();
  const assistantMessageId = randomUUID();
  const toolNames = [...new Set((input.toolNames ?? []).map((entry) => entry.trim()).filter(Boolean))];
  const visuals = input.visuals ?? [];
  const visualRecords = visuals.map((visual) => ({
    id: randomUUID(),
    ...visual,
  }));

  await retryAfterEnsuringTable(
    async () => {
      await sql`
        INSERT INTO analytics_neo_messages (id, thread_id, site_id, role, content, tool_names_json, created_at)
        VALUES (${userMessageId}, ${threadId}, ${input.siteId}, ${"user"}, ${input.userContent}, ${JSON.stringify([])}::jsonb, ${userCreatedAt})
      `;

      await sql`
        INSERT INTO analytics_neo_messages (id, thread_id, site_id, role, content, tool_names_json, created_at)
        VALUES (${assistantMessageId}, ${threadId}, ${input.siteId}, ${"assistant"}, ${input.assistantContent}, ${JSON.stringify(toolNames)}::jsonb, ${assistantCreatedAt})
      `;

      for (const visual of visualRecords) {
        await sql`
          INSERT INTO analytics_neo_visual_artifacts
            (id, thread_id, message_id, site_id, preset, theme, title, description, payload_json, created_at)
          VALUES
            (${visual.id}, ${threadId}, ${assistantMessageId}, ${input.siteId}, ${visual.preset}, ${visual.theme}, ${visual.title},
             ${visual.description ?? null}, ${JSON.stringify(visual.payload)}::jsonb, ${assistantCreatedAt})
        `;
      }

      await refreshThreadTimestamps(threadId);
    },
    "Neo chat persistence is not configured.",
  );

  const persistedVisuals: NeoVisualArtifact[] = visualRecords.map((visual) => ({
    ...visual,
    createdAt: assistantCreatedAt,
  })) as NeoVisualArtifact[];

  return {
    threadId,
    userMessage: {
      id: userMessageId,
      role: "user" as const,
      content: input.userContent,
      createdAt: userCreatedAt,
    },
    assistantMessage: {
      id: assistantMessageId,
      role: "assistant" as const,
      content: input.assistantContent,
      createdAt: assistantCreatedAt,
      toolNames,
      visuals: persistedVisuals,
    },
  };
}

export async function rollbackNeoThreadToMessage(siteId: string, viewerId: string, messageId: string) {
  const threadId = await getOrCreateNeoThread(siteId, viewerId);
  if (!threadId) {
    return {
      threadId: null,
      canPersist: false,
      messages: [],
    } satisfies NeoChatThread;
  }

  await pruneThreadFromMessage(threadId, messageId, { includeTarget: true });
  return listNeoThread(siteId, viewerId);
}
