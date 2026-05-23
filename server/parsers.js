import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { XMLParser } from "fast-xml-parser";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".xls", ".csv", ".pptx", ".hwpx", ".md"]);
const MAX_STORED_TABLE_ROWS = 800;
const MAX_STORED_TABLE_COLUMNS = 60;
const MAX_PROFILE_VALUES = 12;
const BUILTIN_DATE_FORMAT_IDS = new Set([
  14, 15, 16, 17, 18, 19, 20, 21, 22,
  27, 28, 29, 30, 31, 32, 33, 34, 35, 36,
  45, 46, 47, 50, 57
]);

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  preserveOrder: false,
  parseTagValue: false,
  trimValues: true
});

const xmlParserWithAttributes = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: false,
  parseTagValue: false,
  trimValues: true
});

const hwpxXmlParser = new XMLParser({
  ignoreAttributes: false,
  preserveOrder: true,
  parseTagValue: false,
  trimValues: false
});

export async function parseUpload(file) {
  const extension = path.extname(file.originalname).toLowerCase();

  if (IMAGE_EXTENSIONS.has(extension)) {
    return parseImage(file, extension);
  }

  if (!DOCUMENT_EXTENSIONS.has(extension)) {
    throw new Error(`지원하지 않는 파일 형식입니다: ${extension || "unknown"}`);
  }

  if (extension === ".pdf") return parsePdf(file);
  if (extension === ".docx") return parseDocx(file);
  if (extension === ".xls") {
    throw new Error("구형 .xls는 보안상 직접 파싱하지 않습니다. .xlsx로 변환한 뒤 업로드해 주세요.");
  }
  if (extension === ".xlsx") return parseWorkbook(file);
  if (extension === ".csv") return parseCsv(file);
  if (extension === ".pptx") return parsePptx(file);
  if (extension === ".hwpx") return parseHwpx(file);
  if (extension === ".md") return parseMarkdown(file);

  throw new Error(`아직 처리할 수 없는 파일입니다: ${file.originalname}`);
}

async function parseImage(file, extension) {
  const buffer = await fs.readFile(file.path);
  return {
    fileName: file.originalname,
    fileType: extension.slice(1),
    kind: "image",
    mimeType: file.mimetype,
    imageBase64: buffer.toString("base64"),
    text: "",
    pages: []
  };
}

async function parsePdf(file) {
  const buffer = await fs.readFile(file.path);
  const parsed = await pdfParse(buffer);
  const text = normalizeText(parsed.text);

  return {
    fileName: file.originalname,
    fileType: "pdf",
    kind: "document",
    text,
    pages: splitIntoPages(text, parsed.numpages || 1)
  };
}

async function parseDocx(file) {
  const result = await mammoth.extractRawText({ path: file.path });
  const text = normalizeText(result.value);

  return {
    fileName: file.originalname,
    fileType: "docx",
    kind: "document",
    text,
    pages: [{ page: 1, text }]
  };
}

async function parseMarkdown(file) {
  const buffer = await fs.readFile(file.path);
  const text = normalizeText(stripUtf8Bom(buffer.toString("utf8")));

  return {
    fileName: file.originalname,
    fileType: "md",
    kind: "document",
    text,
    pages: [{ page: 1, text }]
  };
}

async function parseCsv(file) {
  const buffer = await fs.readFile(file.path);
  const content = stripUtf8Bom(buffer.toString("utf8"));
  const table = buildTableFromRows("CSV", parseCsvRows(content));
  const text = normalizeText(tableRowsForText(table).map((row) => row.join(", ")).join("\n"));

  return {
    fileName: file.originalname,
    fileType: "csv",
    kind: "document",
    text,
    sheets: [{ ...table, text }],
    tables: [table],
    pages: [{ page: 1, label: "CSV", text }]
  };
}

