// 계좌번호 탐지 (FR-305)

import { BANK_NAMES } from '../dictionaries.js';
import { fieldKeywordScore, digitBoundaryPenalty, makeCandidate, getContext } from './helpers.js';

// 하이픈으로 구분된 3~4그룹 숫자열 (10~14자리) 또는 은행명 인접 연속 숫자
const ACCOUNT_REGEX = /\d{2,6}[-]\d{2,6}[-]\d{2,8}(?:[-]\d{1,6})?/g;
const PLAIN_ACCOUNT_REGEX = /\d{10,14}/g;

function bankContextScore(text, start, end) {
  const ctx = getContext(text, start, end, 30);
  return BANK_NAMES.some((b) => ctx.includes(b)) ? 0.25 : 0;
}

export function detectAccount(text) {
  const results = [];

  for (const m of text.matchAll(ACCOUNT_REGEX)) {
    const raw = m[0];
    const digits = raw.replace(/-/g, '');
    if (digits.length < 10 || digits.length > 16) continue;
    const start = m.index;
    const end = start + raw.length;
    // 전화번호·주민번호 패턴과 겹치는 형식은 해당 규칙에 맡김 (중첩 처리에서 정리)
    if (/^01[016789]/.test(digits) || /^\d{6}-\d{7}$/.test(raw)) continue;
    let score = 0.4;
    score += fieldKeywordScore(text, start, 'ACCOUNT_NO');
    score += bankContextScore(text, start, end);
    score -= digitBoundaryPenalty(text, start, end);
    if (score < 0.35) continue;
    results.push(makeCandidate({ text, start, end, type: 'ACCOUNT_NO', baseScore: Math.min(score, 1), detectionMethod: 'REGEX' }));
  }

  // 구분자 없는 숫자열은 은행명 또는 계좌 필드명이 인접한 경우에만 후보로 인정
  for (const m of text.matchAll(PLAIN_ACCOUNT_REGEX)) {
    const start = m.index;
    const end = start + m[0].length;
    const fieldScore = fieldKeywordScore(text, start, 'ACCOUNT_NO');
    const bankScore = bankContextScore(text, start, end);
    if (fieldScore === 0 && bankScore === 0) continue;
    let score = 0.35 + fieldScore * 2 + bankScore;
    score -= digitBoundaryPenalty(text, start, end);
    if (score < 0.35) continue;
    results.push(makeCandidate({ text, start, end, type: 'ACCOUNT_NO', baseScore: Math.min(score, 1), detectionMethod: 'CONTEXT' }));
  }

  return results;
}
