import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join(rootDir, "scripts", "fixtures", "law");

const {
  normalizeSearchResults,
  chooseLawSearchResult,
  normalizeArticlePayload,
  collectArticleText,
  findUpstreamError,
  buildCitation,
  normalizeDate,
  stripHtml,
  normalizeComparableLawName,
  normalizePrecedentResults,
  normalizePrecedentPayload,
  buildPrecedentCitation,
  normalizeInterpretationResults,
  normalizeInterpretationPayload,
  buildInterpretationCitation,
  normalizeAdminRuleResults,
  normalizeAdminRulePayload,
  buildAdminRuleCitation,
  normalizeOrdinanceResults,
  normalizeOrdinancePayload,
  buildOrdinanceCitation
} = await import("../server/law/lawApiParser.js");
const { normalizeArticleRef } = await import("../server/law/lawArticleRef.js");

let failureCount = 0;

await run("search results: civil code (basic shape)", testSearchCivilCode);
await run("search results: road traffic law (MST shape)", testSearchRoadTraffic);
await run("search results: PIPA with abbreviation", testSearchPipa);
await run("search results: empty payload returns []", testSearchEmpty);
await run("upstream error detection (실패)", testUpstreamError);
await run("chooseLawSearchResult: exact > contains > first", testChooseLawSearchResult);
await run("article payload: civil 750 (조문단위 array)", testArticleCivil750);
await run("article payload: branched 758-2 selection", testArticleBranchSelection);
await run("article payload: PIPA 15 with paragraphs and CDATA", testArticlePipa15);
await run("article payload: HTML entities and tags stripped", testArticleHtmlEncoded);
await run("article payload: missing returns empty text", testArticleNotFound);
await run("collectArticleText: dedupes and joins recursive text keys", testCollectArticleText);
await run("buildCitation: locator and url shape", testBuildCitation);
await run("normalizeDate: 8-digit and pre-formatted", testNormalizeDate);
await run("stripHtml: tags and entities", testStripHtml);
await run("normalizeComparableLawName ignores spaces and brackets", testComparableLawName);
await run("precedent search results", testPrecedentSearch);
await run("precedent detail payload", testPrecedentDetail);
await run("interpretation search results", testInterpretationSearch);
await run("interpretation search official ID key wins over row id", testInterpretationOfficialId);
await run("interpretation detail payload (질의/회답/이유)", testInterpretationDetail);
await run("citation builders for precedent and interpretation", testNonLawCitationBuilders);
await run("admin rule search results", testAdminRuleSearch);
await run("admin rule detail payload", testAdminRuleDetail);
await run("ordinance search results", testOrdinanceSearch);
await run("ordinance search official region key", testOrdinanceOfficialRegion);
await run("ordinance detail payload", testOrdinanceDetail);
await run("ordinance detail official article body key", testOrdinanceOfficialBody);
await run("citation builders for admin rule and ordinance", testAdminOrdinanceCitations);

if (failureCount > 0) process.exitCode = 1;

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failureCount += 1;
    console.error(`not ok - ${name}`);
    console.error(error?.stack || error);
  }
}

async function loadFixture(name) {
  const text = await fs.readFile(path.join(fixturesDir, name), "utf8");
  return JSON.parse(text);
}

async function testSearchCivilCode() {
  const payload = await loadFixture("search-civil-code.json");
  const results = normalizeSearchResults(payload);
  assert.equal(results.length, 3, `expected 3 results, got ${results.length}`);
  assert.equal(results[0].lawName, "민법");
  assert.equal(results[0].lawId, "001110");
  assert.equal(results[0].mst, "001234");
  assert.equal(results[0].lawType, "법률");
  assert.equal(results[0].effectiveDate, "2023-01-04");
  assert.equal(results[0].promulgationDate, "2022-12-06");
  assert.equal(results[1].lawName, "민법시행법");
  assert.equal(results[2].lawName, "민법의 일부개정에 따른 경과조치에 관한 법률");
}

async function testSearchRoadTraffic() {
  const payload = await loadFixture("search-road-traffic.json");
  const results = normalizeSearchResults(payload);
  assert.equal(results.length, 2);
  assert.equal(results[0].lawName, "도로교통법");
  assert.equal(results[0].mst, "270100");
  assert.equal(results[0].lawType, "법률");
  assert.equal(results[0].effectiveDate, "2024-08-01");
  assert.equal(results[1].lawType, "대통령령");
}

