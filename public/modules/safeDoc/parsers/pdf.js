// PDF 처리 (기술명세서 Ⅳ-7)
// 원문 텍스트 레이어가 남지 않도록 각 페이지를 이미지로 렌더링한 뒤,
// 개인정보 영역을 불투명 처리하고 그 위에 치환 토큰을 그려 새 PDF를 생성한다.
// (흰 사각형만 덮는 방식은 원문이 내부에 남으므로 사용하지 않는다)

import { loadPdfjs } from '../vendor/pdfjs.js';
import { loadPdfLib } from '../vendor/pdfLib.js';
import { loadFontkit } from '../vendor/fontkit.js';
import { tokenFontBytes } from '../assets/tokenFont.js';
import { AppError } from '../core/errors.js';

const MAX_PAGES = 500; // 기술명세서 Ⅺ-3 처리 한도
const RENDER_SCALE = 2; // 페이지 이미지 해상도 배율

// 같은 줄 판정 임계값(pt)
const LINE_Y_TOLERANCE = 2.5;
const WORD_GAP = 1.0;

export async function parsePdf(buffer, { render = typeof document !== 'undefined' } = {}) {
  const pdfjsLib = await loadPdfjs();

  let doc;
  let loadingTask;
  try {
    loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
    doc = await loadingTask.promise;
  } catch (e) {
    if (e?.name === 'PasswordException') throw new AppError('E004');
    throw new AppError('E005');
  }

  if (doc.numPages > MAX_PAGES) throw new AppError('E002', `PDF 페이지 수가 한도(${MAX_PAGES}쪽)를 초과했습니다.`);

  const segments = [];
  const pageSizes = [];
  const pageImages = [];
  let text = '';

  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 1 });
    pageSizes.push({ width: viewport.width, height: viewport.height });

    const content = await page.getTextContent();
    let prevY = null;
    let prevXEnd = null;
    for (const item of content.items) {
      if (!item.str || item.str.length === 0) continue;
      const x = item.transform[4];
      const y = item.transform[5];
      const fontH = Math.hypot(item.transform[1], item.transform[3]) || item.height || 10;

      // 세그먼트 구분자: 줄이 바뀌면 줄바꿈, 같은 줄에서 간격이 있으면 공백
      if (text.length > 0) {
        if (prevY === null || Math.abs(y - prevY) > LINE_Y_TOLERANCE) text += '\n';
        else if (x - prevXEnd > WORD_GAP) text += ' ';
      }
      const globalStart = text.length;
      text += item.str;
      segments.push({
        page: p - 1,
        str: item.str,
        x,
        y,
        width: item.width,
        fontH,
        globalStart,
        globalEnd: text.length,
      });
      prevY = y;
      prevXEnd = x + item.width;
    }

    if (render) {
      // 페이지를 캔버스에 렌더링하여 PNG로 보관 (원문 텍스트 레이어 제거용)
      const canvas = document.createElement('canvas');
      const rv = page.getViewport({ scale: RENDER_SCALE });
      canvas.width = Math.ceil(rv.width);
      canvas.height = Math.ceil(rv.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: rv }).promise;
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      pageImages.push(new Uint8Array(await blob.arrayBuffer()));
      canvas.width = 0; // 메모리 해제
      canvas.height = 0;
    } else {
      pageImages.push(null);
    }
    page.cleanup();
  }
  await loadingTask.destroy();

  if (text.trim().length === 0) {
    throw new AppError('E006', '텍스트 레이어가 없는 PDF(스캔 문서)는 지원하지 않습니다.');
  }

  return {
    format: 'pdf',
    text,
    segments,
    pageSizes,
    pageImages,
    meta: { pageCount: pageSizes.length, charCount: text.length },
  };
}

// 서브셋 폰트에 없는 글자는 '*'로 대체 (치환 토큰 외 임의 문자 방어)
const TOKEN_CHARS = new Set(
  [...'성명주민번호외국인휴대전화이메일주소계좌카드여권사업자차량생년월일삭제개인정보'],
);
function sanitizeForFont(s) {
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    out += (code >= 0x20 && code <= 0x7e) || TOKEN_CHARS.has(ch) ? ch : '*';
  }
  return out;
}

// 적용 내역을 반영한 새 PDF 생성
export async function buildPdfResult(parsed, applied) {
  try {
    const { PDFDocument, rgb } = await loadPdfLib();
    const pdfDoc = await PDFDocument.create();
    const sorted = applied.slice().sort((a, b) => a.start - b.start);
    let font = null;
    if (sorted.length > 0) {
      pdfDoc.registerFontkit(await loadFontkit());
      font = await pdfDoc.embedFont(tokenFontBytes(), { subset: true });
    }

    const pages = [];
    for (let i = 0; i < parsed.pageSizes.length; i++) {
      const { width, height } = parsed.pageSizes[i];
      const page = pdfDoc.addPage([width, height]);
      if (parsed.pageImages[i]) {
        const png = await pdfDoc.embedPng(parsed.pageImages[i]);
        page.drawImage(png, { x: 0, y: 0, width, height });
      }
      pages.push(page);
    }

    for (const c of sorted) {
      // 후보와 겹치는 세그먼트별로 원문 영역을 불투명 처리
      const overlapping = parsed.segments.filter(
        (s) => c.start < s.globalEnd && s.globalStart < c.end,
      );
      let first = true;
      for (const seg of overlapping) {
        const page = pages[seg.page];
        const len = seg.str.length || 1;
        const from = Math.max(c.start, seg.globalStart) - seg.globalStart;
        const to = Math.min(c.end, seg.globalEnd) - seg.globalStart;
        const rx = seg.x + seg.width * (from / len);
        const rw = seg.width * ((to - from) / len);
        const ry = seg.y - seg.fontH * 0.28;
        const rh = seg.fontH * 1.35;

        // 가림 영역은 글리프 실폭이 아니라 문자열 길이 비례로 근사한 값이라
        // 가변폭 폰트에서 좌우로 어긋날 수 있다. 원문이 삐져나오는 것보다
        // 조금 넓게 덮는 편이 안전하므로 글자 높이에 비례한 여유를 둔다.
        const padX = seg.fontH * 0.35;
        page.drawRectangle({
          x: rx - padX,
          y: ry,
          width: rw + padX * 2,
          height: rh,
          color: rgb(1, 1, 1),
        });

        if (first) {
          // 시작 세그먼트 위치에 치환 토큰 표시 (영역 폭에 맞게 축소)
          const label = sanitizeForFont(c.replacementText);
          let size = seg.fontH * 0.9;
          const labelWidth = font.widthOfTextAtSize(label, size);
          const available = Math.max(rw, 20);
          if (labelWidth > available) size *= available / labelWidth;
          size = Math.max(size, 4);
          page.drawText(label, { x: rx, y: seg.y, size, font, color: rgb(0.1, 0.1, 0.1) });
          first = false;
        }
      }
    }

    const bytes = await pdfDoc.save();
    return new Blob([bytes], { type: 'application/pdf' });
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError('E008');
  }
}
