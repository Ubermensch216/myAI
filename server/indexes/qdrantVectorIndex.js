import crypto from "node:crypto";
import { loadLocalEnv } from "../env.js";

loadLocalEnv();

const DEFAULT_COLLECTION = "myai_notebook_chunks";
const DEFAULT_VECTOR_NAME = "dense_bge_m3";
const DEFAULT_VECTOR_SIZE = 1024;
const DEFAULT_TIMEOUT_MS = 2500;
const DEFAULT_SEARCH_LIMIT = 48;
const DEFAULT_UPSERT_BATCH_SIZE = 128;
const RRF_K = 60;

export function getQdrantConfig() {
  const rawUrl = String(process.env.QDRANT_URL || "").trim();
  return {
    configured: Boolean(rawUrl),
    url: rawUrl.replace(/\/+$/, ""),
    apiKey: String(process.env.QDRANT_API_KEY || "").trim(),
    collection: String(process.env.QDRANT_COLLECTION || DEFAULT_COLLECTION).trim() || DEFAULT_COLLECTION,
    vectorName: String(process.env.QDRANT_VECTOR_NAME || DEFAULT_VECTOR_NAME).trim() || DEFAULT_VECTOR_NAME,
    vectorSize: Number(process.env.EMBED_DIM || DEFAULT_VECTOR_SIZE),
    timeoutMs: Math.max(500, Number(process.env.QDRANT_TIMEOUT_MS || DEFAULT_TIMEOUT_MS)),
    searchLimit: Math.max(1, Number(process.env.QDRANT_SEARCH_LIMIT || DEFAULT_SEARCH_LIMIT)),
    upsertBatchSize: Math.max(1, Number(process.env.QDRANT_UPSERT_BATCH_SIZE || DEFAULT_UPSERT_BATCH_SIZE))
  };
}

export async function getQdrantHealth(options = {}) {
  const config = getQdrantConfig();
  if (!config.configured) {
    return {
      configured: false,
      ok: false,
      collection: config.collection,
      vectorName: config.vectorName,
      reason: "qdrant_url_not_configured"
    };
  }

  try {
    const collection = await qdrantRequest(`/collections/${encodeURIComponent(config.collection)}`, {
      signal: options.signal,
      allowNotFound: true
    });
    if (!collection) {
      return {
        configured: true,
        ok: false,
        collection: config.collection,
        vectorName: config.vectorName,
        reason: "collection_not_found"
      };
    }

    const result = collection.result || {};
    return {
      configured: true,
      ok: true,
      collection: config.collection,
      vectorName: config.vectorName,
      status: result.status || null,
      pointsCount: result.points_count ?? null,
      vectorsCount: result.vectors_count ?? null
    };
  } catch (error) {
    const classified = classifyQdrantError(error);
    return {
      configured: true,
      ok: false,
      collection: config.collection,
      vectorName: config.vectorName,
      reason: classified.reason,
      error: error.message,
      hint: classified.hint
    };
  }
}

export async function ensureQdrantCollection(options = {}) {
  const config = getQdrantConfig();
  if (!config.configured) {
    return { ok: false, created: false, reason: "qdrant_url_not_configured" };
  }

  const dimension = Number(options.dimension || config.vectorSize);
  if (!Number.isFinite(dimension) || dimension <= 0) {
    throw new Error(`Invalid Qdrant vector dimension: ${options.dimension}`);
  }

  const collectionPath = `/collections/${encodeURIComponent(config.collection)}`;
  const existing = await qdrantRequest(collectionPath, {
    signal: options.signal,
    allowNotFound: true
  });
  if (existing) {
    validateCollectionVector(existing, config.vectorName, dimension);
    await createPayloadIndexes(config, options.signal);
    return { ok: true, created: false, collection: config.collection };
  }

  await qdrantRequest(collectionPath, {
    method: "PUT",
    signal: options.signal,
    body: {
      vectors: {
        [config.vectorName]: {
          size: dimension,
          distance: "Cosine"
        }
      }
    }
  });

  await createPayloadIndexes(config, options.signal);

  return {
    ok: true,
    created: true,
    collection: config.collection,
    vectorName: config.vectorName,
    dimension
  };
}

