import { multiQueryHybridSelect, greedyFit } from "../retrieval.js";
import { embedTexts } from "../embeddings.js";
import { expandQuery } from "../queryExpansion.js";
import { logRetrieval } from "./retrievalLogger.js";
import { resolvedDepartmentBackend, PROFILE_DEPARTMENT } from "./ragConfig.js";
import {
  getNotebookManifest,
  loadNotebookChunksForRetrieval,
  summarizeNotebookManifest
} from "../notebooks.js";

const NOTEBOOK_QUERY_BUDGET = Number(process.env.NOTEBOOK_QUERY_BUDGET || 12000);

/**
 * Search a department notebook for chunks relevant to `query`.
 *
 * Returns the same shape that the old queryNotebook produced so the routing
 * layer in ollama.js can stay unchanged. The retrieval path here is the
 * sole seam that Sprint 2 will replace when Qdrant + FTS5 land — manifest
 * I/O and ingest stay in notebooks.js.
 */
export async function searchNotebook(notebookId, query, options = {}) {
  const manifest = await getNotebookManifest(notebookId);
  if (!manifest) return { ok: false, reason: "notebook_not_found", chunks: [] };

  const budget = Number.isFinite(options.budget) ? options.budget : NOTEBOOK_QUERY_BUDGET;
  const trimmedQuery = String(query ?? "").trim();
  const backend = resolvedDepartmentBackend();

  const t0 = Date.now();
  const timing = {};
  let fallbackReason = null;

  const allChunks = await loadNotebookChunksForRetrieval(notebookId, manifest);

  if (!allChunks.length) {
    return {
      ok: true,
      notebook: summarizeNotebookManifest(manifest),
      chunks: [],
      documentSummaries: []
    };
  }

  let ranked = [];
  let queries = trimmedQuery ? [trimmedQuery] : [];
  if (trimmedQuery) {
    const tExpand = Date.now();
    try {
      queries = await expandQuery(trimmedQuery, { signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      fallbackReason = "expand_failed";
    }
    timing.queryExpansionMs = Date.now() - tExpand;

    let queryEmbeddings = queries.map(() => null);
    const tEmbed = Date.now();
    try {
      const vectors = await embedTexts(queries, {
        signal: options.signal,
        expectedDim: manifest.embedding?.dim ?? undefined
      });
      queryEmbeddings = vectors;
    } catch (error) {
      if (options.signal?.aborted) throw error;
      fallbackReason = fallbackReason || "embed_failed";
      // BM25 fallback — embedding model unavailable or dim mismatch
    }
    timing.queryEmbeddingMs = Date.now() - tEmbed;

    const tRetrieve = Date.now();
    ranked = multiQueryHybridSelect(allChunks, queries, queryEmbeddings, budget);
    timing.retrievalMs = Date.now() - tRetrieve;
  }

  const selected = ranked.length ? ranked : greedyFit(allChunks, budget);
  if (!ranked.length) {
    fallbackReason = fallbackReason || (trimmedQuery ? "no_ranked_results" : "empty_query");
  }
  timing.totalMs = Date.now() - t0;

  const citations = selected.map((chunk, index) => ({
    citationId: index + 1,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    documentType: chunk.documentType,
    locator: chunk.locator,
    text: chunk.text,
    chunkIndex: chunk.chunkIndex
  }));

  const citedIds = new Set(citations.map((c) => c.documentId));
  const documentSummaries = (manifest.documents || [])
    .filter((entry) => citedIds.has(entry.id) && (entry.summary || (entry.topics || []).length))
    .map((entry) => ({
      documentId: entry.id,
      documentName: entry.name,
      summary: entry.summary || "",
      topics: Array.isArray(entry.topics) ? entry.topics : []
    }));

  logRetrieval({
    profile: PROFILE_DEPARTMENT,
    backend,
    notebookId,
    query: trimmedQuery,
    queryVariants: queries.length,
    corpus: {
      chunkCount: allChunks.length,
      embeddedChunkCount: allChunks.reduce((n, c) => n + (c.embedding ? 1 : 0), 0)
    },
    embedding: manifest.embedding
      ? { model: manifest.embedding.model, dim: manifest.embedding.dim }
      : null,
    timing,
    selected: citations.map((c, i) => ({
      rank: i + 1,
      documentId: c.documentId,
      chunkIndex: c.chunkIndex
    })),
    fallback: fallbackReason
  });

  return {
    ok: true,
    notebook: summarizeNotebookManifest(manifest),
    chunks: citations,
    documentSummaries
  };
}
