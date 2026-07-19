// pdf-lib 어댑터 — 비식별 결과 PDF 생성
//
// myAI는 index.html 에서 /vendor/pdf-lib.min.js 를 defer 스크립트로 이미 적재하여
// window.PDFLib 전역을 제공한다. 2.5MB 중복을 피하기 위해 그 전역을 재사용한다.

import { AppError } from '../core/errors.js';

let cached = null;

export async function loadPdfLib() {
  if (cached) return cached;

  if (typeof window === 'undefined') {
    cached = await import('pdf-lib'); // Node(시험) 환경
    return cached;
  }

  // defer 스크립트라 모듈 실행 시점에는 이미 준비되어 있지만, 로드 순서가 어긋나는
  // 경우를 대비해 짧게 기다린다.
  const deadline = Date.now() + 3000;
  while (!window.PDFLib) {
    if (Date.now() > deadline) {
      throw new AppError('E008', 'PDF 라이브러리를 불러오지 못했습니다. 새로고침 후 다시 시도하십시오.');
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  cached = window.PDFLib;
  return cached;
}
