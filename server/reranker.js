import { loadLocalEnv } from "./env.js";
import { rerankQueue } from "./modelQueue.js";

loadLocalEnv();

const DEFAULT_MODEL = "bge-reranker-v2-m3";
const DEFAULT_TOP_K = 40;
const DEFAULT_TIMEOUT_MS = 8000;

export function getRerankConfig() {
  const ollamaUrl = String(process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
  return {
    enabled: String(process.env.RAG_RERANK_ENABLED || "false").toLowerCase() === "true",
    model: String(process.env.RERANK_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL,
    topK: Math.max(1, Number(process.env.RERANK_TOP_K || DEFAULT_TOP_K)),
    timeoutMs: Math.max(500, Number(process.env.RERANK_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)),
    ollamaUrl
  };
}

export async function getRerankHealth(options = {}) {
  const config = getRerankConfig();
  if (!config.enabled) {
    return { enabled: false, ok: false, reason: "reranker_disabled" };
  }
  const { signal, cleanup } = linkedTimeoutSignal(options.signal, config.timeoutMs);
  try {
    const response = await fetch(`${config.ollamaUrl}/api/tags`, { signal });
    if (!response.ok) {
      return { enabled: true, ok: false, model: config.model, reason: `ollama_${response.status}` };
    }
    const data = await response.json();
    const modelNames = (data.models || []).map((m) => String(m.name || ""));
    const found = modelNames.some(
      (name) => name === config.model || name.startsWith(`${config.model}:`)
    );
    return { enabled: true, ok: found, model: config.model, reason: found ? null : "model_not_found" };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { enabled: true, ok: false, model: config.model, reason: "ollama_unreachable", error: error.message };
  } finally {
    cleanup();
  }
}

/**
 * Rerank chunks by relevance using Ollama /api/rerank (cross-encoder).
 * Returns chunks sorted by descending relevance score. Falls back to original
 * order on any error so callers never need special-case handling.
 *
 * Only the first `topK` chunks are sent to the reranker. Remaining chunks are
 * appended after the reranked candidates unchanged.
 */
export async function rerankChunks(query, chunks, options = {}) {
  if (!chunks.length) return { chunks, reranked: false, reason: "empty_chunks" };
  const config = getRerankConfig();
  const topK = Math.min(options.topK ?? config.topK, chunks.length);
  const candidates = chunks.slice(0, topK);

  try {
    const results = await rerankQueue.run(async () => {
      const { signal, cleanup } = linkedTimeoutSignal(options.signal, config.timeoutMs);
      try {
        const response = await fetch(`${config.ollamaUrl}/api/rerank`, {
          method: "POST",
          signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: config.model,
            query: String(query),
            documents: candidates.map((c) => String(c.text || ""))
          })
        });
        if (!response.ok) {
          const msg = await response.text().catch(() => "");
          throw new Error(`Rerank API ${response.status}: ${msg.slice(0, 160)}`);
        }
        const data = await response.json();
        return data.results;
      } finally {
        cleanup();
      }
    }, { signal: options.signal, label: `rerank:${candidates.length}` });

    if (!Array.isArray(results) || !results.length) {
      return { chunks, reranked: false, reason: "empty_rerank_response" };
    }

    const sorted = [...results]
      .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
      .map((r) => ({ ...candidates[r.index], rerankScore: r.relevance_score ?? null }));

    return { chunks: [...sorted, ...chunks.slice(topK)], reranked: true };
  } catch (error) {
    if (options.signal?.aborted) throw error;
    return { chunks, reranked: false, reason: `rerank_failed:${error.message.slice(0, 80)}` };
  }
}

function linkedTimeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort(parentSignal?.reason || new Error("Rerank aborted."));
  };
  if (parentSignal?.aborted) abort();
  else parentSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(new Error("Rerank timed out."));
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abort);
    }
  };
}
