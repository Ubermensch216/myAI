// 이메일 탐지 (FR-304)

import { fieldKeywordScore, makeCandidate } from './helpers.js';

// 아이디 + 도메인 + 최상위 도메인 구조 (기술명세서 Ⅴ-4)
const EMAIL_REGEX = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function detectEmail(text) {
  const results = [];
  for (const m of text.matchAll(EMAIL_REGEX)) {
    const start = m.index;
    let end = start + m[0].length;
    // 문장부호 경계 처리: 끝의 마침표/쉼표 제거
    while (end > start && /[.,;:]$/.test(text.slice(start, end))) end--;
    let score = 0.6 + 0.3;
    score += fieldKeywordScore(text, start, 'EMAIL');
    results.push(makeCandidate({ text, start, end, type: 'EMAIL', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }
  return results;
}
