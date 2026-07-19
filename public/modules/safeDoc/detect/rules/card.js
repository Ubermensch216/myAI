// 카드번호 탐지 — Luhn 검증 포함 (FR-306)

import { validateLuhn } from '../validators.js';
import { fieldKeywordScore, digitBoundaryPenalty, makeCandidate } from './helpers.js';

// 4-4-4-4 형태(하이픈/공백 허용) 또는 15~16자리 연속 숫자
const CARD_REGEX = /\d{4}[-\s]\d{4}[-\s]\d{4}[-\s]\d{3,4}|\d{15,16}/g;

export function detectCard(text) {
  const results = [];
  for (const m of text.matchAll(CARD_REGEX)) {
    const raw = m[0];
    const digits = raw.replace(/[-\s]/g, '');
    if (digits.length < 15 || digits.length > 16) continue;
    const start = m.index;
    const end = start + raw.length;

    const luhn = validateLuhn(digits);
    // Luhn 통과 시 높은 신뢰도, 실패 시 낮은 신뢰도 후보 (기술명세서 Ⅴ-4)
    let score = 0.45 + luhn.score * 0.4;
    score += fieldKeywordScore(text, start, 'CARD_NO');
    score -= digitBoundaryPenalty(text, start, end);
    // 구분자 없는 연속 숫자는 다른 번호일 가능성 감점
    if (!/[-\s]/.test(raw)) score -= 0.25;
    if (score < 0.3) continue;

    results.push(makeCandidate({
      text, start, end, type: 'CARD_NO', baseScore: Math.min(score, 1), detectionMethod: 'REGEX',
      extra: { checksumOk: luhn.checksumOk },
    }));
  }
  return results;
}
