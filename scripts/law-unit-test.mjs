import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "myai-law-test-"));
process.env.LAW_OC = "SECRET-LAW-KEY";
process.env.LAW_CACHE_PATH = path.join(tempDir, "law-cache.sqlite");

const {
  normalizeArticleRef,
  normalizeLawCitationParts,
  parseArticleLocator,
  extractLawCitations
} = await import("../server/law/lawArticleRef.js");
const { detectLawIntent } = await import("../server/law/lawIntent.js");
const { maskLawSecrets } = await import("../server/law/lawConfig.js");
const { stripLawPrivateFields } = await import("../server/law/lawApiClient.js");
const { normalizeLawCitationForMeta } = await import("../server/law/lawCitationFormatter.js");
const { buildImpactMap, createDeterministicImpactMap } = await import("../server/law/tools/impactMap.js");
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

async function testLawCache() {
  const keyA = buildLawCacheKey("article_detail", { lawName: "민법", article: "제750조" });
  const keyB = buildLawCacheKey("article_detail", { article: "제750조", lawName: "민법" });
  assert.equal(keyA, keyB);

  await setCachedLawResponse(keyA, { ok: true, text: "cached" }, { ttlMs: 60_000, lastModified: "20260510" });
  assert.equal((await getCachedLawResponse(keyA, { lastModified: "20260510" })).text, "cached");
  assert.equal(await getCachedLawResponse(keyA, { lastModified: "20260511" }), null);
}
