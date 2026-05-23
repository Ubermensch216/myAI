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
  summarizeNotebookManifest,
  loadDocumentRecord,
  getNotebookParentChunks
} from "../notebooks.js";
import { expandQueryWithGraph, notebookHasGraph } from "./graph/expander.js";

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
  const rerankEnabled = typeof options.rerank === "boolean" ? options.rerank : rerankConfig.enabled;
  const queryExpansionOverride = typeof options.queryExpansion === "boolean" ? options.queryExpansion : undefined;
  const graphExpansionEnabled = typeof options.graphExpansion === "boolean"
    ? options.graphExpansion
    : (process.env.KG_EXPANSION_ENABLED === "1");
  const manifestChunkCount = estimateManifestChunkCount(manifest);
  let allChunks = null;
  let fallbackLoadedAllChunks = false;
  let ranked = [];
  let queries = trimmedQuery ? [trimmedQuery] : [];
  let queryEmbeddings = [];
  let graphExpansionResult = null;
  let graphHydratedAllChunks = false;

  const buildDiagnostics = () => ({
    fallbackLoadedAllChunks,
    fallbackReason,
    rerankApplied,
    rerankEnabled,
    queryExpansionEnabled: queryExpansionOverride,
    graphExpansion: graphExpansionEnabled
      ? {
          enabled: true,
          ok: graphExpansionResult?.ok || false,
          reason: graphExpansionResult?.reason,
          stats: graphExpansionResult?.stats || null,
          supplementKeys: Array.isArray(graphExpansionResult?.supplements)
            ? graphExpansionResult.supplements.map((s) => `${s.documentId}:${s.chunkIndex}`)
            : [],
          seedLabels: graphExpansionResult?.seedLabels || [],
          neighborhoodLabels: graphExpansionResult?.neighborhoodLabels || [],
          hydratedAllChunks: graphHydratedAllChunks
        }
      : { enabled: false },
    queryVariants: queries.length,
    timing: { ...timing }
  });

  if (manifestChunkCount === 0) {
    timing.totalMs = Date.now() - t0;
    fallbackReason = "empty_notebook";
    logDepartmentRetrieval({
      backend,
      notebookId,
      query: trimmedQuery,
      queryVariants: queries.length,
      chunkCount: 0,
      embeddedChunkCount: null,
      fallbackLoadedAllChunks,
      manifest,
      rerankConfig,
      rerankApplied,
      timing,
      citations: [],
      fallbackReason
    });
    return {
      ok: true,
      notebook: summarizeNotebookManifest(manifest),
      chunks: [],
      documentSummaries: [],
      articleRefs: [],
      diagnostics: buildDiagnostics()
    };
  }

  const hydrateAllChunks = async ({ markFallback = false } = {}) => {
    if (!allChunks) {
      const tHydrate = Date.now();
      allChunks = await loadNotebookChunksForRetrieval(notebookId, manifest);
      const elapsed = Date.now() - tHydrate;
      timing.chunkHydrationMs = (timing.chunkHydrationMs || 0) + elapsed;
      if (markFallback) timing.fallbackHydrationMs = (timing.fallbackHydrationMs || 0) + elapsed;
    }
    if (markFallback) {
      fallbackLoadedAllChunks = true;
    }
    return allChunks;
  };

  const loadAllChunksForFallback = () => hydrateAllChunks({ markFallback: true });

  if (trimmedQuery) {
    const tExpand = Date.now();
    try {
      queries = await expandQuery(trimmedQuery, { signal: options.signal, enabled: queryExpansionOverride });
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

    let graphRankingAdded = false;
    if (graphExpansionEnabled && notebookHasGraph(notebookId)) {
      const tGraph = Date.now();
      try {
        graphExpansionResult = await expandQueryWithGraph({
          notebookId,
          query: trimmedQuery,
          excludeKeys: new Set(),
          maxSupplements: Number(process.env.KG_EXPAND_MAX || 5)
        });
        timing.graphExpansionMs = Date.now() - tGraph;
        if (graphExpansionResult.ok && graphExpansionResult.supplements.length) {
          const tGraphHydrate = Date.now();
          const allChunksList = await hydrateAllChunks();
          graphHydratedAllChunks = true;
          timing.graphHydrationMs = (timing.graphHydrationMs || 0) + (Date.now() - tGraphHydrate);
          const byKey = new Map(
            allChunksList.map((c) => [`${c.documentId}:${c.chunkIndex}`, c])
          );
          const graphRanking = [];
          for (const sup of graphExpansionResult.supplements) {
            const hit = byKey.get(`${sup.documentId}:${sup.chunkIndex}`);
            if (hit) graphRanking.push(hit);
          }
          if (graphRanking.length) {
            rankingLists.push(graphRanking);
            graphRankingAdded = true;
          }
        }
      } catch (error) {
        if (options.signal?.aborted) throw error;
        timing.graphExpansionMs = Date.now() - tGraph;
        graphExpansionResult = { ok: false, reason: `graph_failed:${error.message.slice(0, 80)}` };
      }
    }

    if (rankingLists.length) {
      const fusionWeights = graphRankingAdded
        ? rankingLists.map((_, i) => (i === rankingLists.length - 1 ? Number(process.env.KG_FUSION_WEIGHT || 0.3) : 1))
        : null;
      const fusedSorted = fuseRankings(rankingLists, fusionWeights);
      let candidates = [];
      if (rerankEnabled) {
        const tRerank = Date.now();
        const { chunks: rerankedChunks, reranked, reason: rerankReason } = await rerankChunks(
          trimmedQuery,
          fusedSorted.slice(0, rerankConfig.topK),
          { signal: options.signal }
        );
        timing.rerankMs = Date.now() - tRerank;
        rerankApplied = reranked;
        if (!reranked) fallbackReason = fallbackReason || rerankReason;
        candidates = [...rerankedChunks, ...fusedSorted.slice(rerankConfig.topK)];
      } else {
        candidates = fusedSorted;
      }
      const hydrated = await hydrateCandidates(notebookId, manifest, candidates);
      ranked = greedyFit(hydrated, budget);
    } else {
      const fallbackChunks = await loadAllChunksForFallback();
      const rawRanked = multiQueryHybridSelect(fallbackChunks, queries, queryEmbeddings, budget * 4);
      const hydrated = await hydrateCandidates(notebookId, manifest, rawRanked);
      ranked = greedyFit(hydrated, budget);
    }
    timing.retrievalMs = Date.now() - tRetrieve;
  }

  let selected = [];
  if (ranked.length) {
    selected = ranked;
  } else {
    const fallbackChunks = await loadAllChunksForFallback();
    const hydrated = await hydrateCandidates(notebookId, manifest, fallbackChunks);
    selected = greedyFit(hydrated, budget);
  }

  if (!selected.length) {
    fallbackReason = fallbackReason || (trimmedQuery ? "no_ranked_results" : "empty_query");
    timing.totalMs = Date.now() - t0;
    logDepartmentRetrieval({
      backend,
      notebookId,
      query: trimmedQuery,
      queryVariants: queries.length,
      chunkCount: allChunks ? allChunks.length : manifestChunkCount,
      embeddedChunkCount: allChunks
        ? allChunks.reduce((n, c) => n + (c.embedding ? 1 : 0), 0)
        : null,
      fallbackLoadedAllChunks,
      manifest,
      rerankConfig,
      rerankApplied,
      timing,
      citations: [],
      fallbackReason
    });
    return {
      ok: true,
      notebook: summarizeNotebookManifest(manifest),
      chunks: [],
      documentSummaries: [],
      articleRefs: [],
      diagnostics: buildDiagnostics()
    };
  }

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

  logDepartmentRetrieval({
    backend,
    notebookId,
    query: trimmedQuery,
    queryVariants: queries.length,
    chunkCount: allChunks ? allChunks.length : manifestChunkCount,
    embeddedChunkCount: allChunks
      ? allChunks.reduce((n, c) => n + (c.embedding ? 1 : 0), 0)
      : null,
    fallbackLoadedAllChunks,
    manifest,
    rerankConfig,
    rerankApplied,
    timing,
    citations,
    fallbackReason
  });

  return {
    ok: true,
    notebook: summarizeNotebookManifest(manifest),
    chunks: citations,
    documentSummaries,
    articleRefs: Array.isArray(graphExpansionResult?.articleRefs)
      ? graphExpansionResult.articleRefs
      : [],
    diagnostics: buildDiagnostics()
  };
}

