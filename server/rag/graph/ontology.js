/**
 * Knowledge graph base ontology for department notebooks.
 * Locked entity/relation type lists — extraction prompts must restrict the model
 * to these exact identifiers, and the validator drops anything outside.
 */

export const ONTOLOGY_VERSION = "1.0";

export const ENTITY_TYPES = Object.freeze([
  "Document",
  "Concept",
  "Department",
  "Role",
  "Procedure",
  "Rule",
  "Form",
  "System",
  "Statute",
  "Article"
]);

export const ENTITY_TYPE_DESCRIPTIONS = Object.freeze({
  Document: "문서 자체 (예: 공공감사법, 회계감사규칙)",
  Concept: "추상 개념/용어 (예: 자체감사, 적극행정, 독립성)",
  Department: "부서·기관 (예: 감사원, 행정안전부, 자체감사기구)",
  Role: "직책·역할 (예: 감사기구의 장, 회계감사인)",
  Procedure: "절차·조항 (예: 비상근무 발령, 감사보고서 제출)",
  Rule: "규정·규칙 항목 (예: 영리업무 금지, 결격사유, 임기 보장)",
  Form: "양식·별표 (예: 별표 2, 별지 서식)",
  System: "시스템·도구 (예: ERP, 정보통신망)",
  Statute: "법령 자체 (예: 민법, 개인정보 보호법). LawApiClient가 검증한 공식 법령만 사용한다",
  Article: "법령 조문 (예: 민법 제750조, 개인정보 보호법 제15조). 캐노니컬 ID는 \"법령명/제N조\" 형식"
});

export const RELATION_TYPES = Object.freeze([
  { id: "RELATES_TO", label: "관련" },
  { id: "BASED_ON", label: "근거" },
  { id: "OWNED_BY", label: "담당" },
  { id: "REQUIRES", label: "요구" },
  { id: "PART_OF", label: "소속" },
  { id: "CONTRASTS_WITH", label: "대비" },
  { id: "REFERS_TO_ARTICLE", label: "조문 참조" }
]);

export const RELATION_TYPE_IDS = Object.freeze(RELATION_TYPES.map((r) => r.id));

// Statute/Article must only be created by the deterministic law-citation
// harvester, never by the LLM (which would hallucinate fake statute names).
// REFERS_TO_ARTICLE is likewise reserved for the harvester. The extractor
// prompt and validator filter both out.
export const LLM_EXTRACTED_ENTITY_TYPES = Object.freeze(
  ENTITY_TYPES.filter((t) => t !== "Statute" && t !== "Article")
);

export const LLM_EXTRACTED_RELATION_TYPES = Object.freeze(
  RELATION_TYPES.filter((r) => r.id !== "REFERS_TO_ARTICLE")
);

export const LLM_EXTRACTED_RELATION_TYPE_IDS = Object.freeze(
  LLM_EXTRACTED_RELATION_TYPES.map((r) => r.id)
);

export function isValidEntityType(t) {
  return typeof t === "string" && ENTITY_TYPES.includes(t);
}

export function isValidRelationType(t) {
  return typeof t === "string" && RELATION_TYPE_IDS.includes(t);
}

export function isLlmExtractableEntityType(t) {
  return typeof t === "string" && LLM_EXTRACTED_ENTITY_TYPES.includes(t);
}

export function isLlmExtractableRelationType(t) {
  return typeof t === "string" && LLM_EXTRACTED_RELATION_TYPE_IDS.includes(t);
}

export function describeOntology() {
  return {
    version: ONTOLOGY_VERSION,
    entityTypes: ENTITY_TYPES.map((id) => ({ id, description: ENTITY_TYPE_DESCRIPTIONS[id] })),
    relationTypes: RELATION_TYPES.map((r) => ({ ...r }))
  };
}
