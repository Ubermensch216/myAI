import { parseArticleLocator } from "../lawArticleRef.js";
import { runLoggedLawTool } from "./toolRunner.js";

export async function getArticleDetail(input = {}, options = {}) {
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
  const normalizedQuery = {
    lawName: normalizedInput.lawName,
    article: locator.article.canonical,
    paragraph: locator.paragraph.canonical,
    item: locator.item.canonical
  };

  return runLoggedLawTool({
    tool: "article_detail",
    options,
    normalizedQuery,
    execute: (client) => client.getLawArticle(normalizedInput, options)
  });
}
