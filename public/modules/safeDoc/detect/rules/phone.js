// 전화번호 탐지 — 휴대전화·일반전화 (FR-303)

import { fieldKeywordScore, digitBoundaryPenalty, makeCandidate } from './helpers.js';

// 휴대전화: 010/011/016/017/018/019, 하이픈·공백·무구분 허용
const MOBILE_REGEX = /01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}/g;

// 일반전화: 02 또는 0XX 지역번호, 괄호 표현 허용
const LANDLINE_REGEX = /(?:\(0\d{1,2}\)|0(?:2|3[1-3]|4[1-4]|5[1-5]|6[1-4]|70|80|50\d))[-.\s)]?\d{3,4}[-.\s]?\d{4}/g;

export function detectPhone(text) {
  const results = [];

  for (const m of text.matchAll(MOBILE_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    let score = 0.55 + 0.3;
    score += fieldKeywordScore(text, start, 'PHONE_MOBILE');
    score -= digitBoundaryPenalty(text, start, end);
    // 구분자 없는 연속 숫자는 감점 (계좌·문서번호와 혼동 가능)
    if (!/[-.\s]/.test(m[0])) score -= 0.15;
    if (score < 0.3) continue;
    results.push(makeCandidate({ text, start, end, type: 'PHONE_MOBILE', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }

  for (const m of text.matchAll(LANDLINE_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    // 휴대전화와 중복되는 구간은 건너뜀 (010은 지역번호가 아님)
    if (/^01[016789]/.test(m[0].replace(/[^\d]/g, ''))) continue;
    let score = 0.5 + 0.25;
    score += fieldKeywordScore(text, start, 'PHONE_LANDLINE');
    score -= digitBoundaryPenalty(text, start, end);
    if (!/[-.\s()]/.test(m[0])) score -= 0.2;
    if (score < 0.3) continue;
    results.push(makeCandidate({ text, start, end, type: 'PHONE_LANDLINE', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }

  return results;
}
