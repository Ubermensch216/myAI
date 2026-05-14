import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "myai-law-test-"));
process.env.LAW_OC = "SECRET-LAW-KEY";
process.env.LAW_CACHE_PATH = path.join(tempDir, "law-cache.sqlite");

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
const { normalizeLawCitationForMeta, disclaimerForLawMode } = await import("../server/law/lawCitationFormatter.js");
const { buildLawContext, ACTION_PLAN_TEMPLATE } = await import("../server/law/lawContextBuilder.js");
const { buildImpactMap, createDeterministicImpactMap } = await import("../server/law/tools/impactMap.js");
const { getArticleAt } = await import("../server/law/tools/articleAt.js");
const { getArticleDiff } = await import("../server/law/tools/articleDiff.js");
const { bigramSimilarity, computeArticleDiff } = await import("../server/law/lawDiff.js");
const { getLawHistory } = await import("../server/law/tools/lawHistory.js");
const {
  buildLawCacheKey,
  getCachedLawResponse,
  setCachedLawResponse
} = await import("../server/law/lawCache.js");

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
await run("law name alias resolution (산안법 → 산업안전보건법)", testLawAliasResolution);
await run("law_topic_search intent mode detection", testTopicSearchIntent);

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
