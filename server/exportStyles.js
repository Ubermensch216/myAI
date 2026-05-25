// docType 별 다운로드 서식 프로파일.
// title/h2/h3/body/citation 구간별 시각 속성을 정의한다.
// DOCX/PDF/HWPX 핸들러가 공통으로 참조한다.

const DEFAULT_PROFILE = {
  title: {
    fontSize: 18,       // pt
    bold: true,
    color: "#111111",
    align: "left",      // left | center | right
    underline: false,
    spacingAfter: 6,    // pt (PDF: moveDown 환산), DOCX: w:spacing after
    borderBottom: null  // null | { color, width }
  },
  h2: {
    fontSize: 14,
    bold: true,
    color: "#222222",
    align: "left",
    accentBar: null,    // null | { color, width(pt) }
    spacingBefore: 8,
    spacingAfter: 4
  },
  h3: {
    fontSize: 12,
    bold: true,
    color: "#333333",
    indent: 0,          // pt
    spacingBefore: 4,
    spacingAfter: 2
  },
  body: {
    fontSize: 10.5,
    color: "#1a1a1a",
    lineHeight: 1.35,
    indent: 0
  },
  citation: {
    fontSize: 9.5,
    color: "#555555",
    italic: false,
    backgroundFill: null // null | "#hex"
  }
};

// 법령·검토 계열 — 격식 있는 공문 톤, 남색 강조
const LEGAL_REVIEW_PROFILE = {
  title: {
    fontSize: 19,
    bold: true,
    color: "#1F3A68",
    align: "center",
    underline: false,
    spacingAfter: 8,
    borderBottom: { color: "#1F3A68", width: 1.2 }
  },
  h2: {
    fontSize: 14,
    bold: true,
    color: "#1F3A68",
    align: "left",
    accentBar: { color: "#1F3A68", width: 3 },
    spacingBefore: 10,
    spacingAfter: 4
  },
  h3: {
    fontSize: 12,
    bold: true,
    color: "#33518A",
    indent: 6,
    spacingBefore: 4,
    spacingAfter: 2
  },
  body: {
    fontSize: 10.5,
    color: "#1a1a1a",
    lineHeight: 1.4,
    indent: 0
  },
  citation: {
    fontSize: 9.5,
    color: "#444444",
    italic: false,
    backgroundFill: "#F2F4F8"
  }
};

// 회의록 — 제목 박스, 본문 들여쓰기
const MEETING_MINUTES_PROFILE = {
  title: {
    fontSize: 17,
    bold: true,
    color: "#222222",
    align: "center",
    underline: false,
    spacingAfter: 10,
    borderBottom: { color: "#222222", width: 0.8 }
  },
  h2: {
    fontSize: 13,
    bold: true,
    color: "#1a1a1a",
    align: "left",
    accentBar: { color: "#888888", width: 2 },
    spacingBefore: 8,
    spacingAfter: 3
  },
  h3: {
    fontSize: 11.5,
    bold: true,
    color: "#333333",
    indent: 6,
    spacingBefore: 3,
    spacingAfter: 2
  },
  body: {
    fontSize: 10.5,
    color: "#1a1a1a",
    lineHeight: 1.35,
    indent: 6
  },
  citation: {
    fontSize: 9.5,
    color: "#555555",
    italic: true,
    backgroundFill: null
  }
};

// 보고·요약 계열 — 가운데 제목, 강조색 H2
const REPORT_SUMMARY_PROFILE = {
  title: {
    fontSize: 18,
    bold: true,
    color: "#1a1a1a",
    align: "center",
    underline: false,
    spacingAfter: 8,
    borderBottom: null
  },
  h2: {
    fontSize: 13,
    bold: true,
    color: "#2B6CB0",
    align: "left",
    accentBar: null,
    spacingBefore: 8,
    spacingAfter: 3
  },
  h3: {
    fontSize: 11.5,
    bold: true,
    color: "#2B6CB0",
    indent: 4,
    spacingBefore: 3,
    spacingAfter: 2
  },
  body: {
    fontSize: 10.5,
    color: "#1a1a1a",
    lineHeight: 1.4,
    indent: 0
  },
  citation: {
    fontSize: 9.5,
    color: "#555555",
    italic: false,
    backgroundFill: null
  }
};

