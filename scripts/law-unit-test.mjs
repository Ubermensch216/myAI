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
await run("law cache normalization and invalidation", testLawCache);

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

async function testLawCache() {
  const keyA = buildLawCacheKey("article_detail", { lawName: "민법", article: "제750조" });
  const keyB = buildLawCacheKey("article_detail", { article: "제750조", lawName: "민법" });
  assert.equal(keyA, keyB);

  await setCachedLawResponse(keyA, { ok: true, text: "cached" }, { ttlMs: 60_000, lastModified: "20260510" });
  assert.equal((await getCachedLawResponse(keyA, { lastModified: "20260510" })).text, "cached");
  assert.equal(await getCachedLawResponse(keyA, { lastModified: "20260511" }), null);
}
