// LLM additions → 원문 오프셋 앵커링 — 순수 함수
//
// LLM은 위치(오프셋)를 정확히 세지 못하므로 "본문에 그대로 존재하는 문자열을
// 복사하라"는 규약으로 값을 받고, 여기서 원문 검색으로 위치를 확정한다.
// 원문에 없는 값은 환각으로 보고 버린다 (최종 방어선 — 서버도 1차로 거른다).

import { PII_TYPES } from '../detect/types.js';

// LLM 단독 후보의 신뢰도는 유효성 검증을 통과한 정형 정규식(0.9+)보다 항상
// 낮게 잡는다 — 검토 화면에서 과신되지 않게 하기 위함이다.
const SCORE_BY_CONFIDENCE = { HIGH: 0.85, MEDIUM: 0.7, LOW: 0.55 };

export function anchorAdditions(chunkText, chunkStart, additions) {
  const raw = [];
  for (const a of Array.isArray(additions) ? additions : []) {
    const value = typeof a?.value === 'string' ? a.value : '';
    if (!value) continue;

    const occurrences = [];
    let idx = chunkText.indexOf(value);
    while (idx >= 0) {
      occurrences.push(idx);
      idx = chunkText.indexOf(value, idx + value.length);
    }
    if (occurrences.length === 0) continue; // 환각 — 폐기

    // before 힌트가 특정 출현과 일치하면 그 출현만, 아니면 모든 출현을 후보로
    // 삼는다 (같은 값이면 전부 같은 개인정보 — 검색 일괄 지정 FR-408과 동일 철학).
    let chosen = occurrences;
    const before = typeof a.before === 'string' ? a.before : '';
    if (before && occurrences.length > 1) {
      const matched = occurrences.filter(
        (pos) => chunkText.slice(Math.max(0, pos - before.length), pos) === before
      );
      if (matched.length > 0) chosen = matched;
    }

    const type = Object.hasOwn(PII_TYPES, a.type) ? a.type : 'CUSTOM';
    const baseScore = SCORE_BY_CONFIDENCE[a.confidence] ?? SCORE_BY_CONFIDENCE.LOW;
    for (const pos of chosen) {
      raw.push({
        start: chunkStart + pos,
        end: chunkStart + pos + value.length,
        originalText: value,
        type,
        baseScore,
        detectionMethod: 'LLM',
        context: '',
      });
    }
  }
  return raw;
}
