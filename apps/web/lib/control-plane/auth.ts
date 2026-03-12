import { cookies } from "next/headers";
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from "node:crypto";

import { getControlPlaneSql } from "@/lib/control-plane/db";
import type {
  ControlPlaneSession,
  ControlPlaneSite,
  ControlPlaneSitePrivacySettings,
  ControlPlaneSiteSettings,
  ControlPlaneTrackerScript,
  ControlPlaneViewer,
  SiteRegistrationInput,
} from "@/lib/control-plane/types";
import { getSitePrivacySettings, getSiteSettings, updateSitePrivacySettings, updateSiteSettings, type SiteSettingsUpdate } from "@/lib/control-plane/site-settings";
import {
  buildTrackerScriptSrc,
  buildTrackerSnippet,
  deriveSiteNameFromOrigin,
  resolveTrackerCollectorOrigin,
  resolveSnapshotIngestOrigin,
  sanitizeOrigin,
} from "@/lib/control-plane/tracker-script";
import { discoverAndStoreSitePages } from "@/lib/control-plane/site-page-discovery";
import { slugify } from "@/lib/utils";
import { AUTH_SESSION_COOKIE } from "@/lib/session";

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 14;
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};

type RawUserRow = {
  id: string;
  email: string;
  password_hash: string;
  full_name: string | null;
};

type RawSessionRow = {
  session_id: string;
  user_id: string;
  email: string;
  full_name: string | null;
};

type RawSiteRow = {
  id: string;
  name: string;
  slug: string;
  role: string;
  origins: string[] | null;
};

type RawTrackerScriptRow = {
  site_id: string;
  install_origin: string;
  collector_origin: string;
  script_src: string;
  script_tag: string;
  updated_at: string | Date | null;
};

type CreatedSession = {
  sessionId: string;
  sessionSecret: string;
};

function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

function normalizeFullName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function prepareSiteInput(input: SiteRegistrationInput) {
  const origin = sanitizeOrigin(input.origin ?? input.domain ?? "");
  const name = (input.name ?? "").trim() || deriveSiteNameFromOrigin(origin);
  return { name, origin };
}

