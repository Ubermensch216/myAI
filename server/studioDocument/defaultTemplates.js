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
  },
  {
    id: "law_review_opinion",
    name: "법령 검토의견서",
    description: "공식 법령 근거와 내부자료 쟁점을 결합한 검토의견서",
    blocks: [
      { type: "section", title: "1. 검토 개요", instruction: "질문, 검토 대상, 적용 법령 범위를 간단히 정리한다." },
      { type: "section", title: "2. 사실관계 및 자료", instruction: "업로드 문서나 내부자료에서 확인된 핵심 사실만 정리한다." },
      { type: "section", title: "3. 관련 법령 및 하위법령", instruction: "조문, 시행령, 시행규칙, 위임법령을 인용표지와 함께 정리한다." },
      { type: "section", title: "4. 별표·서식 및 자치법규", instruction: "별표/서식과 자치법규 확인 결과를 분리해 작성한다." },
      { type: "table", title: "5. 쟁점별 검토", columns: ["쟁점", "관련 근거", "검토 내용", "판단"] },
      { type: "section", title: "6. 판례·해석례·결정례", instruction: "공식 판례, 해석례, 결정례 후보와 의미를 근거 범위 내에서 정리한다." },
      { type: "section", title: "7. 검토 의견", instruction: "적합, 보완 필요, 추가 확인 필요를 구분해 결론을 작성한다." },
      { type: "section", title: "8. 후속 조치", instruction: "보완 문구, 추가 확인 자료, 담당 부서 조치사항을 정리한다." }
    ]
  },
  {
    id: "ordinance_upper_law_review",
    name: "조례 상위법 적합성 검토서",
    description: "조례·규칙안이 상위 법령과 위임 범위에 부합하는지 검토",
    blocks: [
      { type: "section", title: "1. 검토 대상 조례", instruction: "조례명, 조문, 개정안 또는 검토 문서를 특정한다." },
      { type: "section", title: "2. 상위법 근거", instruction: "법률, 시행령, 시행규칙의 위임 근거를 정리한다." },
      { type: "section", title: "3. 위임 범위 검토", instruction: "조례가 상위법 위임 범위 안에 있는지 쟁점별로 판단한다." },
      { type: "table", title: "4. 조문별 적합성", columns: ["조례 조문", "상위법 근거", "검토 결과", "보완 의견"] },
      { type: "section", title: "5. 관련 자치법규 비교", instruction: "연계 자치법규 또는 유사 자치법규 후보를 비교한다." },
      { type: "section", title: "6. 종합 의견", instruction: "상위법 적합성 결론과 보완 필요 문구를 작성한다." }
    ]
  },
  {
    id: "administrative_disposition_basis",
    name: "행정처분 근거 검토서",
    description: "행정처분의 법적 근거, 요건, 절차 리스크 검토",
    blocks: [
      { type: "section", title: "1. 처분 개요", instruction: "처분 대상, 사실관계, 예정 처분을 정리한다." },
      { type: "section", title: "2. 법적 근거", instruction: "처분 근거 법령, 하위법령, 별표 기준을 정리한다." },
      { type: "table", title: "3. 처분 요건 충족 여부", columns: ["요건", "확인 자료", "근거", "판단"] },
      { type: "section", title: "4. 절차 검토", instruction: "사전통지, 의견제출, 청문 등 절차 필요 여부를 검토한다." },
      { type: "section", title: "5. 판례·해석례", instruction: "처분 관련 판례, 해석례, 결정례 후보를 정리한다." },
      { type: "section", title: "6. 처분 의견", instruction: "처분 가능성, 보완 필요 자료, 리스크를 결론으로 작성한다." }
    ]
  },
  {
    id: "civil_reply_law_review",
    name: "민원 회신 법령 검토서",
    description: "민원 질의에 대한 법령 근거 중심 회신 초안",
    blocks: [
      { type: "section", title: "1. 민원 요지", instruction: "민원인이 묻는 내용을 자연어로 요약한다." },
      { type: "section", title: "2. 관련 법령", instruction: "확인된 법령 조문과 별표/서식을 인용표지와 함께 정리한다." },
      { type: "section", title: "3. 검토 내용", instruction: "민원 사실관계와 법령 요건을 연결해 설명한다." },
      { type: "section", title: "4. 회신 초안", instruction: "공식적이고 단정적인 행정문체로 회신 문안을 작성한다." },
      { type: "section", title: "5. 유의사항", instruction: "추가 자료 필요, 소관기관 확인, 법률자문 필요 사항을 적는다." }
    ]
  },
  {
    id: "internal_compliance_checklist",
    name: "내부규정 컴플라이언스 점검표",
    description: "내부규정·업무절차와 공식 법령 근거의 충돌 여부 점검",
    blocks: [
      { type: "section", title: "1. 점검 범위", instruction: "내부규정, 업무절차, 검토 대상 법령 범위를 정리한다." },
      { type: "table", title: "2. 항목별 점검", columns: ["점검 항목", "내부자료 내용", "법령 근거", "결과", "조치"] },
      { type: "section", title: "3. 주요 리스크", instruction: "위반 가능성, 근거 부족, 절차 누락을 구분해 작성한다." },
      { type: "section", title: "4. 보완 권고", instruction: "문구 수정, 절차 추가, 증빙 확보 등 실행 가능한 권고를 작성한다." },
      { type: "section", title: "5. 후속 점검", instruction: "재점검 일정과 담당 확인 사항을 정리한다." }
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
  if (metadata && metadata.lawWorkbench) {
    return "law_review_opinion";
  }
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
