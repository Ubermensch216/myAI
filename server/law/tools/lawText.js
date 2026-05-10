import { getArticleDetail } from "./articleDetail.js";

export async function getLawText(input = {}, options = {}) {
  return getArticleDetail(input, options);
}
