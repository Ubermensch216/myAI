const TOPIC_HINTS = [
  {
    pattern: /(위반\s*건축물|불법\s*건축물|무허가\s*건축물|건축법\s*위반|이행강제금)/u,
    searchQuery: "건축법 위반건축물",
    articleRefs: [
      { lawName: "건축법", article: "제79조" },
      { lawName: "건축법", article: "제80조" }
    ],
    queries: ["건축법", "건축법 위반건축물", "건축법 제79조", "건축법 제80조"]
  }
];

export function buildLawTopicSearchQuery(query) {
  const text = normalizeTopicText(query);
  const hint = TOPIC_HINTS.find((item) => item.pattern.test(text));
  return hint?.searchQuery || text || String(query || "").trim();
}

export function expandLawTopicQueries(query) {
  const text = normalizeTopicText(query);
  const values = [text];
  for (const hint of TOPIC_HINTS) {
    if (hint.pattern.test(text)) values.push(...hint.queries);
  }
  return uniqueStrings(values).slice(0, 6);
}

export function inferLawArticleRefsForTopic(query) {
  const text = normalizeTopicText(query);
  const refs = [];
  for (const hint of TOPIC_HINTS) {
    if (hint.pattern.test(text)) refs.push(...hint.articleRefs);
  }
  return uniqueRefs(refs).slice(0, 4);
}

function normalizeTopicText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function uniqueStrings(values) {
  const output = [];
  const seen = new Set();
  for (const value of values) {
    const text = normalizeTopicText(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
  }
  return output;
}

function uniqueRefs(refs) {
  const output = [];
  const seen = new Set();
  for (const ref of refs) {
    const key = `${ref.lawName}/${ref.article}`;
    if (!ref.lawName || !ref.article || seen.has(key)) continue;
    seen.add(key);
    output.push(ref);
  }
  return output;
}
