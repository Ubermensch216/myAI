const STOPWORDS = new Set([
  "the", "a", "an", "is", "are", "was", "were", "be", "to", "of",
  "and", "or", "for", "on", "in", "at", "with", "as", "by", "that",
  "this", "it", "its", "from", "into", "than", "then", "but"
]);

const CJK_RUN = /^[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]+$/u;
const TOKEN_SPLIT = /[^\p{L}\p{N}]+/u;
const MIN_BIGRAM_RUN = 2;
const HEADER_OVERHEAD = 80;

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
