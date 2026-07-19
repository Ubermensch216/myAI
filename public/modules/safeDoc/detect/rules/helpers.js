// 탐지 규칙 공통 도우미

import { FIELD_KEYWORDS_BY_TYPE } from '../dictionaries.js';

// 후보 앞뒤 문맥 추출 (화면 표시 및 문맥 점수용)
export function getContext(text, start, end, radius = 25) {
  const from = Math.max(0, start - radius);
  const to = Math.min(text.length, end + radius);
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

// 후보 앞쪽(같은 줄/셀 인접 영역)에 유형 관련 필드명이 있는지 점수화 (FR-314)
export function fieldKeywordScore(text, start, type, radius = 30) {
  const keywords = FIELD_KEYWORDS_BY_TYPE[type];
  if (!keywords) return 0;
  const from = Math.max(0, start - radius);
  const before = text.slice(from, start);
  for (const kw of keywords) {
    if (before.includes(kw)) return 0.15;
  }
  return 0;
}

// 후보 경계가 숫자와 붙어 있으면 감점 (더 긴 숫자열의 일부일 가능성)
export function digitBoundaryPenalty(text, start, end) {
  const beforeCh = start > 0 ? text[start - 1] : '';
  const afterCh = end < text.length ? text[end] : '';
  if (/\d/.test(beforeCh) || /\d/.test(afterCh)) return 0.5;
  return 0;
}

// 후보 객체 생성
export function makeCandidate({ text, start, end, type, baseScore, detectionMethod, extra = {} }) {
  return {
    start,
    end,
    originalText: text.slice(start, end),
    type,
    baseScore,
    detectionMethod,
    context: getContext(text, start, end),
    ...extra,
  };
}
