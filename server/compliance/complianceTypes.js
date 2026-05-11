export const COMPLIANCE_MODE = "department_legal_review";

export const COMPLIANCE_DISCLAIMER = "이 검토는 제공된 내부 자료와 공식 법령 정보를 기반으로 한 업무 참고용 검토 초안입니다. 최종 법률 판단은 관련 부서 또는 전문가 검토가 필요합니다.";

export const COMPLIANCE_FINDING_LABELS = [
  "적합",
  "일부 보완 필요",
  "충돌 가능성",
  "근거 부족",
  "추가 확인 필요",
  "판단 보류"
];

export const REVIEW_TYPES = {
  privacy: {
    id: "privacy",
    label: "개인정보",
    title: "개인정보 법령 적합성 검토",
    queryHints: ["개인정보", "수집", "이용", "제공", "위탁", "보유기간", "파기", "안전성 확보조치", "정보주체", "동의"],
    suggestedLawNames: ["개인정보 보호법", "개인정보 보호법 시행령", "개인정보의 안전성 확보조치 기준"],
    patterns: [/개인정보/u, /정보주체/u, /동의/u, /위탁/u, /보유기간/u, /파기/u]
  },
  civil_complaint: {
    id: "civil_complaint",
    label: "민원 답변",
    title: "민원 답변 법령 적합성 검토",
    queryHints: ["민원", "답변", "처분", "통지", "불복", "이의신청", "행정절차", "처리기간", "고지"],
    suggestedLawNames: ["민원 처리에 관한 법률", "행정절차법", "행정심판법"],
    patterns: [/민원/u, /답변/u, /이의신청/u, /불복/u, /처리기간/u]
  },
  contract_outsourcing: {
    id: "contract_outsourcing",
    label: "계약/용역",
    title: "계약/용역 법령 적합성 검토",
    queryHints: ["계약", "용역", "위탁", "수탁자", "보안", "성과물", "개인정보", "손해배상", "비밀유지"],
    suggestedLawNames: ["개인정보 보호법", "국가를 당사자로 하는 계약에 관한 법률", "지방자치단체를 당사자로 하는 계약에 관한 법률", "전자정부법"],
    patterns: [/계약/u, /용역/u, /수탁/u, /위탁/u, /성과물/u, /비밀유지/u]
  },
  audit: {
    id: "audit",
    label: "감사/평가",
    title: "감사 지적사항 법령 적합성 검토",
    queryHints: ["감사", "평가", "증빙", "재발방지", "내부통제", "책임", "권한", "기록", "보관"],
    suggestedLawNames: ["공공감사에 관한 법률", "감사원법", "행정규칙"],
    patterns: [/감사/u, /평가/u, /지적/u, /재발방지/u, /증빙/u, /내부통제/u]
  },
  administrative_procedure: {
    id: "administrative_procedure",
    label: "행정절차",
    title: "행정절차 법령 적합성 검토",
    queryHints: ["처분", "사전통지", "의견제출", "청문", "이유제시", "송달", "기간", "불복절차"],
    suggestedLawNames: ["행정절차법", "행정심판법", "행정소송법"],
    patterns: [/행정절차/u, /처분/u, /사전통지/u, /의견제출/u, /청문/u, /송달/u]
  },
  internal_rule: {
    id: "internal_rule",
    label: "내부 규정/지침",
    title: "내부 규정 상위 법령 적합성 검토",
    queryHints: ["상위 법령", "위임 근거", "충돌", "저촉", "개정 필요", "조문", "시행규칙", "별표"],
    suggestedLawNames: [],
    patterns: [/내부\s*(규정|지침)/u, /상위\s*법령/u, /위임\s*근거/u, /저촉/u, /충돌/u]
  },
  general: {
    id: "general",
    label: "일반",
    title: "법령 적합성 검토",
    queryHints: ["법령 적합성", "근거", "리스크", "보완", "검토", "준수", "위반 가능성"],
    suggestedLawNames: [],
    patterns: []
  }
};

export function getReviewType(id) {
  return REVIEW_TYPES[id] || REVIEW_TYPES.general;
}

export function getReviewTypes() {
  return Object.values(REVIEW_TYPES);
}

export function buildComplianceSearchQuery({ userQuestion = "", reviewType = "general", focusLawNames = [] } = {}) {
  const type = getReviewType(reviewType);
  return [
    userQuestion,
    type.queryHints.join(" "),
    normalizeStringArray(focusLawNames).join(" ")
  ].filter(Boolean).join("\n").trim();
}

export function normalizeStringArray(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[,;\n]/);
  return list.map((item) => String(item || "").trim()).filter(Boolean);
}
