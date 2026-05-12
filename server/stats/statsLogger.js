import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");
const LOGS_DIR = path.join(rootDir, "data", "logs");
const USAGE_LOG_ENABLED = process.env.USAGE_LOG_ENABLED !== "false";

function todayFile() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return path.join(LOGS_DIR, `usage-${y}-${m}-${day}.jsonl`);
}

function deriveSessionId(rawToken) {
  if (!rawToken) return "anon";
  return crypto
    .createHash("sha256")
    .update(String(rawToken).slice(0, 64))
    .digest("hex")
    .slice(0, 16);
}

function utcDate() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Append one usage event as a JSON line. Never stores raw prompts, IP addresses,
 * or personal data — only hashed session IDs and group/feature metadata.
 *
 * Accepted fields in entry:
 *   rawToken?       string   — access token (hashed to sessionId; not stored)
 *   groupId?        string   — group identifier (default "anon")
 *   level?          string   — "L1"|"L2"|"L3"|"super"|"anon" (default "anon")
 *   eventType       string   — one of: chat_query, law_query, compliance_run,
 *                              studio_open, studio_export, notebook_access,
 *                              kg_render, calendar_query, login, logout
 *   endpoint?       string
 *   notebookId?     string|null
 *   features?       { rag, law, compliance, kg, calendar, documentStudio }
 *   model?          string
 *   latencyMs?      number|null
 *   tokenEstimate?  number|null
 *   success?        boolean  (default true)
 *   errorType?      string   (default "")
 *
 * Logging is best-effort; failures are warned and swallowed.
 */
export async function logUsageEvent(entry) {
  if (!USAGE_LOG_ENABLED) return;
  try {
    await fs.mkdir(LOGS_DIR, { recursive: true });
    const { rawToken, ...rest } = entry || {};
    const record = {
      ts: Date.now(),
      date: utcDate(),
      sessionId: deriveSessionId(rawToken || null),
      groupId: rest.groupId || "anon",
      level: rest.level || "anon",
      eventType: rest.eventType || "unknown",
      endpoint: rest.endpoint || null,
      notebookId: rest.notebookId || null,
      features: {
        rag: false,
        law: false,
        compliance: false,
        kg: false,
        calendar: false,
        documentStudio: false,
        ...rest.features
      },
      model: rest.model || null,
      latencyMs: rest.latencyMs ?? null,
      tokenEstimate: rest.tokenEstimate ?? null,
      success: rest.success !== false,
      errorType: rest.errorType || ""
    };
    await fs.appendFile(todayFile(), `${JSON.stringify(record)}\n`, "utf8");
  } catch (err) {
    console.warn(`[usage-log] ${err.message}`);
  }
}
