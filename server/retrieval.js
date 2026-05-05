const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "to", "of",
  "and", "or", "for", "on", "in", "at", "with", "as", "by", "that",
  "this", "it", "its", "from", "into", "than", "then", "but"
]);

const CJK_RUN = /^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u;
const TOKEN_SPLIT = /[^\p{L}\p{N}]+/u;
const MIN_BIGRAM_RUN = 2;
const HEADER_OVERHEAD = 80;
const RRF_K = 60;

export function tokenize(text) {
  const lowered = String(text ?? "").toLowerCase();
  const tokens = [];
  for (const word of lowered.split(TOKEN_SPLIT)) {
    if (!word || STOPWORDS.has(word)) continue;
    tokens.push(word);
    if (CJK_RUN.test(word) && word.length >= MIN_BIGRAM_RUN) {
      for (let index = 0; index < word.length - 1; index += 1) {
        tokens.push(word.slice(index, index + 2));
      }
    }
  }
  return tokens;
}

export function pickRelevantChunks(chunks, query, budget) {
  if (!chunks.length || budget <= 0) return [];

  const queryTokens = tokenize(query);
  if (!queryTokens.length) return greedyFit(chunks, budget);

  const docTokens = chunks.map((chunk) => tokenize(chunk.text));
  const docFreq = new Map();
  for (const tokens of docTokens) {
    for (const token of new Set(tokens)) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }

  const totalDocs = chunks.length;
  const avgLength = docTokens.reduce((sum, tokens) => sum + tokens.length, 0) / Math.max(1, totalDocs);
  const k1 = 1.5;
  const b = 0.75;

  const scored = chunks.map((chunk, index) => {
    const tokens = docTokens[index];
    const termFrequency = new Map();
    for (const token of tokens) termFrequency.set(token, (termFrequency.get(token) || 0) + 1);

    let score = 0;
    for (const queryToken of queryTokens) {
      const frequency = termFrequency.get(queryToken);
      if (!frequency) continue;
      const df = docFreq.get(queryToken) || 0;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      const numerator = frequency * (k1 + 1);
      const denominator = frequency + k1 * (1 - b + b * (tokens.length / Math.max(1, avgLength)));
      score += idf * (numerator / denominator);
    }

    return { chunk, score, index };
  });

  scored.sort((left, right) => right.score - left.score || left.index - right.index);

  const selected = [];
  let used = 0;
  for (const item of scored) {
    if (item.score <= 0) break;
    const cost = item.chunk.text.length + HEADER_OVERHEAD;
    if (used + cost > budget && selected.length) continue;
    selected.push(item);
    used += cost;
    if (used >= budget) break;
  }

  if (!selected.length) return greedyFit(chunks, budget);

  selected.sort((left, right) => left.index - right.index);
  return selected.map((item) => item.chunk);
}

/**
 * Multi-query hybrid retrieval. For each (query, queryEmbedding) pair we build
 * a BM25 ranking and (when embeddings exist) a vector ranking, then fuse all
 * 2*N rankings via Reciprocal Rank Fusion. Empty queries / null embeddings are
 * skipped. Falls back to single-query hybridSelect when only one query exists,
 * or to greedyFit when none of the rankings produce a positive score.
 *
 * queries: string[] — first entry is the original user query
 * queryEmbeddings: (float[]|null)[] — same length as queries, null = skip vector
 */
export function multiQueryHybridSelect(chunks, queries, queryEmbeddings, budget) {
  if (!chunks.length || budget <= 0) return [];
  const validQueries = (queries || []).map((q) => String(q ?? "").trim()).filter(Boolean);
  if (validQueries.length === 0) return greedyFit(chunks, budget);
  if (validQueries.length === 1) {
    return hybridSelect(chunks, validQueries[0], budget, queryEmbeddings?.[0] ?? null);
  }

  const docTokens = chunks.map((chunk) => tokenize(chunk.text));
  const docFreq = new Map();
  for (const tokens of docTokens) {
    for (const token of new Set(tokens)) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }
  const totalDocs = chunks.length;
  const avgLength = docTokens.reduce((s, t) => s + t.length, 0) / Math.max(1, totalDocs);
  const hasEmbeddings = chunks.some((c) => c.embedding);

  const rankMaps = [];
  for (let i = 0; i < validQueries.length; i += 1) {
    const queryTokens = tokenize(validQueries[i]);
    if (queryTokens.length) {
      const bm25Map = bm25RankMap(chunks, queryTokens, docTokens, docFreq, avgLength, totalDocs);
      if (bm25Map) rankMaps.push(bm25Map);
    }
    const qEmbed = queryEmbeddings?.[i];
    if (hasEmbeddings && qEmbed) {
      rankMaps.push(vectorRankMap(chunks, qEmbed));
    }
  }

  if (!rankMaps.length) return greedyFit(chunks, budget);

  const rrfScored = chunks.map((chunk, index) => {
    let score = 0;
    for (const map of rankMaps) {
      const rank = map.get(index) ?? totalDocs;
      score += 1 / (RRF_K + rank);
    }
    return { chunk, score, index };
  });

  rrfScored.sort((left, right) => right.score - left.score || left.index - right.index);

  const selected = [];
  let used = 0;
  for (const item of rrfScored) {
    const cost = item.chunk.text.length + HEADER_OVERHEAD;
    if (used + cost > budget && selected.length) continue;
    selected.push(item);
    used += cost;
    if (used >= budget) break;
  }

  if (!selected.length) return greedyFit(chunks, budget);
  selected.sort((left, right) => left.index - right.index);
  return selected.map((item) => item.chunk);
}

