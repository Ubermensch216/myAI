import { normalizeArticleRef } from "./lawArticleRef.js";

const LAW_NAME_KEYS = ["법령명한글", "법령명_한글", "법령명", "법령약칭명", "약칭명", "lawName", "name"];
const LAW_ID_KEYS = ["법령ID", "법령아이디", "ID", "id", "lawId"];
const LAW_MST_KEYS = ["법령일련번호", "MST", "mst", "lsiSeq"];
const LAW_TYPE_KEYS = ["법령구분명", "법령구분", "lawType"];
const EFFECTIVE_DATE_KEYS = ["시행일자", "시행일", "effectiveDate", "efYd"];
const PROMULGATION_DATE_KEYS = ["공포일자", "promulgationDate"];
const LAST_MODIFIED_KEYS = ["개정일자", "최종수정일자", "lastModified"];

const ARTICLE_NUMBER_KEYS = ["조문번호", "JO", "jo"];
const ARTICLE_BRANCH_KEYS = ["조문가지번호", "조문가지", "조가지번호"];
const ARTICLE_TITLE_KEYS = ["조문제목", "제목", "title"];
const ARTICLE_BODY_KEYS = ["조문내용", "조문내용문", "내용", "본문", "text"];
const TEXT_KEY_PATTERN = /^(조문내용|조문내용문|항내용|호내용|목내용|내용|본문|text)$/u;

// aiSearch (law.go.kr target=aiSearch) returns article-level results with semantic snippets
const AI_ARTICLE_NUMBER_KEYS = ["조문번호", "articleNumber", "articleNo"];
const AI_ARTICLE_TITLE_KEYS = ["조문제목", "articleTitle", "title"];
const AI_ARTICLE_CONTENT_KEYS = ["조문내용", "content", "snippet", "text"];
const AI_LAW_NAME_KEYS = ["법령명한글", "법령명", "행정규칙명", "lawName"];

export function findUpstreamError(payload) {
  if (!payload || typeof payload !== "object") return "";
  for (const node of findObjects(payload)) {
    const result = node.result ?? node.RESULT;
    if (result != null && /실패|fail|오류|error/i.test(String(result))) {
      const message = node.msg ?? node.MSG ?? node.message ?? node.error ?? node.Error ?? result;
      return String(message);
    }
    if (node.error) return String(node.error);
    if (node.Error) return String(node.Error);
  }
  return "";
}

export function normalizeSearchResults(payload) {
  const candidates = findObjects(payload).filter((item) => {
    const lawName = readFirst(item, LAW_NAME_KEYS);
    const lawId = readFirst(item, LAW_ID_KEYS);
    const mst = readFirst(item, LAW_MST_KEYS);
    return lawName && (lawId || mst);
  });
  const seen = new Set();
  const results = [];
  for (const item of candidates) {
    const lawName = stripHtml(readFirst(item, LAW_NAME_KEYS));
    const lawId = readFirst(item, LAW_ID_KEYS);
    const mst = readFirst(item, LAW_MST_KEYS);
    const key = `${lawName}|${lawId}|${mst}`;
    if (!lawName || seen.has(key)) continue;
    seen.add(key);
    results.push({
      lawName,
      lawId: String(lawId || ""),
      mst: String(mst || ""),
      lawType: stripHtml(readFirst(item, LAW_TYPE_KEYS)),
      effectiveDate: normalizeDate(readFirst(item, EFFECTIVE_DATE_KEYS)),
      promulgationDate: normalizeDate(readFirst(item, PROMULGATION_DATE_KEYS)),
      lastModified: normalizeDate(readFirst(item, LAST_MODIFIED_KEYS)),
      raw: item
    });
  }
  return results;
}

