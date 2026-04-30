import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { XMLParser } from "fast-xml-parser";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".xls", ".csv", ".pptx", ".hwpx"]);
const MAX_STORED_TABLE_ROWS = 800;
const MAX_STORED_TABLE_COLUMNS = 60;
const MAX_PROFILE_VALUES = 12;

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  preserveOrder: false,
  trimValues: true
});

const xmlParserWithAttributes = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  preserveOrder: false,
  trimValues: true
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

async function parseCsv(file) {
  const buffer = await fs.readFile(file.path);
  const content = stripUtf8Bom(buffer.toString("utf8"));
  const rows = normalizeRows(parseCsvRows(content));
  const table = buildTableFromRows("CSV", rows);
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
  const sheetNames = await readSheetNames(zip);
  const sheetFiles = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort(compareNatural);

  const sheets = [];
  for (const [index, sheetPath] of sheetFiles.entries()) {
    const xml = await zip.file(sheetPath).async("string");
    const parsed = xmlParserWithAttributes.parse(xml);
    const rows = readWorksheetRows(parsed, sharedStrings);
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

function readWorksheetRows(parsed, sharedStrings) {
  const rows = asArray(parsed.worksheet?.sheetData?.row).map((row) => {
    const values = [];

    for (const cell of asArray(row.c)) {
      const columnIndex = getCellColumnIndex(cell?.r);
      const value = readCellValue(cell, sharedStrings);
      if (columnIndex >= 0) values[columnIndex] = value;
      else values.push(value);
    }

    return trimTrailingEmpty(values.map((value) => String(value ?? "")));
  });

  return normalizeRows(rows);
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

function readCellValue(cell, sharedStrings) {
  if (!cell) return "";
  if (cell.t === "s") return sharedStrings[Number(cell.v)] ?? "";
  if (cell.t === "inlineStr") return collectText(cell.is).join("");
  if (cell.t === "b") return cell.v === "1" ? "TRUE" : "FALSE";
  return String(cell.v ?? "");
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
      ? normalizeText(collectText(xmlParser.parse(content)).join("\n"))
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