function bm25RankMap(chunks, queryTokens, docTokens, docFreq, avgLength, totalDocs) {
  const k1 = 1.5;
  const b = 0.75;
  const scores = chunks.map((_, index) => {
    const tokens = docTokens[index];
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    let score = 0;
    for (const qt of queryTokens) {
      const freq = tf.get(qt);
      if (!freq) continue;
      const df = docFreq.get(qt) || 0;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      const num = freq * (k1 + 1);
      const den = freq + k1 * (1 - b + b * (tokens.length / Math.max(1, avgLength)));
      score += idf * (num / den);
    }
    return { index, score };
  });
  if (!scores.some((item) => item.score > 0)) return null;
  const sorted = [...scores].sort((left, right) => right.score - left.score);
  return new Map(sorted.map((item, rank) => [item.index, rank]));
}

function vectorRankMap(chunks, queryEmbedding) {
  const scores = chunks.map((chunk, index) => ({
    index,
    sim: chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : -1
  }));
  const sorted = [...scores].sort((left, right) => right.sim - left.sim);
  return new Map(sorted.map((item, rank) => [item.index, rank]));
}

export function greedyFit(chunks, budget) {
  const selected = [];
  let used = 0;
  for (const chunk of chunks) {
    const cost = chunk.text.length + HEADER_OVERHEAD;
    if (used + cost > budget && selected.length) break;
    selected.push(chunk);
    used += cost;
  }
  return selected;
}

export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const mag = Math.sqrt(magA) * Math.sqrt(magB);
  return mag === 0 ? 0 : dot / mag;
}

/**
 * Hybrid retrieval using Reciprocal Rank Fusion (BM25 + vector similarity).
 * Falls back to BM25-only when queryEmbedding is null or chunks lack embeddings.
 *
 * chunks: array of { text, embedding? (float[]), ...meta }
 * queryEmbedding: float[] from embedText(query), or null for BM25-only
 */
export function hybridSelect(chunks, query, budget, queryEmbedding) {
  if (!chunks.length || budget <= 0) return [];
  if (!queryEmbedding) return pickRelevantChunks(chunks, query, budget);

  const queryTokens = tokenize(query);
  const docTokens = chunks.map((chunk) => tokenize(chunk.text));

  // BM25 scoring
  const docFreq = new Map();
  for (const tokens of docTokens) {
    for (const token of new Set(tokens)) {
      docFreq.set(token, (docFreq.get(token) || 0) + 1);
    }
  }
  const totalDocs = chunks.length;
  const avgLength = docTokens.reduce((s, t) => s + t.length, 0) / Math.max(1, totalDocs);
  const k1 = 1.5;
  const b = 0.75;

  const bm25Scores = chunks.map((chunk, index) => {
    const tokens = docTokens[index];
    const tf = new Map();
    for (const token of tokens) tf.set(token, (tf.get(token) || 0) + 1);
    let score = 0;
    for (const qt of queryTokens) {
      const freq = tf.get(qt);
      if (!freq) continue;
      const df = docFreq.get(qt) || 0;
      const idf = Math.log(1 + (totalDocs - df + 0.5) / (df + 0.5));
      const num = freq * (k1 + 1);
      const den = freq + k1 * (1 - b + b * (tokens.length / Math.max(1, avgLength)));
      score += idf * (num / den);
    }
    return { index, score };
  });

  const hasBm25Scores = bm25Scores.some((item) => item.score > 0);
  const bm25Sorted = hasBm25Scores
    ? [...bm25Scores].sort((left, right) => right.score - left.score)
    : [];
  const bm25Rank = hasBm25Scores
    ? new Map(bm25Sorted.map((item, rank) => [item.index, rank]))
    : null;

  // Vector ranking (skip chunks without embeddings)
  const hasEmbeddings = chunks.some((c) => c.embedding);
  let vecRank = null;
  if (hasEmbeddings) {
    const vecScores = chunks.map((chunk, index) => ({
      index,
      sim: chunk.embedding ? cosineSimilarity(queryEmbedding, chunk.embedding) : -1
    }));
    const vecSorted = [...vecScores].sort((left, right) => right.sim - left.sim);
    vecRank = new Map(vecSorted.map((item, rank) => [item.index, rank]));
  }

  if (!bm25Rank && !vecRank) return greedyFit(chunks, budget);

  // RRF combination
  const rrfScored = chunks.map((chunk, index) => {
    const br = bm25Rank ? (bm25Rank.get(index) ?? totalDocs) : totalDocs;
    const vr = vecRank ? (vecRank.get(index) ?? totalDocs) : totalDocs;
    const score = (bm25Rank ? 1 / (RRF_K + br) : 0) + (vecRank ? 1 / (RRF_K + vr) : 0);
    return { chunk, score, index };
  });

  rrfScored.sort((left, right) => right.score - left.score || left.index - right.index);

  const selected = [];
  let used = 0;
  for (const item of rrfScored) {
    const cost = item.chunk.text.length + HEADER_OVERHEAD;
    if (used + cost > budget && selected.length) continue;
    selected.push(item);
    used += cost;
    if (used >= budget) break;
  }

  if (!selected.length) return greedyFit(chunks, budget);

  selected.sort((left, right) => left.index - right.index);
  return selected.map((item) => item.chunk);
}