export function normalizeAiSearchResults(payload) {
  const candidates = findObjects(payload).filter((item) => {
    const articleNo = readFirst(item, AI_ARTICLE_NUMBER_KEYS);
    const title = readFirst(item, AI_ARTICLE_TITLE_KEYS);
    const content = readFirst(item, AI_ARTICLE_CONTENT_KEYS);
    const lawName = readFirst(item, AI_LAW_NAME_KEYS);
    return (articleNo || title) && (lawName || content);
  });
  const seen = new Set();
  const results = [];
  for (const item of candidates) {
    const lawName = stripHtml(readFirst(item, AI_LAW_NAME_KEYS));
    const articleNo = stripHtml(readFirst(item, AI_ARTICLE_NUMBER_KEYS));
    const title = stripHtml(readFirst(item, AI_ARTICLE_TITLE_KEYS));
    const content = stripHtml(readFirst(item, AI_ARTICLE_CONTENT_KEYS) || "");
    // Truncate snippet to 200 chars
    const snippet = content.slice(0, 200);
    const key = `${lawName}|${articleNo}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      lawName,
      articleNo,
      articleTitle: title,
      snippet,
      effectiveDate: normalizeDate(readFirst(item, EFFECTIVE_DATE_KEYS)),
      raw: item
    });
  }
  return results;
}

export function parseAiSearchXml(xmlText) {
  if (!xmlText || typeof xmlText !== "string") return {};
  const text = xmlText.trim();
  if (!text.startsWith("<")) return {};
  // Detect API error envelopes (invalid OC key, server validation failure, etc.)
  const errorMatch = /<result>([\s\S]*?)<\/result>/i.exec(text);
  if (errorMatch && /실패|fail|오류|error/i.test(errorMatch[1])) {
    const msgMatch = /<msg>([\s\S]*?)<\/msg>/i.exec(text);
    return { result: errorMatch[1].trim(), msg: msgMatch ? msgMatch[1].trim() : "" };
  }
  const items = [];
  const blockRe = /<(법령조문|행정규칙조문|법령별표서식|행정규칙별표서식)(?:\s[^>]*)?>([\s\S]*?)<\/\1>/gi;
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const blockKind = match[1];
    const block = match[2];
    const getTag = (tag) => {
      const m = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(block);
      if (!m) return "";
      return m[1]
        .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
        .replace(/<[^>]+>/g, "")
        .trim();
    };
    const item = {
      "법령명": getTag("법령명") || getTag("행정규칙명"),
      "법령ID": getTag("법령ID") || getTag("행정규칙ID"),
      "법령종류명": getTag("법령종류명") || getTag("발령기관명"),
      "조문번호": getTag("조문번호") || getTag("별표서식번호"),
      "조문가지번호": getTag("조문가지번호"),
      "조문제목": getTag("조문제목") || getTag("별표서식제목"),
      "조문내용": getTag("조문내용"),
      "시행일자": getTag("시행일자"),
      "_blockKind": blockKind
    };
    if (item["법령명"] || item["조문번호"]) items.push(item);
  }
  return { aiSearch: { 법령조문: items } };
}

export function chooseLawSearchResult(results, lawName) {
  const target = normalizeComparableLawName(lawName);
  const items = Array.isArray(results) ? results : [];
  if (!target) return items[0] || null;
  const exact = items.find((item) => normalizeComparableLawName(item.lawName) === target);
  if (exact) return exact;
  // Korean law names typically end with the canonical short name (e.g.
  // "대한민국헌법" ends with "헌법"). Prefer suffix matches first so that
  // short queries like "헌법" do not get hijacked by long names that merely
  // contain the term as a substring ("…헌법재판소 규칙").
  const ranked = items
    .map((item) => {
      const name = normalizeComparableLawName(item.lawName);
      if (!name.includes(target) && !target.includes(name)) return null;
      let tier = 4;
      if (name.endsWith(target)) tier = 1;
      else if (name.startsWith(target)) tier = 2;
      else if (name.includes(target)) tier = 3;
      return { item, tier, length: name.length };
    })
    .filter(Boolean)
    .sort((a, b) => a.tier - b.tier || a.length - b.length);
  return ranked[0]?.item || items[0] || null;
}

export function normalizeArticlePayload(payload, { lawName, lawId, mst, articleRef }) {
  const objects = findObjects(payload);
  const articleObjects = objects.filter((item) => {
    const jo = readFirst(item, ARTICLE_NUMBER_KEYS);
    const title = readFirst(item, ARTICLE_TITLE_KEYS);
    const body = readFirst(item, ARTICLE_BODY_KEYS);
    return jo || title || body;
  });
  const matchesJoCode = (item) => {
    const articleDigits = String(readFirst(item, ARTICLE_NUMBER_KEYS) || "").replace(/\D+/g, "");
    const branchDigits = String(readFirst(item, ARTICLE_BRANCH_KEYS) || "").replace(/\D+/g, "");
    if (!articleDigits) return false;
    const code = `${articleDigits.padStart(4, "0")}${(branchDigits || "0").padStart(2, "0")}`;
    return code === articleRef.joCode;
  };
  const preferred = articleObjects.find((item) => matchesJoCode(item) && readFirst(item, ARTICLE_BODY_KEYS))
    || articleObjects.find(matchesJoCode)
    || articleObjects[0]
    || {};

  const text = collectArticleText(preferred || payload);
  return {
    lawName: stripHtml(deepRead(payload, LAW_NAME_KEYS)) || lawName,
    lawId: deepRead(payload, LAW_ID_KEYS) || lawId,
    mst: deepRead(payload, LAW_MST_KEYS) || mst,
    article: articleRef.canonical,
    joCode: articleRef.joCode,
    title: stripHtml(readFirst(preferred, ARTICLE_TITLE_KEYS)),
    effectiveDate: normalizeDate(deepRead(payload, EFFECTIVE_DATE_KEYS)),
    lastModified: normalizeDate(deepRead(payload, LAST_MODIFIED_KEYS)),
    text,
    raw: preferred
  };
}

export function normalizeLawTextPayload(payload, { lawName = "", lawId = "", mst = "" } = {}) {
  return {
    lawName: stripHtml(deepRead(payload, LAW_NAME_KEYS)) || lawName,
    lawId: String(deepRead(payload, LAW_ID_KEYS) || lawId || ""),
    mst: String(deepRead(payload, LAW_MST_KEYS) || mst || ""),
    lawType: stripHtml(deepRead(payload, LAW_TYPE_KEYS)),
    effectiveDate: normalizeDate(deepRead(payload, EFFECTIVE_DATE_KEYS)),
    promulgationDate: normalizeDate(deepRead(payload, PROMULGATION_DATE_KEYS)),
    lastModified: normalizeDate(deepRead(payload, LAST_MODIFIED_KEYS)),
    text: collectArticleText(payload),
    raw: payload
  };
}

function deepRead(value, keys) {
  for (const node of findObjects(value)) {
    const found = readFirst(node, keys);
    if (found) return found;
  }
  return "";
}

export function collectArticleText(value) {
  const pieces = [];
  walk(value, (item, key) => {
    if (item == null) return;
    const keyText = String(key || "");
    if ((typeof item === "string" || typeof item === "number") && TEXT_KEY_PATTERN.test(keyText)) {
      const text = stripHtml(item);
      if (text) pieces.push(text);
    }
  });
  if (!pieces.length && typeof value === "string") pieces.push(stripHtml(value));
  return Array.from(new Set(pieces)).join("\n").trim();
}

export function buildPublicLawUrl(lawName, _article, mst) {
  if (mst) return `https://www.law.go.kr/lsInfoP.do?lsiSeq=${encodeURIComponent(String(mst).trim())}`;
  return `https://www.law.go.kr/법령/${encodeURIComponent(String(lawName || "").trim())}`;
}

export function buildCitation(articleData, articleRef, citationId = "L1") {
  const locator = `${articleData.lawName} ${articleRef.canonical}`.trim();
  return {
    citationId,
    sourceType: "law",
    lawName: articleData.lawName,
    lawId: articleData.lawId,
    mst: articleData.mst,
    article: articleRef.canonical,
    canonical: `${articleData.lawName}/${articleRef.canonical}`,
    title: articleData.title,
    locator,
    effectiveDate: articleData.effectiveDate,
    url: buildPublicLawUrl(articleData.lawName, articleRef.canonical, articleData.mst)
  };
}

export function findObjects(value) {
  const results = [];
  walk(value, (item) => {
    if (item && typeof item === "object" && !Array.isArray(item)) results.push(item);
  });
  return results;
}

export function walk(value, visitor, key = "") {
  visitor(value, key);
  if (Array.isArray(value)) {
    value.forEach((item, index) => walk(item, visitor, String(index)));
    return;
  }
  if (value && typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      walk(childValue, visitor, childKey);
    }
  }
}

