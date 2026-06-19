import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "myai-law-test-"));
process.env.LAW_OC = "SECRET-LAW-KEY";
process.env.LAW_CACHE_PATH = path.join(tempDir, "law-cache.sqlite");
process.env.NAVER_SEARCH_ENABLED = "true";

const {
  normalizeArticleRef,
  normalizeEffectiveDate,
  normalizeLawCitationParts,
  parseArticleLocator,
  extractLawCitations,
  normalizeLawName,
  resolveAliasedLawName
} = await import("../server/law/lawArticleRef.js");
const { detectLawIntent } = await import("../server/law/lawIntent.js");
const { maskLawSecrets } = await import("../server/law/lawConfig.js");
const { LawApiClient, stripLawPrivateFields } = await import("../server/law/lawApiClient.js");
const { DecisionsApiClient } = await import("../server/law/decisionsApiClient.js");
const { normalizeLawCitationForMeta, disclaimerForLawMode } = await import("../server/law/lawCitationFormatter.js");
const { buildLawContext, buildForcedLawContext, ACTION_PLAN_TEMPLATE } = await import("../server/law/lawContextBuilder.js");
const { resolveChatModeFlags, resolveNumCtx } = await import("../server/ollama.js");
const { buildImpactMap, createDeterministicImpactMap } = await import("../server/law/tools/impactMap.js");
const { getArticleAt } = await import("../server/law/tools/articleAt.js");
const { getArticleDiff } = await import("../server/law/tools/articleDiff.js");
const { runTimeTravel } = await import("../server/law/tools/timeTravel.js");
const { executeLawTool, listLawTools } = await import("../server/law/tools/toolRegistry.js");
const { bigramSimilarity, computeArticleDiff } = await import("../server/law/lawDiff.js");
const { getLawHistory } = await import("../server/law/tools/lawHistory.js");
const {
  buildLawCacheKey,
  getCachedLawResponse,
  setCachedLawResponse
} = await import("../server/law/lawCache.js");
const {
  parseAiSearchXml,
  normalizeAiSearchResults,
  findUpstreamError
} = await import("../server/law/lawApiParser.js");
const {
  normalizeKorPrcdntResults
} = await import("../server/law/decisionsApiParser.js");
const {
  buildLawTopicSearchQuery,
  inferLawArticleRefsForTopic
} = await import("../server/law/lawTopicHints.js");

let failureCount = 0;

await run("article reference normalization", testArticleReferenceNormalization);
await run("paragraph/item/subitem parsing", testParagraphParsing);
await run("citation extraction", testCitationExtraction);
await run("law intent detection", testLawIntentDetection);
await run("API key masking", testApiKeyMasking);
await run("law private response field stripping", testPrivateFieldStripping);
await run("law cache normalization and invalidation", testLawCache);
await run("citation meta carries article excerpt", testCitationExcerptMeta);
await run("impact map deterministic graph", testImpactMapGraph);
await run("impact map tool uses official article detail", testImpactMapTool);
await run("effective date normalization", testEffectiveDateNormalization);
await run("getLawArticle historical params (target=eflawjosub, efYd)", testGetLawArticleHistoricalParams);
await run("getLawArticle current params untouched (target=lawjosub, no efYd)", testGetLawArticleCurrentParams);
await run("getArticleAt rejects missing/invalid effectiveDate", testArticleAtRejectsMissingDate);
await run("getArticleAt threads effectiveDate to client", testArticleAtThreadsDate);
await run("bigram similarity bounds", testBigramSimilarity);
await run("computeArticleDiff identical/added/removed/modified", testComputeArticleDiff);
await run("getArticleDiff rejects missing or equal dates", testArticleDiffRejectsBadInput);
await run("getArticleDiff orchestrates two getArticleAt calls", testArticleDiffOrchestration);
await run("getLawHistory rejects empty input", testLawHistoryRejectsEmptyInput);
await run("getLawHistory returns sorted revision list", testLawHistoryOrchestration);
await run("LawApiClient.getLawHistory uses configured target + ID/MST", testLawApiClientHistoryParams);
await run("action_plan intent detection requires statute grounding", testActionPlanIntent);
await run("disclaimerForLawMode maps modes to disclaimer policy", testDisclaimerPolicy);
await run("buildLawContext action_plan injects non-legal-advice template", testActionPlanContext);
await run("citizen action_plan uses topic research evidence", testCitizenActionPlanContext);
await run("forced law search context stays official-evidence only", testForcedLawSearchContext);
await run("forced law search context includes official decision results", testForcedLawSearchDecisionContext);
await run("constitutional Korean decision search marks detail unsupported", testKorHunzaeSearchDetailUnsupported);
await run("constitutional Korean decision detail does not fall through to English detail", testKorHunzaeDetailUnsupported);
await run("forced all-domain decision search keeps haengjim when hunzae is unconfigured", testAllDecisionSearchPartialHunzaeConfig);
await run("forced decision search narrows query and suppresses statute substitutes", testForcedDecisionSearchNarrowsQuery);
await run("forced admin appeal search narrows query and stays in haengjim domain", testForcedAdminAppealSearchNarrowsQuery);
await run("haengjim hub API follows documented request parameters", testHaengJimHubApiDocumentedParams);
await run("haengjim URL env selects hub provider", testHaengJimUrlEnvSelectsHubProvider);
await run("haengjim hub API falls back to law.go.kr on transport failure", testHaengJimHubApiFallback);
await run("legal research 조사 prompt searches laws and precedents", testResearchSurveyPrompt);
await run("law workbench aggregates official law evidence groups", testLawWorkbenchAggregation);
await run("law workbench supports natural-language-only queries", testLawWorkbenchNaturalQueryOnly);
await run("law workbench prioritizes explicit case numbers in decision search", testLawWorkbenchCaseNumberQuery);
await run("law workbench extracts content keywords from natural-language queries", testLawWorkbenchNaturalQueryKeywords);
await run("law workbench searches precedent full text for legal-issue queries", testLawWorkbenchPrecedentUsesFullTextSearch);
await run("chat num_ctx grows with prompt size so large law context fits", testResolveNumCtxScalesWithPrompt);
await run("law workbench searches related article candidates with explicit law input", testLawWorkbenchExplicitLawStillSearchesAiCandidates);
await run("law workbench isolates partial upstream failures", testLawWorkbenchPartialFailure);
await run("law workbench report renders fixed review sequence", testLawWorkbenchReport);
await run("law workbench review payload includes official evidence and review documents", testLawWorkbenchReviewPayload);
await run("law workbench review normalizes Korean-keyed LLM JSON", testLawWorkbenchReviewNormalizesKoreanKeys);
await run("law workbench report prefers LLM review result", testLawWorkbenchReportUsesReviewResult);
await run("law term KB expands citizen wording into legal terms", testLawTermKbExpansion);
await run("time_travel compares full law text when no article is provided", testTimeTravelFullLaw);
await run("MCP-compatible law tool registry executes aliases", testLawToolRegistry);
await run("annex detail selector chooses matching annex number", testAnnexDetailSelectorChoosesAnnexNo);
await run("annex detail selector reports ambiguous matches", testAnnexDetailSelectorAmbiguous);
await run("law search mode overrides web/search context flags", testLawSearchModeFlags);
await run("law name alias resolution (산안법 → 산업안전보건법)", testLawAliasResolution);
await run("law_topic_search intent mode detection", testTopicSearchIntent);
await run("law topic hints expand confined-space work", testConfinedSpaceTopicHints);
await run("parseAiSearchXml extracts 법령조문 blocks", testParseAiSearchXml);
await run("parseAiSearchXml extracts attributed law.go.kr aiSearch blocks", testParseAiSearchXmlWithAttributes);
await run("parseAiSearchXml extracts 행정규칙조문 blocks", testParseAiSearchXmlAdmin);
await run("parseAiSearchXml detects API error envelope", testParseAiSearchXmlError);

await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
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

function testArticleReferenceNormalization() {
  const variants = ["750", "750조", "제750조", "민법750", "민법 제750조"];
  for (const variant of variants) {
    const normalized = normalizeArticleRef(variant);
    assert.equal(normalized.canonical, "제750조", variant);
    assert.equal(normalized.articleNumber, 750);
    assert.equal(normalized.branchNumber, null);
    assert.equal(normalized.joCode, "075000");
  }

  const branched = normalizeArticleRef("750조의2");
  assert.equal(branched.canonical, "제750조의2");
  assert.equal(branched.articleNumber, 750);
  assert.equal(branched.branchNumber, 2);
  assert.equal(branched.joCode, "075002");
}

function testParagraphParsing() {
  const locator = parseArticleLocator("제750조 ① 제2호 가목");
  assert.equal(locator.article.canonical, "제750조");
  assert.equal(locator.paragraph.canonical, "제1항");
  assert.equal(locator.item.canonical, "제2호");
  assert.equal(locator.subitem.canonical, "가목");

  const combined = normalizeLawCitationParts({
    lawName: "민법",
    article: "제750조의2",
    paragraph: "제1항",
    item: "제2호",
    subitem: "가목"
  });
  assert.equal(combined.canonical, "민법/제750조의2/제1항/제2호/가목");
}

function testCitationExtraction() {
  const citations = extractLawCitations("민법 제750조와 형법 제9999조를 검증해줘.");
  assert.equal(citations.length, 2);
  assert.equal(citations[0].canonical, "민법/제750조");
  assert.equal(citations[1].canonical, "형법/제9999조");
}

function testLawIntentDetection() {
  const article = detectLawIntent("법령에서 민법 제750조 찾아줘");
  assert.equal(article.isLegalQuery, true);
  assert.equal(article.mode, "law_article");
  assert.equal(article.extracted.lawName, "민법");
  assert.equal(article.extracted.article, "제750조");

  const verify = detectLawIntent("조문 검증해줘: 민법 제750조, 형법 제9999조");
  assert.equal(verify.isLegalQuery, true);
  assert.equal(verify.mode, "verify_citations");

  const ordinary = detectLawIntent("오늘 점심 메뉴 추천해줘");
  assert.equal(ordinary.isLegalQuery, false);
}

function testApiKeyMasking() {
  const masked = maskLawSecrets("GET https://x.test/path?OC=SECRET-LAW-KEY failed with SECRET-LAW-KEY");
  assert.equal(masked.includes("SECRET-LAW-KEY"), false);
  assert.ok(masked.includes("[REDACTED_LAW_OC]"));
}

function testPrivateFieldStripping() {
  const clean = stripLawPrivateFields({
    ok: true,
    results: [
      {
        lawName: "test law",
        raw: {
          detailLink: "/DRF/lawService.do?OC=SECRET-LAW-KEY&target=law"
        }
      }
    ],
    nested: {
      raw: { secret: "SECRET-LAW-KEY" },
      keep: "public"
    }
  });
  const text = JSON.stringify(clean);
  assert.equal(text.includes("SECRET-LAW-KEY"), false);
  assert.equal(text.includes("OC="), false);
  assert.equal(clean.results[0].raw, undefined);
  assert.equal(clean.nested.raw, undefined);
  assert.equal(clean.nested.keep, "public");
}

