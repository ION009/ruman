const VISITOR_KEY = "_vid";
const CACHE_NAME = "_anlticsheat_vid_store";
const CACHE_REQUEST_KEY = "/_anlticsheat_vid";
const IDB_NAME = "_anlticsheat_vid";
const IDB_STORE = "meta";
const MIN_SYNC_INTERVAL_MS = 30 * 1000;

function normalizeID(value) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length !== 36) {
    return "";
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (trimmed[index] !== "-") {
        return "";
      }
      continue;
    }

    const charCode = trimmed.charCodeAt(index);
    const isDigit = charCode >= 48 && charCode <= 57;
    const isHexLower = charCode >= 97 && charCode <= 102;
    if (!isDigit && !isHexLower) {
      return "";
    }
  }
  return trimmed;
}

function readStorage(getter) {
  try {
    return normalizeID(getter.call(null));
  } catch {
    return "";
  }
}

function writeStorage(setter, id) {
  try {
    setter.call(null, id);
  } catch {}
}

function openIDB() {
  if (typeof indexedDB === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(IDB_STORE)) {
          database.createObjectStore(IDB_STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function readIDB() {
  const database = await openIDB();
  if (!database) {
    return "";
  }

  return new Promise((resolve) => {
    try {
      const transaction = database.transaction(IDB_STORE, "readonly");
      const request = transaction.objectStore(IDB_STORE).get(VISITOR_KEY);
      request.onsuccess = () => resolve(normalizeID(request.result));
      request.onerror = () => resolve("");
      transaction.oncomplete = () => database.close();
      transaction.onerror = () => database.close();
    } catch {
      database.close();
      resolve("");
    }
  });
}

async function writeIDB(id) {
  const database = await openIDB();
  if (!database) {
    return;
  }

  await new Promise((resolve) => {
    try {
      const transaction = database.transaction(IDB_STORE, "readwrite");
      transaction.objectStore(IDB_STORE).put(id, VISITOR_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
  database.close();
}

async function readCache() {
  if (typeof caches === "undefined") {
    return "";
  }

  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(CACHE_REQUEST_KEY);
    if (!response) {
      return "";
    }
    return normalizeID(await response.text());
  } catch {
    return "";
  }
}

async function writeCache(id) {
  if (typeof caches === "undefined") {
    return;
  }

  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(CACHE_REQUEST_KEY, new Response(id, { headers: { "content-type": "text/plain" } }));
  } catch {}
}

async function readBestStorageID() {
  const local = readStorage(() => localStorage.getItem(VISITOR_KEY));
  if (local) {
    return local;
  }

  const session = readStorage(() => sessionStorage.getItem(VISITOR_KEY));
  if (session) {
    return session;
  }

  const fromIDB = await readIDB();
  if (fromIDB) {
    return fromIDB;
  }

  return readCache();
}

async function writeAllStores(id) {
  if (!id) {
    return;
  }

  writeStorage((value) => localStorage.setItem(VISITOR_KEY, value), id);
  writeStorage((value) => sessionStorage.setItem(VISITOR_KEY, value), id);
  await Promise.allSettled([writeIDB(id), writeCache(id)]);
}

async function parseJSON(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function createVisitorIdentity({ apiOrigin, siteId }) {
  let visitorID = readStorage(() => localStorage.getItem(VISITOR_KEY)) || readStorage(() => sessionStorage.getItem(VISITOR_KEY));
  let storageID = visitorID;
  let bootstrapPromise = null;
  let lastSyncAt = 0;

  async function remember(id) {
    const normalized = normalizeID(id);
    if (!normalized) {
      return "";
    }
    visitorID = normalized;
    storageID = normalized;
    await writeAllStores(normalized);
    return normalized;
  }

  function payload() {
    const body = {};
    if (storageID) {
      body.storageId = storageID;
    }
    return body;
  }

  async function sync(reason = "sync") {
    const now = Date.now();
    if (reason !== "collect" && reason !== "bootstrap" && now - lastSyncAt < MIN_SYNC_INTERVAL_MS) {
      return visitorID;
    }
    lastSyncAt = now;

    try {
      const response = await fetch(`${apiOrigin}/identity?id=${encodeURIComponent(siteId)}`, {
        method: "POST",
        keepalive: reason === "hidden",
        credentials: "include",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload()),
      });
      if (!response.ok) {
        return visitorID;
      }

      const parsed = await parseJSON(response);
      if (parsed && typeof parsed.id === "string") {
        await remember(parsed.id);
      }
    } catch {}

    return visitorID;
  }

  async function bootstrap() {
    if (bootstrapPromise) {
      return bootstrapPromise;
    }

    bootstrapPromise = (async () => {
      if (!storageID) {
        storageID = await readBestStorageID();
        visitorID = storageID || visitorID;
      }
      if (storageID) {
        await writeAllStores(storageID);
      }

      await sync("bootstrap");
      return visitorID;
    })();

    return bootstrapPromise;
  }

  async function captureServerPayload(parsed) {
    if (!parsed || typeof parsed !== "object") {
      return;
    }

    const directID = typeof parsed.id === "string" ? parsed.id : "";
    const nested = parsed.visitor && typeof parsed.visitor === "object" ? parsed.visitor : null;
    const nestedID = nested && typeof nested.id === "string" ? nested.id : "";
    const nextID = directID || nestedID;
    if (nextID) {
      await remember(nextID);
    }
  }

  return {
    bootstrap,
    sync,
    payload,
    captureServerPayload,
    currentID() {
      return visitorID || storageID || "";
    },
  };
}
