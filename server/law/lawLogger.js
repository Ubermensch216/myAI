import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { maskLawSecrets } from "./lawConfig.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const LOGS_DIR = path.join(rootDir, "data", "logs");

function todayFile() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return path.join(LOGS_DIR, `law-retrieval-${y}-${m}-${day}.jsonl`);
}

export async function logLawCall(entry = {}) {
  if (process.env.RETRIEVAL_LOG_ENABLED === "false") return;
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    const record = {
      ts: new Date().toISOString(),
      tool: safeText(entry.tool, 80),
      normalizedQuery: sanitizeNormalizedQuery(entry.normalizedQuery),
      latencyMs: Number(entry.latencyMs || 0),
      resultCount: Number(entry.resultCount || 0),
      cacheHit: Boolean(entry.cacheHit),
      errorMarker: safeText(entry.errorMarker, 80)
    };
    await fs.appendFile(todayFile(), `${maskLawSecrets(JSON.stringify(record))}\n`, "utf8");
  } catch (error) {
    console.warn(`[law-log] ${maskLawSecrets(error.message)}`);
  }
}

function sanitizeNormalizedQuery(value) {
  const source = value && typeof value === "object" ? value : { value };
  const allowed = {};
  for (const key of ["query", "lawName", "article", "paragraph", "item", "canonical", "display"]) {
    if (source[key] != null) allowed[key] = safeText(source[key], 240);
  }
  return allowed;
}

function safeText(value, limit) {
  return maskLawSecrets(String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit));
}