export async function upsertNotebookDocumentVectors({
  notebookId,
  documentRecord,
  embeddingModel = process.env.EMBED_MODEL || "bge-m3",
  embeddingDim,
  chunkerVersion = "v1",
  signal
}) {
  const config = getQdrantConfig();
  if (!config.configured) {
    return { ok: false, upserted: 0, reason: "qdrant_url_not_configured" };
  }
  if (!notebookId || !documentRecord?.id) {
    throw new Error("Qdrant upsert requires notebookId and documentRecord.id.");
  }

  const chunks = Array.isArray(documentRecord.chunks) ? documentRecord.chunks : [];
  const embeddedChunks = chunks
    .map((chunk, index) => ({ chunk, index }))
    .filter(({ chunk }) => Array.isArray(chunk.embedding) && chunk.embedding.length);

  if (!embeddedChunks.length) {
    return { ok: false, upserted: 0, reason: "no_embedded_chunks" };
  }

  const dimension = Number(embeddingDim || documentRecord.embedding?.dim || embeddedChunks[0].chunk.embedding.length);
  await ensureQdrantCollection({ dimension, signal });

  let upserted = 0;
  for (let start = 0; start < embeddedChunks.length; start += config.upsertBatchSize) {
    const batch = embeddedChunks.slice(start, start + config.upsertBatchSize);
    const points = batch.map(({ chunk, index }) => ({
      id: pointId(notebookId, documentRecord.id, chunk.index ?? index),
      vector: {
        [config.vectorName]: chunk.embedding
      },
      payload: buildChunkPayload({
        notebookId,
        documentRecord,
        chunk,
        index,
        embeddingModel,
        embeddingDim: dimension,
        chunkerVersion
      })
    }));

    await qdrantRequest(`/collections/${encodeURIComponent(config.collection)}/points?wait=true`, {
      method: "PUT",
      signal,
      body: { points }
    });
    upserted += points.length;
  }

  return { ok: true, upserted, collection: config.collection };
}

export async function deleteNotebookDocumentVectors({ notebookId, documentId, signal }) {
  const config = getQdrantConfig();
  if (!config.configured) {
    return { ok: false, deleted: false, reason: "qdrant_url_not_configured" };
  }
  if (!notebookId || !documentId) {
    throw new Error("Qdrant delete requires notebookId and documentId.");
  }

  await qdrantRequest(`/collections/${encodeURIComponent(config.collection)}/points/delete?wait=true`, {
    method: "POST",
    signal,
    body: {
      filter: {
        must: [
          keywordMatch("notebookId", notebookId),
          keywordMatch("documentId", documentId)
        ]
      }
    }
  });

  return { ok: true, deleted: true };
}

export async function deleteNotebookVectors({ notebookId, signal }) {
  const config = getQdrantConfig();
  if (!config.configured) {
    return { ok: false, deleted: false, reason: "qdrant_url_not_configured" };
  }
  if (!notebookId) {
    throw new Error("Qdrant delete requires notebookId.");
  }

  await qdrantRequest(`/collections/${encodeURIComponent(config.collection)}/points/delete?wait=true`, {
    method: "POST",
    signal,
    body: {
      filter: {
        must: [keywordMatch("notebookId", notebookId)]
      }
    }
  });

  return { ok: true, deleted: true };
}

export async function countQdrantNotebookChunks({ notebookId, signal }) {
  const config = getQdrantConfig();
  if (!config.configured) {
    return { ok: false, count: null, reason: "qdrant_url_not_configured" };
  }
  if (!notebookId) {
    throw new Error("Qdrant count requires notebookId.");
  }

  const response = await qdrantRequest(`/collections/${encodeURIComponent(config.collection)}/points/count`, {
    method: "POST",
    signal,
    body: {
      exact: true,
      filter: {
        must: [keywordMatch("notebookId", notebookId)]
      }
    }
  });

  return {
    ok: true,
    count: Number(response?.result?.count ?? 0)
  };
}