// 공문 초안 — 큰 가운데 제목, 단순 H2
const OFFICIAL_DRAFT_PROFILE = {
  title: {
    fontSize: 20,
    bold: true,
    color: "#000000",
    align: "center",
    underline: false,
    spacingAfter: 12,
    borderBottom: null
  },
  h2: {
    fontSize: 12.5,
    bold: true,
    color: "#000000",
    align: "left",
    accentBar: null,
    spacingBefore: 6,
    spacingAfter: 3
  },
  h3: {
    fontSize: 11.5,
    bold: true,
    color: "#222222",
    indent: 0,
    spacingBefore: 3,
    spacingAfter: 2
  },
  body: {
    fontSize: 11,
    color: "#000000",
    lineHeight: 1.5,
    indent: 0
  },
  citation: {
    fontSize: 10,
    color: "#333333",
    italic: false,
    backgroundFill: null
  }
};

// 체크리스트 — 차분한 제목, 좌측 바
const CHECKLIST_PROFILE = {
  title: {
    fontSize: 16,
    bold: true,
    color: "#1a1a1a",
    align: "left",
    underline: false,
    spacingAfter: 8,
    borderBottom: { color: "#999999", width: 0.6 }
  },
  h2: {
    fontSize: 12.5,
    bold: true,
    color: "#1a1a1a",
    align: "left",
    accentBar: { color: "#3B82F6", width: 2.5 },
    spacingBefore: 8,
    spacingAfter: 3
  },
  h3: {
    fontSize: 11.5,
    bold: true,
    color: "#333333",
    indent: 4,
    spacingBefore: 3,
    spacingAfter: 2
  },
  body: {
    fontSize: 10.5,
    color: "#1a1a1a",
    lineHeight: 1.4,
    indent: 0
  },
  citation: {
    fontSize: 9.5,
    color: "#555555",
    italic: false,
    backgroundFill: null
  }
};

const PROFILE_BY_DOC_TYPE = {
  // 법령·검토 계열
  review_report: LEGAL_REVIEW_PROFILE,
  law_review_opinion: LEGAL_REVIEW_PROFILE,
  ordinance_upper_law_review: LEGAL_REVIEW_PROFILE,
  administrative_disposition_basis: LEGAL_REVIEW_PROFILE,
  civil_reply_law_review: LEGAL_REVIEW_PROFILE,

  // 회의록
  meeting_minutes: MEETING_MINUTES_PROFILE,

  // 보고·요약 계열
  report_memo: REPORT_SUMMARY_PROFILE,
  summary: REPORT_SUMMARY_PROFILE,
  daily_report: REPORT_SUMMARY_PROFILE,
  planning_proposal: REPORT_SUMMARY_PROFILE,

  // 공문 초안
  official_draft: OFFICIAL_DRAFT_PROFILE,

  // 체크리스트
  audit_checklist: CHECKLIST_PROFILE,
  internal_compliance_checklist: CHECKLIST_PROFILE
};

export function getStyleProfile(docType) {
  if (!docType || typeof docType !== "string") return DEFAULT_PROFILE;
  return PROFILE_BY_DOC_TYPE[docType] || DEFAULT_PROFILE;
}

export const __profilesForTest = {
  DEFAULT_PROFILE,
  LEGAL_REVIEW_PROFILE,
  MEETING_MINUTES_PROFILE,
  REPORT_SUMMARY_PROFILE,
  OFFICIAL_DRAFT_PROFILE,
  CHECKLIST_PROFILE
};
