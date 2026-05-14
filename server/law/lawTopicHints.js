const TOPIC_HINTS = [
  {
    pattern: /(밀폐\s*공간|산소\s*결핍|질식\s*재해|유해\s*가스|맨홀\s*작업|탱크\s*내부\s*작업|정화조\s*작업)/u,
    searchQuery: "밀폐공간 작업 산업안전보건기준에 관한 규칙 산업안전보건법",
    articleRefs: [
      { lawName: "산업안전보건기준에 관한 규칙", article: "제618조" },
      { lawName: "산업안전보건기준에 관한 규칙", article: "제619조" },
      { lawName: "산업안전보건법", article: "제39조" },
      { lawName: "산업안전보건기준에 관한 규칙", article: "제619조의2" },
      { lawName: "산업안전보건기준에 관한 규칙", article: "제620조" },
      { lawName: "산업안전보건기준에 관한 규칙", article: "제622조" },
      { lawName: "산업안전보건기준에 관한 규칙", article: "제623조" },
      { lawName: "산업안전보건기준에 관한 규칙", article: "제624조" }
    ],
    queries: [
      "밀폐공간",
      "밀폐공간 작업",
      "산업안전보건기준에 관한 규칙 밀폐공간",
      "산업안전보건기준에 관한 규칙 제618조",
      "산업안전보건기준에 관한 규칙 제619조",
      "산업안전보건법 제39조"
    ]
  },
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
  return uniqueRefs(refs).slice(0, 8);
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