async function parseWorkbook(file) {
  const buffer = await fs.readFile(file.path);
  const zip = await JSZip.loadAsync(buffer);
  const sharedStrings = await readSharedStrings(zip);
  const dateStyleIndexes = await readDateStyleIndexes(zip);
  const sheetNames = await readSheetNames(zip);
  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(compareNatural);

  const sheets = [];
  for (const [index, sheetPath] of sheetFiles.entries()) {
    const xml = await zip.file(sheetPath).async("string");
    const parsed = xmlParserWithAttributes.parse(xml);
    const rows = readWorksheetRows(parsed, sharedStrings, dateStyleIndexes);
    const table = buildTableFromRows(sheetNames[index] || `Sheet ${index + 1}`, rows);
    const text = normalizeText(tableRowsForText(table).map((row) => row.join(", ")).join("\n"));

    sheets.push({
      ...table,
      text
    });
  }

  const text = sheets
    .map((sheet) => `# Sheet: ${sheet.name}\n${sheet.text}`)
    .join("\n\n");

  return {
    fileName: file.originalname,
    fileType: "xlsx",
    kind: "document",
    text,
    sheets,
    tables: sheets.map(({ name, headers, rows, rowCount, columnCount, truncated, profile }) => ({
      name,
      headers,
      rows,
      rowCount,
      columnCount,
      truncated,
      profile
    })),
    pages: sheets.map((sheet, index) => ({
      page: index + 1,
      label: sheet.name,
      text: sheet.text
    }))
  };
}

async function readSharedStrings(zip) {
  const file = zip.file("xl/sharedStrings.xml");
  if (!file) return [];

  const parsed = xmlParserWithAttributes.parse(await file.async("string"));
  return asArray(parsed.sst?.si).map((item) => {
    if (item.t) return String(item.t);
    return collectText(item).join("");
  });
}

async function readSheetNames(zip) {
  const file = zip.file("xl/workbook.xml");
  if (!file) return [];

  const parsed = xmlParserWithAttributes.parse(await file.async("string"));
  return asArray(parsed.workbook?.sheets?.sheet).map((sheet) => String(sheet.name || ""));
}

async function readDateStyleIndexes(zip) {
  const file = zip.file("xl/styles.xml");
  if (!file) return new Set();

  const parsed = xmlParserWithAttributes.parse(await file.async("string"));
  const customDateFormatIds = new Set(
    asArray(parsed.styleSheet?.numFmts?.numFmt)
      .filter((format) => isDateFormatCode(format?.formatCode))
      .map((format) => Number(format.numFmtId))
      .filter(Number.isFinite)
  );

  const dateStyleIndexes = new Set();
  for (const [index, xf] of asArray(parsed.styleSheet?.cellXfs?.xf).entries()) {
    const numFmtId = Number(xf?.numFmtId);
    if (BUILTIN_DATE_FORMAT_IDS.has(numFmtId) || customDateFormatIds.has(numFmtId)) {
      dateStyleIndexes.add(index);
    }
  }
  return dateStyleIndexes;
}

function readWorksheetRows(parsed, sharedStrings, dateStyleIndexes = new Set()) {
  const rows = asArray(parsed.worksheet?.sheetData?.row).map((row) => {
    const values = [];

    for (const cell of asArray(row.c)) {
      const columnIndex = getCellColumnIndex(cell?.r);
      const value = readCellValue(cell, sharedStrings, dateStyleIndexes);
      if (columnIndex >= 0) values[columnIndex] = value;
      else values.push(value);
    }

    return trimTrailingEmpty(values.map((value) => String(value ?? "")));
  });

  return applyMergedCells(rows, readMergedRanges(parsed));
}

function getCellColumnIndex(reference = "") {
  const match = String(reference).match(/^[A-Z]+/i);
  if (!match) return -1;

  let index = 0;
  for (const character of match[0].toUpperCase()) {
    index = index * 26 + character.charCodeAt(0) - 64;
  }
  return index - 1;
}

function readCellValue(cell, sharedStrings, dateStyleIndexes = new Set()) {
  if (!cell) return "";
  if (cell.t === "s") return sharedStrings[Number(cell.v)] ?? "";
  if (cell.t === "inlineStr") return collectText(cell.is).join("");
  if (cell.t === "b") return cell.v === "1" ? "TRUE" : "FALSE";
  if (isDateStyleCell(cell, dateStyleIndexes)) {
    const converted = excelSerialDateToIso(cell.v);
    if (converted) return converted;
  }
  return String(cell.v ?? "");
}

