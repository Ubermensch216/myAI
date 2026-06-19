// 자연어 법령 질의에서 판례/결정례 검색에 쓸 검색어를 생성하는 공유 유틸리티.
// 법령검토(워크벤치)와 정보탐색(채팅 법령 컨텍스트)이 동일한 검색 전략을 쓰도록
// 한 곳에서 관리한다.

const DECISION_FILLER_TAIL = /\s+(근거|요건|방법|방안|기준|적용|관련|관해|여부|사례|검토)$/u;
// 한국 사건번호: 연도(4자리) + 사건부호(한글 1~3자, 예: 도/다/두/헌마/헌바/카합) + 일련번호.
const CASE_NUMBER_PATTERN = /(?:19|20)\d{2}\s?[가-힣]{1,3}\s?\d{1,7}/g;
const CASE_NUMBER_EXACT = /^(?:19|20)\d{2}[가-힣]{1,3}\d{1,7}$/;
// 본문 키워드 검색에서 신호가 약한 일반 명사·접속어는 제거한다.
const DECISION_STOPWORDS = new Set([
  "여부", "경우", "관련", "관해", "관하여", "대한", "대해", "대하여", "위한", "위하여",
  "포함", "방법", "방안", "기준", "요건", "사례", "검토", "내용", "기타", "또는", "그리고",
  "및", "해당", "이하", "이상", "따른", "따라", "통한", "통하여", "등", "등의", "각", "그"
]);
// 토큰 끝에 붙는 한국어 조사·어미. 본문 검색 정확도를 높이기 위해 어간만 남긴다.
const DECISION_PARTICLE_TAIL = /(으로써|으로서|으로|로써|로서|에게|에서|하는지|되는지|인지|하는|되는|함|됨|로|에|와|과|은|는|이|가|을|를|의|도|만|한|된|할|될)$/u;

export function extractCaseNumbers(text) {
  const matches = String(text || "").match(CASE_NUMBER_PATTERN) || [];
  const seen = new Set();
  const out = [];
  for (const raw of matches) {
    const normalized = raw.replace(/\s+/g, "");
    if (!seen.has(normalized)) {
      seen.add(normalized);
      out.push(normalized);
    }
  }
  return out;
}

export function isCaseNumberQuery(value) {
  return CASE_NUMBER_EXACT.test(String(value || "").replace(/\s+/g, ""));
}

function stripParticles(token) {
  let current = token;
  for (let i = 0; i < 3; i += 1) {
    const next = current.replace(DECISION_PARTICLE_TAIL, "");
    if (next === current || next.length < 2) break;
    current = next;
  }
  return current;
}

// 자연어 질의에서 본문 검색에 쓸 핵심 명사 키워드를 추출한다.
export function extractContentKeywords(text) {
  const cleaned = String(text || "")
    .replace(/[()[\]{}<>「」『』，,、.·…“”"'’‘:;!?~\-/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const seen = new Set();
  const out = [];
  for (const token of cleaned.split(" ")) {
    if (token.length < 2 || isCaseNumberQuery(token)) continue;
    const stem = stripParticles(token);
    if (stem.length < 2 || DECISION_STOPWORDS.has(stem)) continue;
    if (seen.has(stem)) continue;
    seen.add(stem);
    out.push(stem);
  }
  return out;
}

export function buildDecisionSearchQueries(query, termMatches = []) {
  const base = String(query || "").replace(/\s+/g, " ").trim();
  const trimmed = base.replace(DECISION_FILLER_TAIL, "").trim();
  const keywords = extractContentKeywords(trimmed);
  const candidates = [];
  const push = (value) => {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (text && !candidates.includes(text)) candidates.push(text);
  };
  // 질의에 명시된 사건번호는 가장 정확한 검색어이므로 최우선으로 조회한다.
  for (const caseNumber of extractCaseNumbers(base).slice(0, 2)) push(caseNumber);
  // 핵심 키워드 본문 AND 검색: 넓은(상위 다수) → 좁은(상위 소수) 순으로 시도한다.
  if (keywords.length >= 2) push(keywords.slice(0, 6).join(" "));
  if (keywords.length >= 4) push(keywords.slice(0, 3).join(" "));
  for (const match of (Array.isArray(termMatches) ? termMatches : []).slice(0, 2)) {
    const canonical = match?.canonicalTerms?.[0];
    if (canonical) push(canonical);
    const hint = match?.lawHints?.[0]?.lawName;
    if (hint && keywords[0] && hint !== keywords[0]) push(`${hint} ${keywords[0]}`);
  }
  if (trimmed) push(trimmed);
  if (!candidates.length && base) push(base);
  return candidates.slice(0, 5);
}

// 판례/결정례 검색에 쓸 단일 질의와 검색범위(scope)를 반환한다.
// scope: 1 = 사건명/판례명, 2 = 본문(판시사항·판결요지). 사건번호는 사건명 검색(1)로,
// 자연어 법리 질의는 본문 검색(2)으로 조회해야 정확히 매칭된다.
export function buildPrecedentSearchPlan(query) {
  const queries = buildDecisionSearchQueries(query);
  const primary = queries[0] || String(query || "").trim();
  return {
    queries,
    primary,
    scope: isCaseNumberQuery(primary) ? 1 : 2
  };
}
