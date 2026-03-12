import { Buffer } from "node:buffer";

type ImportPayload = {
  platform: string;
  fileName: string;
  contentType: string;
  contentBase64: string;
  mapping?: Record<string, string>;
  importTimezone?: string;
};

function normalizeMapping(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const mapping: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    const canonical = key.trim();
    const source = typeof raw === "string" ? raw.trim() : "";
    if (!canonical || !source) {
      continue;
    }
    mapping[canonical] = source;
  }
  return mapping;
}

function parseJSONString(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export async function readDashboardImportPayload(request: Request): Promise<ImportPayload> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new Error("Attach a CSV or JSON file.");
    }

    const platform = String(form.get("platform") ?? "").trim();
    const mapping = normalizeMapping(parseJSONString(form.get("mapping")));
    const importTimezone = String(form.get("importTimezone") ?? "").trim();

    return {
      platform,
      fileName: file.name || "import",
      contentType: file.type || "application/octet-stream",
      contentBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      mapping,
      importTimezone: importTimezone || undefined,
    };
  }

  const raw = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  return {
    platform: String(raw.platform ?? "").trim(),
    fileName: String(raw.fileName ?? "import").trim(),
    contentType: String(raw.contentType ?? "application/octet-stream").trim(),
    contentBase64: String(raw.contentBase64 ?? "").trim(),
    mapping: normalizeMapping(raw.mapping),
    importTimezone: typeof raw.importTimezone === "string" ? raw.importTimezone.trim() || undefined : undefined,
  };
}