async function testSearchPipa() {
  const payload = await loadFixture("search-pipa.json");
  const results = normalizeSearchResults(payload);
  assert.equal(results.length, 2);
  const pipa = results[0];
  assert.equal(pipa.lawName, "개인정보 보호법");
  assert.equal(pipa.lawId, "011357");
  assert.equal(pipa.lawType, "법률");
}

async function testSearchEmpty() {
  const payload = await loadFixture("search-empty.json");
  const results = normalizeSearchResults(payload);
  assert.deepEqual(results, [], "empty payload should yield no results");
}

async function testUpstreamError() {
  const payload = await loadFixture("search-error.json");
  const message = findUpstreamError(payload);
  assert.ok(message, "should detect upstream error message");
  assert.match(message, /OC|인증키|유효/);
  const okPayload = await loadFixture("search-civil-code.json");
  assert.equal(findUpstreamError(okPayload), "", "valid payload must not be flagged");
}

function testChooseLawSearchResult() {
  const items = [
    { lawName: "도로교통법 시행령" },
    { lawName: "도로교통법" },
    { lawName: "도로교통법 시행규칙" }
  ];
  const exact = chooseLawSearchResult(items, "도로교통법");
  assert.equal(exact.lawName, "도로교통법", "exact match should win over contains");

  const contains = chooseLawSearchResult(
    [{ lawName: "도로교통법 시행령" }, { lawName: "민법" }],
    "도로교통"
  );
  assert.equal(contains.lawName, "도로교통법 시행령", "contains should match when exact missing");

  const fallback = chooseLawSearchResult([{ lawName: "민법" }], "전혀다른법");
  assert.equal(fallback.lawName, "민법", "fallback to first item when no match");

  assert.equal(chooseLawSearchResult([], "민법"), null, "empty list returns null");
}

async function testArticleCivil750() {
  const payload = await loadFixture("article-civil-750.json");
  const articleRef = normalizeArticleRef("제750조");
  const article = normalizeArticlePayload(payload, {
    lawName: "민법",
    lawId: "001110",
    mst: "001234",
    articleRef
  });
  assert.equal(article.lawName, "민법");
  assert.equal(article.article, "제750조");
  assert.equal(article.title, "불법행위의 내용");
  assert.match(article.text, /고의 또는 과실/);
  assert.equal(article.effectiveDate, "2023-01-04");
}

async function testArticleBranchSelection() {
  const payload = await loadFixture("article-civil-758-branch.json");
  const branchedRef = normalizeArticleRef("제758조의2");
  assert.equal(branchedRef.joCode, "075802", "joCode for 제758조의2 should be 075802");
  const branched = normalizeArticlePayload(payload, {
    lawName: "민법",
    lawId: "001110",
    mst: "",
    articleRef: branchedRef
  });
  assert.equal(branched.title, "분리된 가지조 본문", "should select branched 조문 when JO matches");
  assert.match(branched.text, /750조의2 분기 조문의 본문/);

  const baseRef = normalizeArticleRef("제758조");
  assert.equal(baseRef.joCode, "075800");
  const base = normalizeArticlePayload(payload, {
    lawName: "민법",
    lawId: "001110",
    mst: "",
    articleRef: baseRef
  });
  assert.equal(base.title, "공작물등의 점유자, 소유자의 책임", "non-branched should pick base article");
  assert.match(base.text, /공작물의 설치 또는 보존의 하자/);
}

async function testArticlePipa15() {
  const payload = await loadFixture("article-pipa-15.json");
  const articleRef = normalizeArticleRef("제15조");
  const article = normalizeArticlePayload(payload, {
    lawName: "개인정보 보호법",
    lawId: "011357",
    mst: "",
    articleRef
  });
  assert.equal(article.title, "개인정보의 수집ㆍ이용");
  assert.match(article.text, /개인정보처리자/, "main article body should be present");
  assert.match(article.text, /정보주체의 동의/, "paragraph 1 should be merged into text");
  assert.match(article.text, /법률에 특별한 규정/, "paragraph 2 should be merged into text");
  // CDATA wrappers should not leak through
  assert.equal(article.text.includes("CDATA"), false, "CDATA marker must be stripped");
  assert.equal(article.text.includes("<![CDATA["), false);
}