function isDateStyleCell(cell, dateStyleIndexes) {
  const styleIndex = Number(cell?.s);
  return Number.isInteger(styleIndex)
    && dateStyleIndexes.has(styleIndex)
    && cell?.v !== undefined
    && cell.t !== "str";
}

function isDateFormatCode(value) {
  const code = String(value ?? "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "")
    .replace(/\[[^\]]*]/g, "")
    .toLowerCase();
  if (!code) return false;
  if (/[ymd]/.test(code)) return true;
  return /h{1,2}:m{1,2}|m{1,2}:s{1,2}|am\/pm/.test(code);
}

function excelSerialDateToIso(value) {
  const serial = Number(value);
  if (!Number.isFinite(serial) || serial <= 0) return "";

  const wholeDays = Math.floor(serial);
  const fraction = serial - wholeDays;
  const leapBugOffset = wholeDays >= 60 ? -1 : 0;
  const epoch = Date.UTC(1899, 11, 31);
  const millis = epoch + (wholeDays + leapBugOffset) * 86400000 + Math.round(fraction * 86400000);
  const date = new Date(millis);
  if (Number.isNaN(date.getTime())) return "";

  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  const ss = String(date.getUTCSeconds()).padStart(2, "0");
  return fraction
    ? `${yyyy}-${mm}-${dd} ${hh}:${min}${ss !== "00" ? `:${ss}` : ""}`
    : `${yyyy}-${mm}-${dd}`;
}

function readMergedRanges(parsed) {
  return asArray(parsed.worksheet?.mergeCells?.mergeCell)
    .map((mergeCell) => parseCellRange(mergeCell?.ref))
    .filter(Boolean);
}

function parseCellRange(reference) {
  const [startRef, endRef] = String(reference ?? "").split(":");
  const start = parseCellReference(startRef);
  const end = parseCellReference(endRef || startRef);
  if (!start || !end) return null;
  return {
    startRow: Math.min(start.row, end.row),
    endRow: Math.max(start.row, end.row),
    startColumn: Math.min(start.column, end.column),
    endColumn: Math.max(start.column, end.column)
  };
}

function parseCellReference(reference) {
  const match = String(reference ?? "").match(/^([A-Z]+)(\d+)$/i);
  if (!match) return null;
  return {
    column: getCellColumnIndex(match[1]),
    row: Number(match[2]) - 1
  };
}

function applyMergedCells(rows, ranges) {
  if (!ranges.length) return rows;
  const nextRows = rows.map((row) => [...row]);
  for (const range of ranges) {
    const source = nextRows[range.startRow]?.[range.startColumn];
    if (source === undefined || source === "") continue;
    for (let rowIndex = range.startRow; rowIndex <= range.endRow; rowIndex += 1) {
      if (!nextRows[rowIndex]) nextRows[rowIndex] = [];
      for (let columnIndex = range.startColumn; columnIndex <= range.endColumn; columnIndex += 1) {
        if (nextRows[rowIndex][columnIndex] === undefined || nextRows[rowIndex][columnIndex] === "") {
          nextRows[rowIndex][columnIndex] = source;
        }
      }
    }
  }
  return nextRows.map((row) => trimTrailingEmpty(row.map((value) => String(value ?? ""))));
}

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === "\"") {
      if (inQuotes && next === "\"") {
        field += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      continue;
    }

    field += character;
  }

  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

