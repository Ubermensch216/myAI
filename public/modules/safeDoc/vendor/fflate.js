// fflate 어댑터 — 문서보안(safeDoc) 모듈의 ZIP 처리 의존성
//
// safeDoc 원본은 번들러가 'fflate'를 해석하는 것을 전제로 했으나 myAI 프론트엔드는
// 번들 없는 네이티브 ESM이다. fflate/esm/browser.js는 bare specifier가 없는
// self-contained ESM이므로 public/vendor/ 에서 동적 import 한다.
//
// unzipSync/zipSync/strFromU8/strToU8 는 모두 동기 API이고, 이를 쓰는
// zipUtils.js·xmlDoc.js 의 함수 시그니처를 async 로 바꾸면 analyzer.js 와
// 시험 코드까지 전파된다. 따라서 진입점에서 preloadFflate() 로 한 번 적재한 뒤
// 동기 접근자 fflate() 로 꺼내 쓰는 방식을 택했다.

let cached = null;

export async function preloadFflate() {
  if (!cached) {
    cached = typeof window === 'undefined'
      ? await import('fflate') // Node(시험) 환경
      : await import('/vendor/fflate/fflate.esm.js');
  }
  return cached;
}

export function fflate() {
  if (!cached) {
    throw new Error('[safeDoc] fflate가 적재되지 않았습니다. preloadFflate()를 먼저 호출하십시오.');
  }
  return cached;
}