export function readFirst(object, keys) {
  if (!object || typeof object !== "object") return "";
  for (const key of keys) {
    if (object[key] != null && object[key] !== "") return String(object[key]).trim();
  }
  return "";
}

function readFirstByKey(object, keys) {
  if (!object || typeof object !== "object") return "";
  for (const key of keys) {
    if (object[key] != null && object[key] !== "") return object[key];
  }
  return "";
}

export function stripHtml(value) {
  let text = String(value ?? "");
  // CDATA wrappers from XML-derived JSON: keep inner text, drop the brackets.
  text = text.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  // Decode common HTML entities first so encoded tags like &lt;br&gt; can be stripped below.
  text = text
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  // Strip ASCII HTML tags only. Korean revision markers like "<개정 2018.3.27>" must
  // be preserved because they are statute content, not markup.
  text = text.replace(/<\/?[a-zA-Z][^<>]*>/g, " ");
  return text.replace(/\s+/g, " ").trim();
}

export function normalizeDate(value) {
  const text = String(value || "").replace(/[^\d]/g, "");
  if (text.length === 8) return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
  return String(value || "").trim();
}

export function normalizeComparableLawName(value) {
  return String(value ?? "")
    .replace(/[\s\-·ㆍ「」『』"'`“”‘’]/g, "")
    .toLowerCase();
}

export function articleRefFromCanonical(canonical) {
  return normalizeArticleRef(canonical || "");
}

// ===== Precedent (판례) =====

const PREC_ID_KEYS = ["판례일련번호", "판례정보일련번호", "사건일련번호", "id", "precId"];
const PREC_TITLE_KEYS = ["사건명", "판결명", "판례명", "title", "name"];
const PREC_CASE_NUMBER_KEYS = ["사건번호", "caseNumber"];
const PREC_COURT_KEYS = ["법원명", "선고법원", "court"];
const PREC_DATE_KEYS = ["선고일자", "판결일자", "선고일", "date"];
const PREC_CASE_TYPE_KEYS = ["사건종류명", "사건종류", "caseType"];
const PREC_VERDICT_KEYS = ["판결유형", "판시유형", "verdict"];
const PREC_BODY_KEYS = ["판시사항", "판결요지", "이유", "주문", "전문", "본문", "내용", "summary", "text"];

export function normalizePrecedentResults(payload) {
  const candidates = findObjects(payload).filter((item) => {
    const id = readFirst(item, PREC_ID_KEYS);
    const title = readFirst(item, PREC_TITLE_KEYS);
    const caseNumber = readFirst(item, PREC_CASE_NUMBER_KEYS);
    return (id || title) && (caseNumber || title);
  });
  const seen = new Set();
  const results = [];
  for (const item of candidates) {
    const id = readFirst(item, PREC_ID_KEYS);
    const title = stripHtml(readFirst(item, PREC_TITLE_KEYS));
    const caseNumber = stripHtml(readFirst(item, PREC_CASE_NUMBER_KEYS));
    const key = `${id}|${caseNumber}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      precId: String(id || ""),
      title,
      caseNumber,
      court: stripHtml(readFirst(item, PREC_COURT_KEYS)),
      date: normalizeDate(readFirst(item, PREC_DATE_KEYS)),
      caseType: stripHtml(readFirst(item, PREC_CASE_TYPE_KEYS)),
      verdict: stripHtml(readFirst(item, PREC_VERDICT_KEYS)),
      raw: item
    });
  }
  return results;
}

export function normalizePrecedentPayload(payload) {
  const objects = findObjects(payload);
  const root = objects.find((item) => readFirst(item, PREC_TITLE_KEYS) || readFirst(item, PREC_BODY_KEYS)) || payload;
  const text = collectPrecedentText(payload);
  return {
    precId: String(deepRead(payload, PREC_ID_KEYS) || ""),
    title: stripHtml(readFirst(root, PREC_TITLE_KEYS)) || stripHtml(deepRead(payload, PREC_TITLE_KEYS)),
    caseNumber: stripHtml(readFirst(root, PREC_CASE_NUMBER_KEYS)) || stripHtml(deepRead(payload, PREC_CASE_NUMBER_KEYS)),
    court: stripHtml(readFirst(root, PREC_COURT_KEYS)) || stripHtml(deepRead(payload, PREC_COURT_KEYS)),
    date: normalizeDate(deepRead(payload, PREC_DATE_KEYS)),
    caseType: stripHtml(deepRead(payload, PREC_CASE_TYPE_KEYS)),
    verdict: stripHtml(deepRead(payload, PREC_VERDICT_KEYS)),
    text,
    raw: root
  };
}

function collectPrecedentText(value) {
  const pieces = [];
  walk(value, (item, key) => {
    if (item == null) return;
    const keyText = String(key || "");
    if ((typeof item === "string" || typeof item === "number") && PREC_BODY_KEYS.includes(keyText)) {
      const text = stripHtml(item);
      if (text) pieces.push(text);
    }
  });
  return Array.from(new Set(pieces)).join("\n").trim();
}

export function buildPrecedentCitation(prec, citationId = "P1") {
  const locator = [prec.caseNumber, prec.court].filter(Boolean).join(" / ");
  return {
    citationId,
    sourceType: "law_precedent",
    recordType: "precedent",
    title: prec.title,
    caseNumber: prec.caseNumber,
    court: prec.court,
    date: prec.date,
    caseType: prec.caseType,
    locator: locator || prec.title,
    url: prec.precId
      ? `https://www.law.go.kr/precInfoP.do?precSeq=${encodeURIComponent(prec.precId)}`
      : "https://www.law.go.kr/precSc.do"
  };
}

// ===== Interpretation (법령해석례) =====

const EXPC_ID_KEYS = ["법령해석례일련번호", "해석례일련번호", "안건번호", "expcId"];
const EXPC_TITLE_KEYS = ["안건명", "해석례명", "제목", "title", "name"];
const EXPC_AGENCY_KEYS = ["회신기관명", "회신기관", "회신청", "회신부서", "회신부처", "회신일자기관", "agency"];
const EXPC_DATE_KEYS = ["회신일자", "해석일자", "date"];
const EXPC_QUERY_KEYS = ["질의요지", "질의", "question"];
const EXPC_ANSWER_KEYS = ["회답", "회신", "answer"];
const EXPC_REASON_KEYS = ["이유", "회답이유", "reason"];

export function normalizeInterpretationResults(payload) {
  const candidates = findObjects(payload).filter((item) => {
    const id = readFirst(item, EXPC_ID_KEYS);
    const title = readFirst(item, EXPC_TITLE_KEYS);
    return id || title;
  });
  const seen = new Set();
  const results = [];
  for (const item of candidates) {
    const id = readFirst(item, EXPC_ID_KEYS);
    const title = stripHtml(readFirst(item, EXPC_TITLE_KEYS));
    if (!title) continue;
    const key = `${id}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      expcId: String(id || ""),
      title,
      agency: stripHtml(readFirst(item, EXPC_AGENCY_KEYS)),
      date: normalizeDate(readFirst(item, EXPC_DATE_KEYS)),
      raw: item
    });
  }
  return results;
}

export function normalizeInterpretationPayload(payload) {
  const objects = findObjects(payload);
  const root = objects.find((item) => readFirst(item, EXPC_TITLE_KEYS) || readFirst(item, EXPC_QUERY_KEYS)) || payload;
  const question = stripHtml(deepRead(payload, EXPC_QUERY_KEYS));
  const answer = stripHtml(deepRead(payload, EXPC_ANSWER_KEYS));
  const reason = stripHtml(deepRead(payload, EXPC_REASON_KEYS));
  const text = [question && `[질의요지] ${question}`, answer && `[회답] ${answer}`, reason && `[이유] ${reason}`]
    .filter(Boolean)
    .join("\n\n");
  return {
    expcId: String(deepRead(payload, EXPC_ID_KEYS) || ""),
    title: stripHtml(readFirst(root, EXPC_TITLE_KEYS)) || stripHtml(deepRead(payload, EXPC_TITLE_KEYS)),
    agency: stripHtml(readFirst(root, EXPC_AGENCY_KEYS)) || stripHtml(deepRead(payload, EXPC_AGENCY_KEYS)),
    date: normalizeDate(deepRead(payload, EXPC_DATE_KEYS)),
    question,
    answer,
    reason,
    text,
    raw: root
  };
}

export function buildInterpretationCitation(expc, citationId = "I1") {
  const locator = [expc.agency, expc.date].filter(Boolean).join(" · ");
  return {
    citationId,
    sourceType: "law_interpretation",
    recordType: "interpretation",
    title: expc.title,
    agency: expc.agency,
    date: expc.date,
    locator: locator || expc.title,
    url: expc.expcId
      ? `https://www.law.go.kr/expcInfoP.do?expcSeq=${encodeURIComponent(expc.expcId)}`
      : "https://www.law.go.kr/expcSc.do"
  };
}

// ===== Admin Rule (행정규칙: 고시/예규/훈령/지침) =====

const ADMRUL_ID_KEYS = ["행정규칙일련번호", "행정규칙ID", "행정규칙id", "id", "admrulId"];
const ADMRUL_TITLE_KEYS = ["행정규칙명", "행정규칙명한글", "title", "name"];
const ADMRUL_AGENCY_KEYS = ["발령기관명", "발령기관", "소관부처명", "agency"];
const ADMRUL_KIND_KEYS = ["행정규칙종류", "행정규칙종류명", "kind"];
const ADMRUL_ISSUE_DATE_KEYS = ["발령일자", "공포일자", "promulgationDate"];
const ADMRUL_EFFECTIVE_DATE_KEYS = ["시행일자", "효력일자", "effectiveDate"];
const ADMRUL_BODY_KEYS = ["행정규칙내용", "조문내용", "본문", "내용", "text"];

export function normalizeAdminRuleResults(payload) {
  const candidates = findObjects(payload).filter((item) => {
    const id = readFirst(item, ADMRUL_ID_KEYS);
    const title = readFirst(item, ADMRUL_TITLE_KEYS);
    return (id || title) && title;
  });
  const seen = new Set();
  const results = [];
  for (const item of candidates) {
    const id = readFirst(item, ADMRUL_ID_KEYS);
    const title = stripHtml(readFirst(item, ADMRUL_TITLE_KEYS));
    if (!title) continue;
    const key = `${id}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      admrulId: String(id || ""),
      title,
      agency: stripHtml(readFirst(item, ADMRUL_AGENCY_KEYS)),
      kind: stripHtml(readFirst(item, ADMRUL_KIND_KEYS)),
      issueDate: normalizeDate(readFirst(item, ADMRUL_ISSUE_DATE_KEYS)),
      effectiveDate: normalizeDate(readFirst(item, ADMRUL_EFFECTIVE_DATE_KEYS)),
      raw: item
    });
  }
  return results;
}

export function normalizeAdminRulePayload(payload) {
  const objects = findObjects(payload);
  const root = objects.find((item) => readFirst(item, ADMRUL_TITLE_KEYS) || readFirst(item, ADMRUL_BODY_KEYS)) || payload;
  const text = collectKeyedText(payload, ADMRUL_BODY_KEYS);
  return {
    admrulId: String(deepRead(payload, ADMRUL_ID_KEYS) || ""),
    title: stripHtml(readFirst(root, ADMRUL_TITLE_KEYS)) || stripHtml(deepRead(payload, ADMRUL_TITLE_KEYS)),
    agency: stripHtml(deepRead(payload, ADMRUL_AGENCY_KEYS)),
    kind: stripHtml(deepRead(payload, ADMRUL_KIND_KEYS)),
    issueDate: normalizeDate(deepRead(payload, ADMRUL_ISSUE_DATE_KEYS)),
    effectiveDate: normalizeDate(deepRead(payload, ADMRUL_EFFECTIVE_DATE_KEYS)),
    text,
    raw: root
  };
}

export function buildAdminRuleCitation(rule, citationId = "R1") {
  const locator = [rule.agency, rule.kind, rule.effectiveDate ? `시행 ${rule.effectiveDate}` : ""].filter(Boolean).join(" · ");
  return {
    citationId,
    sourceType: "law_admin_rule",
    recordType: "admin_rule",
    title: rule.title,
    agency: rule.agency,
    kind: rule.kind,
    issueDate: rule.issueDate,
    effectiveDate: rule.effectiveDate,
    locator: locator || rule.title,
    url: rule.admrulId
      ? `https://www.law.go.kr/admRulInfoP.do?admRulSeq=${encodeURIComponent(rule.admrulId)}`
      : "https://www.law.go.kr/admRulSc.do"
  };
}

// ===== Ordinance (자치법규: 조례/규칙) =====

const ORDIN_ID_KEYS = ["자치법규일련번호", "자치법규ID", "자치법규id", "id", "ordinId"];
const ORDIN_TITLE_KEYS = ["자치법규명", "자치법규명한글", "title", "name"];
const ORDIN_REGION_KEYS = ["지자체기관명", "지자체명", "지방자치단체명", "지방자치단체", "관할기관", "region"];
const ORDIN_KIND_KEYS = ["자치법규종류", "자치법규종류명", "kind"];
const ORDIN_PROMULGATION_KEYS = ["공포일자", "promulgationDate"];
const ORDIN_EFFECTIVE_DATE_KEYS = ["시행일자", "effectiveDate"];
const ORDIN_BODY_KEYS = ["자치법규내용", "조문내용", "조내용", "본문", "내용", "text"];

export function normalizeOrdinanceResults(payload) {
  const candidates = findObjects(payload).filter((item) => {
    const id = readFirst(item, ORDIN_ID_KEYS);
    const title = readFirst(item, ORDIN_TITLE_KEYS);
    return (id || title) && title;
  });
  const seen = new Set();
  const results = [];
  for (const item of candidates) {
    const id = readFirst(item, ORDIN_ID_KEYS);
    const title = stripHtml(readFirst(item, ORDIN_TITLE_KEYS));
    if (!title) continue;
    const key = `${id}|${title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      ordinId: String(id || ""),
      title,
      region: stripHtml(readFirst(item, ORDIN_REGION_KEYS)),
      kind: stripHtml(readFirst(item, ORDIN_KIND_KEYS)),
      promulgationDate: normalizeDate(readFirst(item, ORDIN_PROMULGATION_KEYS)),
      effectiveDate: normalizeDate(readFirst(item, ORDIN_EFFECTIVE_DATE_KEYS)),
      raw: item
    });
  }
  return results;
}

export function normalizeOrdinancePayload(payload) {
  const objects = findObjects(payload);
  const root = objects.find((item) => readFirst(item, ORDIN_TITLE_KEYS) || readFirst(item, ORDIN_BODY_KEYS)) || payload;
  const text = collectKeyedText(payload, ORDIN_BODY_KEYS);
  return {
    ordinId: String(deepRead(payload, ORDIN_ID_KEYS) || ""),
    title: stripHtml(readFirst(root, ORDIN_TITLE_KEYS)) || stripHtml(deepRead(payload, ORDIN_TITLE_KEYS)),
    region: stripHtml(deepRead(payload, ORDIN_REGION_KEYS)),
    kind: stripHtml(deepRead(payload, ORDIN_KIND_KEYS)),
    promulgationDate: normalizeDate(deepRead(payload, ORDIN_PROMULGATION_KEYS)),
    effectiveDate: normalizeDate(deepRead(payload, ORDIN_EFFECTIVE_DATE_KEYS)),
    text,
    raw: root
  };
}

export function buildOrdinanceCitation(ord, citationId = "O1") {
  const locator = [ord.region, ord.kind, ord.effectiveDate ? `시행 ${ord.effectiveDate}` : ""].filter(Boolean).join(" · ");
  return {
    citationId,
    sourceType: "law_ordinance",
    recordType: "ordinance",
    title: ord.title,
    region: ord.region,
    kind: ord.kind,
    promulgationDate: ord.promulgationDate,
    effectiveDate: ord.effectiveDate,
    locator: locator || ord.title,
    url: ord.ordinId
      ? `https://www.law.go.kr/ordinInfoP.do?ordinSeq=${encodeURIComponent(ord.ordinId)}`
      : "https://www.law.go.kr/ordinSc.do"
  };
}

// ===== Annex (별표/별지/서식) =====

const ANNEX_ID_KEYS = ["별표일련번호", "별표번호", "annexId", "id"];
const ANNEX_TITLE_KEYS = ["별표명", "별표제목", "서식명", "title", "name"];
const ANNEX_NUMBER_KEYS = ["별표번호", "별표순번", "annexNo", "no"];
const ANNEX_BODY_KEYS = ["별표내용", "서식내용", "내용", "content", "text"];

const ANNEX_TYPE_KEYS = ["annexType", "type", "kind"];

export function normalizeAnnexResults(payload) {
  const candidates = findObjects(payload).filter((item) => {
    const title = readFirst(item, ANNEX_TITLE_KEYS);
    const annexNo = readFirst(item, ANNEX_NUMBER_KEYS);
    return title || annexNo;
  });
  const seen = new Set();
  const results = [];
  for (const item of candidates) {
    const annexId = readFirst(item, ANNEX_ID_KEYS);
    const title = stripHtml(readFirst(item, ANNEX_TITLE_KEYS));
    const annexNo = stripHtml(readFirst(item, ANNEX_NUMBER_KEYS));
    if (!title && !annexNo) continue;
    const lawName = stripHtml(readFirst(item, LAW_NAME_KEYS));
    const lawId = readFirst(item, LAW_ID_KEYS);
    const mst = readFirst(item, LAW_MST_KEYS);
    const key = `${annexId}|${title}|${annexNo}|${mst}`;
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      annexId: String(annexId || ""),
      title,
      annexNo,
      annexType: stripHtml(readFirst(item, ANNEX_TYPE_KEYS)),
      lawName,
      lawId: String(lawId || ""),
      mst: String(mst || ""),
      effectiveDate: normalizeDate(readFirst(item, EFFECTIVE_DATE_KEYS)),
      raw: item
    });
  }
  return results;
}

