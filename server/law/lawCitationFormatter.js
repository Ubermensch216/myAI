export function formatLawContext(citations = []) {
  const usable = Array.isArray(citations) ? citations.filter((item) => item?.text && item?.citation) : [];
  if (!usable.length) return "";
  const lines = [
    "[공식 법령 근거]",
    "Use only this section for statute/article existence and original article text. Cite legal claims with [L1], [L2], etc. Do not invent law names, article numbers, paragraphs, items, precedents, or interpretations."
  ];
  usable.forEach((item) => {
    const citation = item.citation;
    const title = citation.title ? ` ${citation.title}` : "";
    const effective = citation.effectiveDate ? ` 시행일자: ${citation.effectiveDate}` : "";
    lines.push(`[${citation.citationId}] ${citation.locator}${title}${effective}\n${item.text}`);
  });
  return lines.join("\n\n");
}

export function normalizeLawCitationForMeta(citation, index = 0) {
  return {
    citationId: citation.citationId || `L${index + 1}`,
    sourceType: "law",
    lawName: citation.lawName || "",
    lawId: citation.lawId || "",
    mst: citation.mst || "",
    article: citation.article || "",
    canonical: citation.canonical || "",
    title: citation.title || "",
    locator: citation.locator || [citation.lawName, citation.article].filter(Boolean).join(" "),
    effectiveDate: citation.effectiveDate || "",
    url: citation.url || ""
  };
}

export function disclaimerForLawMode(mode) {
  if (mode === "legal_research" || mode === "department_legal_review") return "short";
  if (mode === "action_plan") return "mandatory";
  return null;
}
