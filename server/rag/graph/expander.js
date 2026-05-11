import fs from "node:fs";
import {
  openNotebookGraph,
  findNodesByAlias,
  neighborsOf,
  sourceRefsOf,
  getNotebookGraphPath,
  normalizeLabel
} from "./store.js";
import { extractLawCitations } from "../../law/lawArticleRef.js";

const DEFAULT_TERM_LIMIT = Number(process.env.KG_EXPAND_TERMS || 8);
const DEFAULT_NEIGHBOR_LIMIT = Number(process.env.KG_EXPAND_NEIGHBORS || 8);
const DEFAULT_REFS_PER_NODE = Number(process.env.KG_EXPAND_REFS || 4);
const DEFAULT_MAX_SUPPLEMENTS = Number(process.env.KG_EXPAND_MAX || 12);

export function notebookHasGraph(notebookId) {
  try {
    return fs.existsSync(getNotebookGraphPath(notebookId));
  } catch {
    return false;
  }
}

function tokenizeQuery(query) {
  const text = String(query || "").trim();
  if (!text) return [];
  const out = new Set();
  out.add(text);
  for (const piece of text.split(/[\s,.;:!?()\[\]{}<>"'·…\-]+/)) {
    const t = piece.trim();
    if (t && t.length >= 2) out.add(t);
  }
  return Array.from(out);
}

function seedNodesForQuery(db, query, termLimit) {
  const terms = tokenizeQuery(query);
  const seen = new Map();
  for (const term of terms) {
    const matches = findNodesByAlias(db, term, 5);
    for (const m of matches) {
      if (!seen.has(m.id)) {
        seen.set(m.id, {
          id: m.id,
          type: m.type,
          label: m.label,
          confidence: m.confidence,
          matchedTerm: term
        });
      }
    }
    if (seen.size >= termLimit * 2) break;
  }
  return Array.from(seen.values())
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
    .slice(0, termLimit);
}

function expandToNeighborhood(db, seeds, neighborLimit) {
  const nodes = new Map();
  for (const s of seeds) {
    nodes.set(s.id, { ...s, hop: 0 });
  }
  for (const s of seeds) {
    const neighbors = neighborsOf(db, s.id, { directions: "both", limit: neighborLimit });
    for (const nb of neighbors) {
      if (nodes.has(nb.neighbor_id)) continue;
      nodes.set(nb.neighbor_id, {
        id: nb.neighbor_id,
        type: nb.neighbor_type,
        label: nb.neighbor_label,
        confidence: nb.confidence,
        relType: nb.type,
        direction: nb.direction,
        viaSeed: s.label,
        hop: 1
      });
    }
  }
  return Array.from(nodes.values());
}

function collectChunkKeysFromNodes(db, nodes, refsPerNode) {
  const keys = new Map();
  for (const n of nodes) {
    const refs = sourceRefsOf(db, "node", n.id, refsPerNode);
    for (const r of refs) {
      const key = `${r.documentId}:${r.chunkIndex}`;
      if (!keys.has(key)) {
        keys.set(key, {
          documentId: r.documentId,
          chunkIndex: r.chunkIndex,
          quote: r.quote,
          fromNode: n,
          score: 1 / (1 + n.hop)
        });
      } else {
        const existing = keys.get(key);
        existing.score += 1 / (1 + n.hop);
      }
    }
  }
  return Array.from(keys.values()).sort((a, b) => b.score - a.score);
}

/**
 * Run graph-based expansion for a query against a notebook KG.
 * Returns supplemental chunk keys (documentId+chunkIndex) ranked by graph score.
 *
 * Caller is responsible for:
 *   - hydrating the chunk text via loadNotebookChunksForRetrieval and matching keys
 *   - merging with vector/lexical rankings (e.g. via fuseRankings)
 *
 * Safe to call when the graph DB is missing — returns empty result with reason.
 */
export async function expandQueryWithGraph({
  notebookId,
  query,
  excludeKeys = new Set(),
  termLimit = DEFAULT_TERM_LIMIT,
  neighborLimit = DEFAULT_NEIGHBOR_LIMIT,
  refsPerNode = DEFAULT_REFS_PER_NODE,
  maxSupplements = DEFAULT_MAX_SUPPLEMENTS
} = {}) {
  if (!notebookId || !query || !String(query).trim()) {
    return { ok: false, reason: "empty_input", supplements: [], stats: null };
  }
  if (!notebookHasGraph(notebookId)) {
    return { ok: false, reason: "no_graph", supplements: [], stats: null };
  }
  const t0 = Date.now();
  const db = await openNotebookGraph(notebookId);

  const seeds = seedNodesForQuery(db, query, termLimit);
  if (!seeds.length) {
    return {
      ok: true,
      supplements: [],
      stats: { seeds: 0, neighborhood: 0, candidates: 0, elapsedMs: Date.now() - t0 }
    };
  }
  const neighborhood = expandToNeighborhood(db, seeds, neighborLimit);
  const candidates = collectChunkKeysFromNodes(db, neighborhood, refsPerNode);

  const filtered = candidates
    .filter((c) => !excludeKeys.has(`${c.documentId}:${c.chunkIndex}`))
    .slice(0, maxSupplements);

  const articleRefs = extractArticleRefsFromNeighborhood(neighborhood);

  return {
    ok: true,
    supplements: filtered,
    articleRefs,
    stats: {
      seeds: seeds.length,
      neighborhood: neighborhood.length,
      candidates: candidates.length,
      returned: filtered.length,
      articleRefs: articleRefs.length,
      elapsedMs: Date.now() - t0
    },
    seedLabels: seeds.map((s) => s.label),
    neighborhoodLabels: neighborhood.filter((n) => n.hop > 0).map((n) => n.label).slice(0, 10)
  };
}

/**
 * Pull Article-typed nodes out of the seed+neighborhood set and re-parse their
 * labels via `extractLawCitations` so each ref carries `{ lawName, article,
 * canonical }`. Used by chat orchestration to fetch official article text via
 * `LawApiClient` at answer time — never trust the graph as the source of body
 * text.
 */
export function extractArticleRefsFromNeighborhood(neighborhood) {
  const seen = new Set();
  const refs = [];
  for (const node of neighborhood) {
    if (node?.type !== "Article") continue;
    const label = String(node.label || "").trim();
    if (!label) continue;
    let parsed;
    try {
      parsed = extractLawCitations(label)[0];
    } catch {
      parsed = null;
    }
    if (!parsed?.lawName || !parsed?.article) continue;
    if (seen.has(parsed.canonical)) continue;
    seen.add(parsed.canonical);
    refs.push({
      lawName: parsed.lawName,
      article: parsed.article,
      canonical: parsed.canonical,
      nodeId: node.id || "",
      nodeConfidence: node.confidence ?? null,
      hop: node.hop ?? 0
    });
  }
  return refs;
}