export function normalizeAnnexPayload(payload) {
  const objects = findObjects(payload);
  const root = objects.find((item) => readFirst(item, ANNEX_TITLE_KEYS) || readFirst(item, ANNEX_BODY_KEYS)) || payload;
  const text = collectKeyedText(payload, ANNEX_BODY_KEYS);
  const annexItems = normalizeAnnexResults(payload);
  return {
    annexId: String(deepRead(payload, ANNEX_ID_KEYS) || ""),
    title: stripHtml(readFirst(root, ANNEX_TITLE_KEYS)) || stripHtml(deepRead(payload, ANNEX_TITLE_KEYS)),
    annexNo: stripHtml(readFirst(root, ANNEX_NUMBER_KEYS)) || stripHtml(deepRead(payload, ANNEX_NUMBER_KEYS)),
    annexType: stripHtml(readFirst(root, ANNEX_TYPE_KEYS)) || stripHtml(deepRead(payload, ANNEX_TYPE_KEYS)),
    lawName: stripHtml(deepRead(payload, LAW_NAME_KEYS)),
    lawId: String(deepRead(payload, LAW_ID_KEYS) || ""),
    mst: String(deepRead(payload, LAW_MST_KEYS) || ""),
    effectiveDate: normalizeDate(deepRead(payload, EFFECTIVE_DATE_KEYS)),
    text,
    results: annexItems,
    raw: root
  };
}