async function testArticleHtmlEncoded() {
  const payload = await loadFixture("article-html-encoded.json");
  const articleRef = normalizeArticleRef("제44조");
  const article = normalizeArticlePayload(payload, {
    lawName: "도로교통법",
    lawId: "270100",
    mst: "",
    articleRef
  });
  assert.equal(article.title, "술에 취한 상태에서의 운전 금지");
  assert.equal(article.text.includes("&lt;"), false, "&lt; entity must be decoded");
  assert.equal(article.text.includes("&gt;"), false, "&gt; entity must be decoded");
  assert.equal(article.text.includes("<br>"), false, "<br> tag must be stripped");
  assert.match(article.text, /개정 2018\.3\.27/);
  assert.match(article.text, /운전하여서는 아니 된다/);
}

async function testArticleNotFound() {
  const payload = await loadFixture("article-not-found.json");
  const articleRef = normalizeArticleRef("제999조");
  const article = normalizeArticlePayload(payload, {
    lawName: "민법",
    lawId: "001110",
    mst: "",
    articleRef
  });
  assert.equal(article.text, "", "missing article should yield empty text so caller can throw NOT_FOUND");
}

function testCollectArticleText() {
  const text = collectArticleText({
    조문내용: "본문 1",
    항: [
      { 항내용: "항 1 본문" },
      {
        항내용: "항 2 본문",
        호: [
          { 호내용: "호 1 본문" },
          { 호내용: "호 1 본문" } // duplicate
        ]
      }
    ]
  });
  const lines = text.split("\n");
  assert.deepEqual(lines, ["본문 1", "항 1 본문", "항 2 본문", "호 1 본문"], "should dedupe and preserve order");
}

