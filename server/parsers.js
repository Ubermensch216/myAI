import fs from "node:fs/promises";
import path from "node:path";
import JSZip from "jszip";
import mammoth from "mammoth";
import pdfParse from "pdf-parse";
import { XMLParser } from "fast-xml-parser";

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const DOCUMENT_EXTENSIONS = new Set([".pdf", ".docx", ".xlsx", ".xls", ".pptx", ".hwpx"]);

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
    const rows = asArray(parsed.worksheet?.sheetData?.row).map((row) => {
      return asArray(row.c)
        .map((cell) => readCellValue(cell, sharedStrings))
        .join(", ");
    });

    sheets.push({
      name: sheetNames[index] || `Sheet ${index + 1}`,
      text: normalizeText(rows.join("\n"))
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

function readCellValue(cell, sharedStrings) {
  if (!cell) return "";
  if (cell.t === "s") return sharedStrings[Number(cell.v)] ?? "";
  if (cell.t === "inlineStr") return collectText(cell.is).join("");
  if (cell.t === "b") return cell.v === "1" ? "TRUE" : "FALSE";
  return String(cell.v ?? "");
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
