// XLSX·DOCX·HWPX 공통 문서 처리 (기술명세서 Ⅳ-4~6)
// ZIP 내 XML의 텍스트 노드만 직접 수정하여 서식·구조를 보존한다.

import { fflate } from '../vendor/fflate.js';
import { safeUnzip, rezip, extractSegments, joinSegments, applyToSegments, spliceXml } from './zipUtils.js';
import { AppError } from '../core/errors.js';

// 어댑터가 적재한 fflate 인스턴스에서 꺼내 쓴다 (vendor/fflate.js 주석 참고)
const strFromU8 = (bytes) => fflate().strFromU8(bytes);
const strToU8 = (s) => fflate().strToU8(s);

// 형식별 구성
const FORMAT_CONFIGS = {
  xlsx: {
    // 공유 문자열 + 시트 인라인 문자열 (숨김 시트 포함 전체 시트 분석)
    requiredEntry: 'xl/workbook.xml',
    targetFiles: (names) => names.filter(
      (n) => n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/sheet\d+\.xml$/.test(n) || /^xl\/comments\d*\.xml$/.test(n),
    ),
    // <t> (sharedStrings/inlineStr/comments 공통), 셀 단위이므로 문단 구분 없이 항상 줄바꿈
    segmentSpec: { openTag: '<t(?:\\s[^>]*)?>', closeTag: '</t>', paragraphClose: null },
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    meta(entries) {
      const wb = strFromU8(entries['xl/workbook.xml']);
      const sheets = [...wb.matchAll(/<sheet[^>]*name="([^"]*)"/g)].map((m) => m[1]);
      return { sheetCount: sheets.length, sheetNames: sheets.join(', ') };
    },
  },
  docx: {
    requiredEntry: 'word/document.xml',
    targetFiles: (names) => names.filter(
      (n) => n === 'word/document.xml'
        || /^word\/(header|footer)\d+\.xml$/.test(n)
        || n === 'word/footnotes.xml' || n === 'word/endnotes.xml' || n === 'word/comments.xml',
    ),
    // 분리된 텍스트 런(<w:t>)은 문단(</w:p>) 경계가 없으면 결합하여 분석 (기술명세서 Ⅳ-5)
    segmentSpec: { openTag: '<w:t(?:\\s[^>]*)?>', closeTag: '</w:t>', paragraphClose: '</w:p>' },
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    meta(entries) {
      const doc = strFromU8(entries['word/document.xml']);
      return {
        paragraphCount: (doc.match(/<w:p[ >]/g) || []).length,
        tableCount: (doc.match(/<w:tbl>/g) || []).length,
      };
    },
  },
  hwpx: {
    requiredEntry: null, // section 파일 존재로 검증
    targetFiles: (names) => names.filter(
      (n) => /^Contents\/section\d+\.xml$/.test(n) || /^Contents\/header\.xml$/.test(n),
    ),
    // 본문 텍스트 노드 <hp:t>, 문단 </hp:p> (기술명세서 Ⅳ-6)
    segmentSpec: { openTag: '<hp:t(?:\\s[^>]*)?>', closeTag: '</hp:t>', paragraphClose: '</hp:p>' },
    mime: 'application/hwp+zip',
    meta(entries) {
      const sections = Object.keys(entries).filter((n) => /^Contents\/section\d+\.xml$/.test(n));
      return { sectionCount: sections.length };
    },
  },
};

export function parseZipDocument(buffer, format) {
  const config = FORMAT_CONFIGS[format];
  if (!config) throw new AppError('E001');

  const entries = safeUnzip(buffer);
  const names = Object.keys(entries);

  // 확장자와 실제 구조 교차검증
  if (config.requiredEntry && !entries[config.requiredEntry]) throw new AppError('E009');
  const targets = config.targetFiles(names);
  if (format === 'hwpx' && !targets.some((n) => /^Contents\/section\d+\.xml$/.test(n))) {
    throw new AppError('E009');
  }
  if (targets.length === 0) throw new AppError('E009');

  // 대상 XML에서 텍스트 세그먼트 추출
  const files = [];
  for (const path of targets.sort()) {
    const xml = strFromU8(entries[path]);
    const segments = extractSegments(xml, config.segmentSpec);
    if (segments.length > 0) segments[0].fileBoundary = true;
    files.push({ path, xml, segments });
  }

  const text = joinSegments(files);
  if (text.length === 0) {
    throw new AppError('E006', '문서에서 추출할 텍스트가 없습니다.');
  }

  return {
    format,
    text,
    entries,
    files,
    mime: config.mime,
    meta: { ...config.meta(entries), charCount: text.length },
  };
}

// 적용 내역을 XML에 반영하여 결과 ZIP 생성
export function buildZipResult(parsed, applied) {
  applyToSegments(parsed.files, applied);
  const newEntries = {};
  for (const [name, data] of Object.entries(parsed.entries)) {
    newEntries[name] = data;
  }
  for (const file of parsed.files) {
    const newXml = spliceXml(file.xml, file.segments);
    newEntries[file.path] = strToU8(newXml);
  }
  try {
    const zipped = rezip(newEntries);
    return new Blob([zipped], { type: parsed.mime });
  } catch {
    throw new AppError('E008');
  }
}

// 복원: 대응표의 치환값을 각 텍스트 세그먼트에서 원문으로 역치환
export function restoreZipDocument(parsed, mappingTable) {
  let restoredCount = 0;
  let notRestoredCount = 0;
  const sorted = mappingTable.mappings
    .slice()
    .sort((a, b) => b.replacement.length - a.replacement.length);
  const reversible = sorted.filter((m) => m.reversible);
  notRestoredCount = sorted.length - reversible.length;

  const restoredTokens = new Set();
  for (const file of parsed.files) {
    for (const seg of file.segments) {
      let newText = seg.text;
      for (const m of reversible) {
        if (newText.includes(m.replacement)) {
          newText = newText.split(m.replacement).join(m.original);
          restoredTokens.add(m.replacement);
        }
      }
      if (newText !== seg.text) seg.newText = newText;
    }
  }
  restoredCount = restoredTokens.size;

  const newEntries = {};
  for (const [name, data] of Object.entries(parsed.entries)) newEntries[name] = data;
  for (const file of parsed.files) {
    newEntries[file.path] = strToU8(spliceXml(file.xml, file.segments));
  }
  const blob = new Blob([rezip(newEntries)], { type: parsed.mime });
  return { blob, restoredCount, notRestoredCount };
}
