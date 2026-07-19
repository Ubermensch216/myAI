// 개인정보 탐지엔진 — 규칙 조합, 중복·중첩 정리, 신뢰도 산정 (기술명세서 Ⅴ)

import { detectRRN } from './rules/rrn.js';
import { detectPhone } from './rules/phone.js';
import { detectEmail } from './rules/email.js';
import { detectCard } from './rules/card.js';
import { detectAccount } from './rules/account.js';
import {
  detectPassport, detectBusinessNo, detectVehicle, detectIP, detectBirthDate,
} from './rules/misc.js';
import { detectName } from './rules/name.js';
import { detectAddress } from './rules/address.js';
import { getContext } from './rules/helpers.js';

export const RULE_VERSION = '1.0.0';

// 유효성 검증이 있는 정형정보 유형 (중첩 처리 우선순위용)
const STRUCTURED_TYPES = new Set([
  'RRN', 'FOREIGNER_NO', 'PHONE_MOBILE', 'PHONE_LANDLINE', 'EMAIL',
  'CARD_NO', 'BUSINESS_NO', 'PASSPORT_NO', 'IP_ADDRESS',
]);

let idCounter = 0;
export function resetIdCounter() {
  idCounter = 0;
}
function nextId() {
  idCounter += 1;
  return `pii-${String(idCounter).padStart(6, '0')}`;
}

// 사용자 정의 규칙: [{ name, pattern(문자열 정규식), type }]
export function detectAll(text, documentPart = 'body', userRules = []) {
  // 1) 정형정보 우선 탐지
  const structured = [
    ...detectRRN(text),
    ...detectPhone(text),
    ...detectEmail(text),
    ...detectCard(text),
    ...detectAccount(text),
    ...detectPassport(text),
    ...detectBusinessNo(text),
    ...detectVehicle(text),
    ...detectIP(text),
    ...detectBirthDate(text),
  ];

  // 2) 비정형(성명·주소): 정형정보 위치를 문맥 정보로 활용
  const piiRanges = structured.map((c) => ({ start: c.start, end: c.end }));
  const unstructured = [
    ...detectName(text, { otherPiiRanges: piiRanges }),
    ...detectAddress(text),
  ];

  // 3) 사용자 정의 규칙
  const custom = [];
  for (const rule of userRules) {
    try {
      const re = new RegExp(rule.pattern, 'g');
      for (const m of text.matchAll(re)) {
        if (!m[0]) break;
        custom.push({
          start: m.index,
          end: m.index + m[0].length,
          originalText: m[0],
          type: rule.type || 'CUSTOM',
          baseScore: 0.95,
          detectionMethod: 'USER_RULE',
          context: getContext(text, m.index, m.index + m[0].length),
        });
      }
    } catch {
      // 잘못된 정규식은 무시 (UI에서 사전 검증)
    }
  }

  // 4) 중복·중첩 정리 후 최종 후보 생성
  const merged = resolveOverlaps([...custom, ...structured, ...unstructured]);

  return merged.map((c) => ({
    id: nextId(),
    documentPart,
    start: c.start,
    end: c.end,
    originalText: c.originalText,
    type: c.type,
    confidence: Math.max(0, Math.min(1, c.baseScore)),
    detectionMethod: c.detectionMethod,
    context: c.context,
    selected: true,
    action: null, // 유형별 기본 정책은 세션에서 적용
    replacementText: null,
  }));
}

// 중첩 후보 우선순위 (기술명세서 Ⅴ-8):
// 사용자 규칙 > 유효성 통과 정형정보 > 더 긴 범위 > 높은 신뢰도
function priorityKey(c) {
  const userRule = c.detectionMethod === 'USER_RULE' ? 1 : 0;
  const structuredValid = STRUCTURED_TYPES.has(c.type) && c.baseScore >= 0.7 ? 1 : 0;
  return [userRule, structuredValid, c.end - c.start, c.baseScore];
}

export function resolveOverlaps(candidates) {
  const sorted = candidates.slice().sort((a, b) => {
    const ka = priorityKey(a);
    const kb = priorityKey(b);
    for (let i = 0; i < ka.length; i++) {
      if (ka[i] !== kb[i]) return kb[i] - ka[i];
    }
    return a.start - b.start;
  });

  const accepted = [];
  for (const c of sorted) {
    const overlaps = accepted.some((a) => c.start < a.end && a.start < c.end);
    if (!overlaps) accepted.push(c);
  }
  return accepted.sort((a, b) => a.start - b.start);
}