function toTrackerScript(
  row: RawTrackerScriptRow,
  options: {
    persisted: boolean;
  },
): ControlPlaneTrackerScript {
  return {
    siteId: row.site_id,
    installOrigin: row.install_origin,
    collectorOrigin: row.collector_origin,
    scriptSrc: row.script_src,
    scriptTag: row.script_tag,
    isPersisted: options.persisted,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function missingScriptsTable(error: unknown) {
  const raw = error as { code?: unknown; message?: unknown } | null;
  const code = String(raw?.code ?? "");
  const message = String(raw?.message ?? "").toLowerCase();
  return code === "42P01" || message.includes("analytics_site_scripts");
}

function trackerScriptOptions(
  requestOrigin: string,
  settings: ControlPlaneSiteSettings,
) {
  const snapshotOrigin =
    resolveSnapshotIngestOrigin({ requestOrigin }) || requestOrigin;
  return {
    domSnapshotsEnabled: settings.tracking.domSnapshotsEnabled,
    spaTrackingEnabled: settings.tracking.spaTrackingEnabled,
    errorTrackingEnabled: settings.tracking.errorTrackingEnabled,
    performanceTrackingEnabled: settings.tracking.performanceTrackingEnabled,
    replayMaskTextEnabled: settings.tracking.replayMaskTextEnabled,
    snapshotOrigin,
  };
}

function fallbackTrackerScript(
  siteId: string,
  installOrigin: string,
  requestOrigin: string,
  settings: ControlPlaneSiteSettings,
): ControlPlaneTrackerScript {
  const collectorOrigin = resolveTrackerCollectorOrigin({ requestOrigin }) || requestOrigin || installOrigin;
  const options = trackerScriptOptions(requestOrigin || installOrigin, settings);
  return {
    siteId,
    installOrigin,
    collectorOrigin,
    scriptSrc: buildTrackerScriptSrc(collectorOrigin, siteId, options),
    scriptTag: buildTrackerSnippet(collectorOrigin, siteId, options),
    isPersisted: false,
    updatedAt: null,
  };
}

async function readTrackerScript(siteId: string) {
  const sql = getControlPlaneSql();
  const rows = (await sql`
    SELECT site_id, install_origin, collector_origin, script_src, script_tag, updated_at
    FROM analytics_site_scripts
    WHERE site_id = ${siteId}
    LIMIT 1
  `) as RawTrackerScriptRow[];

  const row = rows[0];
  if (!row) {
    return null;
  }
  return toTrackerScript(row, { persisted: true });
}

async function upsertTrackerScript(
  siteId: string,
  installOrigin: string,
  requestOrigin: string,
  settings: ControlPlaneSiteSettings,
) {
  const sql = getControlPlaneSql();
  const collectorOrigin = resolveTrackerCollectorOrigin({ requestOrigin }) || requestOrigin || installOrigin;
  const options = trackerScriptOptions(requestOrigin || installOrigin, settings);
  const scriptSrc = buildTrackerScriptSrc(collectorOrigin, siteId, options);
  const scriptTag = buildTrackerSnippet(collectorOrigin, siteId, options);

  const rows = (await sql`
    INSERT INTO analytics_site_scripts (site_id, install_origin, collector_origin, script_src, script_tag, updated_at)
    VALUES (${siteId}, ${installOrigin}, ${collectorOrigin}, ${scriptSrc}, ${scriptTag}, NOW())
    ON CONFLICT (site_id) DO UPDATE
    SET install_origin = EXCLUDED.install_origin,
        collector_origin = EXCLUDED.collector_origin,
        script_src = EXCLUDED.script_src,
        script_tag = EXCLUDED.script_tag,
        updated_at = NOW()
    RETURNING site_id, install_origin, collector_origin, script_src, script_tag, updated_at
  `) as RawTrackerScriptRow[];

  return toTrackerScript(rows[0], { persisted: true });
}

async function ensureTrackerScript(siteId: string, installOrigin: string, requestOrigin: string) {
  const settings = await getSiteSettings(siteId);
  try {
    const existing = await readTrackerScript(siteId);
    const expectedFallback = fallbackTrackerScript(siteId, installOrigin, requestOrigin, settings);
    if (
      existing &&
      existing.installOrigin === expectedFallback.installOrigin &&
      existing.collectorOrigin === expectedFallback.collectorOrigin &&
      existing.scriptSrc === expectedFallback.scriptSrc &&
      existing.scriptTag === expectedFallback.scriptTag
    ) {
      return existing;
    }
    return await upsertTrackerScript(siteId, installOrigin, requestOrigin, settings);
  } catch (error) {
    if (missingScriptsTable(error)) {
      return fallbackTrackerScript(siteId, installOrigin, requestOrigin, settings);
    }
    throw error;
  }
}

async function warmSitePageDiscovery(siteId: string, origin: string) {
  try {
    await discoverAndStoreSitePages(siteId, origin);
  } catch (error) {
    console.warn(
      "[site-page-discovery] warmup failed",
      JSON.stringify({ siteId, origin, error: error instanceof Error ? error.message : "unknown" }),
    );
  }
}

function hashValue(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function encodePassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `scrypt:${salt}:${derived}`;
}

function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, hash] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !hash) {
    return false;
  }

  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, 64);

  if (expected.length !== actual.length) {
    return false;
  }

  return timingSafeEqual(expected, actual);
}

function buildViewer(row: { id: string; email: string; full_name: string | null }): ControlPlaneViewer {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name?.trim() || row.email,
  };
}

function createSessionRecord(): CreatedSession {
  return {
    sessionId: randomUUID(),
    sessionSecret: randomBytes(32).toString("base64url"),
  };
}

async function insertSession(userId: string): Promise<CreatedSession> {
  const sql = getControlPlaneSql();
  const session = createSessionRecord();
  const secretHash = hashValue(session.sessionSecret);

  await sql`
    INSERT INTO app_sessions (id, user_id, secret_hash, expires_at)
    VALUES (${session.sessionId}, ${userId}, ${secretHash}, NOW() + INTERVAL '14 days')
  `;

  return session;
}

async function writeSessionCookie(session: CreatedSession) {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_SESSION_COOKIE, `${session.sessionId}.${session.sessionSecret}`, SESSION_COOKIE_OPTIONS);
}

export async function clearAuthCookies() {
  const cookieStore = await cookies();
  cookieStore.delete(AUTH_SESSION_COOKIE);
}

