const STORAGE_KEY = "_as";
const SESSION_TTL = 30 * 60 * 1000;

let memorySession = null;

function readStoredSession() {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return "";
  }
}

function writeStoredSession(value) {
  memorySession = value;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {}
}

function loadSession(now) {
  const raw = readStoredSession();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.id === "string" && parsed.expiresAt > now) {
        return parsed;
      }
    } catch {}
  }

  if (memorySession && memorySession.expiresAt > now) {
    return memorySession;
  }

  return null;
}

export function getSession() {
  const now = Date.now();
  const current = loadSession(now);
  const session = {
    id: (current && current.id) || crypto.randomUUID(),
    expiresAt: now + SESSION_TTL,
  };

  writeStoredSession(session);
  return session.id;
}