function testBuildCitation() {
  const articleRef = normalizeArticleRef("제750조");
  const citation = buildCitation({
    lawName: "민법",
    lawId: "001110",
    mst: "001234",
    title: "불법행위의 내용",
    effectiveDate: "2023-01-04"
  }, articleRef);
  assert.equal(citation.citationId, "L1");
  assert.equal(citation.sourceType, "law");
  assert.equal(citation.locator, "민법 제750조");
  assert.equal(citation.canonical, "민법/제750조");
  assert.match(citation.url, /^https:\/\/www\.law\.go\.kr\/lsInfoP\.do\?lsiSeq=001234$/);

  const citationNoMst = buildCitation({ lawName: "민법", lawId: "001110", mst: "", title: "불법행위의 내용", effectiveDate: "2023-01-04" }, articleRef);
  assert.match(citationNoMst.url, /^https:\/\/www\.law\.go\.kr\/법령\//);
  assert.match(decodeURIComponent(citationNoMst.url), /민법/);
}

function testNormalizeDate() {
  assert.equal(normalizeDate("20230104"), "2023-01-04");
  assert.equal(normalizeDate("2023-01-04"), "2023-01-04");
  assert.equal(normalizeDate(""), "");
  assert.equal(normalizeDate(null), "");
}

function testStripHtml() {
  assert.equal(stripHtml("<p>안녕</p>"), "안녕");
  assert.equal(stripHtml("&lt;개정 2018.3.27&gt;"), "<개정 2018.3.27>", "Korean revision markers must survive");
  assert.equal(stripHtml("&quot;값&quot; &amp; &#39;다른값&#39;"), "\"값\" & '다른값'");
  assert.equal(stripHtml("앞&nbsp;뒤"), "앞 뒤");
  assert.equal(stripHtml("<![CDATA[보존된 본문]]>"), "보존된 본문");
  assert.equal(stripHtml("앞<br>뒤"), "앞 뒤");
}

function testComparableLawName() {
  assert.equal(normalizeComparableLawName("개인정보 보호법"), "개인정보보호법");
  assert.equal(normalizeComparableLawName("「도로교통법」"), "도로교통법");
  assert.equal(normalizeComparableLawName("도로ㆍ교통ㆍ법"), "도로교통법");
}

async function testPrecedentSearch() {
  const payload = await loadFixture("search-precedent.json");
  const results = normalizePrecedentResults(payload);
  assert.equal(results.length, 2);
  const top = results[0];
  assert.equal(top.precId, "230001");
  assert.equal(top.title, "손해배상(자)");
  assert.equal(top.caseNumber, "2023다12345");
  assert.equal(top.court, "대법원");
  assert.equal(top.date, "2023-06-15");
  assert.equal(top.caseType, "민사");
}

async function testPrecedentDetail() {
  const payload = await loadFixture("precedent-detail.json");
  const data = normalizePrecedentPayload(payload);
  assert.equal(data.precId, "230001");
  assert.equal(data.title, "손해배상(자)");
  assert.equal(data.caseNumber, "2023다12345");
  assert.equal(data.court, "대법원");
  assert.equal(data.date, "2023-06-15");
  assert.match(data.text, /고의 또는 과실로 인한 위법행위/);
  assert.match(data.text, /불법행위로 인한 손해배상/);
  assert.match(data.text, /원심판결 이유/);
  assert.equal(data.text.includes("<br>"), false, "<br> tag must be stripped from precedent text");
}

async function testInterpretationSearch() {
  const payload = await loadFixture("search-interpretation.json");
  const results = normalizeInterpretationResults(payload);
  assert.equal(results.length, 2);
  const top = results[0];
  assert.equal(top.expcId, "EXPC-2023-0099");
  assert.equal(top.title, "개인정보 보호법 제15조 적용 여부");
  assert.equal(top.agency, "개인정보보호위원회");
  assert.equal(top.date, "2023-08-20");
}

function testInterpretationOfficialId() {
  const results = normalizeInterpretationResults({
    "LawSearch": {
      "law": [
        {
          "id": "1",
          "안건명": "개인정보보호위원회 - 자료제출 명령 관련",
          "안건번호": "20-0370",
          "법령해석례일련번호": "328859",
          "회신기관명": "법제처",
          "회신일자": "20201105"
        }
      ]
    }
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].expcId, "328859");
  assert.equal(results[0].agency, "법제처");
  assert.equal(results[0].date, "2020-11-05");
}

async function testInterpretationDetail() {
  const payload = await loadFixture("interpretation-detail.json");
  const data = normalizeInterpretationPayload(payload);
  assert.equal(data.expcId, "EXPC-2023-0099");
  assert.equal(data.title, "개인정보 보호법 제15조 적용 여부");
  assert.equal(data.agency, "개인정보보호위원회");
  assert.equal(data.date, "2023-08-20");
  assert.match(data.text, /\[질의요지\]/);
  assert.match(data.text, /공공기관이 보유한 정보/);
  assert.match(data.text, /\[회답\]/);
  assert.match(data.text, /\[이유\]/);
}

async function testAdminRuleSearch() {
  const payload = await loadFixture("search-admin-rule.json");
  const results = normalizeAdminRuleResults(payload);
  assert.equal(results.length, 2);
  const top = results[0];
  assert.equal(top.admrulId, "ADM-2024-0001");
  assert.equal(top.title, "개인정보 안전성 확보조치 기준");
  assert.equal(top.kind, "고시");
  assert.equal(top.agency, "개인정보보호위원회");
  assert.equal(top.issueDate, "2024-01-15");
  assert.equal(top.effectiveDate, "2024-03-01");
}

async function testAdminRuleDetail() {
  const payload = await loadFixture("admin-rule-detail.json");
  const data = normalizeAdminRulePayload(payload);
  assert.equal(data.admrulId, "ADM-2024-0001");
  assert.equal(data.title, "개인정보 안전성 확보조치 기준");
  assert.equal(data.agency, "개인정보보호위원회");
  assert.equal(data.kind, "고시");
  assert.equal(data.effectiveDate, "2024-03-01");
  assert.match(data.text, /제1조\(목적\)/);
  assert.match(data.text, /개인정보 보호법/);
}

async function testOrdinanceSearch() {
  const payload = await loadFixture("search-ordinance.json");
  const results = normalizeOrdinanceResults(payload);
  assert.equal(results.length, 2);
  const top = results[0];
  assert.equal(top.ordinId, "ORD-SEOUL-12345");
  assert.equal(top.title, "서울특별시 주차장 설치 및 관리 조례");
  assert.equal(top.kind, "조례");
  assert.equal(top.region, "서울특별시");
  assert.equal(top.effectiveDate, "2024-03-01");
}

function testOrdinanceOfficialRegion() {
  const results = normalizeOrdinanceResults({
    "LawSearch": {
      "law": [
        {
          "id": "1",
          "자치법규명": "서울특별시 강남구 주차장 설치 및 관리 조례",
          "자치법규일련번호": "2082681",
          "지자체기관명": "서울특별시 강남구",
          "자치법규종류": "조례",
          "시행일자": "20250919"
        }
      ]
    }
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].ordinId, "2082681");
  assert.equal(results[0].region, "서울특별시 강남구");
  assert.equal(results[0].effectiveDate, "2025-09-19");
}

async function testOrdinanceDetail() {
  const payload = await loadFixture("ordinance-detail.json");
  const data = normalizeOrdinancePayload(payload);
  assert.equal(data.ordinId, "ORD-SEOUL-12345");
  assert.equal(data.title, "서울특별시 주차장 설치 및 관리 조례");
  assert.equal(data.region, "서울특별시");
  assert.equal(data.kind, "조례");
  assert.equal(data.effectiveDate, "2024-03-01");
  assert.match(data.text, /제1조\(목적\)/);
  assert.match(data.text, /주차장법/);
}

function testOrdinanceOfficialBody() {
  const data = normalizeOrdinancePayload({
    "자치법규": {
      "자치법규기본정보": {
        "자치법규명": "서울특별시 강남구 주차장 설치 및 관리 조례",
        "자치법규일련번호": "2082681",
        "지자체기관명": "서울특별시 강남구",
        "자치법규종류": "조례",
        "시행일자": "20251107"
      },
      "조문": {
        "조문단위": [
          {
            "조문번호": "000100",
            "조제목": "목적",
            "조내용": "제1조(목적) 이 조례는 주차장 설치 및 관리에 필요한 사항을 규정한다."
          }
        ]
      }
    }
  });
  assert.equal(data.ordinId, "2082681");
  assert.equal(data.region, "서울특별시 강남구");
  assert.match(data.text, /제1조\(목적\)/);
}

function testAdminOrdinanceCitations() {
  const adminCitation = buildAdminRuleCitation({
    admrulId: "ADM-2024-0001",
    title: "개인정보 안전성 확보조치 기준",
    agency: "개인정보보호위원회",
    kind: "고시",
    effectiveDate: "2024-03-01"
  });
  assert.equal(adminCitation.sourceType, "law_admin_rule");
  assert.equal(adminCitation.recordType, "admin_rule");
  assert.match(adminCitation.locator, /개인정보보호위원회.*고시.*2024-03-01/);
  assert.match(adminCitation.url, /admRulInfoP\.do\?admRulSeq=ADM-2024-0001/);

  const ordCitation = buildOrdinanceCitation({
    ordinId: "ORD-SEOUL-12345",
    title: "서울특별시 주차장 설치 및 관리 조례",
    region: "서울특별시",
    kind: "조례",
    effectiveDate: "2024-03-01"
  });
  assert.equal(ordCitation.sourceType, "law_ordinance");
  assert.equal(ordCitation.recordType, "ordinance");
  assert.match(ordCitation.locator, /서울특별시.*조례.*2024-03-01/);
  assert.match(ordCitation.url, /ordinInfoP\.do\?ordinSeq=ORD-SEOUL-12345/);
}

function testNonLawCitationBuilders() {
  const precCitation = buildPrecedentCitation({
    precId: "230001",
    title: "손해배상(자)",
    caseNumber: "2023다12345",
    court: "대법원",
    date: "2023-06-15",
    caseType: "민사"
  });
  assert.equal(precCitation.sourceType, "law_precedent");
  assert.equal(precCitation.recordType, "precedent");
  assert.equal(precCitation.locator, "2023다12345 / 대법원");
  assert.match(precCitation.url, /precInfoP\.do\?precSeq=230001/);

  const expcCitation = buildInterpretationCitation({
    expcId: "EXPC-2023-0099",
    title: "개인정보 보호법 제15조 적용 여부",
    agency: "개인정보보호위원회",
    date: "2023-08-20"
  });
  assert.equal(expcCitation.sourceType, "law_interpretation");
  assert.equal(expcCitation.recordType, "interpretation");
  assert.equal(expcCitation.locator, "개인정보보호위원회 · 2023-08-20");
  assert.match(expcCitation.url, /expcInfoP\.do\?expcSeq=EXPC-2023-0099/);
}
