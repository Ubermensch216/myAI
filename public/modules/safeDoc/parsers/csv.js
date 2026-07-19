// CSV 파서 (기술명세서 Ⅳ-3)
// 원문 텍스트를 그대로 유지한 채 셀 위치만 기록하여, 치환 시 구분자·셀 구조가 보존된다.

import { decodeBuffer, encodeText } from './encoding.js';
import { AppError } from '../core/errors.js';
import { FIELD_KEYWORDS_BY_TYPE } from '../detect/dictionaries.js';

// 구분자 판별: 첫 행 기준 쉼표/탭/세미콜론 출현 수 비교
export function detectDelimiter(text) {
  const firstLine = text.slice(0, text.indexOf('\n') >= 0 ? text.indexOf('\n') : text.length);
  const counts = {
    ',': (firstLine.match(/,/g) || []).length,
    '\t': (firstLine.match(/\t/g) || []).length,
    ';': (firstLine.match(/;/g) || []).length,
  };
  let best = ',';
  for (const [d, n] of Object.entries(counts)) {
    if (n > counts[best]) best = d;
  }
  return best;
}

// 셀 단위 토큰화 — 각 셀 내용의 원문 내 위치(start/end)를 기록
// 큰따옴표 셀·셀 내 줄바꿈 지원
export function tokenizeCsv(text, delimiter) {
  const rows = [];
  let row = [];
  let i = 0;
  const len = text.length;

  while (i <= len) {
    if (i === len) {
      if (row.length > 0 || rows.length === 0) rows.push(row);
      break;
    }
    const ch = text[i];
    if (ch === '"') {
      // 따옴표 셀: 내부 시작 위치부터 닫는 따옴표 전까지
      const contentStart = i + 1;
      let j = contentStart;
      while (j < len) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            j += 2;
            continue;
          }
          break;
        }
        j += 1;
      }
      row.push({ value: text.slice(contentStart, j).replace(/""/g, '"'), start: contentStart, end: j, quoted: true });
      i = j + 1;
      // 따옴표 뒤 구분자/줄바꿈 소비
      if (text[i] === delimiter) i += 1;
      else if (text[i] === '\r' && text[i + 1] === '\n') { rows.push(row); row = []; i += 2; }
      else if (text[i] === '\n') { rows.push(row); row = []; i += 1; }
    } else {
      let j = i;
      while (j < len && text[j] !== delimiter && text[j] !== '\n' && text[j] !== '\r') j += 1;
      row.push({ value: text.slice(i, j), start: i, end: j, quoted: false });
      if (j >= len) { rows.push(row); break; }
      if (text[j] === delimiter) i = j + 1;
      else if (text[j] === '\r' && text[j + 1] === '\n') { rows.push(row); row = []; i = j + 2; }
      else { rows.push(row); row = []; i = j + 1; }
    }
  }
  return rows;
}

// 헤더명 → 개인정보 유형 추정 (기술명세서 Ⅳ-3: 헤더명 기반 유형 추정)
export function inferColumnTypes(headerRow) {
  const hints = [];
  for (let col = 0; col < headerRow.length; col++) {
    const header = headerRow[col].value.trim();
    if (!header) { hints.push(null); continue; }
    let matched = null;
    for (const [type, keywords] of Object.entries(FIELD_KEYWORDS_BY_TYPE)) {
      if (keywords.some((k) => header === k || header.includes(k))) {
        matched = type;
        break;
      }
    }
    hints.push(matched);
  }
  return hints;
}

export function parseCsv(buffer) {
  let decoded;
  try {
    decoded = decodeBuffer(buffer);
  } catch {
    throw new AppError('E006');
  }
  const text = decoded.text;
  const delimiter = detectDelimiter(text);
  const rows = tokenizeCsv(text, delimiter);

  // 첫 행 헤더 여부: 첫 행에 숫자만인 셀이 없으면 헤더로 간주
  const firstRow = rows[0] || [];
  const hasHeader =
    firstRow.length > 1 && firstRow.every((c) => c.value.trim() !== '' && !/^\d+$/.test(c.value.trim()));
  const columnTypeHints = hasHeader ? inferColumnTypes(firstRow) : [];

  return {
    format: 'csv',
    text,
    encoding: decoded.encoding,
    bom: decoded.bom,
    delimiter,
    rows,
    hasHeader,
    columnTypeHints,
    meta: {
      rowCount: rows.length,
      columnCount: firstRow.length,
      delimiter: delimiter === '\t' ? '탭' : delimiter,
      encoding: decoded.encoding.toUpperCase(),
      hasHeader,
    },
  };
}

// 헤더 유형 힌트 기반 열 단위 후보 생성 (엔진 결과와 병합 후 중첩 정리)
export function columnCandidates(parsed) {
  if (!parsed.hasHeader) return [];
  const out = [];
  const { rows, columnTypeHints } = parsed;
  for (let r = 1; r < rows.length; r++) {
    for (let col = 0; col < rows[r].length; col++) {
      const type = columnTypeHints[col];
      if (!type) continue;
      const cell = rows[r][col];
      const value = cell.value.trim();
      if (!value) continue;
      const offset = cell.value.indexOf(value);
      out.push({
        start: cell.start + offset,
        end: cell.start + offset + value.length,
        originalText: value,
        type,
        baseScore: 0.8,
        detectionMethod: 'FIELD_HEADER',
        context: `${rows[0][col].value.trim()} 열`,
      });
    }
  }
  return out;
}

export function buildCsvResult(parsed, processedText) {
  const bytes = encodeText(processedText, parsed.encoding, parsed.bom);
  return new Blob([bytes], { type: 'text/csv' });
}
