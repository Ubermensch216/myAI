// 주민등록번호·외국인등록번호 탐지 (FR-301, FR-302)

import { validateRRN, validateForeignerNo } from '../validators.js';
import { fieldKeywordScore, digitBoundaryPenalty, makeCandidate } from './helpers.js';

const RRN_REGEX = /\d{6}[-\s]?\d{7}/g;

export function detectRRN(text) {
  const results = [];
  for (const m of text.matchAll(RRN_REGEX)) {
    const raw = m[0];
    const digits = raw.replace(/[-\s]/g, '');
    const start = m.index;
    const end = start + raw.length;

    const rrn = validateRRN(digits);
    const frn = validateForeignerNo(digits);
    let type;
    let validScore;
    if (rrn.valid) {
      type = 'RRN';
      validScore = rrn.score;
    } else if (frn.valid) {
      type = 'FOREIGNER_NO';
      validScore = frn.score;
    } else {
      continue;
    }

    // 형식 일치 0.5 + 유효성 0.35 + 필드명 가점 - 경계 감점 (기술명세서 Ⅴ-7)
    let score = 0.5 + validScore * 0.35;
    score += fieldKeywordScore(text, start, type);
    score -= digitBoundaryPenalty(text, start, end);
    // 하이픈 없는 13자리 연속 숫자는 문서번호 오탐 가능성으로 감점
    if (!raw.includes('-')) score -= 0.1;
    if (score < 0.3) continue;

    results.push(makeCandidate({ text, start, end, type, baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }
  return results;
}
