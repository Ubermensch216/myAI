// TXT 파서 (기술명세서 Ⅳ-2)

import { decodeBuffer, encodeText } from './encoding.js';
import { AppError } from '../core/errors.js';

export function parseTxt(buffer) {
  let decoded;
  try {
    decoded = decodeBuffer(buffer);
  } catch {
    throw new AppError('E006');
  }
  return {
    format: 'txt',
    text: decoded.text, // 탐지 대상 전체 텍스트 (줄바꿈 구조 유지)
    encoding: decoded.encoding,
    bom: decoded.bom,
    meta: {
      lineCount: decoded.text.split('\n').length,
      charCount: decoded.text.length,
      encoding: decoded.encoding.toUpperCase(),
    },
  };
}

// 비식별 처리된 텍스트를 결과 파일로 생성
export function buildTxtResult(parsed, processedText) {
  const bytes = encodeText(processedText, parsed.encoding, parsed.bom);
  return new Blob([bytes], { type: 'text/plain' });
}
