// 문서보안(safeDoc) 모듈 진입점 — app.js 가 쓰는 공개 API
//
// 이 화면에 처음 들어올 때만 무거운 의존성(fflate 등)을 적재하고 이벤트를 건다.
// 대메뉴를 떠날 때는 disposeSafeDoc() 로 작업 세션을 즉시 폐기한다.

import { preloadFflate } from './vendor/fflate.js';
import { showTab, showScreen, toast } from './ui/dom.js';

let initialized = false;
let initializing = null;

export async function initSafeDoc() {
  if (initialized) return;
  if (initializing) return initializing;

  initializing = (async () => {
    // ZIP 계열 파서(XLSX/DOCX/HWPX)는 fflate 를 동기 접근자로 쓰므로 먼저 적재한다.
    // pdf.js·pdf-lib·fontkit 은 PDF 를 실제로 다룰 때 각 어댑터가 지연 적재한다.
    await preloadFflate();

    const { initController } = await import('./controller.js');
    initController();
    showTab('deidentify');
    showScreen('main');
    initialized = true;
  })().catch((err) => {
    console.error('[safeDoc] 초기화 실패', err);
    toast('문서보안 기능을 불러오지 못했습니다. 새로고침 후 다시 시도하십시오.', true);
    throw err;
  }).finally(() => {
    initializing = null;
  });

  return initializing;
}

/**
 * 화면 이탈 시 호출. 작업 세션에는 원본 문서·개인정보 원문·대응표가 들어 있어
 * SPA에서 화면만 숨기면 메모리에 계속 남는다.
 */
export function disposeSafeDoc() {
  if (!initialized) return;
  import('./controller.js').then(({ disposeController }) => disposeController());
}
