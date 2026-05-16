const TERM_ENTRIES = [
  {
    id: "lease_deposit",
    scenario: "lease_deposit",
    naturalTerms: ["전세금 못 받음", "전세 보증금 못 받음", "보증금 안 돌려줌", "전세금 반환"],
    canonicalTerms: ["임대차보증금 반환", "임차권등기명령"],
    lawHints: [
      { lawName: "주택임대차보호법" },
      { lawName: "민법" }
    ],
    queryBoosts: ["주택임대차보호법 임대차보증금 반환", "임차권등기명령 신청"]
  },
  {
    id: "unfair_dismissal",
    scenario: "labor",
    naturalTerms: ["해고 억울함", "부당하게 해고", "갑자기 해고", "해고 당함"],
    canonicalTerms: ["부당해고 구제신청", "해고의 정당한 이유"],
    lawHints: [
      { lawName: "근로기준법" },
      { lawName: "노동위원회법" }
    ],
    queryBoosts: ["근로기준법 부당해고", "노동위원회 부당해고 구제신청"]
  },
  {
    id: "cartel",
    scenario: "fair_trade",
    naturalTerms: ["업체가 담합한 것 같음", "가격 담합", "입찰 담합", "업체끼리 짜고"],
    canonicalTerms: ["부당한 공동행위", "담합"],
    lawHints: [
      { lawName: "독점규제 및 공정거래에 관한 법률" }
    ],
    queryBoosts: ["독점규제 및 공정거래에 관한 법률 부당한 공동행위", "공정거래 담합"]
  },
  {
    id: "personal_info_consent",
    scenario: "privacy",
    naturalTerms: ["개인정보 동의 안 받음", "개인정보 동의 없이", "개인정보 무단 수집", "동의 없이 개인정보"],
    canonicalTerms: ["개인정보 수집·이용 동의", "정보주체 동의"],
    lawHints: [
      { lawName: "개인정보 보호법" }
    ],
    queryBoosts: ["개인정보 보호법 개인정보 수집 이용 동의", "개인정보 보호법 정보주체 동의"]
  }
];

export function listLawTermEntries() {
  return TERM_ENTRIES.map(cloneEntry);
}

export function searchLawTerms(query = "", { limit = 5 } = {}) {
  const text = normalize(query);
  if (!text) return [];
  return TERM_ENTRIES
    .map((entry) => ({ entry, score: scoreEntry(entry, text) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score || left.entry.id.localeCompare(right.entry.id))
    .slice(0, Math.max(1, Number(limit) || 5))
    .map((item) => cloneEntry(item.entry));
}

export function expandQueryWithLawTerms(query = "", { limit = 3 } = {}) {
  const base = String(query || "").trim();
  const matches = searchLawTerms(base, { limit });
  if (!matches.length) return base;
  const additions = [];
  for (const match of matches) {
    additions.push(...match.canonicalTerms, ...match.queryBoosts);
    for (const hint of match.lawHints || []) {
      if (hint?.lawName) additions.push(hint.article ? `${hint.lawName} ${hint.article}` : hint.lawName);
    }
  }
  const unique = uniqueStrings(additions).slice(0, 10);
  return unique.length ? `${base} ${unique.join(" ")}`.trim() : base;
}

export function inferLawTermArticleRefs(query = "") {
  const refs = [];
  for (const match of searchLawTerms(query, { limit: 3 })) {
    for (const hint of match.lawHints || []) {
      if (hint?.lawName && hint?.article) refs.push({ lawName: hint.lawName, article: hint.article });
    }
  }
  return uniqueRefs(refs);
}

function scoreEntry(entry, text) {
  let score = 0;
  for (const term of entry.naturalTerms || []) {
    const n = normalize(term);
    if (!n) continue;
    if (text.includes(n)) score += 10 + n.length;
    else score += sharedTokenScore(text, n);
  }
  for (const term of entry.canonicalTerms || []) {
    const n = normalize(term);
    if (n && text.includes(n)) score += 6;
  }
  return score;
}

function sharedTokenScore(left, right) {
  const leftTokens = new Set(tokenize(left));
  if (!leftTokens.size) return 0;
  let score = 0;
  for (const token of tokenize(right)) {
    if (leftTokens.has(token)) score += 2;
  }
  return score;
}

function tokenize(value) {
  return normalize(value)
    .split(/[^0-9a-z가-힣]+/u)
    .filter((token) => token.length >= 2);
}

function normalize(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function uniqueStrings(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

function uniqueRefs(refs) {
  const out = [];
  const seen = new Set();
  for (const ref of refs || []) {
    const key = `${ref.lawName}/${ref.article}`;
    if (!ref.lawName || !ref.article || seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

function cloneEntry(entry) {
  return {
    id: entry.id,
    scenario: entry.scenario,
    naturalTerms: [...(entry.naturalTerms || [])],
    canonicalTerms: [...(entry.canonicalTerms || [])],
    lawHints: (entry.lawHints || []).map((item) => ({ ...item })),
    queryBoosts: [...(entry.queryBoosts || [])]
  };
}