function buildTableFromRows(name, sourceRows) {
  const normalizedRows = normalizeRows(sourceRows);
  const sourceColumnCount = normalizedRows.reduce((max, row) => Math.max(max, row.length), 0);
  const limitedRows = normalizedRows
    .slice(0, MAX_STORED_TABLE_ROWS + 1)
    .map((row) => row.slice(0, MAX_STORED_TABLE_COLUMNS));
  const hasHeader = inferHeaderRow(limitedRows);
  const columnCount = limitedRows.reduce((max, row) => Math.max(max, row.length), 0);
  const headers = hasHeader
    ? buildHeaders(limitedRows[0] || [], columnCount)
    : buildHeaders([], columnCount);
  const rows = hasHeader ? limitedRows.slice(1) : limitedRows;
  const paddedRows = rows.map((row) => padRow(row, headers.length));

  return {
    name,
    headers,
    rows: paddedRows,
    sampleRows: paddedRows.slice(0, 12).map((row) => rowToRecord(headers, row)),
    rowCount: Math.max(0, normalizedRows.length - (hasHeader ? 1 : 0)),
    columnCount: headers.length,
    truncated: normalizedRows.length > limitedRows.length || sourceColumnCount > MAX_STORED_TABLE_COLUMNS,
    profile: profileTable(headers, paddedRows)
  };
}

function inferHeaderRow(rows) {
  if (!rows.length) return false;
  const first = rows[0] || [];
  const second = rows[1] || [];
  const firstTextCount = first.filter((value) => {
    const text = String(value ?? "").trim();
    return text && !isNumericText(text);
  }).length;
  const secondNumericCount = second.filter((value) => isNumericText(value)).length;
  return firstTextCount > 0 && (firstTextCount >= Math.ceil(first.length / 2) || secondNumericCount > 0);
}

function buildHeaders(row, columnCount) {
  const seen = new Map();
  const headers = [];

  for (let index = 0; index < columnCount; index += 1) {
    const fallback = `Column ${index + 1}`;
    const base = String(row[index] ?? "").trim() || fallback;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    headers.push(count ? `${base} ${count + 1}` : base);
  }

  return headers;
}

function normalizeRows(rows) {
  return rows
    .map((row) => trimTrailingEmpty(asArray(row).map((value) => String(value ?? "").trim())))
    .filter((row) => row.some((value) => value !== ""));
}

function trimTrailingEmpty(row) {
  const trimmed = [...row];
  while (trimmed.length && String(trimmed[trimmed.length - 1] ?? "").trim() === "") {
    trimmed.pop();
  }
  return trimmed;
}

function padRow(row, length) {
  return Array.from({ length }, (_value, index) => String(row[index] ?? ""));
}

function tableRowsForText(table) {
  if (!table.headers.length) return table.rows;
  return [table.headers, ...table.rows];
}

function rowToRecord(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function profileTable(headers, rows) {
  return {
    columns: headers.map((header, index) => profileColumn(header, rows.map((row) => row[index])))
  };
}

function profileColumn(name, values) {
  const nonEmptyValues = values.map((value) => String(value ?? "").trim()).filter(Boolean);
  const numbers = nonEmptyValues
    .map(parseNumber)
    .filter((value) => Number.isFinite(value));
  const numberRatio = nonEmptyValues.length ? numbers.length / nonEmptyValues.length : 0;
  const topValues = topValueCounts(nonEmptyValues);
  const numeric = numberRatio >= 0.75 && numbers.length > 0;

  return {
    name,
    type: numeric ? "number" : "category",
    count: nonEmptyValues.length,
    emptyCount: Math.max(0, values.length - nonEmptyValues.length),
    uniqueCount: new Set(nonEmptyValues).size,
    ...(numeric
      ? {
          min: Math.min(...numbers),
          max: Math.max(...numbers),
          sum: roundNumber(numbers.reduce((sum, value) => sum + value, 0)),
          average: roundNumber(numbers.reduce((sum, value) => sum + value, 0) / numbers.length)
        }
      : {}),
    topValues
  };
}

function topValueCounts(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, MAX_PROFILE_VALUES)
    .map(([value, count]) => ({ value, count }));
}

function isNumericText(value) {
  return Number.isFinite(parseNumber(value));
}

function parseNumber(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/,/g, "")
    .replace(/[%$]/g, "");
  if (!text) return NaN;
  return Number(text);
}

function roundNumber(value) {
  return Math.round(value * 10000) / 10000;
}

function stripUtf8Bom(text) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

