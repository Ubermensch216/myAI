// Built-in Studio Document templates. Each template is a recipe: section titles
// + optional instructions/columns. answerToDocument.js turns the recipe into
// actual document blocks by filling content from the assistant answer.

const TEMPLATES = [
  {
    id: "planning_proposal",
    name: "기획서",
    description: "신규 사업·업무 개선 기획용 문서",
    blocks: [
      { type: "section", title: "1. 추진 배경", instruction: "추진 배경, 필요성, 외부 환경 변화를 간단히 정리한다." },
      { type: "section", title: "2. 현황 및 문제점", instruction: "현재 상태와 핵심 문제를 사실 위주로 기술한다." },
      { type: "section", title: "3. 추진 목표", instruction: "정량/정성 목표를 구분해 명확하게 제시한다." },
      { type: "section", title: "4. 주요 추진 내용", instruction: "핵심 추진 과제를 항목별로 정리한다." },
      { type: "section", title: "5. 세부 추진 계획", instruction: "과제별 세부 활동, 담당, 일정을 정리한다." },
      { type: "section", title: "6. 기대 효과", instruction: "기대되는 정량·정성 효과를 구분해 기술한다." },
      { type: "section", title: "7. 향후 일정", instruction: "단계별 마일스톤과 일정을 정리한다." },
      { type: "section", title: "8. 검토 및 협조 사항", instruction: "타 부서 협조사항, 결정 필요 사항을 정리한다." }
    ]
  },
  {
    id: "review_report",
    name: "검토보고서",
    description: "법령·문서 검토 결과 보고서",
    blocks: [
      { type: "section", title: "1. 검토 개요", instruction: "검토 목적·대상·범위를 간단히 기술한다." },
      { type: "section", title: "2. 검토 대상", instruction: "검토한 문서/조항/사실 관계를 명확히 적는다." },
      { type: "section", title: "3. 관련 근거", instruction: "관련 법령·지침·판례를 인용 마커와 함께 정리한다." },
      { type: "section", title: "4. 주요 검토 내용", instruction: "쟁점별 검토 내용을 항목으로 정리한다." },
      {
        type: "table",
        title: "5. 쟁점 및 판단",
        columns: ["쟁점", "검토 내용", "근거", "판단"]
      },
      { type: "section", title: "6. 리스크", instruction: "현 시점에서 식별된 법적·운영 리스크를 정리한다." },
      { type: "section", title: "7. 조치 의견", instruction: "권고 조치사항과 후속 절차를 정리한다." },
      { type: "section", title: "8. 참고 자료", instruction: "본 검토에 사용된 자료의 출처를 정리한다." }
    ]
  },
  {
    id: "daily_report",
    name: "일일보고",
    description: "팀·프로젝트 일일 업무 보고",
    blocks: [
      { type: "section", title: "1. 금일 주요 업무", instruction: "오늘 처리한 업무를 항목으로 정리한다." },
      { type: "section", title: "2. 진행 현황", instruction: "주요 과제의 진행 단계와 비율을 정리한다." },
      { type: "section", title: "3. 이슈 및 대응", instruction: "발생 이슈와 대응 방향을 정리한다." },
      { type: "section", title: "4. 내일 계획", instruction: "익일 처리 예정 업무를 정리한다." },
      { type: "section", title: "5. 협조 요청", instruction: "타 부서/팀 협조가 필요한 사항을 정리한다." },
      { type: "section", title: "6. 참고 사항", instruction: "기타 공유가 필요한 사항을 정리한다." }
    ]
  },
  {
    id: "meeting_minutes",
    name: "회의록",
    description: "내부·협의체 회의 기록",
    blocks: [
      {
        type: "table",
        title: "1. 회의 개요",
        columns: ["항목", "내용"]
      },
      { type: "section", title: "2. 주요 논의 내용", instruction: "안건별 논의 흐름을 정리한다." },
      { type: "section", title: "3. 결정 사항", instruction: "회의에서 합의·결정된 항목만 정리한다." },
      {
        type: "table",
        title: "4. 후속 조치",
        columns: ["조치 사항", "담당", "기한"]
      },
      { type: "section", title: "5. 담당자 및 기한", instruction: "전체 액션 아이템 담당자/기한을 한 번 더 정리한다." },
      { type: "section", title: "6. 첨부/참고 자료", instruction: "회의 참고자료를 정리한다." }
    ]
  },
  {
    id: "audit_checklist",
    name: "감사·점검 체크리스트",
    description: "감사 대응·점검 결과 정리용 문서",
    blocks: [
      { type: "section", title: "1. 점검 개요", instruction: "점검 목적·대상·범위·기간을 간단히 기술한다." },
      { type: "section", title: "2. 점검 기준", instruction: "관련 법령·지침·내부 규정 등 기준을 정리한다." },
      {
        type: "table",
        title: "3. 점검 항목",
        columns: ["점검 항목", "기준/근거", "확인 내용", "결과", "조치 필요"]
      },
      { type: "section", title: "4. 확인 결과", instruction: "점검 결과의 전반적인 요약을 정리한다." },
      { type: "section", title: "5. 미흡 사항", instruction: "기준 미충족·보완 필요 사항을 정리한다." },
      { type: "section", title: "6. 개선 권고", instruction: "권고사항과 우선순위를 정리한다." },
      { type: "section", title: "7. 후속 조치 일정", instruction: "후속 조치 책임자/기한/완료 기준을 정리한다." }
    ]
  }
];

const TEMPLATE_BY_ID = new Map(TEMPLATES.map((tpl) => [tpl.id, tpl]));

export function listDefaultTemplates() {
  return TEMPLATES.map(cloneTemplate);
}

export function getDefaultTemplate(id) {
  const tpl = TEMPLATE_BY_ID.get(String(id || ""));
  return tpl ? cloneTemplate(tpl) : null;
}

export function isBuiltInTemplateId(id) {
  return TEMPLATE_BY_ID.has(String(id || ""));
}

// PRD §8.2: review_report is the default for compliance/legal review answers.
export function pickDefaultTemplateId(metadata = {}) {
  if (metadata && (metadata.compliance || metadata.law || metadata.lawCompliance)) {
    return "review_report";
  }
  return null;
}

function cloneTemplate(tpl) {
  return {
    id: tpl.id,
    name: tpl.name,
    description: tpl.description,
    builtIn: true,
    blocks: tpl.blocks.map((block) => ({ ...block, columns: block.columns ? [...block.columns] : undefined }))
  };
}