export async function registerAccount(input: {
  email: string;
  password: string;
  fullName: string;
  site: SiteRegistrationInput;
  requestOrigin: string;
}) {
  const email = normalizeEmail(input.email);
  const fullName = normalizeFullName(input.fullName);
  const siteInput = prepareSiteInput(input.site);
  const siteName = siteInput.name;
  const origin = siteInput.origin;

  if (!email || !email.includes("@")) {
    throw new Error("Enter a valid work email.");
  }
  if (input.password.trim().length < 8) {
    throw new Error("Password must be at least 8 characters.");
  }
  if (!fullName) {
    throw new Error("Enter your full name.");
  }
  if (!siteName) {
    throw new Error("Enter the first site name.");
  }
  if (!origin) {
    throw new Error("Enter a valid site domain.");
  }

  const sql = getControlPlaneSql();
  const existing = (await sql`
    SELECT id
    FROM app_users
    WHERE lower(email) = ${email}
    LIMIT 1
  `) as Pick<RawUserRow, "id">[];
  if (existing.length) {
    throw new Error("An account with that email already exists.");
  }

  const userId = randomUUID();
  const siteIdBase = slugify(siteName).slice(0, 24) || "site";
  const siteId = `${siteIdBase}-${randomBytes(3).toString("hex")}`;
  const siteSlug = `${siteIdBase}-${randomBytes(3).toString("hex")}`;
  const siteSalt = randomBytes(16).toString("hex");
  const passwordHash = encodePassword(input.password);
  const session = createSessionRecord();

  try {
    await sql.transaction([
      sql`
        INSERT INTO app_users (id, email, password_hash, full_name)
        VALUES (${userId}, ${email}, ${passwordHash}, ${fullName})
      `,
      sql`
        INSERT INTO analytics_sites (id, name, slug, owner_user_id, salt)
        VALUES (${siteId}, ${siteName}, ${siteSlug}, ${userId}, ${siteSalt})
      `,
      sql`
        INSERT INTO analytics_site_memberships (site_id, user_id, role)
        VALUES (${siteId}, ${userId}, 'owner')
      `,
      sql`
        INSERT INTO analytics_site_origins (site_id, origin)
        VALUES (${siteId}, ${origin})
      `,
      sql`
        INSERT INTO analytics_site_settings (site_id)
        VALUES (${siteId})
        ON CONFLICT (site_id) DO NOTHING
      `,
      sql`
        INSERT INTO app_sessions (id, user_id, secret_hash, expires_at)
        VALUES (${session.sessionId}, ${userId}, ${hashValue(session.sessionSecret)}, NOW() + INTERVAL '14 days')
      `,
    ]);
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Failed to register account.");
  }

  await ensureTrackerScript(siteId, origin, input.requestOrigin);
  await warmSitePageDiscovery(siteId, origin);

  await writeSessionCookie(session);

  return {
    viewer: {
      id: userId,
      email,
      fullName,
    },
    siteId,
  };
}

export async function createEmailPasswordSession(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const password = input.password;

  if (!email || !password) {
    throw new Error("Enter your email and password.");
  }

  const sql = getControlPlaneSql();
  const rows = (await sql`
    SELECT id, email, password_hash, full_name
    FROM app_users
    WHERE lower(email) = ${email}
    ORDER BY created_at ASC
  `) as RawUserRow[];

  const user = rows.find((item) => verifyPassword(password, item.password_hash));
  if (!user) {
    throw new Error("Email or password is incorrect.");
  }

  const session = await insertSession(user.id);
  await writeSessionCookie(session);

  return buildViewer(user);
}

export async function deleteCurrentSession() {
  const session = await getCurrentSession();
  if (!session) {
    await clearAuthCookies();
    return;
  }

  const sql = getControlPlaneSql();
  await sql`DELETE FROM app_sessions WHERE id = ${session.sessionId}`;
  await clearAuthCookies();
}

export async function getCurrentSession(): Promise<ControlPlaneSession | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(AUTH_SESSION_COOKIE)?.value ?? "";
  if (!raw.includes(".")) {
    return null;
  }

  const [sessionId, sessionSecret] = raw.split(".", 2);
  if (!sessionId || !sessionSecret) {
    return null;
  }

  const sql = getControlPlaneSql();
  const rows = (await sql`
    SELECT
      s.id AS session_id,
      u.id AS user_id,
      u.email,
      u.full_name
    FROM app_sessions s
    JOIN app_users u ON u.id = s.user_id
    WHERE s.id = ${sessionId}
      AND s.secret_hash = ${hashValue(sessionSecret)}
      AND s.expires_at > NOW()
    LIMIT 1
  `) as RawSessionRow[];

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    sessionId: row.session_id,
    user: buildViewer({
      id: row.user_id,
      email: row.email,
      full_name: row.full_name,
    }),
  };
}