async function parsePptx(file) {
  const buffer = await fs.readFile(file.path);
  const zip = await JSZip.loadAsync(buffer);
  const slideFiles = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    .sort(compareNatural);

  const pages = [];
  for (const slidePath of slideFiles) {
    const xml = await zip.file(slidePath).async("string");
    const parsed = xmlParser.parse(xml);
    const text = normalizeText(collectText(parsed).join("\n"));
    const slideNumber = Number(slidePath.match(/slide(\d+)\.xml$/i)?.[1] ?? pages.length + 1);
    pages.push({ page: slideNumber, text });
  }

  const text = pages.map((page) => `# Slide ${page.page}\n${page.text}`).join("\n\n");

  return {
    fileName: file.originalname,
    fileType: "pptx",
    kind: "document",
    text,
    pages
  };
}

async function parseHwpx(file) {
  const buffer = await fs.readFile(file.path);
  const zip = await JSZip.loadAsync(buffer);
  const textFiles = Object.keys(zip.files)
    .filter((name) => /(^Contents\/section\d+\.xml$|^Preview\/PrvText\.txt$)/i.test(name))
    .sort(compareNatural);

  const pages = [];
  for (const filePath of textFiles) {
    const content = await zip.file(filePath).async("string");
    const text = filePath.toLowerCase().endsWith(".xml")
      ? parseHwpxSectionXml(content)
      : normalizeText(content);
    pages.push({ page: pages.length + 1, label: filePath, text });
  }

  const text = pages.map((page) => `# ${page.label}\n${page.text}`).join("\n\n");

  return {
    fileName: file.originalname,
    fileType: "hwpx",
    kind: "document",
    text,
    pages
  };
}

function getLocalName(tagName) {
  if (!tagName) return "";
  const parts = tagName.split(":");
  return parts[parts.length - 1];
}

function processHwpxNodes(nodes) {
  if (!Array.isArray(nodes)) return "";
  let result = "";
  for (const node of nodes) {
    const tagName = Object.keys(node)[0];
    if (tagName === ":@" || !tagName) continue;
    const children = node[tagName];
    const localName = getLocalName(tagName);
    
    if (localName === "p") {
      const pText = processHwpxNodes(children).trim();
      if (pText) {
        result += pText + "\n\n";
      }
    } else if (localName === "tbl") {
      const tableMarkdown = processHwpxTable(children);
      if (tableMarkdown) {
        result += "\n" + tableMarkdown + "\n\n";
      }
    } else if (localName === "t" || tagName === "#text") {
      if (tagName === "#text") {
        result += String(children);
      } else {
        result += processHwpxNodes(children);
      }
    } else if (localName === "tr" || localName === "tc") {
      result += processHwpxNodes(children);
    } else {
      result += processHwpxNodes(children);
    }
  }
  return result;
}

function processHwpxTable(tableChildren) {
  const rows = [];
  const findRows = (nodes) => {
    if (!Array.isArray(nodes)) return;
    for (const node of nodes) {
      const tagName = Object.keys(node)[0];
      if (tagName === ":@" || !tagName) continue;
      const localName = getLocalName(tagName);
      if (localName === "tr") {
        rows.push(node[tagName]);
      } else {
        findRows(node[tagName]);
      }
    }
  };
  findRows(tableChildren);

  if (rows.length === 0) return "";

  const mdRows = [];
  let maxCols = 0;
  for (const row of rows) {
    const cells = [];
    const findCells = (nodes) => {
      if (!Array.isArray(nodes)) return;
      for (const node of nodes) {
        const tagName = Object.keys(node)[0];
        if (tagName === ":@" || !tagName) continue;
        const localName = getLocalName(tagName);
        if (localName === "tc") {
          cells.push(node[tagName]);
        } else {
          findCells(node[tagName]);
        }
      }
    };
    findCells(row);
    
    const cellTexts = cells.map(cell => {
      return processHwpxNodes(cell).replace(/\r?\n/g, " ").trim();
    });
    mdRows.push(cellTexts);
    if (cellTexts.length > maxCols) {
      maxCols = cellTexts.length;
    }
  }

  if (mdRows.length === 0 || maxCols === 0) return "";

  const lines = [];
  const header = mdRows[0];
  while (header.length < maxCols) header.push("");
  lines.push("| " + header.join(" | ") + " |");
  
  const separator = Array(maxCols).fill("---");
  lines.push("| " + separator.join(" | ") + " |");
  
  for (let i = 1; i < mdRows.length; i++) {
    const row = mdRows[i];
    while (row.length < maxCols) row.push("");
    lines.push("| " + row.join(" | ") + " |");
  }

  return lines.join("\n");
}

