import { loadLocalEnv } from "./env.js";
import { createLinkedAbortController } from "./abort.js";
import { analysisQueue } from "./modelQueue.js";

loadLocalEnv();

const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const DEFAULT_MODEL = process.env.OLLAMA_MODEL || "gemma3n:e2b";
const ENABLED = String(process.env.QUERY_EXPANSION_ENABLED ?? "true").toLowerCase() !== "false";
const MAX_VARIANTS = clampInt(process.env.QUERY_EXPANSION_VARIANTS, 3, 1, 6);
const TIMEOUT_MS = clampInt(process.env.QUERY_EXPANSION_TIMEOUT_MS, 6000, 1000, 30000);

function clampInt(raw, fallback, min, max) {
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/**
 * Generate retrieval-friendly variants of a user query via the local LLM.
 * Returns an array starting with the original query, followed by 0..MAX_VARIANTS
 * paraphrases. On any failure (disabled, timeout, parse error) returns [original].
 */
export async function expandQuery(query, { model = DEFAULT_MODEL, signal, enabled } = {}) {
  const original = String(query ?? "").trim();
  if (!original) return [];
  const effectiveEnabled = typeof enabled === "boolean" ? enabled : ENABLED;
  if (!effectiveEnabled || MAX_VARIANTS <= 0) return [original];
  if (original.length > 500) return [original];

  const controller = createLinkedAbortController(signal, TIMEOUT_MS, "Query expansion timed out.");

  try {
    const response = await analysisQueue.run(() => fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        format: "json",
        messages: [
          {
            role: "system",
            content: [
              "You rewrite user search queries to improve retrieval recall in a Korean RAG system.",
              "Return only strict JSON of the form: {\"variants\": [\"...\", \"...\"]}",
              `Generate up to ${MAX_VARIANTS} alternative phrasings.`,
              "Each variant must preserve the original intent but vary one of:",
              "- swap synonyms or domain-specific equivalents (e.g., 휴가→연차, 보고서→리포트)",
              "- expand abbreviations or contract long phrases",
              "- shift grammatical perspective (question ↔ keyword form)",
              "- add or remove explicit context words that often appear in documents",
              "Do NOT include the original query verbatim.",
              "Do NOT add explanations, numbering, or extra keys.",
              "Each variant must be a complete Korean phrase under 200 characters."
            ].join("\n")
          },
          {
            role: "user",
            content: `원문 질의:\n${original}\n\n검색 적중률을 높이는 변형 질의들을 JSON으로 반환하세요.`
          }
        ],
        options: { temperature: 0.4, top_p: 0.9 }
      })
    }), {
      signal: controller.signal,
      label: "query_expansion"
    });

    if (!response.ok) return [original];
    const payload = await response.json();
    const variants = parseVariants(payload.message?.content ?? "", original);
    return [original, ...variants];
  } catch (error) {
    if (signal?.aborted) throw error;
    return [original];
  } finally {
    controller.cleanup();
  }
}

function parseVariants(rawContent, original) {
  const text = String(rawContent ?? "").trim();
  if (!text) return [];

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }

  const list = Array.isArray(parsed) ? parsed : parsed?.variants;
  if (!Array.isArray(list)) return [];

  const seen = new Set([normalizeForDedup(original)]);
  const variants = [];
  for (const value of list) {
    const cleaned = String(value ?? "")
      .replace(/^["'`]+|["'`]+$/g, "")
      .trim()
      .slice(0, 200);
    if (!cleaned) continue;
    const key = normalizeForDedup(cleaned);
    if (seen.has(key)) continue;
    seen.add(key);
    variants.push(cleaned);
    if (variants.length >= MAX_VARIANTS) break;
  }
  return variants;
}

function normalizeForDedup(value) {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

export const QUERY_EXPANSION_ENABLED = ENABLED;
export const QUERY_EXPANSION_MAX_VARIANTS = MAX_VARIANTS;