export function buildAnnexCitation(annex, citationId = "A1") {
  return {
    citationId,
    sourceType: "law_annex",
    recordType: "annex",
    title: annex.title,
    lawName: annex.lawName,
    annexNo: annex.annexNo,
    annexType: annex.annexType,
    effectiveDate: annex.effectiveDate,
    locator: [annex.lawName, annex.title].filter(Boolean).join(" "),
    url: annex.mst
      ? `https://www.law.go.kr/lsInfoP.do?lsiSeq=${encodeURIComponent(annex.mst)}`
      : "https://www.law.go.kr"
  };
}

// ===== Law Revision History (법령 연혁) =====

const HIST_EFFECTIVE_DATE_KEYS = ["시행일자", "효력일자", "시행일", "effectiveDate"];
const HIST_PROMULGATION_KEYS = ["공포일자", "공포일", "promulgationDate"];
const HIST_MST_KEYS = ["법령일련번호", "MST", "mst", "lsiSeq"];
const HIST_PROMULGATION_NUMBER_KEYS = ["공포번호", "promulgationNumber"];
const HIST_REVISION_TYPE_KEYS = ["제개정구분명", "제개정구분", "개정구분", "revisionType"];
const HIST_TITLE_KEYS = ["법령명한글", "법령명_한글", "법령명", "title"];

