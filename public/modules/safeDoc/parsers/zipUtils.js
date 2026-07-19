// ZIP 컨테이너 공통 처리 — XLSX·DOCX·HWPX (기술명세서 Ⅻ-3 문서 보안)

import { fflate } from '../vendor/fflate.js';
import { AppError } from '../core/errors.js';

// ZIP 폭탄 방지 한도 (NFR-007)
const MAX_ZIP_ENTRIES = 10000;
const MAX_TOTAL_UNCOMPRESSED = 300 * 1024 * 1024; // 300MB

// 암호화된 Office 문서는 OLE(CFB) 컨테이너로 저장됨 → ZIP이 아님
function isOleContainer(bytes) {
  return bytes.length >= 8 &&
    bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
}

export function safeUnzip(buffer) {
  const bytes = new Uint8Array(buffer);
  if (isOleContainer(bytes)) {
    throw new AppError('E004');
  }
  // ZIP 시그니처 확인 (확장자와 실제 구조 교차검증)
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    throw new AppError('E005');
  }

  const { unzipSync } = fflate();

  // ZIP 폭탄 방어는 압축 해제 "중"에 이뤄져야 한다. filter 콜백은 각 항목의
  // originalSize(압축 해제 후 크기)를 실제 해제 전에 알려주므로, 여기서 누적
  // 검사하여 한도 초과 시 메모리를 할당하기 전에 중단한다.
  let entryCount = 0;
  let declaredTotal = 0;
  let bombError = null;
  const guard = (file) => {
    if (bombError) return false;
    entryCount += 1;
    declaredTotal += file.originalSize || 0;
    if (entryCount > MAX_ZIP_ENTRIES) {
      bombError = new AppError('E005', '압축 항목 수가 비정상적으로 많습니다.');
      return false;
    }
    if (declaredTotal > MAX_TOTAL_UNCOMPRESSED) {
      bombError = new AppError('E005', '압축해제 크기가 비정상적으로 큽니다.');
      return false;
    }
    return true;
  };

  let entries;
  try {
    entries = unzipSync(bytes, { filter: guard });
  } catch (e) {
    if (bombError) throw bombError;
    // fflate는 암호화 항목에서 오류를 던짐
    if (String(e).toLowerCase().includes('encrypt')) throw new AppError('E004');
    throw new AppError('E005');
  }
  if (bombError) throw bombError;

  // 실제 해제 결과로 재확인 (헤더의 originalSize가 위조된 경우 대비)
  let total = 0;
  for (const name of Object.keys(entries)) {
    total += entries[name].length;
    if (total > MAX_TOTAL_UNCOMPRESSED) throw new AppError('E005', '압축해제 크기가 비정상적으로 큽니다.');
  }
  return entries;
}

export function rezip(entries) {
  return fflate().zipSync(entries);
}

// XML 엔터티 처리
export function decodeXmlEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&');
}

export function encodeXmlEntities(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// XML 문자열에서 텍스트 노드 세그먼트 추출
// tagPattern: 여는 태그 정규식 소스 (예: '<w:t(?:\\s[^>]*)?>'), closeTag: '</w:t>'
// paragraphClose: 문단 종료 태그 — 세그먼트 사이에 줄바꿈 삽입 판단용 (null이면 항상 줄바꿈)
export function extractSegments(xml, { openTag, closeTag, paragraphClose }) {
  const segments = [];
  const re = new RegExp(`${openTag}([\\s\\S]*?)${closeTag}`, 'g');
  let prevRawEnd = 0;
  for (const m of xml.matchAll(re)) {
    const rawContent = m[1];
    const rawStart = m.index + m[0].length - closeTag.length - rawContent.length;
    const rawEnd = rawStart + rawContent.length;
    // 이전 세그먼트와의 사이에 문단 종료 태그가 있으면 줄바꿈으로 구분
    const between = xml.slice(prevRawEnd, m.index);
    const newParagraph = segments.length === 0
      ? false
      : (paragraphClose ? between.includes(paragraphClose) : true);
    segments.push({
      rawStart,
      rawEnd,
      text: decodeXmlEntities(rawContent),
      newParagraph,
    });
    prevRawEnd = rawEnd;
  }
  return segments;
}

// 여러 XML 파일의 세그먼트를 하나의 문서 텍스트로 결합 (전역 오프셋 부여)
// files: [{ path, xml, segments }] → 반환: { text, files(세그먼트에 globalStart/End 추가) }
export function joinSegments(files) {
  let text = '';
  for (const file of files) {
    for (const seg of file.segments) {
      if (text.length > 0) {
        // 문단 경계는 줄바꿈, 같은 문단 내 분리된 텍스트 런은 그대로 연결하여 결합 분석
        text += seg.newParagraph || seg.fileBoundary ? '\n' : '';
      }
      seg.globalStart = text.length;
      text += seg.text;
      seg.globalEnd = text.length;
    }
  }
  return text;
}

// 적용된 치환 내역(전역 위치 기준)을 각 세그먼트에 분배하여 새 텍스트 계산
// applied: [{ start, end, replacementText }] (전역 오프셋, 오름차순)
// 여러 세그먼트에 걸친 후보는 시작 세그먼트에 치환값을 넣고 나머지 구간은 삭제
export function applyToSegments(files, applied) {
  const sorted = applied.slice().sort((a, b) => a.start - b.start);
  for (const file of files) {
    for (const seg of file.segments) {
      const overlapping = sorted.filter((c) => c.start < seg.globalEnd && seg.globalStart < c.end);
      if (overlapping.length === 0) {
        seg.newText = seg.text;
        continue;
      }
      let out = '';
      let pos = seg.globalStart;
      for (const c of overlapping) {
        const from = Math.max(c.start, seg.globalStart);
        if (from > pos) out += seg.text.slice(pos - seg.globalStart, from - seg.globalStart);
        if (c.start >= seg.globalStart) out += c.replacementText; // 시작 세그먼트에만 삽입
        pos = Math.min(c.end, seg.globalEnd);
      }
      if (pos < seg.globalEnd) out += seg.text.slice(pos - seg.globalStart);
      seg.newText = out;
    }
  }
}

// 세그먼트 변경사항을 XML 문자열에 반영 (뒤쪽부터 치환하여 위치 유지)
export function spliceXml(xml, segments) {
  let result = xml;
  for (let i = segments.length - 1; i >= 0; i--) {
    const seg = segments[i];
    if (seg.newText === undefined || seg.newText === seg.text) continue;
    result = result.slice(0, seg.rawStart) + encodeXmlEntities(seg.newText) + result.slice(seg.rawEnd);
  }
  return result;
}
