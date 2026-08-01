// LLM 결과 병합 — 순수 함수
//
// 두 단계로 나뉜다. 호출 순서가 중요하다:
//   ① applyVerifications — 기존 후보 id 기준으로 검증 결과를 반영 (id 유지)
//   ② mergeLlmCandidates — 신규 후보를 병합하며 id 를 재부여 (①이 끝난 뒤에만)
//
// 검증 결과는 후보를 삭제하지 않는다 — 오탐 판정(REJECT)은 신뢰도를 '낮음'
// 구간으로 강등하고 뱃지만 붙인다. 최종 제외는 사용자가 결정한다 (FR-403).

import { resolveOverlaps } from '../detect/engine.js';
import { finalizeCandidates } from '../core/analyzer.js';
import { PII_TYPES } from '../detect/types.js';

const REJECT_CONFIDENCE_CAP = 0.35;
const CONFIRM_BONUS = 0.05;
// 이 값 이상이고 정규식으로 잡힌 후보는 유형 자동 교체 대상에서 제외한다
// (체크섬을 통과한 주민번호 등을 LLM 판단으로 뒤집지 않는다).
const RETYPE_PROTECT_CONFIDENCE = 0.9;

export function applyVerifications(candidates, verifications) {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  for (const v of Array.isArray(verifications) ? verifications : []) {
    const c = byId.get(v?.id);
    if (!c) continue;
    // 청크 겹침 구간의 후보는 두 번 검증될 수 있다 — 먼저 온 판정을 유지한다.
    if (c.llmVerdict) continue;

    if (v.verdict === 'CONFIRM') {
      c.confidence = Math.min(1, c.confidence + CONFIRM_BONUS);
      c.llmVerdict = 'CONFIRM';
    } else if (v.verdict === 'REJECT') {
      c.confidence = Math.min(c.confidence, REJECT_CONFIDENCE_CAP);
      c.llmVerdict = 'REJECT';
    } else if (v.verdict === 'RETYPE') {
      const type = Object.hasOwn(PII_TYPES, v.type) ? v.type : null;
      if (!type || type === c.type) continue;
      if (c.detectionMethod === 'REGEX' && c.confidence >= RETYPE_PROTECT_CONFIDENCE) {
        // 고신뢰 정형 후보는 제안만 남긴다 — 사용자가 유형 셀렉트로 결정.
        c.llmSuggestedType = type;
        c.llmVerdict = 'RETYPE';
      } else {
        c.type = type;
        c.action = null; // 새 유형의 기본 정책 적용
        c.llmVerdict = 'RETYPE';
      }
    }
  }
  return candidates;
}

export function mergeLlmCandidates(candidates, llmRaw, text) {
  if (!Array.isArray(llmRaw) || llmRaw.length === 0) return candidates;

  // 기존 후보를 원시 형태로 되돌려 병합한다 (analyzer.js CSV 열 힌트와 동일).
  // 우선순위상 LLM 후보(비정형, baseScore ≤ 0.85)는 사용자 규칙·유효성 통과
  // 정형보다 항상 후순위라 기존 후보 구간을 침범하지 못한다.
  const raw = candidates.map((c) => ({
    start: c.start, end: c.end, originalText: c.originalText, type: c.type,
    baseScore: c.confidence, detectionMethod: c.detectionMethod, context: c.context,
    carry: pickCarry(c),
  }));
  const merged = resolveOverlaps([...raw, ...llmRaw]);
  return finalizeCandidates(merged, text);
}

function pickCarry(c) {
  const carry = {};
  if (c.llmVerdict) carry.llmVerdict = c.llmVerdict;
  if (c.llmSuggestedType) carry.llmSuggestedType = c.llmSuggestedType;
  return carry;
}