export function normalizeHistoryResults(payload) {
  const candidates = findObjects(payload).filter((item) => {
    const eff = readFirst(item, HIST_EFFECTIVE_DATE_KEYS);
    const mst = readFirst(item, HIST_MST_KEYS);
    return eff && mst;
  });
  const seen = new Set();
  const results = [];
  for (const item of candidates) {
    const effective = normalizeDate(readFirst(item, HIST_EFFECTIVE_DATE_KEYS));
    const mst = String(readFirst(item, HIST_MST_KEYS) || "");
    const key = `${effective}|${mst}`;
    if (!effective || !mst || seen.has(key)) continue;
    seen.add(key);
    results.push({
      effectiveDate: effective,
      promulgationDate: normalizeDate(readFirst(item, HIST_PROMULGATION_KEYS)),
      mst,
      promulgationNumber: stripHtml(readFirst(item, HIST_PROMULGATION_NUMBER_KEYS)),
      revisionType: stripHtml(readFirst(item, HIST_REVISION_TYPE_KEYS)),
      title: stripHtml(readFirst(item, HIST_TITLE_KEYS)),
      raw: item
    });
  }
  // Sort newest first so the latest revision sits at the top of the list.
  results.sort((a, b) => (b.effectiveDate || "").localeCompare(a.effectiveDate || ""));
  return results;
}

function collectKeyedText(value, keys) {
  const set = new Set(keys);
  const pieces = [];
  walk(value, (item, key) => {
    if (item == null) return;
    if ((typeof item === "string" || typeof item === "number") && set.has(String(key))) {
      const text = stripHtml(item);
      if (text) pieces.push(text);
    }
  });
  return Array.from(new Set(pieces)).join("\n").trim();
}
