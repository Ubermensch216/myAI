// pdf.js 어댑터 — PDF 텍스트 추출 및 페이지 렌더링
//
// safeDoc 원본은 Vite의 `?worker&inline` 로 워커를 번들에 인라인했으나
// myAI는 번들 없는 네이티브 ESM이므로 워커 파일을 public/vendor/ 에 정적 배치하고
// GlobalWorkerOptions.workerSrc 로 지정한다. pdf.min.mjs 내부가
// `new Worker(src, { type: 'module' })` 로 same-origin 워커를 생성한다.

let cached = null;

export async function loadPdfjs() {
  if (cached) return cached;

  if (typeof window === 'undefined') {
    // Node(시험) 환경 — 워커 없이 메인 스레드에서 처리
    cached = await import('pdfjs-dist/legacy/build/pdf.mjs');
    return cached;
  }

  const lib = await import('/vendor/pdfjs/pdf.min.mjs');
  lib.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs/pdf.worker.min.mjs';
  cached = lib;
  return cached;
}