function logDepartmentRetrieval({
  backend,
  notebookId,
  query,
  queryVariants,
  chunkCount,
  embeddedChunkCount,
  fallbackLoadedAllChunks,
  manifest,
  rerankConfig,
  rerankApplied,
  timing,
  citations,
  fallbackReason
}) {
  logRetrieval({
    profile: PROFILE_DEPARTMENT,
    backend,
    notebookId,
    query,
    queryVariants,
    corpus: {
      chunkCount,
      embeddedChunkCount,
      fallbackLoadedAllChunks
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
    fallbackLoadedAllChunks,
    selected: citations.map((c, i) => ({
      rank: i + 1,
      documentId: c.documentId,
      chunkIndex: c.chunkIndex
    })),
    fallback: fallbackReason
  });
}

function estimateManifestChunkCount(manifest) {
  const documents = Array.isArray(manifest?.documents) ? manifest.documents : [];
  if (!documents.length) return 0;

  let sawChunkCount = false;
  let total = 0;
  for (const entry of documents) {
    const count = Number(entry?.chunkCount);
    if (Number.isFinite(count)) {
      sawChunkCount = true;
      total += Math.max(0, count);
    }
  }

  return sawChunkCount ? total : null;
}

function fuseRankings(rankings, weights = null) {
  const RRF_K = 60;
  const byKey = new Map();
  rankings.forEach((ranking, idx) => {
    const w = weights ? (weights[idx] ?? 1) : 1;
    ranking.forEach((chunk, rank) => {
      const key = `${chunk.documentId || ""}:${chunk.chunkIndex ?? ""}:${chunk.text?.slice(0, 32) || ""}`;
      const entry = byKey.get(key) || { chunk, score: 0, bestRank: rank };
      entry.score += w / (RRF_K + rank + 1);
      entry.bestRank = Math.min(entry.bestRank, rank);
      byKey.set(key, entry);
    });
  });
  return Array.from(byKey.values())
    .sort((left, right) => right.score - left.score || left.bestRank - right.bestRank)
    .map((entry) => entry.chunk);
}

async function hydrateCandidates(notebookId, manifest, candidates) {
  if (!Array.isArray(candidates) || !candidates.length) return [];

  const parentChunksByDoc = await getNotebookParentChunks(notebookId, manifest).catch(() => ({}));
  const docsCache = new Map();

  const getDocRecord = async (docId) => {
    if (docsCache.has(docId)) return docsCache.get(docId);
    const record = await loadDocumentRecord(notebookId, docId).catch(() => null);
    if (record) {
      docsCache.set(docId, record);
    }
    return record;
  };

  const hydrated = [];
  const seenParentKeys = new Set();

  for (const chunk of candidates) {
    const docId = chunk.documentId;
    const parentIndex = chunk.parentIndex;

    let parentText = null;
    let parentLocator = chunk.locator;

    if (docId && parentIndex != null) {
      let parentChunk = null;
      if (parentChunksByDoc[docId] && parentChunksByDoc[docId][parentIndex]) {
        parentChunk = parentChunksByDoc[docId][parentIndex];
      } else {
        const record = await getDocRecord(docId);
        if (record && Array.isArray(record.parentChunks) && record.parentChunks[parentIndex]) {
          parentChunk = record.parentChunks[parentIndex];
        }
      }

      if (parentChunk) {
        parentText = parentChunk.text;
        const parts = [];
        if (parentChunk.label) parts.push(parentChunk.label);
        if (parentChunk.page != null) parts.push(`${parentChunk.page}쪽`);
        if (parts.length) {
          parentLocator = parts.join(" · ");
        }
      }
    }

    const parentKey = docId && parentIndex != null
      ? `${docId}:${parentIndex}`
      : `${docId}:child:${chunk.chunkIndex ?? chunk.index}`;

    if (seenParentKeys.has(parentKey)) continue;
    seenParentKeys.add(parentKey);

    hydrated.push({
      ...chunk,
      text: parentText || chunk.text,
      locator: parentLocator
    });
  }

  return hydrated;
}
