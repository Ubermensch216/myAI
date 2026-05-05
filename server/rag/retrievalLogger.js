import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const LOGS_DIR = path.join(rootDir, "data", "logs");
const RETRIEVAL_LOG_ENABLED = process.env.RETRIEVAL_LOG_ENABLED !== "false";

function todayFile() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return path.join(LOGS_DIR, `retrieval-${y}-${m}-${day}.jsonl`);
}

function hashQuery(text) {
  return crypto
    .createHash("sha256")
    .update(String(text ?? ""))
    .digest("hex")
    .slice(0, 16);
}

/**
 * Append one retrieval event as a JSON line. Never stores raw query/chunk text.
 *
 * Expected entry shape:
 *   {
 *     profile: "personal" | "department",
 *     notebookId?: string,
 *     query: string,                 // hashed; not stored
 *     queryVariants: number,
 *     corpus: { chunkCount, embeddedChunkCount },
 *     timing: { queryExpansionMs?, queryEmbeddingMs?, retrievalMs?, totalMs? },
 *     selected: [{ rank, documentId?, chunkIndex }],
 *     fallback: string | null
 *   }
 *
 * Logging is best-effort; failures are warned and swallowed.
 */
export async function logRetrieval(entry) {
  if (!RETRIEVAL_LOG_ENABLED) return;
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    const { query, ...rest } = entry || {};
    const record = {
      ts: new Date().toISOString(),
      ...rest,
      queryHash: query ? hashQuery(query) : null,
      queryLength: typeof query === "string" ? query.length : 0
    };
    await fs.appendFile(todayFile(), `${JSON.stringify(record)}\n`, "utf8");
  } catch (err) {
    console.warn(`[retrieval-log] ${err.message}`);
  }
}
