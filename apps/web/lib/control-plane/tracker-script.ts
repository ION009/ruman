type ResolveTrackerOriginInput = {
  requestOrigin?: string;
};

const DEFAULT_REPLAY_SAMPLE_RATE = 1;

const EXPLICIT_PROTOCOL = /^[a-z][a-z\d+.-]*:\/\//i;

type TrackerScriptOptions = {
  domSnapshotsEnabled?: boolean;
  snapshotOrigin?: string;
  replay?: boolean;
  replaySampleRate?: number;
  spaTrackingEnabled?: boolean;
  errorTrackingEnabled?: boolean;
  performanceTrackingEnabled?: boolean;
  replayMaskTextEnabled?: boolean;
};

function isLocalHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(".local")
  );
}

function parseDomainInput(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  const candidate = EXPLICIT_PROTOCOL.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/\//, "")}`;

  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

export function sanitizeOrigin(value: string) {
  const parsed = parseDomainInput(value);
  if (!parsed) {
    return "";
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    return "";
  }

  if (!parsed.hostname || /\s/.test(parsed.hostname)) {
    return "";
  }

  if (parsed.protocol === "http:" && !isLocalHostname(parsed.hostname)) {
    return "";
  }

  return parsed.origin;
}

export function deriveSiteNameFromOrigin(origin: string) {
  const parsed = parseDomainInput(origin);
  if (!parsed) {
    return "";
  }

  if (parsed.port) {
    return `${parsed.hostname.replace(/^www\./i, "")}:${parsed.port}`;
  }

  return parsed.hostname.replace(/^www\./i, "");
}

export function resolveTrackerCollectorOrigin(input: ResolveTrackerOriginInput) {
  const fromEnv =
    process.env.ANLTICSHEAT_TRACKER_PUBLIC_ORIGIN ||
    process.env.ANLTICSHEAT_API_BASE_URL ||
    "";
  const resolved = sanitizeOrigin(fromEnv) || sanitizeOrigin(input.requestOrigin ?? "");
  return resolved.replace(/\/$/, "");
}

export function resolveSnapshotIngestOrigin(input: ResolveTrackerOriginInput) {
  const fromEnv =
    process.env.ANLTICSHEAT_SNAPSHOT_PUBLIC_ORIGIN ||
    process.env.ANLTICSHEAT_WEB_PUBLIC_ORIGIN ||
    "";
  const resolved = sanitizeOrigin(fromEnv) || sanitizeOrigin(input.requestOrigin ?? "");
  return resolved.replace(/\/$/, "");
}

export function buildTrackerScriptSrc(
  collectorOrigin: string,
  siteId: string,
  options?: TrackerScriptOptions,
) {
  const base = collectorOrigin.replace(/\/$/, "");
  const src = new URL(`${base}/t.js`);
  src.searchParams.set("id", siteId);
  const snapshotOrigin = sanitizeOrigin(options?.snapshotOrigin ?? "");
  if (snapshotOrigin) {
    src.searchParams.set("snapshot_origin", snapshotOrigin);
  }
  if (options?.replay !== false) {
    src.searchParams.set("replay", "1");
    src.searchParams.set(
      "replay_sample",
      String(
        Math.max(0, Math.min(1, Number.isFinite(options?.replaySampleRate) ? options?.replaySampleRate ?? DEFAULT_REPLAY_SAMPLE_RATE : DEFAULT_REPLAY_SAMPLE_RATE)),
      ),
    );
  }
  src.searchParams.set("spa", options?.spaTrackingEnabled === false ? "0" : "1");
  src.searchParams.set("err", options?.errorTrackingEnabled === false ? "0" : "1");
  src.searchParams.set("perf", options?.performanceTrackingEnabled === false ? "0" : "1");
  src.searchParams.set("replay_mask_text", options?.replayMaskTextEnabled ? "1" : "0");
  return src.toString();
}

export function buildTrackerSnippet(
  collectorOrigin: string,
  siteId: string,
  options?: TrackerScriptOptions,
) {
  const src = buildTrackerScriptSrc(collectorOrigin, siteId, options);
  const attributes = [`defer`, `src="${src}"`, `data-site="${siteId}"`];
  if (options?.domSnapshotsEnabled) {
    attributes.push(`data-snapshots="true"`);
  }
  if (options?.replay !== false) {
    const replaySampleRate = Math.max(
      0,
      Math.min(
        1,
        Number.isFinite(options?.replaySampleRate)
          ? options?.replaySampleRate ?? DEFAULT_REPLAY_SAMPLE_RATE
          : DEFAULT_REPLAY_SAMPLE_RATE,
      ),
    );
    attributes.push(`data-replay="true"`);
    attributes.push(`data-replay-sample-rate="${replaySampleRate}"`);
  }
  attributes.push(`data-spa="${options?.spaTrackingEnabled === false ? "false" : "true"}"`);
  attributes.push(`data-errors="${options?.errorTrackingEnabled === false ? "false" : "true"}"`);
  attributes.push(`data-performance="${options?.performanceTrackingEnabled === false ? "false" : "true"}"`);
  attributes.push(`data-replay-mask-text="${options?.replayMaskTextEnabled ? "true" : "false"}"`);
  return `<script ${attributes.join(" ")}></script>`;
}