function testCitationExcerptMeta() {
  const baseCitation = {
    citationId: "L1",
    sourceType: "law",
    lawName: "민법",
    article: "제750조",
    canonical: "민법/제750조",
    title: "불법행위의 내용",
    locator: "민법 제750조",
    effectiveDate: "2023-01-04",
    url: "https://www.law.go.kr/법령/민법%20제750조"
  };

  const short = normalizeLawCitationForMeta(baseCitation, 0, "고의 또는 과실로 인한 위법행위로 타인에게 손해를 가한 자는 그 손해를 배상할 책임이 있다.");
  assert.equal(short.sourceType, "law");
  assert.equal(short.excerptTruncated, false, "short excerpt must not be marked truncated");
  assert.match(short.excerpt, /고의 또는 과실/);
  assert.equal(short.excerptLength, short.excerpt.length, "excerptLength should equal full text length when not truncated");

  const longText = "가".repeat(900);
  const long = normalizeLawCitationForMeta(baseCitation, 0, longText);
  assert.equal(long.excerptTruncated, true, "long excerpt must be marked truncated");
  assert.ok(long.excerpt.endsWith("…"), "truncated excerpt should end with ellipsis");
  assert.ok(long.excerpt.length <= 801, `truncated excerpt should fit budget, got ${long.excerpt.length}`);
  assert.equal(long.excerptLength, longText.length, "excerptLength should reflect original text length");

  const empty = normalizeLawCitationForMeta(baseCitation, 0, "");
  assert.equal(empty.excerpt, undefined, "no excerpt field when text is empty");
  assert.equal(empty.excerptTruncated, undefined);
}

function testImpactMapGraph() {
  const impact = createDeterministicImpactMap({
    citation: {
      citationId: "L1",
      lawName: "개인정보 보호법",
      article: "제15조",
      locator: "개인정보 보호법 제15조",
      title: "개인정보의 수집ㆍ이용",
      url: "https://www.law.go.kr/법령/개인정보보호법/제15조"
    },
    articleText: "개인정보처리자는 정보주체의 동의를 받은 경우 개인정보를 수집할 수 있다. 법률에 특별한 규정이 있는 경우에는 필요한 범위에서 이용하여야 한다. 이를 위반한 경우 책임이 발생할 수 있다.",
    subject: "회원가입 양식",
    materialText: "회원가입 양식은 개인정보 수집 동의 문구와 이용 목적을 표시한다."
  });
  assert.equal(impact.mode, "impact_map");
  assert.ok(impact.nodes.some((node) => node.type === "law_article" && node.citationId === "L1"));
  assert.ok(impact.nodes.some((node) => node.type === "obligation"));
  assert.ok(impact.nodes.some((node) => node.type === "condition"));
  assert.ok(impact.edges.some((edge) => edge.label === "requires"));
  assert.equal(JSON.stringify(impact).includes("SECRET-LAW-KEY"), false);
}

