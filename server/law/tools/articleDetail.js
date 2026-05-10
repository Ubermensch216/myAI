import { createLawApiClient } from "../lawApiClient.js";
import { parseArticleLocator } from "../lawArticleRef.js";
import { logLawCall } from "../lawLogger.js";

export async function getArticleDetail(input = {}, options = {}) {
  const client = options.client || createLawApiClient();
  const startedAt = Date.now();
  const locator = parseArticleLocator([
    input.article,
    input.paragraph,
    input.item,
    input.subitem
  ].filter(Boolean).join(" "));
  const normalizedInput = {
    ...input,
    article: locator.article.canonical || input.article,
    paragraph: locator.paragraph.number ? locator.paragraph : input.paragraph,
    item: locator.item.number ? locator.item : input.item,
    subitem: locator.subitem.value ? locator.subitem : input.subitem
  };
  try {
    const result = await client.getLawArticle(normalizedInput, options);
    await logLawCall({
      tool: "article_detail",
      normalizedQuery: {
        lawName: normalizedInput.lawName,
        article: locator.article.canonical,
        paragraph: locator.paragraph.canonical,
        item: locator.item.canonical
      },
      latencyMs: Date.now() - startedAt,
      resultCount: result.ok ? 1 : 0,
      cacheHit: result.cacheHit
    });
    return result;
  } catch (error) {
    await logLawCall({
      tool: "article_detail",
      normalizedQuery: {
        lawName: normalizedInput.lawName,
        article: locator.article.canonical,
        paragraph: locator.paragraph.canonical,
        item: locator.item.canonical
      },
      latencyMs: Date.now() - startedAt,
      resultCount: 0,
      cacheHit: false,
      errorMarker: error.marker || "LAW_API_ERROR"
    });
    throw error;
  }
}
