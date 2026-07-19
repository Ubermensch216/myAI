// 분석 파이프라인 — 파서 실행 + 탐지엔진 + 열 힌트 병합

import { parseTxt, buildTxtResult } from '../parsers/txt.js';
import { parseCsv, columnCandidates, buildCsvResult } from '../parsers/csv.js';
import { parseZipDocument, buildZipResult, restoreZipDocument } from '../parsers/xmlDoc.js';
import { parsePdf, buildPdfResult } from '../parsers/pdf.js';
import { restoreText } from './restore.js';
import { detectAll, resolveOverlaps } from '../detect/engine.js';
import { getContext } from '../detect/rules/helpers.js';
import { AppError } from './errors.js';

// PDF는 비동기 파싱이므로 항상 await하여 사용한다
export async function parseDocument(file) {
  switch (file.ext) {
    case 'txt':
      return parseTxt(file.buffer);
    case 'csv':
      return parseCsv(file.buffer);
    case 'xlsx':
    case 'docx':
    case 'hwpx':
      return parseZipDocument(file.buffer, file.ext);
    case 'pdf':
      return parsePdf(file.buffer);
    default:
      throw new AppError('E001');
  }
}

// 탐지 실행: 엔진 후보 + CSV 열 힌트 후보를 병합하고 중첩을 정리
export function analyze(parsed, userRules = []) {
  const engineCandidates = detectAll(parsed.text, 'body', userRules);

  if (parsed.format === 'csv') {
    const colCands = columnCandidates(parsed);
    if (colCands.length > 0) {
      // 엔진 후보를 원시 형태로 되돌려 병합 (id는 병합 후 재부여)
      const raw = engineCandidates.map((c) => ({
        start: c.start, end: c.end, originalText: c.originalText, type: c.type,
        baseScore: c.confidence, detectionMethod: c.detectionMethod, context: c.context,
      }));
      const merged = resolveOverlaps([...raw, ...colCands]);
      let seq = 0;
      return merged.map((c) => {
        seq += 1;
        return {
          id: `pii-${String(seq).padStart(6, '0')}`,
          documentPart: 'body',
          start: c.start,
          end: c.end,
          originalText: c.originalText,
          type: c.type,
          confidence: Math.max(0, Math.min(1, c.baseScore)),
          detectionMethod: c.detectionMethod,
          context: c.context || getContext(parsed.text, c.start, c.end),
          selected: true,
          action: null,
          replacementText: null,
        };
      });
    }
  }
  return engineCandidates;
}

export async function buildResult(parsed, processedText, applied = []) {
  switch (parsed.format) {
    case 'txt':
      return buildTxtResult(parsed, processedText);
    case 'csv':
      return buildCsvResult(parsed, processedText);
    case 'xlsx':
    case 'docx':
    case 'hwpx':
      // ZIP 형식은 텍스트 세그먼트 단위로 XML에 직접 반영 (서식 보존)
      return buildZipResult(parsed, applied);
    case 'pdf':
      // 페이지 이미지 + 개인정보 영역 불투명 처리 + 치환 토큰 표시
      return buildPdfResult(parsed, applied);
    default:
      throw new AppError('E008');
  }
}

// 대응표를 이용한 원본 복원 (형식 공통 진입점)
export async function restoreDocument(parsed, mappingTable) {
  switch (parsed.format) {
    case 'txt':
    case 'csv': {
      const { text, restoredCount, notRestoredCount } = restoreText(parsed.text, mappingTable);
      return { blob: await buildResult(parsed, text), restoredCount, notRestoredCount };
    }
    case 'xlsx':
    case 'docx':
    case 'hwpx':
      return restoreZipDocument(parsed, mappingTable);
    case 'pdf':
      // PDF 결과는 이미지 기반이므로 파일 복원이 불가능 — 대응표로 원문 값만 확인 가능
      throw new AppError('E009', 'PDF는 파일 복원을 지원하지 않습니다. 대응표에서 원문 값을 확인하십시오.');
    default:
      throw new AppError('E001');
  }
}