async function testImpactMapTool() {
  const result = await buildImpactMap({
    lawName: "개인정보 보호법",
    article: "제15조",
    subject: "가입 화면"
  }, {
    client: {
      async getLawArticle() {
        return {
          ok: true,
          cacheHit: true,
          text: "개인정보처리자는 정보주체의 동의를 받은 경우 개인정보를 수집할 수 있다. 필요한 범위에서 이용하여야 한다.",
          citation: {
            citationId: "L1",
            sourceType: "law",
            lawName: "개인정보 보호법",
            article: "제15조",
            canonical: "개인정보 보호법/제15조",
            title: "개인정보의 수집ㆍ이용",
            locator: "개인정보 보호법 제15조",
            url: "https://www.law.go.kr/법령/개인정보보호법/제15조"
          }
        };
      }
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.cacheHit, true);
  assert.equal(result.citation.citationId, "L1");
  assert.equal(result.impactMap.mode, "impact_map");
  assert.ok(result.impactMap.nodes.length >= 4);
}

function testEffectiveDateNormalization() {
  assert.equal(normalizeEffectiveDate("2020-01-04").iso, "2020-01-04");
  assert.equal(normalizeEffectiveDate("2020-01-04").compact, "20200104");
  assert.equal(normalizeEffectiveDate("20200104").iso, "2020-01-04");
  assert.equal(normalizeEffectiveDate("2020/01/04").compact, "20200104");
  assert.equal(normalizeEffectiveDate("2020.01.04").compact, "20200104");
  assert.equal(normalizeEffectiveDate("").iso, "");
  assert.equal(normalizeEffectiveDate("garbage").iso, "");
  assert.equal(normalizeEffectiveDate("2020-13-04").iso, "", "invalid month rejected");
  assert.equal(normalizeEffectiveDate("2020-01-32").iso, "", "invalid day rejected");
  assert.equal(normalizeEffectiveDate("1800-01-01").iso, "", "before 1948 rejected");
  assert.equal(normalizeEffectiveDate("3500-01-01").iso, "", "absurdly far future rejected");
}

function buildTestClient({ payload, capture }) {
  const client = new LawApiClient({
    enabled: true,
    configured: true,
    apiKey: "TEST",
    apiProvider: "law.go.kr",
    searchUrl: "https://law.test/search",
    serviceUrl: "https://law.test/service",
    userAgent: "test",
    timeoutMs: 5000,
    maxResults: 8,
    contextBudget: 10000,
    cache: { enabled: false, ttlMs: 0, maxEntries: 10, path: "" },
    autoDetect: false,
    verifyCitations: true,
    impactMapEnabled: true
  });
  client.requestService = async (params) => {
    if (capture) capture.params = { ...params };
    return payload;
  };
  client.requestSearch = async () => ({});
  return client;
}

async function testGetLawArticleHistoricalParams() {
  const capture = {};
  const client = buildTestClient({
    capture,
    payload: {
      "법령": {
        "기본정보": {
          "법령ID": "001110",
          "법령일련번호": "987654",
          "법령명_한글": "민법",
          "시행일자": "20120304"
        },
        "조문": {
          "조문단위": [
            { "조문번호": "750", "조문가지번호": "0", "조문제목": "불법행위의 내용", "조문내용": "고의 또는 과실..." }
          ]
        }
      }
    }
  });
  const result = await client.getLawArticle({
    lawName: "민법",
    lawId: "001110",
    article: "제750조",
    effectiveDate: "2012-03-04"
  });
  assert.equal(capture.params.target, "eflawjosub", "must switch target to eflawjosub for historical");
  assert.equal(capture.params.efYd, "20120304", "must pass YYYYMMDD as efYd");
  assert.equal(capture.params.JO, "075000", "must pass article JO code");
  assert.equal(capture.params.ID, "001110", "must pass resolved law ID");
  assert.equal(result.ok, true);
  assert.equal(result.effectiveDateRequested, "2012-03-04");
  assert.match(result.text, /고의 또는 과실/);
}

async function testGetLawArticleCurrentParams() {
  const capture = {};
  const client = buildTestClient({
    capture,
    payload: {
      "법령": {
        "기본정보": { "법령ID": "001110", "법령일련번호": "001234", "법령명_한글": "민법", "시행일자": "20230104" },
        "조문": {
          "조문단위": [
            { "조문번호": "750", "조문가지번호": "0", "조문제목": "불법행위의 내용", "조문내용": "고의 또는 과실..." }
          ]
        }
      }
    }
  });
  await client.getLawArticle({ lawName: "민법", lawId: "001110", article: "제750조" });
  assert.equal(capture.params.target, "lawjosub", "current mode keeps lawjosub target");
  assert.equal(capture.params.efYd, undefined, "current mode must not send efYd");
}

async function testArticleAtRejectsMissingDate() {
  await assert.rejects(
    () => getArticleAt({ lawName: "민법", article: "제750조" }, { client: {} }),
    /effectiveDate/
  );
  await assert.rejects(
    () => getArticleAt({ lawName: "민법", article: "제750조", effectiveDate: "garbage" }, { client: {} }),
    /effectiveDate/
  );
}

async function testArticleAtThreadsDate() {
  let captured = null;
  const result = await getArticleAt({
    lawName: "민법",
    article: "750",
    effectiveDate: "20120304"
  }, {
    client: {
      async getLawArticle(input) {
        captured = input;
        return {
          ok: true,
          cacheHit: false,
          text: "old text",
          citation: {
            citationId: "L1",
            sourceType: "law",
            lawName: "민법",
            article: "제750조",
            canonical: "민법/제750조",
            title: "불법행위의 내용",
            locator: "민법 제750조",
            effectiveDate: "2012-03-04",
            url: "https://www.law.go.kr/lsInfoP.do?lsiSeq=987654"
          }
        };
      }
    }
  });
  assert.equal(captured.effectiveDate, "2012-03-04", "ISO date must be forwarded to client");
  assert.equal(captured.article, "제750조", "loose article forms must be canonicalized first");
  assert.equal(result.ok, true);
  assert.equal(result.effectiveDateRequested, "2012-03-04");
  assert.equal(result.citation.effectiveDate, "2012-03-04");
}

function testBigramSimilarity() {
  assert.equal(bigramSimilarity("동일한 문장", "동일한 문장"), 1);
  assert.equal(bigramSimilarity("", ""), 1);
  assert.ok(bigramSimilarity("개인정보처리자는 동의를 받아야 한다", "개인정보처리자는 동의를 받지 아니할 수 있다") > 0.4,
    "near-rewrites should score > 0.4");
  assert.ok(bigramSimilarity("ABCDE", "ZYXWV") < 0.1, "fully different should score near 0");
}

function testComputeArticleDiff() {
  const identical = computeArticleDiff("문장 1\n문장 2", "문장 1\n문장 2");
  assert.equal(identical.identical, true);
  assert.equal(identical.stats.unchanged, 2);
  assert.equal(identical.stats.added, 0);
  assert.equal(identical.stats.removed, 0);

  const added = computeArticleDiff("문장 1", "문장 1\n문장 2");
  assert.equal(added.identical, false);
  assert.equal(added.stats.added, 1);
  assert.equal(added.stats.removed, 0);

  const removed = computeArticleDiff("문장 1\n문장 2", "문장 1");
  assert.equal(removed.stats.removed, 1);
  assert.equal(removed.stats.added, 0);

  const modified = computeArticleDiff(
    "개인정보처리자는 정보주체의 동의를 받은 경우 개인정보를 수집할 수 있다.",
    "개인정보처리자는 정보주체의 동의를 받지 아니하고는 개인정보를 수집할 수 없다."
  );
  assert.equal(modified.stats.modified, 1, "near-rewrite should collapse into modified");
  assert.equal(modified.stats.added, 0);
  assert.equal(modified.stats.removed, 0);
  const modifiedHunk = modified.hunks.find((h) => h.type === "modified");
  assert.ok(modifiedHunk, "must produce a modified hunk");
  assert.match(modifiedHunk.oldText, /수집할 수 있다/);
  assert.match(modifiedHunk.newText, /수집할 수 없다/);

  const empty = computeArticleDiff("", "신설된 조문 본문입니다");
  assert.equal(empty.fromLineCount, 0);
  assert.equal(empty.stats.added, 1);
}

async function testArticleDiffRejectsBadInput() {
  await assert.rejects(
    () => getArticleDiff({ article: "제750조", fromDate: "2020-01-01", toDate: "2023-01-01" }, { client: {} }),
    /lawName/
  );
  await assert.rejects(
    () => getArticleDiff({ lawName: "민법", article: "제750조", fromDate: "garbage", toDate: "2023-01-01" }, { client: {} }),
    /fromDate/
  );
  await assert.rejects(
    () => getArticleDiff({ lawName: "민법", article: "제750조", fromDate: "2020-01-01", toDate: "2020-01-01" }, { client: {} }),
    /must differ/
  );
}

async function testArticleDiffOrchestration() {
  const captured = [];
  const fakeClient = {
    async getLawArticle(input) {
      captured.push(input);
      const text = input.effectiveDate === "2012-03-04"
        ? "개인정보처리자는 동의를 받은 경우 개인정보를 수집할 수 있다."
        : "개인정보처리자는 동의를 받지 아니하고는 개인정보를 수집할 수 없다.";
      return {
        ok: true,
        cacheHit: false,
        text,
        citation: {
          citationId: "L1",
          lawName: "개인정보 보호법",
          article: "제15조",
          locator: "개인정보 보호법 제15조",
          effectiveDate: input.effectiveDate,
          url: "https://www.law.go.kr/법령/개인정보보호법/제15조"
        }
      };
    }
  };
  const result = await getArticleDiff({
    lawName: "개인정보 보호법",
    article: "제15조",
    fromDate: "2012-03-04",
    toDate: "2023-09-15"
  }, { client: fakeClient });
  assert.equal(result.ok, true);
  assert.equal(captured.length, 2, "must call getLawArticle twice");
  assert.equal(result.from.effectiveDate, "2012-03-04");
  assert.equal(result.to.effectiveDate, "2023-09-15");
  assert.equal(result.diff.identical, false);
  assert.equal(result.diff.stats.modified, 1);
}

async function testLawHistoryRejectsEmptyInput() {
  await assert.rejects(
    () => getLawHistory({}, { client: {} }),
    /lawName/
  );
}

async function testLawHistoryOrchestration() {
  const fakeClient = {
    async getLawHistory(input) {
      assert.equal(input.lawName, "민법");
      return {
        ok: true,
        cacheHit: false,
        lawName: "민법",
        lawId: "001110",
        mst: "001234",
        revisions: [
          { effectiveDate: "2023-01-04", mst: "001234", revisionType: "일부개정" },
          { effectiveDate: "2012-03-04", mst: "987654", revisionType: "일부개정" }
        ]
      };
    }
  };
  const result = await getLawHistory({ lawName: "민법" }, { client: fakeClient });
  assert.equal(result.ok, true);
  assert.equal(result.revisions.length, 2);
  assert.equal(result.revisions[0].effectiveDate, "2023-01-04");
}

async function testLawApiClientHistoryParams() {
  const captureSearch = [];
  function makeClient(historyTarget) {
    const client = new LawApiClient({
      enabled: true,
      configured: true,
      apiKey: "TEST",
      apiProvider: "law.go.kr",
      searchUrl: "https://law.test/search",
      serviceUrl: "https://law.test/service",
      userAgent: "test",
      timeoutMs: 5000,
      maxResults: 8,
      contextBudget: 10000,
      cache: { enabled: false, ttlMs: 0, maxEntries: 10, path: "" },
      autoDetect: false,
      verifyCitations: true,
      impactMapEnabled: true,
      historyTarget
    });
    client.requestSearch = async (params) => {
      captureSearch.push({ historyTarget, params: { ...params } });
      return {
        "LawSearch": {
          "law": [
            // expected match
            { "법령명한글": "민법", "법령일련번호": "001234", "시행일자": "20230104", "공포일자": "20221206", "제개정구분명": "일부개정" },
            { "법령명한글": "민법", "법령일련번호": "987654", "시행일자": "20120304", "공포일자": "20111210", "제개정구분명": "일부개정" },
            // foreign rows that must be filtered out under eflaw target
            { "법령명한글": "민법 시행령", "법령일련번호": "555000", "시행일자": "20220101", "공포일자": "20211201", "제개정구분명": "일부개정" },
            { "법령명한글": "민사소송법", "법령일련번호": "666000", "시행일자": "20220101", "공포일자": "20211201", "제개정구분명": "일부개정" }
          ]
        }
      };
    };
    return client;
  }

  // Default eflaw target: search by query + display=100, post-filter by exact lawName.
  const eflawResult = await makeClient("eflaw").getLawHistory({ lawName: "민법", lawId: "001110" });
  const eflawCall = captureSearch[captureSearch.length - 1];
  assert.equal(eflawCall.params.target, "eflaw", "default target is eflaw (live law.go.kr endpoint)");
  assert.equal(eflawCall.params.query, "민법", "eflaw filters by query, not ID");
  assert.equal(eflawCall.params.display, 100);
  assert.equal(eflawCall.params.ID, undefined, "ID/MST/LM must not be sent for eflaw");
  assert.equal(eflawCall.params.LM, undefined);
  assert.equal(eflawResult.revisions.length, 2, "eflaw filters out 민법 시행령 / 민사소송법 by exact lawName");
  assert.equal(eflawResult.revisions[0].effectiveDate, "2023-01-04", "newest revision first");
  assert.ok(eflawResult.revisions.every((r) => r.title === "민법"));

  // Legacy historyTarget=lsHstInq still uses ID/MST/LM shape for env-driven override compat.
  captureSearch.length = 0;
  const legacyResult = await makeClient("lsHstInq").getLawHistory({ lawName: "민법", lawId: "001110" });
  const legacyCall = captureSearch[captureSearch.length - 1];
  assert.equal(legacyCall.params.target, "lsHstInq");
  assert.equal(legacyCall.params.ID, "001110", "legacy mode passes resolved law ID");
  assert.equal(legacyCall.params.query, undefined, "legacy mode does not use query/display");
  assert.equal(legacyResult.revisions.length, 4, "legacy mode does not post-filter — caller-determined");
}

function testActionPlanIntent() {
  // True positives: action-plan verbs + statute grounding (citation or law name + article)
  const tp1 = detectLawIntent("개인정보 보호법 제15조 위반 시 단계별 대응 방안 알려줘");
  assert.equal(tp1.isLegalQuery, true, "PIPA + article + 단계별 대응 방안 must trigger");
  assert.equal(tp1.mode, "action_plan");
  assert.equal(tp1.extracted.lawName, "개인정보 보호법");
  assert.equal(tp1.extracted.article, "제15조");

  const tp2 = detectLawIntent("근로기준법 제53조 이행 계획을 단계별로 정리해줘");
  assert.equal(tp2.isLegalQuery, true);
  assert.equal(tp2.mode, "action_plan");

  const tp3 = detectLawIntent("민법 제750조 손해배상 조치 절차");
  assert.equal(tp3.isLegalQuery, true);
  assert.equal(tp3.mode, "action_plan");

  // False positives: must NOT trigger as action_plan (no statute grounding)
  const fpGeneric = detectLawIntent("이번 분기 프로젝트 단계별 실행 계획 짜줘");
  assert.equal(fpGeneric.isLegalQuery, false, "no statute → not action_plan");

  const fpTravel = detectLawIntent("주말 여행 대응 방안 알려줘");
  assert.equal(fpTravel.isLegalQuery, false, "travel context → not action_plan");

  // Boundary: review verb without action-plan verb falls back to legalReview/article path
  const boundary = detectLawIntent("개인정보 보호법 제15조 위반인지 검토해줘", { hasDocuments: true });
  assert.notEqual(boundary.mode, "action_plan",
    "review verb without action-plan verb must not be action_plan");
}

function testDisclaimerPolicy() {
  assert.equal(disclaimerForLawMode("action_plan"), "mandatory");
  assert.equal(disclaimerForLawMode("legal_research"), "short");
  assert.equal(disclaimerForLawMode("department_legal_review"), "short");
  assert.equal(disclaimerForLawMode("law_article"), null);
  assert.equal(disclaimerForLawMode("law_search"), null);
  assert.equal(disclaimerForLawMode("verify_citations"), null);
  assert.equal(disclaimerForLawMode("none"), null);
}

async function testActionPlanContext() {
  // Sanity: the template itself carries the non-legal-advice framing.
  assert.match(ACTION_PLAN_TEMPLATE, /행동 계획 응답 템플릿/);
  assert.match(ACTION_PLAN_TEMPLATE, /법률 자문이 아닙니다/);
  assert.match(ACTION_PLAN_TEMPLATE, /단계별 조치/);
  assert.match(ACTION_PLAN_TEMPLATE, /증빙·기록/);
  assert.match(ACTION_PLAN_TEMPLATE, /후속 점검/);

  // End-to-end: buildLawContext routes action_plan prompts through the
  // structured template, attaches the article citation, and tags disclaimer
  // as mandatory. Mock client so we don't hit law.go.kr.
  const fakeClient = {
    async getLawArticle(input) {
      assert.equal(input.lawName, "개인정보 보호법");
      assert.equal(input.article, "제15조");
      return {
        ok: true,
        cacheHit: false,
        text: "개인정보처리자는 정보주체의 동의를 받은 경우 개인정보를 수집할 수 있다.",
        citation: {
          citationId: "L1",
          sourceType: "law",
          lawName: "개인정보 보호법",
          article: "제15조",
          canonical: "개인정보 보호법/제15조",
          title: "개인정보의 수집ㆍ이용",
          locator: "개인정보 보호법 제15조",
          effectiveDate: "2023-09-15",
          url: "https://www.law.go.kr/법령/개인정보보호법/제15조"
        }
      };
    }
  };
  const ctx = await buildLawContext(
    "개인정보 보호법 제15조 위반 시 단계별 대응 방안 알려줘",
    { client: fakeClient }
  );
  assert.ok(ctx, "buildLawContext returns context");
  assert.equal(ctx.mode, "action_plan");
  assert.equal(ctx.disclaimer, "mandatory", "action_plan must carry mandatory disclaimer");
  assert.equal(ctx.citations.length, 1);
  assert.equal(ctx.citations[0].citationId, "L1");
  assert.match(ctx.contextText, /\[공식 법령 근거\]/);
  assert.match(ctx.contextText, /\[행동 계획 응답 템플릿\]/);
  assert.match(ctx.contextText, /법률 자문이 아닙니다/,
    "rendered system block must include the non-legal-advice phrase");
  assert.match(ctx.contextText, /단계별 조치/);
}

async function testCitizenActionPlanContext() {
  const citizen = detectLawIntent("전세금 못 받았어");
  assert.equal(citizen.isLegalQuery, true, "citizen legal problem should trigger law engine");
  assert.equal(citizen.mode, "action_plan");
  assert.equal(citizen.extracted.query, "전세금 못 받았어");

  const fakeClient = {
    async searchAiLaw(input) {
      if (input.searchType === 0) {
        return {
          ok: true,
          results: [
            {
              lawName: "주택임대차보호법",
              articleNo: "제3조의2",
              articleTitle: "보증금의 회수",
              snippet: "임차인은 임차주택에 대하여 보증금반환채권을 가진다.",
              effectiveDate: "2024-01-01"
            }
          ]
        };
      }
      return { ok: true, results: [] };
    },
    async searchLaw() { return { ok: true, results: [] }; },
    async searchAdminRules() { return { ok: true, results: [] }; },
    async searchPrecedents() { return { ok: true, results: [] }; },
    async searchInterpretations() { return { ok: true, results: [] }; },
    async searchOrdinances() { return { ok: true, results: [] }; }
  };
  const ctx = await buildLawContext("전세금 못 받았어", { client: fakeClient });
  assert.equal(ctx.ok, true);
  assert.equal(ctx.mode, "action_plan");
  assert.equal(ctx.disclaimer, "mandatory");
  assert.ok(ctx.citations.some((item) => item.citationId === "AI-L1"));
  assert.match(ctx.contextText, /\[AI-L1\]/);
  assert.match(ctx.contextText, /행동 계획 응답 템플릿/);
}

async function testForcedLawSearchContext() {
  const fakeClient = {
    async searchAiLaw(input) {
      if (input.searchType === 0) {
        return {
          ok: true,
          results: [
            {
              lawName: "개인정보 보호법",
              articleNo: "제15조",
              articleTitle: "개인정보의 수집ㆍ이용",
              snippet: "개인정보처리자는 정보주체의 동의를 받은 경우 개인정보를 수집할 수 있다.",
              effectiveDate: "2023-09-15"
            }
          ]
        };
      }
      return { ok: true, results: [] };
    },
    async searchLaw() {
      return {
        ok: true,
        query: "개인정보",
        results: [
          {
            lawName: "개인정보 보호법",
            lawId: "011357",
            mst: "258625",
            lawType: "법률",
            effectiveDate: "2023-09-15"
          }
        ]
      };
    },
    async searchAdminRules() { return { ok: true, results: [] }; },
    async searchPrecedents() { return { ok: true, results: [] }; },
    async searchInterpretations() { return { ok: true, results: [] }; }
  };

  const ctx = await buildForcedLawContext("개인정보 수집 법령 검색", { client: fakeClient });
  assert.equal(ctx.ok, true);
  assert.ok(ctx.citations.length >= 2, "forced law search should expose official citations");
  assert.match(ctx.contextText, /\[AI-L1\]/);
  assert.match(ctx.contextText, /\[L-S2\]/);
  assert.doesNotMatch(ctx.contextText, /training knowledge|using your knowledge/i);
  assert.match(ctx.contextText, /do not infer/i);
}

async function testForcedLawSearchDecisionContext() {
  const calls = [];
  const fakeClient = {
    async searchAiLaw(input) {
      calls.push(["searchAiLaw", input]);
      return { ok: true, results: [] };
    },
    async searchLaw(input) {
      calls.push(["searchLaw", input]);
      return { ok: true, query: input.query, results: [] };
    },
    async searchAdminRules(input) {
      calls.push(["searchAdminRules", input]);
      return { ok: true, results: [] };
    },
    async searchPrecedents(input) {
      calls.push(["searchPrecedents", input]);
      return { ok: true, results: [] };
    },
    async searchInterpretations(input) {
      calls.push(["searchInterpretations", input]);
      return { ok: true, results: [] };
    },
    async searchOrdinances(input) {
      calls.push(["searchOrdinances", input]);
      return { ok: true, results: [] };
    },
    async searchDecisions(input) {
      calls.push(["searchDecisions", input]);
      return {
        ok: true,
        domain: "hunzae",
        results: [
          {
            id: "1001",
            caseNo: "2018Hun-Ma001",
            title: "Privacy infringement constitutional decision",
            result: "dismissed",
            date: "2020-01-01",
            institution: "Constitutional Court of Korea",
            summary: "Privacy-related decision summary.",
            sourceType: "decision_hunzae_kor"
          }
        ]
      };
    }
  };

  const ctx = await buildForcedLawContext("privacy infringement constitutional court decisions", { client: fakeClient });
  assert.equal(ctx.ok, true);
  assert.ok(calls.some(([name]) => name === "searchDecisions"), "forced law search must search decisions");
  assert.ok(ctx.citations.some((item) => item.citationId === "D1"), "must include a decision citation");
  assert.match(ctx.contextText, /\[D1\]/);
  assert.match(ctx.contextText, /Privacy infringement constitutional decision/);
}

function testKorHunzaeSearchDetailUnsupported() {
  const xml = [
    "<response>",
    "<header><resultCode>0</resultCode><resultMsg>OK</resultMsg></header>",
    "<body><items><item>",
    "<eventNum>1001</eventNum>",
    "<eventNo>2024Hun-Ma1</eventNo>",
    "<eventNm>Korean constitutional decision</eventNm>",
    "<rstaRsta>dismissed</rstaRsta>",
    "<rstaDate>20240102</rstaDate>",
    "</item></items><totalCount>1</totalCount><pageNo>1</pageNo></body>",
    "</response>"
  ].join("");
  const result = normalizeKorPrcdntResults(xml);
  assert.equal(result.results.length, 1);
  assert.equal(result.results[0].sourceType, "decision_hunzae_kor");
  assert.equal(result.results[0].detailAvailable, false);
  assert.equal(result.results[0].detailKind, "list_only");
  assert.match(result.results[0].detailNotice, /Korean full text/i);
}

async function testKorHunzaeDetailUnsupported() {
  const client = new DecisionsApiClient();
  client.hunzaeApiKey = "TEST-HUNZAE";
  client.hunzaeBaseUrl = "https://example.test/hunzae";
  client.requestRaw = async () => {
    throw new Error("Korean detail must not call English or outline detail APIs");
  };
  const result = await client.getDecisionText({
    id: "1001",
    sourceType: "decision_hunzae_kor"
  });
  assert.equal(result.ok, false);
  assert.equal(result.error, "HUNZAE_KOR_FULL_TEXT_UNSUPPORTED");
  assert.equal(result.detailAvailable, false);
  assert.equal(result.detailKind, "list_only");
}

async function testAllDecisionSearchPartialHunzaeConfig() {
  const previousKey = process.env.HUNZAE_API_KEY;
  const previousShared = process.env.DECISIONS_API_KEY;
  const previousUrl = process.env.HUNZAE_API_URL;
  delete process.env.HUNZAE_API_KEY;
  delete process.env.DECISIONS_API_KEY;
  delete process.env.HUNZAE_API_URL;
  const calls = [];
  const fakeClient = {
    async searchDecisions(input) {
      calls.push(["searchDecisions", input]);
      assert.equal(input.domain, "all");
      return {
        ok: true,
        domain: "all",
        results: [
          {
            id: "HA-1",
            caseNo: "2026-1",
            title: "Administrative appeal decision",
            result: "accepted",
            date: "2026-01-01",
            institution: "Central Administrative Appeals Commission",
            summary: "Administrative appeal summary.",
            sourceType: "decision_haengjim",
            subType: "haengjim",
            detailAvailable: true,
            detailKind: "full_text"
          }
        ],
        domains: {
          hunzae: { ok: false, total: 0, error: "HUNZAE_API_KEY_NOT_CONFIGURED" },
          haengjim: { ok: true, total: 1, error: "" }
        },
        warnings: ["HUNZAE_API_KEY_NOT_CONFIGURED"]
      };
    }
  };
  try {
    const ctx = await buildForcedLawContext("?뚯옱 ?됱젙?ы뙋 ?ш껐濡 privacy infringement decisions", { client: fakeClient });
    assert.equal(ctx.ok, true);
    assert.ok(calls.some(([name]) => name === "searchDecisions"));
    assert.equal(ctx.decisionDomains.hunzae.error, "HUNZAE_API_KEY_NOT_CONFIGURED");
    assert.equal(ctx.decisionDomains.haengjim.ok, true);
    assert.ok(ctx.warnings.includes("HUNZAE_API_KEY_NOT_CONFIGURED"));
    assert.ok(ctx.citations.some((item) => item.sourceType === "decision_haengjim"));
  } finally {
    if (previousKey == null) delete process.env.HUNZAE_API_KEY;
    else process.env.HUNZAE_API_KEY = previousKey;
    if (previousShared == null) delete process.env.DECISIONS_API_KEY;
    else process.env.DECISIONS_API_KEY = previousShared;
    if (previousUrl == null) delete process.env.HUNZAE_API_URL;
    else process.env.HUNZAE_API_URL = previousUrl;
  }
}

async function testForcedDecisionSearchNarrowsQuery() {
  const calls = [];
  const fakeClient = {
    async searchAiLaw(input) {
      calls.push(["searchAiLaw", input]);
      return {
        ok: true,
        results: [
          {
            lawName: "헌법재판소 개인정보 보호 규칙",
            articleNo: "0013",
            articleTitle: "헌법재판소지침",
            snippet: "개인정보 보호와 관련한 절차 규정",
            effectiveDate: "2024-01-01"
          }
        ]
      };
    },
    async searchLaw(input) {
      calls.push(["searchLaw", input]);
      return { ok: true, query: input.query, results: [] };
    },
    async searchAdminRules(input) {
      calls.push(["searchAdminRules", input]);
      return { ok: true, results: [] };
    },
    async searchPrecedents(input) {
      calls.push(["searchPrecedents", input]);
      return { ok: true, results: [] };
    },
    async searchInterpretations(input) {
      calls.push(["searchInterpretations", input]);
      return { ok: true, results: [] };
    },
    async searchOrdinances(input) {
      calls.push(["searchOrdinances", input]);
      return { ok: true, results: [] };
    },
    async searchDecisions(input) {
      calls.push(["searchDecisions", input]);
      if (input.query !== "개인정보") return { ok: true, domain: input.domain, results: [], total: 0 };
      return {
        ok: true,
        domain: "hunzae",
        results: [
          {
            id: "2001",
            caseNo: "2024Hun-Ma001",
            title: "개인정보 자기결정권 침해 여부",
            result: "인용",
            date: "2024-02-01",
            institution: "헌법재판소",
            summary: "개인정보 관련 헌법재판소 결정례 요지",
            sourceType: "decision_hunzae_outline"
          }
        ]
      };
    }
  };

  const ctx = await buildForcedLawContext("개인정보 침해 관련 헌법재판소 결정례 찾아줘", { client: fakeClient });
  assert.equal(ctx.ok, true);
  assert.deepEqual(
    calls.filter(([name]) => name === "searchDecisions").map(([, input]) => input.query),
    ["개인정보 침해", "개인정보"]
  );
  assert.ok(!calls.some(([name]) => name === "searchAiLaw"), "decision-specific law search must not fall back to statute AI snippets");
  assert.ok(ctx.citations.some((item) => item.citationId === "D1"));
  assert.ok(ctx.citations.every((item) => item.citationId.startsWith("D")), "decision prompt should expose only decision citations");
  assert.match(ctx.contextText, /개인정보 자기결정권 침해 여부/);
  assert.doesNotMatch(ctx.contextText, /\[AI-L/);
}

async function testForcedAdminAppealSearchNarrowsQuery() {
  const calls = [];
  const fakeClient = {
    async searchAiLaw(input) {
      calls.push(["searchAiLaw", input]);
      return { ok: true, results: [{ lawName: "행정심판법", articleNo: "0001", snippet: "대체 조문" }] };
    },
    async searchDecisions(input) {
      calls.push(["searchDecisions", input]);
      assert.equal(input.domain, "haengjim");
      if (input.query !== "개인정보") return { ok: true, domain: input.domain, results: [], total: 0 };
      return {
        ok: true,
        domain: "haengjim",
        results: [
          {
            id: "272985",
            caseNo: "2025-15824",
            title: "정보공개 거부처분 취소청구",
            result: "인용",
            date: "2026-02-24",
            institution: "국민권익위원회",
            summary: "개인정보가 포함된 행정심판 재결례 요지",
            sourceType: "decision_haengjim"
          }
        ]
      };
    }
  };

  const ctx = await buildForcedLawContext("행정심판 재결례 중 개인정보 관련 사례 찾아줘", { client: fakeClient });
  assert.equal(ctx.ok, true);
  assert.deepEqual(
    calls.filter(([name]) => name === "searchDecisions").map(([, input]) => input.query),
    ["개인정보"]
  );
  assert.ok(!calls.some(([name]) => name === "searchAiLaw"), "admin appeal decision prompt must not fall back to statute AI snippets");
  assert.ok(ctx.citations.some((item) => item.citationId === "D1" && item.sourceType === "decision_haengjim"));
  assert.ok(ctx.citations.every((item) => item.citationId.startsWith("D")), "admin appeal prompt should expose only decision citations");
  assert.match(ctx.contextText, /정보공개 거부처분 취소청구/);
  assert.doesNotMatch(ctx.contextText, /\[AI-L/);
}

async function testHaengJimHubApiDocumentedParams() {
  const previousProvider = process.env.HAENGJIM_API_PROVIDER;
  const previousUrl = process.env.HAENGJIM_API_URL;
  process.env.HAENGJIM_API_PROVIDER = "hub";
  process.env.HAENGJIM_API_URL = "http://www.simpan.go.kr/nsph/getAdjdexeList.do";
  try {
    const client = new DecisionsApiClient();
    let captured = null;
    client.requestRaw = async (url, params) => {
      captured = { url, params };
      return [
        "<simpan>",
        "<list pageRecords=\"1\" totalRecords=\"1\">",
        "<data index=\"1\">",
        "<incdntNb>202500001</incdntNb>",
        "<incdntNm><![CDATA[개인정보 관련 재결례]]></incdntNm>",
        "<cmitNm>중앙행정심판위원회</cmitNm>",
        "<adjdcDe>20260120</adjdcDe>",
        "<adjdcResultNm>기각</adjdcResultNm>",
        "<sumryCn><![CDATA[문서 표준 XML 응답]]></sumryCn>",
        "</data>",
        "</list>",
        "</simpan>"
      ].join("");
    };

    const result = await client.searchHaengJim({
      query: "개인정보",
      page: 2,
      display: 7,
      reqDate: "20260101",
      cmitId: "100100000",
      adjdcStartDe: "20250101",
      adjdcEndDe: "20261231"
    });

    assert.equal(captured.url, "http://www.simpan.go.kr/nsph/getAdjdexeList.do");
    assert.deepEqual(captured.params, {
      page: 2,
      row: 7,
      init: "Y",
      reqDate: "20260101",
      cmitId: "100100000",
      incdntNm: "개인정보",
      adjdcStartDe: "20250101",
      adjdcEndDe: "20261231"
    });
    assert.equal(result.results[0].title, "개인정보 관련 재결례");
    assert.equal(result.results[0].institution, "중앙행정심판위원회");
  } finally {
    if (previousProvider == null) delete process.env.HAENGJIM_API_PROVIDER;
    else process.env.HAENGJIM_API_PROVIDER = previousProvider;
    if (previousUrl == null) delete process.env.HAENGJIM_API_URL;
    else process.env.HAENGJIM_API_URL = previousUrl;
  }
}

async function testHaengJimUrlEnvSelectsHubProvider() {
  const previousProvider = process.env.HAENGJIM_API_PROVIDER;
  const previousUrl = process.env.HAENGJIM_API_URL;
  delete process.env.HAENGJIM_API_PROVIDER;
  process.env.HAENGJIM_API_URL = "http://www.simpan.go.kr/nsph/getAdjdexeList.do";
  try {
    const client = new DecisionsApiClient();
    assert.equal(client.haengjimProvider, "hub");
  } finally {
    if (previousProvider == null) delete process.env.HAENGJIM_API_PROVIDER;
    else process.env.HAENGJIM_API_PROVIDER = previousProvider;
    if (previousUrl == null) delete process.env.HAENGJIM_API_URL;
    else process.env.HAENGJIM_API_URL = previousUrl;
  }
}

async function testHaengJimHubApiFallback() {
  const previousProvider = process.env.HAENGJIM_API_PROVIDER;
  const previousUrl = process.env.HAENGJIM_API_URL;
  process.env.HAENGJIM_API_PROVIDER = "hub";
  process.env.HAENGJIM_API_URL = "http://www.simpan.go.kr/nsph/getAdjdexeList.do";
  try {
    const client = new DecisionsApiClient();
    const urls = [];
    client.requestRaw = async (url) => {
      urls.push(url);
      if (url.includes("simpan.go.kr")) {
        throw Object.assign(new Error("HTTP 404 from www.simpan.go.kr"), { marker: "DECISIONS_HTTP_ERROR" });
      }
      return JSON.stringify({
        Decc: {
          totalCnt: 1,
          page: 1,
          decc: [
            {
              "행정심판재결례일련번호": "272985",
              "사건번호": "2025-15824",
              "사건명": "정보공개 거부처분 취소청구",
              "의결일자": "2026.02.24",
              "재결청": "국민권익위원회",
              "재결요지": "개인정보 관련 정보공개 재결례"
            }
          ]
        }
      });
    };

    const result = await client.searchHaengJim({ query: "개인정보", display: 1 });
    assert.deepEqual(urls, [
      "http://www.simpan.go.kr/nsph/getAdjdexeList.do",
      "https://www.law.go.kr/DRF/lawSearch.do"
    ]);
    assert.equal(result.provider, "law.go.kr");
    assert.equal(result.results[0].sourceType, "decision_haengjim");
    assert.equal(result.results[0].title, "정보공개 거부처분 취소청구");
  } finally {
    if (previousProvider == null) delete process.env.HAENGJIM_API_PROVIDER;
    else process.env.HAENGJIM_API_PROVIDER = previousProvider;
    if (previousUrl == null) delete process.env.HAENGJIM_API_URL;
    else process.env.HAENGJIM_API_URL = previousUrl;
  }
}

async function testResearchSurveyPrompt() {
  const prompt = "위반건축물 관련 법령이나 판례를 조사해";
  const intent = detectLawIntent(prompt);
  assert.equal(intent.isLegalQuery, true);
  assert.equal(intent.mode, "legal_research");
  assert.equal(intent.extracted.wantLawSources, true);
  assert.equal(intent.extracted.wantPrecedents, true);
  assert.match(intent.extracted.query, /위반건축물/);

  const calls = [];
  const fakeClient = {
    async getLawArticle(input) {
      calls.push(["getLawArticle", input]);
      return {
        ok: true,
        cacheHit: false,
        text: `${input.lawName} ${input.article} 공식 조문 본문`,
        citation: {
          citationId: "L1",
          sourceType: "law",
          lawName: input.lawName,
          article: input.article,
          canonical: `${input.lawName}/${input.article}`,
          title: input.article === "제79조" ? "위반 건축물 등에 대한 조치 등" : "이행강제금",
          locator: `${input.lawName} ${input.article}`,
          effectiveDate: "2024-01-01",
          url: "https://www.law.go.kr/lsInfoP.do?lsiSeq=123456"
        }
      };
    },
    async searchAiLaw(input) {
      calls.push(["searchAiLaw", input]);
      return {
        ok: true,
        results: [
          {
            lawName: "건축법",
            articleNo: "제79조",
            articleTitle: "위반 건축물 등에 대한 조치 등",
            snippet: "허가권자는 위반 건축물에 대하여 필요한 조치를 명할 수 있다.",
            effectiveDate: "2024-01-01"
          }
        ]
      };
    },
    async searchLaw(input) {
      calls.push(["searchLaw", input]);
      return {
        ok: true,
        query: input.query,
        results: [
          { lawName: "건축법", lawId: "000001", mst: "123456", lawType: "법률", effectiveDate: "2024-01-01" }
        ]
      };
    },
    async searchPrecedents(input) {
      calls.push(["searchPrecedents", input]);
      return {
        ok: true,
        results: [
          { title: "위반건축물 시정명령 취소", caseNumber: "2020두12345", court: "대법원", date: "2021-01-01", precId: "98765" }
        ]
      };
    },
    async searchInterpretations() { return { ok: true, results: [] }; },
    async searchAdminRules() { return { ok: true, results: [] }; },
    async searchOrdinances() { return { ok: true, results: [] }; }
  };

  const ctx = await buildLawContext(prompt, { client: fakeClient });
  assert.equal(ctx.ok, true);
  assert.equal(ctx.mode, "legal_research");
  assert.equal(new Set(ctx.citations.map((item) => item.citationId)).size, ctx.citations.length, "citation ids must be unique");
  assert.ok(calls.some(([name]) => name === "getLawArticle"), "must fetch inferred law articles");
  assert.ok(calls.some(([name]) => name === "searchAiLaw"), "must search semantic law articles");
  assert.ok(calls.some(([name]) => name === "searchLaw"), "must search law names");
  assert.ok(calls.some(([name]) => name === "searchPrecedents"), "must search precedents");
  assert.ok(ctx.citations.some((item) => item.citationId.startsWith("AI-L")), "must include AI law result citation");
  assert.ok(ctx.citations.some((item) => item.sourceType === "law_precedent"), "must include precedent citation");
  assert.match(ctx.contextText, /건축법/);
  assert.match(ctx.contextText, /위반건축물 시정명령 취소/);
}

function testLawSearchModeFlags() {
  const forced = resolveChatModeFlags({
    lawSearchMode: true,
    prompt: "민법 제750조 검색해줘",
    notebookId: "nb_1",
    documents: [{ id: "doc_1" }]
  });
  assert.equal(forced.isLawSearchMode, true);
  assert.equal(forced.forceWebSearch, false, "law-search mode must suppress explicit web search routing");
  assert.equal(forced.allowWebSearch, false, "law-search mode must suppress ambient web search");
  assert.equal(forced.shouldLoadNotebookContext, false, "law-search mode must not inject notebook context");

  const normal = resolveChatModeFlags({
    lawSearchMode: false,
    prompt: "민법 제750조 검색해줘",
    notebookId: null,
    documents: []
  });
  assert.equal(normal.forceWebSearch, false, "normal chat must route legal search prompts to Korea Law Engine before web search");

  const web = resolveChatModeFlags({
    lawSearchMode: false,
    prompt: "네이버에서 서울 날씨 검색해줘",
    notebookId: null,
    documents: []
  });
  assert.equal(web.forceWebSearch, true, "normal chat still honors non-legal explicit web-search prompts");
}

async function testLawWorkbenchAggregation() {
  const { buildLawWorkbench } = await import("../server/law/lawWorkbench.js");
  const calls = [];
  const fakeClient = {
    async getLawArticle(input) {
      calls.push(["getLawArticle", input]);
      return {
        ok: true,
        text: "Article body",
        citation: {
          citationId: "L1",
          sourceType: "law",
          lawName: input.lawName,
          article: input.article,
          canonical: `${input.lawName}/${input.article}`,
          title: "Article title",
          locator: `${input.lawName} ${input.article}`,
          url: "https://law.test/article"
        }
      };
    },
    async searchAnnexes(input) {
      calls.push(["searchAnnexes", input]);
      return { ok: true, results: [{ title: "Form A", annexNo: "1", lawName: "Test Act", mst: "10" }] };
    },
    async getLawHistory() {
      calls.push(["getLawHistory"]);
      return { ok: true, revisions: [{ effectiveDate: "2024-01-01", revisionType: "amended" }] };
    },
    async getThreeTier() {
      calls.push(["getThreeTier"]);
      return { ok: true, tiers: [{ level: "law", lawName: "Test Act" }] };
    },
    async getDelegatedLaws() {
      calls.push(["getDelegatedLaws"]);
      return { ok: true, links: [{ title: "Delegated Rule" }] };
    },
    async searchOrdinances() {
      calls.push(["searchOrdinances"]);
      return { ok: true, results: [{ title: "Seoul Ordinance", region: "서울특별시", ordinId: "O1" }] };
    },
    async searchPrecedents(input) {
      calls.push(["searchPrecedents", input]);
      return { ok: true, results: [{ title: "Precedent", caseNumber: "2024다1", precId: "P1" }] };
    },
    async searchInterpretations(input) {
      calls.push(["searchInterpretations", input]);
      return { ok: true, results: [{ title: "Interpretation", expcId: "I1" }] };
    },
    async searchAdminRules(input) {
      calls.push(["searchAdminRules", input]);
      return { ok: true, results: [{ title: "Admin Rule", admrulId: "R1" }] };
    }
  };

  const result = await buildLawWorkbench({
    lawName: "Test Act",
    article: "제1조",
    query: "uploaded policy",
    region: "서울특별시",
    materialText: "policy says Article body",
    includeInternalImpact: true
  }, { client: fakeClient });

  assert.equal(result.ok, true);
  assert.equal(result.article.text, "Article body");
  assert.equal(result.annexes.items.length, 1);
  assert.equal(result.history.revisions.length, 1);
  assert.equal(result.structure.ok, true);
  assert.equal(result.delegated.ok, true);
  assert.equal(result.ordinances.items[0].title, "Seoul Ordinance");
  assert.equal(result.decisions.precedents.items.length, 1);
  assert.equal(result.decisions.interpretations.items.length, 1);
  assert.equal(result.decisions.adminRules.items.length, 1);
  assert.equal(result.decisions.precedents.items[0].title, "Precedent");
  assert.equal(result.decisions.precedents.items[0].precId, "P1");
  assert.match(result.decisions.precedents.items[0].url, /precInfoP\.do/);
  assert.equal(result.decisions.interpretations.items[0].title, "Interpretation");
  assert.equal(result.decisions.interpretations.items[0].expcId, "I1");
  assert.match(result.decisions.interpretations.items[0].url, /expcInfoP\.do/);
  assert.equal(result.decisions.adminRules.items[0].title, "Admin Rule");
  assert.equal(result.decisions.adminRules.items[0].admrulId, "R1");
  assert.match(result.decisions.adminRules.items[0].url, /admRulInfoP\.do/);
  assert.equal(result.internalImpact.impactMap.mode, "impact_map");
  assert.ok(result.citations.some((item) => item.sourceType === "law"));
  assert.ok(calls.some(([name]) => name === "getLawArticle"));
  const annexCall = calls.find(([name]) => name === "searchAnnexes");
  assert.deepEqual(annexCall[1], { lawName: "Test Act", query: "Test Act", display: 8 });
  for (const source of ["searchPrecedents", "searchInterpretations", "searchAdminRules"]) {
    const call = calls.find(([name]) => name === source);
    assert.ok(call, `${source} must be called`);
    assert.equal(call[1].display, 5);
    assert.ok(String(call[1].query || "").trim(), `${source} must receive a concrete query`);
  }
}

async function testLawWorkbenchNaturalQueryOnly() {
  const { buildLawWorkbench } = await import("../server/law/lawWorkbench.js");
  let annexCalled = false;
  let articleCall = null;
  const result = await buildLawWorkbench({
    query: "전세금 못 받음"
  }, {
    client: {
      async getLawArticle(input) {
        articleCall = input;
        return {
          ok: true,
          text: "임대차가 종료된 후 보증금을 반환받지 못한 임차인은 임차권등기명령을 신청할 수 있다.",
          citation: {
            citationId: "L1",
            sourceType: "law",
            lawName: input.lawName,
            article: input.article,
            canonical: `${input.lawName}/${input.article}`,
            locator: `${input.lawName} ${input.article}`
          }
        };
      },
      async searchAnnexes() {
        annexCalled = true;
        return { ok: true, results: [] };
      },
      async getLawHistory() {
        return { ok: true, revisions: [] };
      },
      async getThreeTier() {
        return { ok: true, tiers: [] };
      },
      async getDelegatedLaws() {
        return { ok: true, links: [] };
      },
      async searchOrdinances() {
        return { ok: true, results: [] };
      },
      async searchPrecedents() {
        return { ok: true, results: [{ title: "임대차보증금 반환 판례", caseNumber: "2024다1" }] };
      },
      async searchInterpretations() {
        return { ok: true, results: [] };
      },
      async searchAdminRules() {
        return { ok: true, results: [] };
      }
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(articleCall, { lawName: "주택임대차보호법", article: "제3조의3" });
  assert.equal(result.article.ok, true);
  assert.match(result.article.text, /임차권등기명령/);
  assert.equal(result.input.resolvedLawName, "주택임대차보호법");
  assert.equal(annexCalled, true);
  assert.equal(result.decisions.precedents.items.length, 1);
  assert.ok(result.termMatches.some((item) => item.canonicalTerms.includes("임대차보증금 반환")));
}

async function testLawWorkbenchCaseNumberQuery() {
  const { buildDecisionSearchQueries, extractCaseNumbers } = await import("../server/law/lawWorkbench.js");
  const query = "공문서(전자공문서 포함)는 결재권자가 서명 등의 방법으로 결재함으로써 성립하는지 여부 (판례 정보) 대법원 2015도19296 판결";
  assert.deepEqual(extractCaseNumbers(query), ["2015도19296"]);
  assert.deepEqual(extractCaseNumbers("대법원 2015 도 19296 판결"), ["2015도19296"]);
  const queries = buildDecisionSearchQueries(query);
  assert.equal(queries[0], "2015도19296", "explicit case number must be the first decision search query");
}

function testResolveNumCtxScalesWithPrompt() {
  // 짧은 일반 대화는 기본(작은) 창을 유지해 메모리/속도를 아낀다.
  const small = resolveNumCtx([{ role: "system", content: "짧은 시스템" }, { role: "user", content: "안녕" }]);
  assert.equal(small, 4096, `small prompt should keep base window (got ${small})`);
  // 대형 법령 컨텍스트(≈24k자)는 기본 창을 넘으므로 창을 키워 잘림을 방지한다.
  const large = resolveNumCtx([{ role: "system", content: "가".repeat(24000) }, { role: "user", content: "질의" }]);
  assert.ok(large >= 16384, `large law context must grow the context window (got ${large})`);
  assert.ok(large <= 32768, `context window must stay bounded (got ${large})`);
}

async function testLawWorkbenchNaturalQueryKeywords() {
  const { buildDecisionSearchQueries, extractContentKeywords } = await import("../server/law/lawWorkbench.js");
  // 사용자가 실제로 입력한 자연어 질의 (사건번호 없음). 법리를 서술한 문장이다.
  const query = "공문서(전자공문서 포함)는 결재권자가 서명 등의 방법으로 결재함으로써 성립하는지 여부";
  const keywords = extractContentKeywords(query);
  // 조사/괄호/필러가 제거되고 핵심 명사 어간만 남아야 한다.
  for (const expected of ["공문서", "전자공문서", "결재권자", "서명", "결재", "성립"]) {
    assert.ok(keywords.includes(expected), `keyword "${expected}" must be extracted (got ${keywords.join(",")})`);
  }
  assert.ok(!keywords.includes("포함"), "filler noun 포함 must be dropped");
  assert.ok(!keywords.includes("여부"), "filler noun 여부 must be dropped");
  const queries = buildDecisionSearchQueries(query);
  // 첫 후보는 핵심 키워드 본문 AND 검색이어야 한다 (사건명만으로는 매칭 불가).
  assert.ok(queries[0].includes("공문서") && queries[0].includes("결재권자"), `first query must combine core keywords (got "${queries[0]}")`);
  assert.ok(!queries[0].includes("("), "keyword query must not contain raw punctuation");
}

async function testLawWorkbenchPrecedentUsesFullTextSearch() {
  const { buildLawWorkbench } = await import("../server/law/lawWorkbench.js");
  const precedentCalls = [];
  await buildLawWorkbench({
    query: "공문서(전자공문서 포함)는 결재권자가 서명 등의 방법으로 결재함으로써 성립하는지 여부"
  }, {
    client: {
      async getLawArticle() { return { ok: false }; },
      async searchAnnexes() { return { ok: true, results: [] }; },
      async getLawHistory() { return { ok: true, revisions: [] }; },
      async getThreeTier() { return { ok: true, tiers: [] }; },
      async getDelegatedLaws() { return { ok: true, links: [] }; },
      async searchOrdinances() { return { ok: true, results: [] }; },
      async searchPrecedents(input) {
        precedentCalls.push(input);
        return { ok: false, results: [] };
      },
      async searchInterpretations() { return { ok: true, results: [] }; },
      async searchAdminRules() { return { ok: true, results: [] }; }
    }
  });
  assert.ok(precedentCalls.length > 0, "precedent search must run");
  // 키워드(비-사건번호) 후보는 본문 검색(search=2)으로 조회되어야 한다.
  assert.ok(
    precedentCalls.every((call) => call.search === 2),
    `keyword precedent searches must use full-text scope (search=2); got ${JSON.stringify(precedentCalls.map((c) => c.search))}`
  );
}

async function testLawWorkbenchExplicitLawStillSearchesAiCandidates() {
  const { buildLawWorkbench } = await import("../server/law/lawWorkbench.js");
  const calls = [];
  const result = await buildLawWorkbench({
    query: "행정처분 사전통지 절차 검토",
    lawName: "행정절차법",
    article: "제21조"
  }, {
    client: {
      async searchAiLaw(input) {
        calls.push(["searchAiLaw", input]);
        return {
          ok: true,
          results: [
            {
              lawName: "행정절차법",
              articleNo: "21",
              articleTitle: "처분의 사전 통지",
              snippet: "행정청은 당사자에게 처분의 제목 등을 미리 통지하여야 한다."
            }
          ]
        };
      },
      async getLawArticle(input) {
        calls.push(["getLawArticle", input]);
        return {
          ok: true,
          text: "행정청은 당사자에게 처분의 제목 등을 미리 통지하여야 한다.",
          citation: {
            citationId: "L1",
            sourceType: "law",
            lawName: input.lawName,
            article: input.article,
            canonical: `${input.lawName}/${input.article}`,
            locator: `${input.lawName} ${input.article}`
          }
        };
      },
      async searchAnnexes() { return { ok: true, results: [] }; },
      async getLawHistory() { return { ok: true, revisions: [] }; },
      async getThreeTier() { return { ok: true, tiers: [] }; },
      async getDelegatedLaws() { return { ok: true, links: [] }; },
      async searchOrdinances() { return { ok: true, results: [] }; },
      async searchPrecedents() { return { ok: true, results: [] }; },
      async searchInterpretations() { return { ok: true, results: [] }; },
      async searchAdminRules() { return { ok: true, results: [] }; }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.article.ok, true);
  assert.equal(result.aiCandidates.ok, true);
  assert.equal(result.aiCandidates.items[0].lawName, "행정절차법");
  assert.ok(calls.some(([name]) => name === "searchAiLaw"), "explicit law input should still populate related article candidates");
  assert.deepEqual(
    calls.find(([name]) => name === "getLawArticle")[1],
    { lawName: "행정절차법", article: "제21조" },
    "explicit article lookup must not be overridden by the candidate search"
  );
}

async function testLawWorkbenchPartialFailure() {
  const { buildLawWorkbench } = await import("../server/law/lawWorkbench.js");
  const result = await buildLawWorkbench({
    lawName: "Test Act",
    article: "제1조",
    query: "failure isolation"
  }, {
    client: {
      async getLawArticle(input) {
        return {
          ok: true,
          text: "Article body",
          citation: {
            citationId: "L1",
            sourceType: "law",
            lawName: input.lawName,
            article: input.article,
            canonical: `${input.lawName}/${input.article}`,
            locator: `${input.lawName} ${input.article}`
          }
        };
      },
      async searchAnnexes() { throw new Error("annex unavailable"); },
      async getLawHistory() { return { ok: true, revisions: [] }; },
      async getThreeTier() { return { ok: true, tiers: [] }; },
      async getDelegatedLaws() { return { ok: true, links: [] }; },
      async searchOrdinances() { return { ok: true, results: [] }; },
      async searchPrecedents() { return { ok: true, results: [] }; },
      async searchInterpretations() { return { ok: true, results: [] }; },
      async searchAdminRules() { return { ok: true, results: [] }; }
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.article.text, "Article body");
  assert.equal(result.annexes.ok, false);
  assert.ok(result.warnings.some((item) => item.source === "annexes"));
  assert.ok(result.errors.some((item) => item.source === "annexes"));
}

async function testLawWorkbenchReport() {
  const { buildLawWorkbenchReport } = await import("../server/law/lawWorkbench.js");
  const report = buildLawWorkbenchReport({
    templateId: "ordinance_upper_law_review",
    workbench: {
      input: { query: "ordinance review", lawName: "Test Act", article: "제1조" },
      article: { text: "Article body", citation: { citationId: "L1", locator: "Test Act 제1조" } },
      annexes: { items: [{ title: "Form A", annexNo: "1" }] },
      structure: { tiers: [{ level: "law", lawName: "Test Act" }] },
      delegated: { items: [{ title: "Delegated Rule" }] },
      ordinances: { items: [{ title: "Seoul Ordinance" }] },
      decisions: {
        precedents: { items: [{ title: "Precedent" }] },
        interpretations: { items: [{ title: "Interpretation" }] },
        adminRules: { items: [{ title: "Admin Rule" }] }
      },
      internalImpact: { summary: "Internal material may conflict." },
      citations: [{ citationId: "L1", sourceType: "law", locator: "Test Act 제1조" }],
      warnings: [{ source: "annexes", message: "partial" }]
    }
  });

  assert.equal(report.ok, true);
  assert.equal(report.recommendedTemplateId, "ordinance_upper_law_review");
  const sequence = [
    "## 1. 질문/업로드 문서 요약",
    "## 2. 관련 법령 조문",
    "## 3. 별표/서식",
    "## 4. 시행령/시행규칙",
    "## 5. 자치법규",
    "## 6. 판례/해석례/결정례",
    "## 7. 내부자료 충돌 여부",
    "## 8. 검토의견서 초안"
  ];
  let previous = -1;
  for (const heading of sequence) {
    const index = report.markdown.indexOf(heading);
    assert.ok(index > previous, `missing or out of order: ${heading}`);
    previous = index;
  }
  assert.deepEqual(report.citations, [{ citationId: "L1", sourceType: "law", locator: "Test Act 제1조" }]);
  assert.ok(report.metadata.lawWorkbench);
  assert.ok(report.warnings.length);
}

async function testLawWorkbenchReviewPayload() {
  const { buildLawWorkbenchReviewPrompt } = await import("../server/law/lawWorkbenchReview.js");
  const payload = buildLawWorkbenchReviewPrompt({
    query: "Check policy",
    conditions: {
      reviewType: "privacy",
      outputType: "law_review_opinion",
      detail: "Focus on consent"
    },
    workbench: {
      article: { ok: true, text: "Article body", citation: { citationId: "L1", locator: "Test Act Article 1" } },
      decisions: { precedents: { items: [{ title: "Case A" }] } }
    },
    documents: [
      { fileName: "policy.txt", summary: "Policy summary", text: "The policy text mentions consent." }
    ]
  });

  assert.match(payload, /Check policy/);
  assert.match(payload, /Focus on consent/);
  assert.match(payload, /Test Act Article 1/);
  assert.match(payload, /Article body/);
  assert.match(payload, /Case A/);
  assert.match(payload, /policy.txt/);
  assert.match(payload, /The policy text mentions consent/);
}

async function testLawWorkbenchReviewNormalizesKoreanKeys() {
  const { normalizeReviewResult } = await import("../server/law/lawWorkbenchReview.js");
  const result = normalizeReviewResult({
    reviewResult: {
      "요약": "검토 요약 A",
      "핵심 쟁점": ["쟁점 A"],
      "확인된 사실": ["사실 A"],
      "적용 법령 및 근거": ["근거 A [L1]"],
      "검토 의견": ["의견 A"],
      "리스크": ["리스크 A"],
      "보완 권고": ["권고 A"],
      "추가 확인 필요": ["추가확인 A"],
      "검토의견 초안": "초안 A",
      "고지": "고지 A"
    }
  });

  assert.equal(result.summary, "검토 요약 A");
  assert.deepEqual(result.issues, ["쟁점 A"]);
  assert.deepEqual(result.facts, ["사실 A"]);
  assert.deepEqual(result.legalGrounds, ["근거 A [L1]"]);
  assert.deepEqual(result.analysis, ["의견 A"]);
  assert.deepEqual(result.risks, ["리스크 A"]);
  assert.deepEqual(result.recommendations, ["권고 A"]);
  assert.deepEqual(result.missingEvidence, ["추가확인 A"]);
  assert.equal(result.draftOpinion, "초안 A");
  assert.equal(result.disclaimer, "고지 A");
}

async function testLawWorkbenchReportUsesReviewResult() {
  const { buildLawWorkbenchReport } = await import("../server/law/lawWorkbench.js");
  const report = buildLawWorkbenchReport({
    templateId: "law_review_opinion",
    reviewResult: {
      summary: "LLM summary",
      issues: ["Issue A"],
      facts: ["Fact A"],
      legalGrounds: ["Ground A [L1]"],
      analysis: ["Analysis A"],
      risks: ["Risk A"],
      recommendations: ["Recommendation A"],
      missingEvidence: ["Missing A"],
      draftOpinion: "Draft opinion A",
      disclaimer: "Working draft only"
    },
    workbench: {
      input: { query: "report from review result" },
      citations: [{ citationId: "L1", sourceType: "law", locator: "Test Act Article 1" }]
    }
  });

  assert.equal(report.ok, true);
  assert.match(report.markdown, /LLM summary/);
  assert.match(report.markdown, /Issue A/);
  assert.match(report.markdown, /Draft opinion A/);
  assert.match(report.markdown, /Working draft only/);
  assert.deepEqual(report.citations, [{ citationId: "L1", sourceType: "law", locator: "Test Act Article 1" }]);
}

async function testLawTermKbExpansion() {
  const { searchLawTerms, expandQueryWithLawTerms } = await import("../server/law/lawTermKb.js");
  const matches = searchLawTerms("전세금 못 받음");
  assert.equal(matches[0].scenario, "lease_deposit");
  assert.ok(matches[0].canonicalTerms.includes("임대차보증금 반환"));
  assert.ok(matches[0].canonicalTerms.includes("임차권등기명령"));

  const expanded = expandQueryWithLawTerms("전세금 못 받음 어떻게 해?");
  assert.ok(expanded.includes("임대차보증금 반환"));
  assert.ok(expanded.includes("임차권등기명령"));
  assert.ok(expanded.length > "전세금 못 받음 어떻게 해?".length);
}

async function testTimeTravelFullLaw() {
  const fakeClient = {
    async getLawText(input) {
      const oldText = "제1조 목적\n이 법은 개인정보의 처리 및 보호를 목적으로 한다.";
      const newText = "제1조 목적\n이 법은 개인정보의 처리와 안전한 활용을 목적으로 한다.\n제2조 정의";
      return {
        ok: true,
        cacheHit: false,
        text: input.effectiveDate === "2020-01-01" ? oldText : newText,
        citation: {
          citationId: "L1",
          sourceType: "law",
          lawName: "개인정보 보호법",
          canonical: "개인정보 보호법/full-text",
          locator: "개인정보 보호법 full text",
          effectiveDate: input.effectiveDate,
          url: "https://www.law.go.kr/lsInfoP.do?lsiSeq=1"
        },
        snapshotEffectiveDate: input.effectiveDate
      };
    }
  };
  const result = await runTimeTravel({
    query: "개인정보 보호법",
    fromDate: "2020-01-01",
    toDate: "2025-11-01"
  }, { client: fakeClient });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "time_travel");
  assert.equal(result.scope, "law");
  assert.ok(result.diff.hunks.length >= 2);
  assert.equal(result.from.effectiveDate, "2020-01-01");
  assert.equal(result.to.effectiveDate, "2025-11-01");
}

async function testLawToolRegistry() {
  assert.ok(listLawTools({ query: "time" }).some((tool) => tool.name === "time_travel"));

  const result = await executeLawTool({
    toolName: "chain_full_research",
    params: { query: "전세금 못 받았어", scenario: "action_plan" }
  }, {
    client: {
      async searchAiLaw(input) {
        if (input.searchType === 0) {
          return {
            ok: true,
            results: [
              {
                lawName: "주택임대차보호법",
                articleNo: "제3조의2",
                articleTitle: "보증금의 회수",
                snippet: "보증금 반환 관련 조문",
                effectiveDate: "2024-01-01"
              }
            ]
          };
        }
        return { ok: true, results: [] };
      },
      async searchLaw() { return { ok: true, results: [] }; },
      async searchAdminRules() { return { ok: true, results: [] }; },
      async searchPrecedents() { return { ok: true, results: [] }; },
      async searchInterpretations() { return { ok: true, results: [] }; },
      async searchOrdinances() { return { ok: true, results: [] }; }
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.mode, "action_plan");
  assert.ok(result.citations.length >= 1);

  const unknown = await executeLawTool({ toolName: "no_such_tool", params: {} }, {});
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, "UNKNOWN_LAW_TOOL");
}

function createTestLawApiClient() {
  return new LawApiClient({
    enabled: true,
    configured: true,
    apiKey: "TEST-LAW",
    apiProvider: "test",
    searchUrl: "https://example.test/search",
    serviceUrl: "https://example.test/service",
    timeoutMs: 1000,
    userAgent: "myai-test",
    maxResults: 10
  });
}

async function testAnnexDetailSelectorChoosesAnnexNo() {
  const client = createTestLawApiClient();
  const calls = [];
  client.requestSearch = async (params) => {
    calls.push(["search", params]);
    return {
      items: [
        { title: "Schedule 1", annexNo: "1", lawName: "Test Act", lawId: "LAW1", mst: "100" },
        { title: "Schedule 3", annexNo: "3", lawName: "Test Act", lawId: "LAW1", mst: "300" }
      ]
    };
  };
  client.requestService = async (params) => {
    calls.push(["detail", params]);
    assert.equal(params.MST, "300");
    return {
      title: "Schedule 3",
      annexNo: "3",
      lawName: "Test Act",
      mst: "300",
      content: "selected schedule 3 text"
    };
  };

  const result = await client.getAnnexDetail({
    lawName: "Test Act",
    annexNo: "Schedule 3"
  });
  assert.equal(result.ok, true);
  assert.equal(result.citation.title, "Schedule 3");
  assert.equal(result.selection.method, "selector");
  assert.equal(result.selection.ambiguous, false);
  assert.match(result.text, /selected schedule 3 text/);
  assert.ok(calls.some(([name]) => name === "search"));
}

async function testAnnexDetailSelectorAmbiguous() {
  const client = createTestLawApiClient();
  client.requestSearch = async () => ({
    items: [
      { title: "Schedule 3 Safety", annexNo: "3", lawName: "Test Act", lawId: "LAW1", mst: "300" },
      { title: "Schedule 3 Health", annexNo: "3", lawName: "Test Act", lawId: "LAW1", mst: "301" }
    ]
  });
  client.requestService = async () => {
    throw new Error("Ambiguous annex selection must not fetch detail");
  };

  await assert.rejects(
    () => client.getAnnexDetail({ lawName: "Test Act", annexNo: "3" }),
    (error) => {
      assert.equal(error.marker, "ANNEX_AMBIGUOUS");
      assert.equal(error.candidates.length, 2);
      return true;
    }
  );
}

async function testLawCache() {
  const keyA = buildLawCacheKey("article_detail", { lawName: "민법", article: "제750조" });
  const keyB = buildLawCacheKey("article_detail", { article: "제750조", lawName: "민법" });
  assert.equal(keyA, keyB);

  await setCachedLawResponse(keyA, { ok: true, text: "cached" }, { ttlMs: 60_000, lastModified: "20260510" });
  assert.equal((await getCachedLawResponse(keyA, { lastModified: "20260510" })).text, "cached");
  assert.equal(await getCachedLawResponse(keyA, { lastModified: "20260511" }), null);
}

function testLawAliasResolution() {
  // Test safety/labor law aliases
  assert.equal(normalizeLawName("산안법"), "산업안전보건법");
  assert.equal(normalizeLawName("산안기준규칙"), "산업안전보건기준에 관한 규칙");
  assert.equal(normalizeLawName("안전보건규칙"), "산업안전보건기준에 관한 규칙");
  assert.equal(normalizeLawName("중처법"), "중대재해 처벌 등에 관한 법률");
  assert.equal(normalizeLawName("근기법"), "근로기준법");
  assert.equal(normalizeLawName("산재법"), "산업재해보상보험법");

  // Test resolveAliasedLawName direct call
  assert.equal(resolveAliasedLawName("산안법"), "산업안전보건법");
  assert.equal(resolveAliasedLawName("산업안전보건법"), "산업안전보건법");

  // Test non-aliased names pass through
  assert.equal(normalizeLawName("개인정보 보호법"), "개인정보 보호법");
  assert.equal(normalizeLawName("도로교통법"), "도로교통법");
}

function testTopicSearchIntent() {
  // Test that explicit legal pattern + topic (no law suffix) triggers law_topic_search
  const topicIntent = detectLawIntent("법령에서 밀폐공간 작업 찾아");
  assert.equal(topicIntent.isLegalQuery, true, "explicit pattern should trigger legal query");
  assert.equal(topicIntent.mode, "law_topic_search", "topic without law suffix should be law_topic_search");

  // Verify alias resolution happens in normalizeLawName()
  assert.equal(normalizeLawName("산안법"), "산업안전보건법", "normalizeLawName should resolve alias");
  assert.equal(normalizeLawName("중처법"), "중대재해 처벌 등에 관한 법률", "multiple aliases should be supported");
}

function testConfinedSpaceTopicHints() {
  const prompt = "밀폐공간 작업이라는 주제와 관련있는 법령, 판례, 조문 등을 가능한 모두 조사해줘.";
  assert.equal(buildLawTopicSearchQuery(prompt), "밀폐공간 작업 산업안전보건기준에 관한 규칙 산업안전보건법");
  const refs = inferLawArticleRefsForTopic(prompt);
  assert.ok(
    refs.some((ref) => ref.lawName === "산업안전보건기준에 관한 규칙" && ref.article === "제618조"),
    "should infer the confined-space definition article"
  );
  assert.ok(
    refs.some((ref) => ref.lawName === "산업안전보건기준에 관한 규칙" && ref.article === "제619조"),
    "should infer the confined-space work program article"
  );
  assert.ok(
    refs.some((ref) => ref.lawName === "산업안전보건법" && ref.article === "제39조"),
    "should infer the Industrial Safety and Health Act health-measures article"
  );
}

function testParseAiSearchXml() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<aiSearch>
  <검색결과개수>2</검색결과개수>
  <법령조문>
    <법령ID>123</법령ID>
    <법령명>산업안전보건기준에 관한 규칙</법령명>
    <조문번호>619</조문번호>
    <조문제목>정의</조문제목>
    <조문내용>"밀폐공간"이란 산소결핍, 유해가스로 인한 건강장해를 일으킬 수 있는 장소를 말한다.</조문내용>
    <시행일자>20240101</시행일자>
  </법령조문>
  <법령조문>
    <법령ID>124</법령ID>
    <법령명>산업안전보건법</법령명>
    <조문번호>38</조문번호>
    <조문제목>안전조치</조문제목>
    <조문내용>사업주는 근로자가 작업장에서 안전하게 작업할 수 있도록 조치하여야 한다.</조문내용>
    <시행일자>20240701</시행일자>
  </법령조문>
</aiSearch>`;
  const parsed = parseAiSearchXml(xml);
  assert.ok(parsed.aiSearch, "should produce aiSearch root");
  const results = normalizeAiSearchResults(parsed);
  assert.equal(results.length, 2, "should extract two 법령조문 entries");
  assert.equal(results[0].lawName, "산업안전보건기준에 관한 규칙");
  assert.equal(results[0].articleNo, "619");
  assert.equal(results[0].articleTitle, "정의");
  assert.ok(results[0].snippet.includes("밀폐공간"), "snippet should preserve content");
  assert.equal(results[1].lawName, "산업안전보건법");
  assert.equal(results[1].articleNo, "38");
}

function testParseAiSearchXmlWithAttributes() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<aiSearch>
  <target>aiSearch</target>
  <키워드>밀폐공간</키워드>
  <검색결과개수>1</검색결과개수>
  <법령조문 id="1">
    <법령일련번호>280187</법령일련번호>
    <법령ID>007363</법령ID>
    <법령명><![CDATA[산업안전보건기준에 관한 규칙]]></법령명>
    <시행일자>20251201121200</시행일자>
    <법령종류명>고용노동부령</법령종류명>
    <조문번호>0619</조문번호>
    <조문가지번호>00</조문가지번호>
    <조문제목><![CDATA[밀폐공간 작업 프로그램의 수립ㆍ시행]]></조문제목>
    <조문내용><![CDATA[① 사업주는 밀폐공간에서 근로자에게 작업을 하도록 하는 경우 밀폐공간 작업 프로그램을 수립하여 시행하여야 한다.]]></조문내용>
  </법령조문>
</aiSearch>`;
  const parsed = parseAiSearchXml(xml);
  const results = normalizeAiSearchResults(parsed);
  assert.equal(results.length, 1, "should extract attributed 법령조문 entry");
  assert.equal(results[0].lawName, "산업안전보건기준에 관한 규칙");
  assert.equal(results[0].articleNo, "0619");
  assert.equal(results[0].articleCanonical, "제619조", "zero-padded 조문번호 must format into a valid 한글주소 article (제619조)");
  assert.equal(results[0].recordKind, "law", "법령조문 block must be tagged as a statute record");
  assert.equal(results[0].articleTitle, "밀폐공간 작업 프로그램의 수립ㆍ시행");
  assert.ok(results[0].snippet.includes("밀폐공간"), "snippet should preserve law.go.kr CDATA content");
}

function testParseAiSearchXmlError() {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <result>사용자 정보 검증에 실패하였습니다.</result>
  <msg>OPEN API 호출 시 사용자 검증을 위하여 정확한 서버장비의 IP주소 및 도메인주소를 등록해 주세요.</msg>
</Response>`;
  const parsed = parseAiSearchXml(xml);
  assert.equal(parsed.result, "사용자 정보 검증에 실패하였습니다.", "should extract error result");
  assert.ok(parsed.msg && parsed.msg.includes("IP주소"), "should extract error msg");
  const upstream = findUpstreamError(parsed);
  assert.ok(upstream && upstream.length > 0, "findUpstreamError should detect failure");
}

function testParseAiSearchXmlAdmin() {
  const xml = `<aiSearch>
  <행정규칙조문>
    <행정규칙ID>456</행정규칙ID>
    <행정규칙명>밀폐공간 작업의 안전에 관한 고시</행정규칙명>
    <발령기관명>고용노동부</발령기관명>
    <조문번호>5</조문번호>
    <조문제목>작업절차</조문제목>
    <조문내용>밀폐공간 작업 전 산소 및 유해가스 농도를 측정하여야 한다.</조문내용>
    <시행일자>20230101</시행일자>
  </행정규칙조문>
</aiSearch>`;
  const parsed = parseAiSearchXml(xml);
  const results = normalizeAiSearchResults(parsed);
  assert.equal(results.length, 1, "should extract 행정규칙조문 entry via 행정규칙명 key");
  assert.equal(results[0].lawName, "밀폐공간 작업의 안전에 관한 고시");
  assert.equal(results[0].articleNo, "5");
  assert.ok(results[0].snippet.includes("산소"), "snippet should preserve content");
}
