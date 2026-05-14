import { getArticleDetail } from "./articleDetail.js";
import { runLoggedLawTool } from "./toolRunner.js";

export async function getLawText(input = {}, options = {}) {
  const article = input.article || input.jo;
  if (article) {
    return getArticleDetail({ ...input, article }, options);
  }
  return runLoggedLawTool({
    tool: "get_law_text",
    options,
    normalizedQuery: {
      lawName: input.lawName,
      lawId: input.lawId,
      mst: input.mst,
      effectiveDate: input.effectiveDate || input.efYd
    },
    execute: (client) => client.getLawText({
      lawName: input.lawName,
      lawId: input.lawId,
      mst: input.mst,
      effectiveDate: input.effectiveDate || input.efYd
    }, options)
  });
}
