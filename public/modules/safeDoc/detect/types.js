// 개인정보 유형 코드 정의 (기술명세서 Ⅴ-3)

export const PII_TYPES = {
  PERSON_NAME: { code: 'PERSON_NAME', label: '성명', token: '성명', defaultAction: 'REPLACE' },
  RRN: { code: 'RRN', label: '주민등록번호', token: '주민번호', defaultAction: 'MASK_ALL' },
  FOREIGNER_NO: { code: 'FOREIGNER_NO', label: '외국인등록번호', token: '외국인번호', defaultAction: 'MASK_ALL' },
  PHONE_MOBILE: { code: 'PHONE_MOBILE', label: '휴대전화', token: '휴대전화', defaultAction: 'MASK_PART' },
  PHONE_LANDLINE: { code: 'PHONE_LANDLINE', label: '일반전화', token: '전화번호', defaultAction: 'MASK_PART' },
  EMAIL: { code: 'EMAIL', label: '이메일', token: '이메일', defaultAction: 'MASK_PART' },
  ADDRESS: { code: 'ADDRESS', label: '주소', token: '주소', defaultAction: 'REPLACE' },
  ACCOUNT_NO: { code: 'ACCOUNT_NO', label: '계좌번호', token: '계좌번호', defaultAction: 'MASK_PART' },
  CARD_NO: { code: 'CARD_NO', label: '카드번호', token: '카드번호', defaultAction: 'MASK_ALL' },
  PASSPORT_NO: { code: 'PASSPORT_NO', label: '여권번호', token: '여권번호', defaultAction: 'MASK_ALL' },
  BUSINESS_NO: { code: 'BUSINESS_NO', label: '사업자등록번호', token: '사업자번호', defaultAction: 'REPLACE' },
  VEHICLE_NO: { code: 'VEHICLE_NO', label: '차량번호', token: '차량번호', defaultAction: 'REPLACE' },
  IP_ADDRESS: { code: 'IP_ADDRESS', label: 'IP 주소', token: 'IP주소', defaultAction: 'REPLACE' },
  BIRTH_DATE: { code: 'BIRTH_DATE', label: '생년월일', token: '생년월일', defaultAction: 'REPLACE' },
  CUSTOM: { code: 'CUSTOM', label: '사용자 지정', token: '개인정보', defaultAction: 'REPLACE' },
};

export const ACTION_LABELS = {
  REPLACE: '유형별 치환',
  MASK_PART: '부분 마스킹',
  MASK_ALL: '전체 마스킹',
  DELETE: '삭제',
};

// 신뢰도 구간 (기술명세서 Ⅴ-7)
export const CONFIDENCE_LEVELS = {
  HIGH: 0.9,
  MEDIUM: 0.7,
};

export function confidenceLabel(confidence) {
  if (confidence >= CONFIDENCE_LEVELS.HIGH) return '높음';
  if (confidence >= CONFIDENCE_LEVELS.MEDIUM) return '보통';
  return '낮음';
}