export async function searchQdrantNotebookChunks({
  notebookId,
  queryEmbeddings,
  limit,
  signal
}) {
  const config = getQdrantConfig();
  if (!config.configured) {
    return { ok: false, chunks: [], reason: "qdrant_url_not_configured" };
  }
  const vectors = normalizeQueryEmbeddings(queryEmbeddings);
  if (!notebookId || !vectors.length) {
    return { ok: false, chunks: [], reason: "missing_notebook_or_query_vector" };
  }

  const perQueryLimit = Math.max(1, Number(limit || config.searchLimit));
  const resultLists = [];

  for (const vector of vectors) {
    const response = await qdrantRequest(`/collections/${encodeURIComponent(config.collection)}/points/search`, {
      method: "POST",
      signal,
      body: {
        vector: {
          name: config.vectorName,
          vector
        },
        filter: {
          must: [keywordMatch("notebookId", notebookId)]
        },
        limit: perQueryLimit,
        with_payload: true,
        with_vector: false
      }
    });
    resultLists.push(Array.isArray(response?.result) ? response.result : []);
  }

  return {
    ok: true,
    chunks: fuseQdrantResults(resultLists),
    resultSets: resultLists.length,
    collection: config.collection
  };
}

async function createPayloadIndexes(config, signal) {
  const fields = [
    ["notebookId", "keyword"],
    ["documentId", "keyword"],
    ["documentType", "keyword"]
  ];
  for (const [fieldName, fieldSchema] of fields) {
    await qdrantRequest(`/collections/${encodeURIComponent(config.collection)}/index`, {
      method: "PUT",
      signal,
      body: {
        field_name: fieldName,
        field_schema: fieldSchema
      }
    }).catch(() => {});
  }
}