export async function requireCurrentSession() {
  const session = await getCurrentSession();
  if (!session) {
    throw new Error("Authentication required.");
  }
  return session;
}

export async function listSitesForUser(userId: string): Promise<ControlPlaneSite[]> {
  const sql = getControlPlaneSql();
  const rows = (await sql`
    SELECT
      s.id,
      s.name,
      s.slug,
      m.role,
      COALESCE(array_remove(array_agg(o.origin ORDER BY o.origin), NULL), ARRAY[]::text[]) AS origins
    FROM analytics_site_memberships m
    JOIN analytics_sites s ON s.id = m.site_id
    LEFT JOIN analytics_site_origins o ON o.site_id = s.id
    WHERE m.user_id = ${userId}
      AND s.is_active = TRUE
    GROUP BY s.id, s.name, s.slug, m.role
    ORDER BY s.created_at ASC, s.id ASC
  `) as RawSiteRow[];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role,
    origins: row.origins ?? [],
  }));
}

export async function requireUserSite(userId: string, requestedSiteId: string) {
  const sites = await listSitesForUser(userId);
  if (!sites.length) {
    throw new Error("No accessible sites were found for this account.");
  }

  if (!requestedSiteId.trim()) {
    return sites[0];
  }

  const site = sites.find((item) => item.id === requestedSiteId);
  if (!site) {
    throw new Error("That site is not available for this account.");
  }

	return site;
}

function canMutateSite(role: string) {
  const normalized = role.trim().toLowerCase();
  return normalized === "owner" || normalized === "admin";
}

export async function requireSiteMutationAccess(userId: string, requestedSiteId: string) {
  const site = await requireUserSite(userId, requestedSiteId);
  if (!canMutateSite(site.role)) {
    throw new Error("Owner or admin access is required for this site action.");
  }
  return site;
}

export async function createSiteForUser(
  userId: string,
  input: SiteRegistrationInput,
  options: { requestOrigin: string },
) {
  const siteInput = prepareSiteInput(input);
  const name = siteInput.name;
  const origin = siteInput.origin;
  if (!name) {
    throw new Error("Enter a site name.");
  }
  if (!origin) {
    throw new Error("Enter a valid site domain.");
  }

  const sql = getControlPlaneSql();
  const siteBase = slugify(name).slice(0, 24) || "site";
  const siteId = `${siteBase}-${randomBytes(3).toString("hex")}`;
  const siteSlug = `${siteBase}-${randomBytes(3).toString("hex")}`;
  const siteSalt = randomBytes(16).toString("hex");

  await sql.transaction([
    sql`
      INSERT INTO analytics_sites (id, name, slug, owner_user_id, salt)
      VALUES (${siteId}, ${name}, ${siteSlug}, ${userId}, ${siteSalt})
    `,
    sql`
      INSERT INTO analytics_site_memberships (site_id, user_id, role)
      VALUES (${siteId}, ${userId}, 'owner')
    `,
    sql`
      INSERT INTO analytics_site_origins (site_id, origin)
      VALUES (${siteId}, ${origin})
    `,
    sql`
      INSERT INTO analytics_site_settings (site_id)
      VALUES (${siteId})
      ON CONFLICT (site_id) DO NOTHING
    `,
  ]);

  await ensureTrackerScript(siteId, origin, options.requestOrigin);
  await warmSitePageDiscovery(siteId, origin);

  return siteId;
}

export async function addOriginToSite(
  userId: string,
  siteId: string,
  input: { origin?: string; domain?: string },
  options: { requestOrigin: string },
) {
  const site = await requireSiteMutationAccess(userId, siteId);
  const origin = sanitizeOrigin(input.origin ?? input.domain ?? "");
  if (!origin) {
    throw new Error("Enter a valid domain.");
  }

  const sql = getControlPlaneSql();
  await sql`
    INSERT INTO analytics_site_origins (site_id, origin)
    VALUES (${site.id}, ${origin})
    ON CONFLICT (site_id, origin) DO NOTHING
  `;

  await ensureTrackerScript(site.id, origin, options.requestOrigin);
  await warmSitePageDiscovery(site.id, origin);
}

