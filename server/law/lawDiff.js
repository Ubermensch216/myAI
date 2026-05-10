// Pure structural diff for law.go.kr article text. Splits the article body
// into lines (paragraphs/items as joined by collectArticleText), then runs an
// LCS-based diff. Adjacent removed+added pairs with high bigram similarity are
// collapsed into a single `modified` hunk so callers can render side-by-side
// changes without flooding the UI with noise.

export function computeArticleDiff(fromText, toText, options = {}) {
  const fromLines = splitLines(fromText);
  const toLines = splitLines(toText);
  const pairs = computeLcs(fromLines, toLines);
  const raw = buildRawHunks(fromLines, toLines, pairs);
  const threshold = clampNumber(options.modifiedSimilarityThreshold, 0, 1, 0.5);
  const hunks = pairHunks(raw, threshold);
  const stats = computeStats(hunks);
  return {
    fromLineCount: fromLines.length,
    toLineCount: toLines.length,
    identical: stats.added === 0 && stats.removed === 0 && stats.modified === 0,
    hunks,
    stats
  };
}

export function bigramSimilarity(a, b) {
  const aBigrams = bigrams(a);
  const bBigrams = bigrams(b);
  if (!aBigrams.size && !bBigrams.size) return 1;
  let intersection = 0;
  for (const bigram of aBigrams) if (bBigrams.has(bigram)) intersection += 1;
  const union = aBigrams.size + bBigrams.size - intersection;
  return union ? intersection / union : 0;
}

function splitLines(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function computeLcs(a, b) {
  const n = a.length;
  const m = b.length;
  if (!n || !m) return [];
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const pairs = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      pairs.unshift([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return pairs;
}

function buildRawHunks(a, b, pairs) {
  const hunks = [];
  let i = 0;
  let j = 0;
  for (const [pi, pj] of pairs) {
    while (i < pi) {
      hunks.push({ type: "removed", text: a[i] });
      i += 1;
    }
    while (j < pj) {
      hunks.push({ type: "added", text: b[j] });
      j += 1;
    }
    hunks.push({ type: "unchanged", text: a[pi] });
    i += 1;
    j += 1;
  }
  while (i < a.length) {
    hunks.push({ type: "removed", text: a[i] });
    i += 1;
  }
  while (j < b.length) {
    hunks.push({ type: "added", text: b[j] });
    j += 1;
  }
  return hunks;
}

function pairHunks(rawHunks, threshold) {
  const result = [];
  for (let k = 0; k < rawHunks.length; k += 1) {
    const cur = rawHunks[k];
    const next = rawHunks[k + 1];
    if (cur.type === "removed" && next?.type === "added") {
      const similarity = bigramSimilarity(cur.text, next.text);
      if (similarity >= threshold) {
        result.push({
          type: "modified",
          oldText: cur.text,
          newText: next.text,
          similarity: Number(similarity.toFixed(3))
        });
        k += 1;
        continue;
      }
    }
    result.push(cur);
  }
  return result;
}

function computeStats(hunks) {
  const stats = { added: 0, removed: 0, modified: 0, unchanged: 0 };
  for (const hunk of hunks) {
    stats[hunk.type] = (stats[hunk.type] || 0) + 1;
  }
  return stats;
}

function bigrams(text) {
  const set = new Set();
  const normalized = String(text || "").replace(/\s+/g, "");
  for (let i = 0; i < normalized.length - 1; i += 1) {
    set.add(normalized.slice(i, i + 2));
  }
  return set;
}

function clampNumber(value, min, max, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(min, Math.min(max, num));
}