async function qdrantRequest(path, { method = "GET", body, signal, allowNotFound = false } = {}) {
  const config = getQdrantConfig();
  if (!config.configured) {
    throw new Error("QDRANT_URL is not configured.");
  }

  const { signal: requestSignal, cleanup } = linkedTimeoutSignal(signal, config.timeoutMs);
  const headers = { "Content-Type": "application/json" };
  if (config.apiKey) headers["api-key"] = config.apiKey;

  try {
    const response = await fetch(`${config.url}${path}`, {
      method,
      signal: requestSignal,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (allowNotFound && response.status === 404) return null;
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`Qdrant ${method} ${path} returned ${response.status}: ${text.slice(0, 240)}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  } finally {
    cleanup();
  }
}

function classifyQdrantError(error) {
  const message = String(error?.message || "");
  if (/returned\s+(401|403)\b|invalid api key|jwt|unauthorized|forbidden/i.test(message)) {
    return {
      reason: "qdrant_auth_failed",
      hint: "Qdrant rejected QDRANT_API_KEY. Match the key used by the running Qdrant service, then restart myAI so .env is reloaded."
    };
  }
  if (/timed out|timeout|aborted/i.test(message)) {
    return {
      reason: "qdrant_timeout",
      hint: "Qdrant did not respond within QDRANT_TIMEOUT_MS. Check container health, local disk pressure, and QDRANT_URL."
    };
  }
  return {
    reason: "qdrant_unreachable",
    hint: "myAI could not reach Qdrant. Check QDRANT_URL, Docker/service status, firewall rules, and restart myAI after .env changes."
  };
}

function linkedTimeoutSignal(parentSignal, timeoutMs) {
  const controller = new AbortController();
  const abortFromParent = () => {
    if (!controller.signal.aborted) {
      controller.abort(parentSignal?.reason || new Error("Qdrant request aborted."));
    }
  };
  if (parentSignal?.aborted) abortFromParent();
  else parentSignal?.addEventListener("abort", abortFromParent, { once: true });

  const timer = setTimeout(() => {
    if (!controller.signal.aborted) controller.abort(new Error("Qdrant request timed out."));
  }, timeoutMs);

  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      parentSignal?.removeEventListener("abort", abortFromParent);
    }
  };
}

function buildChunkPayload({
  notebookId,
  documentRecord,
  chunk,
  index,
  embeddingModel,
  embeddingDim,
  chunkerVersion
}) {
  const text = String(chunk.text || "");
  return {
    notebookId,
    documentId: documentRecord.id,
    documentName: documentRecord.name,
    documentType: documentRecord.type,
    chunkIndex: chunk.index ?? index,
    page: chunk.page ?? null,
    label: chunk.label ?? "",
    part: chunk.part ?? null,
    partTotal: chunk.partTotal ?? null,
    locator: formatLocator(chunk),
    text,
    textHash: crypto.createHash("sha256").update(text).digest("hex").slice(0, 24),
    embeddingModel,
    embeddingDim,
    chunkerVersion,
    createdAt: documentRecord.addedAt || new Date().toISOString()
  };
}

function validateCollectionVector(collection, vectorName, expectedDim) {
  const vectors = collection?.result?.config?.params?.vectors;
  const vectorConfig = vectors?.[vectorName] || (vectors?.size ? vectors : null);
  if (!vectorConfig) {
    throw new Error(`Qdrant collection is missing vector "${vectorName}".`);
  }
  const actualDim = Number(vectorConfig.size);
  if (Number.isFinite(actualDim) && actualDim !== expectedDim) {
    throw new Error(`Qdrant vector dimension mismatch: collection=${actualDim}, expected=${expectedDim}.`);
  }
}

function fuseQdrantResults(resultLists) {
  const fused = new Map();
  for (const results of resultLists) {
    results.forEach((result, rank) => {
      const key = String(result.id);
      const existing = fused.get(key) || {
        id: key,
        payload: result.payload || {},
        rrfScore: 0,
        qdrantScore: result.score ?? null
      };
      existing.rrfScore += 1 / (RRF_K + rank + 1);
      if ((result.score ?? -Infinity) > (existing.qdrantScore ?? -Infinity)) {
        existing.qdrantScore = result.score;
        existing.payload = result.payload || existing.payload;
      }
      fused.set(key, existing);
    });
  }

  return Array.from(fused.values())
    .sort((left, right) => right.rrfScore - left.rrfScore)
    .map(({ payload, rrfScore, qdrantScore }) => payloadToChunk(payload, { rrfScore, qdrantScore }));
}

function payloadToChunk(payload, scores) {
  return {
    text: String(payload.text || ""),
    documentId: payload.documentId,
    documentName: payload.documentName,
    documentType: payload.documentType,
    page: payload.page,
    label: payload.label,
    part: payload.part,
    partTotal: payload.partTotal,
    chunkIndex: payload.chunkIndex,
    locator: payload.locator || "",
    rrfScore: scores.rrfScore,
    qdrantScore: scores.qdrantScore
  };
}

function normalizeQueryEmbeddings(queryEmbeddings) {
  if (!Array.isArray(queryEmbeddings)) return [];
  if (queryEmbeddings.length && typeof queryEmbeddings[0] === "number") {
    return [queryEmbeddings];
  }
  return queryEmbeddings.filter((vector) => Array.isArray(vector) && vector.length);
}

function pointId(...parts) {
  const hex = crypto
    .createHash("sha256")
    .update(parts.map((part) => String(part)).join(":"))
    .digest("hex")
    .slice(0, 32)
    .split("");
  hex[12] = "5";
  hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  const value = hex.join("");
  return [
    value.slice(0, 8),
    value.slice(8, 12),
    value.slice(12, 16),
    value.slice(16, 20),
    value.slice(20)
  ].join("-");
}

function keywordMatch(key, value) {
  return {
    key,
    match: { value }
  };
}

function formatLocator(chunk) {
  const parts = [];
  if (chunk.label) parts.push(chunk.label);
  if (chunk.page != null) parts.push(`${chunk.page}쪽`);
  if (chunk.part) parts.push(`part ${chunk.part}/${chunk.partTotal}`);
  return parts.join(" · ");
}