export async function listOriginsForSite(userId: string, siteId: string) {
  const site = await requireUserSite(userId, siteId);
  return site.origins;
}

export async function removeOriginFromSite(
  userId: string,
  siteId: string,
  origin: string,
  options: { requestOrigin: string },
) {
  const site = await requireSiteMutationAccess(userId, siteId);
  const normalizedOrigin = sanitizeOrigin(origin);
  if (!normalizedOrigin) {
    throw new Error("Enter a valid domain.");
  }
  if (!site.origins.includes(normalizedOrigin)) {
    throw new Error("That origin is not configured for this site.");
  }
  if (site.origins.length <= 1) {
    throw new Error("Each site must keep at least one trusted origin.");
  }

  const sql = getControlPlaneSql();
  await sql`
    DELETE FROM analytics_site_origins
    WHERE site_id = ${site.id}
      AND origin = ${normalizedOrigin}
  `;

  const remaining = (await requireUserSite(userId, siteId)).origins;
  const installOrigin = remaining[0] || sanitizeOrigin(options.requestOrigin) || "https://localhost";
  await ensureTrackerScript(site.id, installOrigin, options.requestOrigin);
}

export async function updateSiteForUser(
  userId: string,
  siteId: string,
  input: { name?: string },
  options: { requestOrigin: string },
) {
  const site = await requireSiteMutationAccess(userId, siteId);
  const name = normalizeFullName(input.name ?? "");
  if (!name) {
    throw new Error("Enter a site name.");
  }

  const sql = getControlPlaneSql();
  await sql`
    UPDATE analytics_sites
    SET name = ${name}, updated_at = NOW()
    WHERE id = ${site.id}
  `;

  const updated = await requireUserSite(userId, siteId);
  const installOrigin = updated.origins[0] || sanitizeOrigin(options.requestOrigin) || "https://localhost";
  await ensureTrackerScript(site.id, installOrigin, options.requestOrigin);
  return updated;
}

export async function archiveSiteForUser(userId: string, siteId: string) {
  const site = await requireSiteMutationAccess(userId, siteId);

  const sql = getControlPlaneSql();
  await sql`
    UPDATE analytics_sites
    SET is_active = FALSE, updated_at = NOW()
    WHERE id = ${site.id}
  `;
}

export async function getSiteTrackerScriptForUser(userId: string, siteId: string, requestOrigin: string) {
  const site = await requireUserSite(userId, siteId);
  const installOrigin = site.origins[0] || sanitizeOrigin(requestOrigin) || "https://localhost";
  return ensureTrackerScript(site.id, installOrigin, requestOrigin);
}

export async function getSitePrivacySettingsForUser(userId: string, siteId: string) {
  const site = await requireUserSite(userId, siteId);
  return getSitePrivacySettings(site.id);
}

export async function getSiteSettingsForUser(userId: string, siteId: string) {
  const site = await requireUserSite(userId, siteId);
  return getSiteSettings(site.id);
}

export async function updateSitePrivacySettingsForUser(
  userId: string,
  siteId: string,
  input: Partial<ControlPlaneSitePrivacySettings>,
  options: { requestOrigin: string },
) {
  const site = await requireSiteMutationAccess(userId, siteId);
  const settings = await updateSitePrivacySettings(site.id, input);
  const installOrigin = site.origins[0] || sanitizeOrigin(options.requestOrigin) || "https://localhost";
  await ensureTrackerScript(site.id, installOrigin, options.requestOrigin);
  return settings;
}

export async function updateSiteSettingsForUser(
  userId: string,
  siteId: string,
  input: SiteSettingsUpdate,
  options: { requestOrigin: string },
) {
  const site = await requireSiteMutationAccess(userId, siteId);
  const settings = await updateSiteSettings(site.id, input);
  const installOrigin = site.origins[0] || sanitizeOrigin(options.requestOrigin) || "https://localhost";
  await ensureTrackerScript(site.id, installOrigin, options.requestOrigin);
  return settings;
}

export async function updateViewerProfile(userId: string, fullName: string) {
  const normalized = normalizeFullName(fullName);
  if (!normalized) {
    throw new Error("Enter your full name.");
  }

  const sql = getControlPlaneSql();
  await sql`
    UPDATE app_users
    SET full_name = ${normalized}, updated_at = NOW()
    WHERE id = ${userId}
  `;
}
