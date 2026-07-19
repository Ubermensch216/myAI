// fontkit 어댑터 — 결과 PDF에 치환 토큰용 한글 서브셋 폰트를 삽입할 때 사용
//
// @pdf-lib/fontkit 의 ES 빌드(fontkit.es.min.js)는 `import from "pako"` bare
// specifier가 남아 있어 브라우저에서 직접 import 할 수 없다. UMD 빌드는 pako를
// 인라인 번들하므로 그쪽을 <script> 주입으로 지연 적재하여 window.fontkit 을 얻는다.
// (PDF 처리 시에만 741KB를 내려받는다)

import { AppError } from '../core/errors.js';

const SCRIPT_SRC = '/vendor/fontkit/fontkit.umd.min.js';
let cached = null;
let pending = null;

export async function loadFontkit() {
  if (cached) return cached;

  if (typeof window === 'undefined') {
    cached = (await import('@pdf-lib/fontkit')).default; // Node(시험) 환경
    return cached;
  }

  if (window.fontkit) {
    cached = window.fontkit;
    return cached;
  }

  if (!pending) {
    pending = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.onload = () => {
        if (window.fontkit) resolve(window.fontkit);
        else reject(new AppError('E008', '폰트 라이브러리를 불러오지 못했습니다.'));
      };
      script.onerror = () => reject(new AppError('E008', '폰트 라이브러리를 불러오지 못했습니다.'));
      document.head.appendChild(script);
    }).catch((e) => {
      pending = null; // 재시도 가능하도록 초기화
      throw e;
    });
  }

  cached = await pending;
  return cached;
}