export function parseHwpxSectionXml(xmlContent) {
  try {
    const parsed = hwpxXmlParser.parse(xmlContent);
    const text = processHwpxNodes(parsed);
    return normalizeText(text);
  } catch (error) {
    console.error(`Error parsing HWPX section XML: ${error.message}`);
    try {
      return normalizeText(collectText(xmlParser.parse(xmlContent)).join("\n"));
    } catch (fallbackError) {
      return "";
    }
  }
}

function collectText(value, output = []) {
  if (value == null) return output;

  if (typeof value === "string" || typeof value === "number") {
    const text = String(value).trim();
    if (text) output.push(text);
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectText(item, output);
    return output;
  }

  if (typeof value === "object") {
    for (const item of Object.values(value)) collectText(item, output);
  }

  return output;
}

function splitIntoPages(text, pageCount) {
  if (pageCount <= 1) return [{ page: 1, text }];
  const chunks = chunkText(text, Math.max(1200, Math.ceil(text.length / pageCount)));
  return chunks.map((chunk, index) => ({ page: index + 1, text: chunk }));
}

export function chunkText(text, maxLength = 6500) {
  const normalized = normalizeText(text);
  if (normalized.length <= maxLength) return [normalized];

  const paragraphs = normalized.split(/\n{2,}/);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + "\n\n" + paragraph).length > maxLength && current) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = current ? `${current}\n\n${paragraph}` : paragraph;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

/**
 * Sliding-window chunking with overlap and natural-boundary snapping.
 * Defaults target ~512 tokens / ~128 tokens overlap (≈ 1024 / 256 chars for mixed KO/EN).
 * Boundaries are snapped to paragraph → sentence → whitespace, within a slack window,
 * to avoid cutting mid-sentence.
 */
export function slidingChunkText(text, { windowChars = 1024, overlapChars = 256 } = {}) {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  if (normalized.length <= windowChars) return [normalized];

  let overlap = Math.max(0, Math.min(overlapChars, Math.floor(windowChars * 0.5)));
  const step = Math.max(1, windowChars - overlap);

  const chunks = [];
  let start = 0;

  while (start < normalized.length) {
    const idealEnd = Math.min(start + windowChars, normalized.length);
    const end = idealEnd >= normalized.length
      ? idealEnd
      : alignToBoundary(normalized, start + step, idealEnd);

    const piece = normalized.slice(start, end).trim();
    if (piece) chunks.push(piece);

    if (end >= normalized.length) break;

    const nextStart = end - overlap;
    start = nextStart > start ? nextStart : start + step;
  }

  return chunks;
}

function alignToBoundary(text, minEnd, idealEnd) {
  if (idealEnd <= minEnd) return idealEnd;
  const slice = text.slice(minEnd, idealEnd);

  const para = slice.lastIndexOf("\n\n");
  if (para >= 0) return minEnd + para + 2;

  const sentenceRegex = /[.!?。…][\s")\]]/g;
  let lastSentence = -1;
  let match;
  while ((match = sentenceRegex.exec(slice)) !== null) {
    lastSentence = match.index + match[0].length;
  }
  if (lastSentence > 0) return minEnd + lastSentence;

  const newline = slice.lastIndexOf("\n");
  if (newline >= 0) return minEnd + newline + 1;

  const space = slice.lastIndexOf(" ");
  if (space >= 0) return minEnd + space + 1;

  return idealEnd;
}

function normalizeText(text) {
  return String(text ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function compareNatural(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
