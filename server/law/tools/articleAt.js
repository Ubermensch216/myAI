import { normalizeEffectiveDate, parseArticleLocator } from "../lawArticleRef.js";
import { LawError, LAW_ERROR_MARKERS } from "../lawErrors.js";
import { runLoggedLawTool } from "./toolRunner.js";

export async function getArticleAt(input = {}, options = {}) {
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

  return runLoggedLawTool({
    tool: "article_at",
    options,
    normalizedQuery: logQuery,
    execute: async (client) => {
      const result = await client.getLawArticle(normalizedInput, options);
      return { ...result, effectiveDateRequested: effective.iso };
    },
    errorMarker: (error) => error?.marker || LAW_ERROR_MARKERS.LAW_API_ERROR
  });
}
