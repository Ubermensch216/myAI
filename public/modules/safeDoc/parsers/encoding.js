// 문자 인코딩 자동 판별 (기술명세서 Ⅳ-2: UTF-8, UTF-8 BOM, EUC-KR/CP949)

export function detectEncoding(buffer) {
  const bytes = new Uint8Array(buffer);

  // UTF-8 BOM
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { encoding: 'utf-8', bom: true };
  }
  // UTF-16 BOM (참고용 — 지원 범위 외지만 읽기는 시도)
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { encoding: 'utf-16le', bom: true };
  }

  // UTF-8 유효성 검사 (fatal 디코더 사용)
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return { encoding: 'utf-8', bom: false };
  } catch {
    // UTF-8이 아니면 한국어 환경 기준 EUC-KR(CP949)로 간주
    return { encoding: 'euc-kr', bom: false };
  }
}

export function decodeBuffer(buffer) {
  const { encoding, bom } = detectEncoding(buffer);
  const text = new TextDecoder(encoding).decode(buffer);
  // BOM 문자 제거
  return { text: text.replace(/^﻿/, ''), encoding, bom };
}

// 출력 인코딩: EUC-KR 인코딩 쓰기는 브라우저가 지원하지 않으므로 UTF-8로 저장
// (기술명세서 Ⅳ-2: "원본 인코딩 또는 UTF-8")
export function encodeText(text, sourceEncoding, sourceBom) {
  const withBom = sourceEncoding === 'utf-8' && sourceBom ? '﻿' + text : text;
  return new TextEncoder().encode(withBom);
}
