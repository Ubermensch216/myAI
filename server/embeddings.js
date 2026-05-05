import { loadLocalEnv } from "./env.js";

loadLocalEnv();

const EMBED_MODEL = process.env.EMBED_MODEL || "bge-m3";
const OLLAMA_URL = process.env.OLLAMA_URL || "http://127.0.0.1:11434";

/**
 * Batch-embed multiple texts via Ollama /api/embed.
 * Returns float[][] — one vector per input text.
 * Throws if the model is unavailable; callers should catch and fall back to BM25.
 */
export async function embedTexts(texts, { signal } = {}) {
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
  if (!Array.isArray(data.embeddings)) {
    throw new Error("Embed API가 embeddings 배열을 반환하지 않았습니다.");
  }
  return data.embeddings;
}

export async function embedText(text, options = {}) {
  const results = await embedTexts([String(text)], options);
  return results[0];
}
