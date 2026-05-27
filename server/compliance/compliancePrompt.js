import {
  COMPLIANCE_DISCLAIMER,
  COMPLIANCE_FINDING_LABELS,
  COMPLIANCE_MODE,
  getReviewType
} from "./complianceTypes.js";

const UNIFIED_COMPLIANCE_READABILITY_POLICY = [
  "[Unified answer readability policy]",
  "Every compliance answer must follow the app-wide readability policy.",
  "Use Korean plain-text section labels only. Do not add Markdown heading marks, bold markers, emoji, or decorative symbols.",
  "Use compact '- ' bullets inside sections and Markdown tables only where the required compliance template asks for table-like comparison.",
  "Do not override this structure with ad hoc section labels or visual symbols."
].join("\n");

export function buildCompliancePromptBlock({ reviewType = "general", outputStyle = "summary", hasLegalEvidence = false } = {}) {
  const type = getReviewType(reviewType);
  const structure = outputStyle === "detailed_report" ? detailedReportTemplate() : summaryTemplate();
  return [
    "[Compliance Review Instructions]",
    UNIFIED_COMPLIANCE_READABILITY_POLICY,
    "You are performing a public-sector compliance review.",
    `Mode: ${COMPLIANCE_MODE}`,
    `Review type: ${type.label} (${type.id})`,
    `Output style: ${outputStyle}`,
    "Use only the provided internal evidence and official legal evidence.",
    "Separate internal evidence [N] from official legal evidence [L/P/I/R/O] and web evidence [W].",
    "Do not invent statutes, articles, precedents, interpretations, administrative rules, ordinances, or internal document content.",
    "Every risk, compliance gap, or recommendation must cite at least one evidence item.",
    "If evidence is insufficient, say exactly what is missing and use one of the allowed labels.",
    "Do not provide final legal advice. Provide an evidence-based working review draft.",
    `Allowed finding labels: ${COMPLIANCE_FINDING_LABELS.join(", ")}`,
    hasLegalEvidence
      ? "Official legal evidence is available. Cite it for legal propositions."
      : "Official legal evidence is not available or insufficient. You may summarize internal material, but legal compliance judgment must be marked as 판단 보류 or 근거 부족.",
    "",
    structure,
    "",
    `Disclaimer text to include exactly once at the end: ${COMPLIANCE_DISCLAIMER}`
  ].join("\n");
}

export function buildComplianceUnavailableMessage(reason) {
  if (reason === "law_not_configured") {
    return "공식 법령 조회 설정이 없어 법령 적합성 검토를 완료할 수 없습니다. LAW_OC 설정 후 다시 실행하세요.";
  }
  if (reason === "no_internal_material") {
    return "검토할 내부 자료가 필요합니다. 지식팩을 선택하거나 문서를 업로드한 뒤 다시 실행하세요.";
  }
  return "법령 적합성 검토를 진행할 수 없습니다. 필요한 내부 자료와 공식 법령 조회 설정을 확인하세요.";
}

function summaryTemplate() {
  return [
    "Required answer structure:",
    "핵심 요약",
    "- 적합 / 일부 보완 필요 / 추가 확인 필요 / 판단 보류 중 하나로 시작하세요.",
    "- 전체 판단을 3~5개 bullet로 요약하세요.",
    "",
    "주요 근거",
    "- 내부 자료 근거와 공식 법령 근거를 citation으로 분리해 정리하세요.",
    "",
    "세부 내용",
    "| 항목 | 내부 근거 | 법령 근거 | 판단 | 보완 권고 |",
    "| --- | --- | --- | --- | --- |",
    "",
    "주의사항",
    "- 부족한 자료나 추가 확인이 필요한 사항을 적으세요.",
    "",
    "다음 단계",
    "- 보완 권고와 필요한 후속 확인을 적으세요.",
    "",
    "참고 고지"
  ].join("\n");
}

function detailedReportTemplate() {
  return [
    "Required answer structure:",
    "핵심 요약",
    "- 검토 결과, 검토 대상, 사용한 자료, 한계를 요약하세요.",
    "",
    "주요 근거",
    "- 내부 자료에서 확인한 주요 내용을 [N] citation으로 정리하세요.",
    "- 공식 법령, 판례, 해석례, 행정규칙, 자치법규가 제공된 경우에만 [L/P/I/R/O] citation으로 정리하세요.",
    "",
    "세부 내용",
    "| 검토 항목 | 내부 자료 내용 | 공식 근거 | 판단 | 리스크 |",
    "| --- | --- | --- | --- | --- |",
    "",
    "주의사항",
    "- 법률 자문이 아닌 업무 참고용 검토 초안임을 전제로 한계와 판단 보류 사유를 적으세요.",
    "",
    "다음 단계",
    "| 우선순위 | 보완 사항 | 근거 | 제안 문구 |",
    "| --- | --- | --- | --- |",
    "",
    "체크리스트",
    "- [ ] 항목",
    "",
    "참고 고지"
  ].join("\n");
}
