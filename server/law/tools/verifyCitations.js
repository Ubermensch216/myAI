import { extractLawCitations } from "../lawArticleRef.js";
import { LAW_ERROR_MARKERS } from "../lawErrors.js";
import { getArticleDetail } from "./articleDetail.js";

export async function verifyLawCitations({ text } = {}, options = {}) {
  const citations = extractLawCitations(text);
  const results = [];
  for (const citation of citations) {
    try {
      await getArticleDetail({
        lawName: citation.lawName,
        article: citation.article,
        paragraph: citation.paragraph,
        item: citation.item,
        subitem: citation.subitem
      }, options);
      results.push({
        citation: citation.citation,
        canonical: citation.canonical,
        valid: true,
        reason: "exists"
      });
    } catch (error) {
      results.push({
        citation: citation.citation,
        canonical: citation.canonical,
        valid: false,
        reason: error.marker === LAW_ERROR_MARKERS.NOT_FOUND ? "article_not_found" : error.marker || LAW_ERROR_MARKERS.LAW_API_ERROR
      });
    }
  }
  const passCount = results.filter((item) => item.valid).length;
  const failCount = results.length - passCount;
  return {
    ok: true,
    checked: true,
    passCount,
    failCount,
    results
  };
}
