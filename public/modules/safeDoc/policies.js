// 문서보안(safeDoc) 설정 영속화 브릿지
//
// 원본 safeDoc은 유형별 처리방식 정책을 localStorage('safedoc-type-policies')에
// 직접 저장했다. myAI는 개인 데이터를 IndexedDB + WebCrypto AES-GCM 으로 암호화해
// 보관하므로, 저장 경로를 state.safeDoc 으로 일원화하고 persistence.js 를 태운다.
//
// 영속화 대상은 "비민감 설정"뿐이다:
//   - 저장함: typePolicies (유형별 기본 처리방식)
//   - 저장함: useLlm (AI 기반 탐지 사용 여부 — boolean)
//   - 저장 안 함: userRules (사용자 정의 정규식 — ReDoS 벡터라 세션 한정, FR-803)
//   - 저장 안 함: WorkSession 전체 (원본 문서·개인정보 원문·대응표)

import { PII_TYPES, ACTION_LABELS } from './detect/types.js';

/**
 * 저장된 정책을 신뢰하지 않고 화이트리스트로 정규화한다.
 * 암호화 저장소가 손상되었거나 예전 판이 저장한 값이 섞여 있어도
 * 알 수 없는 유형·처리방식이 탐지 엔진에 흘러들지 않게 한다.
 */
export function normalizeTypePolicies(stored) {
  const clean = Object.create(null);
  if (!stored || typeof stored !== 'object') return clean;

  for (const [type, action] of Object.entries(stored)) {
    if (!Object.hasOwn(PII_TYPES, type)) continue;
    if (typeof action !== 'string') continue;
    if (!Object.hasOwn(ACTION_LABELS, action)) continue;
    clean[type] = action;
  }
  return clean;
}

/**
 * state.safeDoc 중 영속화할 부분만 골라낸다. persistence.js 의 saveAppState()가
 * 이 결과를 그대로 직렬화하므로, 여기에 없는 것은 저장되지 않는다.
 */
export function serializeSafeDocState(safeDoc) {
  return {
    typePolicies: normalizeTypePolicies(safeDoc?.typePolicies),
    // AI(LLM) 탐지 사용 여부 — 비민감 boolean, 기본 꺼짐(opt-in)
    useLlm: safeDoc?.useLlm === true
    // userRules 는 의도적으로 제외한다 — 정규식은 ReDoS 벡터이며 명세상
    // 세션 한정(FR-803)이다. 여기에 추가하지 말 것.
  };
}

/** 저장소에서 읽어들인 값으로 state.safeDoc 초기 형태를 만든다. */
export function deserializeSafeDocState(stored) {
  return {
    typePolicies: normalizeTypePolicies(stored?.typePolicies),
    useLlm: stored?.useLlm === true,
    userRules: []
  };
}

/** 유형별 기본 처리방식 — 저장된 정책이 없으면 명세 기본값을 쓴다. */
export function resolveAction(typePolicies, type) {
  const policy = typePolicies?.[type];
  if (policy && Object.hasOwn(ACTION_LABELS, policy)) return policy;
  return PII_TYPES[type]?.defaultAction ?? 'REPLACE';
}
