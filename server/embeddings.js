import { loadLocalEnv } from "./env.js";
import { validateEmbeddingBatch } from "./rag/embeddingValidator.js";
import { embeddingQueue } from "./modelQueue.js";

loadLocalEnv();

const EMBED_MODEL = process.env.EMBED_MODEL || "bge-m3";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
const EMBED_DIM_ENV = Number(process.env.EMBED_DIM) || null;

/**
 * Batch-embed multiple texts via Ollama /api/embed.
 * Returns float[][] — one vector per input text.
 * Throws if the model is unavailable or the result fails validation.
 *
 * Options:
 *   signal       AbortSignal forwarded to fetch
 *   expectedDim  override dim check; falls back to EMBED_DIM env when unset
 */
export async function embedTexts(texts, { signal, expectedDim } = {}) {
  return embeddingQueue.run(async () => {
    const response = await fetch(`${OLLAMA_URL}/api/embed`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: EMBED_MODEL, input: texts })
    });
    if (!response.ok) {
      const msg = await response.text().catch(() => "");
      throw new Error(`Embed API ${response.status}: ${msg}`);
    }
    const data = await response.json();
    validateEmbeddingBatch(data.embeddings, {
      expectedCount: texts.length,
      expectedDim: expectedDim ?? EMBED_DIM_ENV ?? undefined
    });
    return data.embeddings;
  }, {
    signal,
    label: `embed:${Array.isArray(texts) ? texts.length : 0}`
  });
}

export async function embedText(text, options = {}) {
  const results = await embedTexts([String(text)], options);
  return results[0];
}
