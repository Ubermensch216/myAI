// safeDoc LLM 분석 API 클라이언트
//
// 이 파일은 문서보안 모듈에서 유일하게 fetch 가 허용된 곳이다
// (scripts/safedoc-test.mjs 검증 1). 호출 대상은 이 앱 자신의 서버가 로컬
// Ollama 로 중계하는 /api/safedoc/ 상대경로뿐이며, 절대 URL(외부 호스트)을
// 여기에 추가해서는 안 된다 — 문서 원문이 외부로 나가면 안 되기 때문이다.

const ANALYZE_URL = '/api/safedoc/analyze';

/**
 * 청크 1개를 서버 LLM 분석에 보낸다.
 * @returns {Promise<{verifications: Array, additions: Array}>}
 * @throws 네트워크·서버 오류 시 일반 Error — 호출측(controller)이 삼키고
 *         정규식 결과로 계속 진행한다 (LLM 실패는 치명 오류가 아니다).
 */
export async function requestChunkAnalysis({ text, candidates, signal }) {
  const response = await fetch(ANALYZE_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, candidates }),
  });
  if (!response.ok) {
    throw new Error(`safeDoc LLM API ${response.status}`);
  }
  const payload = await response.json();
  return {
    verifications: Array.isArray(payload?.verifications) ? payload.verifications : [],
    additions: Array.isArray(payload?.additions) ? payload.additions : [],
  };
}
