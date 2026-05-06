import { multiQueryHybridSelect, greedyFit } from "../retrieval.js";
import { embedTexts } from "../embeddings.js";
import { expandQuery } from "../queryExpansion.js";
import { logRetrieval } from "./retrievalLogger.js";
import { resolvedDepartmentBackend, PROFILE_DEPARTMENT } from "./ragConfig.js";
import { searchQdrantNotebookChunks } from "../indexes/qdrantVectorIndex.js";
import { searchSqliteNotebookChunks } from "../indexes/sqliteFtsIndex.js";
import { getRerankConfig, rerankChunks } from "../reranker.js";
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
  let rerankApplied = false;
  const rerankConfig = getRerankConfig();

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
  let queryEmbeddings = [];

  if (trimmedQuery) {
    const tExpand = Date.now();
    try {
      queries = await expandQuery(trimmedQuery, { signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) throw error;
      fallbackReason = "expand_failed";
    }
    timing.queryExpansionMs = Date.now() - tExpand;

    queryEmbeddings = queries.map(() => null);
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
    const rankingLists = [];
    if (backend.vector === "qdrant" && queryEmbeddings.some(Boolean)) {
      const qdrantStart = Date.now();
      try {
        const qdrantResult = await searchQdrantNotebookChunks({
          notebookId,
          queryEmbeddings: queryEmbeddings.filter(Boolean),
          limit: options.qdrantLimit,
          signal: options.signal
        });
        timing.qdrantMs = Date.now() - qdrantStart;
        if (qdrantResult.ok && qdrantResult.chunks.length) {
          rankingLists.push(qdrantResult.chunks);
        } else {
          fallbackReason = fallbackReason || qdrantResult.reason || "qdrant_no_results";
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        timing.qdrantMs = Date.now() - qdrantStart;
        fallbackReason = fallbackReason || `qdrant_failed:${error.message.slice(0, 80)}`;
      }
    }

    if (backend.lexical === "sqlite") {
      const lexicalStart = Date.now();
      try {
        const lexicalResult = await searchSqliteNotebookChunks({
          notebookId,
          queries,
          limit: options.lexicalLimit
        });
        timing.lexicalMs = Date.now() - lexicalStart;
        if (lexicalResult.ok && lexicalResult.chunks.length) {
          rankingLists.push(lexicalResult.chunks);
        } else {
          fallbackReason = fallbackReason || lexicalResult.reason || "sqlite_no_results";
        }
      } catch (error) {
        timing.lexicalMs = Date.now() - lexicalStart;
        fallbackReason = fallbackReason || `sqlite_failed:${error.message.slice(0, 80)}`;
      }
    }

    if (rankingLists.length) {
      const fusedSorted = fuseRankings(rankingLists);
      if (rerankConfig.enabled) {
        const tRerank = Date.now();
        const { chunks: rerankedChunks, reranked, reason: rerankReason } = await rerankChunks(
          trimmedQuery,
          fusedSorted.slice(0, rerankConfig.topK),
          { signal: options.signal }
        );
        timing.rerankMs = Date.now() - tRerank;
        rerankApplied = reranked;
        if (!reranked) fallbackReason = fallbackReason || rerankReason;
        ranked = greedyFit([...rerankedChunks, ...fusedSorted.slice(rerankConfig.topK)], budget);
      } else {
        ranked = greedyFit(fusedSorted, budget);
      }
    } else {
      ranked = multiQueryHybridSelect(allChunks, queries, queryEmbeddings, budget);
    }
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
    rerank: {
      enabled: rerankConfig.enabled,
      applied: rerankApplied,
      model: rerankConfig.enabled ? rerankConfig.model : null
    },
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

function fuseRankings(rankings) {
  const RRF_K = 60;
  const byKey = new Map();
  for (const ranking of rankings) {
    ranking.forEach((chunk, rank) => {
      const key = `${chunk.documentId || ""}:${chunk.chunkIndex ?? ""}:${chunk.text?.slice(0, 32) || ""}`;
      const entry = byKey.get(key) || { chunk, score: 0, bestRank: rank };
      entry.score += 1 / (RRF_K + rank + 1);
      entry.bestRank = Math.min(entry.bestRank, rank);
      byKey.set(key, entry);
    });
  }
  return Array.from(byKey.values())
    .sort((left, right) => right.score - left.score || left.bestRank - right.bestRank)
    .map((entry) => entry.chunk);
}
