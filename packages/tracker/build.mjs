import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = dirname(fileURLToPath(import.meta.url));
const input = resolve(root, "src/index.js");
const output = resolve(root, "../../apps/api/internal/httpapi/assets/tracker.js");
const result = await build({
  absWorkingDir: root,
  bundle: true,
  entryPoints: [input],
  format: "iife",
  minify: true,
  platform: "browser",
  target: ["chrome92", "firefox90", "safari15.4"],
  write: false,
});

const bundled = `${result.outputFiles[0].text.trim()}\n`;

await mkdir(dirname(output), { recursive: true });
await writeFile(output, bundled);

const rawBytes = Buffer.byteLength(bundled);
const gzipBytes = gzipSync(bundled, { level: 9 }).length;

console.log(`tracker raw=${rawBytes}B gzip=${gzipBytes}B`);
