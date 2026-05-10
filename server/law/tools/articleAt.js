import { createLawApiClient } from "../lawApiClient.js";
import { normalizeEffectiveDate, parseArticleLocator } from "../lawArticleRef.js";
import { LawError, LAW_ERROR_MARKERS } from "../lawErrors.js";
import { logLawCall } from "../lawLogger.js";

export async function getArticleAt(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  const effective = normalizeEffectiveDate(input.effectiveDate);
  if (!effective.iso) {
    throw new LawError("effectiveDate (YYYY-MM-DD) is required for time-travel article lookup.", {
      marker: LAW_ERROR_MARKERS.NOT_FOUND,
      statusCode: 400
    });
  }
  const locator = parseArticleLocator([
    input.article,
    input.paragraph,
    input.item,
    input.subitem
  ].filter(Boolean).join(" "));
  const normalizedInput = {
    lawName: input.lawName,
    lawId: input.lawId,
    mst: input.mst,
    article: locator.article.canonical || input.article,
    paragraph: locator.paragraph.number ? locator.paragraph : input.paragraph,
    item: locator.item.number ? locator.item : input.item,
    subitem: locator.subitem.value ? locator.subitem : input.subitem,
    effectiveDate: effective.iso
  };
  const logQuery = {
    lawName: normalizedInput.lawName,
    article: locator.article.canonical,
    paragraph: locator.paragraph.canonical,
    item: locator.item.canonical,
    effectiveDate: effective.iso
  };
  try {
    const result = await client.getLawArticle(normalizedInput, options);
    await logLawCall({
      tool: "article_at",
      normalizedQuery: logQuery,
      latencyMs: Date.now() - startedAt,
      resultCount: result.ok ? 1 : 0,
      cacheHit: result.cacheHit
    });
    return { ...result, effectiveDateRequested: effective.iso };
  } catch (error) {
    await logLawCall({
      tool: "article_at",
      normalizedQuery: logQuery,
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || LAW_ERROR_MARKERS.LAW_API_ERROR
    });
    throw error;
  }
}
