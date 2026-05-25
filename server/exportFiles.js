import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import JSZip from "jszip";
import { getStyleProfile } from "./exportStyles.js";

const MAX_EXPORT_CHARS = Number(process.env.EXPORT_MAX_CHARS || 180_000);

const FORMATS = {
  md: {
    extension: "md",
    contentType: "text/markdown; charset=utf-8"
  },
  pdf: {
    extension: "pdf",
    contentType: "application/pdf"
  },
  xlsx: {
    extension: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  },
  docx: {
    extension: "docx",
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  },
  hwpx: {
    extension: "hwpx",
    contentType: "application/vnd.hancom.hwpx"
  }
};

export function listExportFormats() {
  return Object.entries(FORMATS).map(([id, config]) => ({ id, extension: config.extension, contentType: config.contentType }));
}

export async function createExportFile({ format, title = "myAI answer", content = "", docType = null } = {}) {
  const normalizedFormat = String(format || "").trim().toLowerCase();
  const config = FORMATS[normalizedFormat];
  if (!config) {
    const supported = Object.keys(FORMATS).join(", ");
    throw new Error(`Unsupported export format. Supported formats: ${supported}`);
  }

  const safeTitle = sanitizeTitle(title || "myAI answer");
  const text = normalizeContent(content);
  if (!text) throw new Error("Export content is empty.");
  if (text.length > MAX_EXPORT_CHARS) {
    throw new Error(`Export content is too large. Limit is ${MAX_EXPORT_CHARS.toLocaleString()} characters.`);
  }

  const profile = getStyleProfile(docType);

  let buffer;
  if (normalizedFormat === "md") buffer = Buffer.from(text, "utf8");
  if (normalizedFormat === "pdf") buffer = await createPdfBuffer({ title: safeTitle, content: text, profile });
  if (normalizedFormat === "xlsx") buffer = await createXlsxBuffer({ title: safeTitle, content: text });
  if (normalizedFormat === "docx") buffer = await createDocxBuffer({ title: safeTitle, content: text, profile });
  if (normalizedFormat === "hwpx") buffer = await createHwpxBuffer({ title: safeTitle, content: text, profile });

  return {
    buffer,
    contentType: config.contentType,
    filename: `${safeTitle}.${config.extension}`
  };
}

function normalizeContent(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
}

function sanitizeTitle(value) {
  const title = String(value || "myAI answer")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return title || "myAI answer";
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function parseMarkdownTables(content) {
  const lines = content.split("\n");
  const tables = [];
  let i = 0;
  while (i < lines.length) {
    const header = parseTableRow(lines[i]);
    const divider = parseTableDivider(lines[i + 1]);
    if (!header || !divider || header.length < 2) {
      i += 1;
      continue;
    }
    const rows = [header];
    i += 2;
    while (i < lines.length) {
      const row = parseTableRow(lines[i]);
      if (!row) break;
      rows.push(row);
      i += 1;
    }
    tables.push(rows);
  }
  return tables;
}

function parseTableRow(line = "") {
  const text = String(line);
  if (!text.includes("|")) return null;
  const trimmed = text.trim();
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
  return cells.length >= 2 ? cells : null;
}

function parseTableDivider(line = "") {
  const row = parseTableRow(line);
  if (!row) return null;
  return row.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, ""))) ? row : null;
}

function plainRowsFromContent(content) {
  const rows = content.split(/\n{2,}/)
    .map((part) => part.replace(/\n/g, " ").trim())
    .filter(Boolean);
  return [["AI Answer"], ...rows.map((row) => [stripMarkdown(row)])];
}

function stripMarkdown(value) {
  return String(value || "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[a-zA-Z0-9_-]*\n?/g, "").replace(/```/g, ""))
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .trim();
}

async function createXlsxBuffer({ title, content }) {
  const zip = new JSZip();
  const tables = parseMarkdownTables(content);
  const sheets = tables.length
    ? tables.map((rows, index) => ({ name: `Table ${index + 1}`, rows }))
    : [{ name: "Answer", rows: plainRowsFromContent(content) }];

  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("\n  ")}
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.file("xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((sheet, i) => `<sheet name="${xmlEscape(sheet.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
</workbook>`);
  zip.file("xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("\n  ")}
</Relationships>`);
  sheets.forEach((sheet, index) => {
    zip.file(`xl/worksheets/sheet${index + 1}.xml`, worksheetXml(sheet.rows));
  });
  addOfficeProps(zip, title, "myAI XLSX Export");
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function worksheetXml(rows) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${rows.map((row, rowIndex) => `<row r="${rowIndex + 1}">${row.map((cell, colIndex) => {
      const ref = `${columnName(colIndex + 1)}${rowIndex + 1}`;
      return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(stripMarkdown(cell))}</t></is></c>`;
    }).join("")}</row>`).join("\n    ")}
  </sheetData>
</worksheet>`;
}

function columnName(index) {
  let name = "";
  let n = index;
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

async function createDocxBuffer({ title, content, profile }) {
  const styleProfile = profile || getStyleProfile(null);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${contentToWordXml(content, styleProfile)}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  addOfficeProps(zip, title, "myAI DOCX Export");
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function contentToWordXml(content, profile) {
  const lines = content.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const header = parseTableRow(lines[i]);
    const divider = parseTableDivider(lines[i + 1]);
    if (header && divider) {
      const rows = [header];
      i += 2;
      while (i < lines.length) {
        const row = parseTableRow(lines[i]);
        if (!row) break;
        rows.push(row);
        i += 1;
      }
      out.push(wordTableXml(rows));
      continue;
    }
    if (!lines[i].trim()) {
      out.push("<w:p/>");
    } else {
      out.push(wordParagraphXml(lines[i], profile));
    }
    i += 1;
  }
  return out.join("\n    ");
}

// pt → half-points (DOCX w:sz 단위)
function ptToHalfPt(pt) {
  return Math.round(pt * 2);
}
// pt → twentieths-of-a-point (DOCX w:spacing/w:ind 단위)
function ptToTwip(pt) {
  return Math.round(pt * 20);
}

function hexNoHash(color) {
  return String(color || "").replace(/^#/, "").toUpperCase() || "000000";
}

function buildRunProps(style) {
  const parts = [];
  if (style.bold) parts.push("<w:b/>");
  if (style.italic) parts.push("<w:i/>");
  if (style.underline) parts.push('<w:u w:val="single"/>');
  if (style.fontSize) {
    const sz = ptToHalfPt(style.fontSize);
    parts.push(`<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/>`);
  }
  if (style.color) parts.push(`<w:color w:val="${hexNoHash(style.color)}"/>`);
  if (!parts.length) return "";
  return `<w:rPr>${parts.join("")}</w:rPr>`;
}

function buildParaProps(style, opts = {}) {
  const parts = [];
  if (style.align && style.align !== "left") {
    const map = { center: "center", right: "right", justify: "both" };
    const val = map[style.align] || "left";
    parts.push(`<w:jc w:val="${val}"/>`);
  }
  if (style.indent && style.indent > 0) {
    parts.push(`<w:ind w:left="${ptToTwip(style.indent)}"/>`);
  }
  const before = style.spacingBefore ? ptToTwip(style.spacingBefore) : 0;
  const after = style.spacingAfter ? ptToTwip(style.spacingAfter) : 0;
  if (before || after) {
    parts.push(`<w:spacing w:before="${before}" w:after="${after}"/>`);
  }
  if (opts.borderBottom) {
    const sz = Math.max(4, Math.round(opts.borderBottom.width * 8));
    parts.push(`<w:pBdr><w:bottom w:val="single" w:sz="${sz}" w:space="2" w:color="${hexNoHash(opts.borderBottom.color)}"/></w:pBdr>`);
  }
  if (opts.accentBar) {
    const sz = Math.max(4, Math.round(opts.accentBar.width * 8));
    parts.push(`<w:pBdr><w:left w:val="single" w:sz="${sz}" w:space="4" w:color="${hexNoHash(opts.accentBar.color)}"/></w:pBdr>`);
  }
  if (opts.shading) {
    parts.push(`<w:shd w:val="clear" w:color="auto" w:fill="${hexNoHash(opts.shading)}"/>`);
  }
  if (!parts.length) return "";
  return `<w:pPr>${parts.join("")}</w:pPr>`;
}

function wordParagraphXml(line, profile) {
  const text = stripMarkdown(line);
  const heading = /^(#{1,3})\s+/.exec(line);
  if (heading) {
    const level = Math.min(heading[1].length, 3);
    if (level === 1) {
      const s = profile.title;
      const pPr = buildParaProps(s, { borderBottom: s.borderBottom });
      const rPr = buildRunProps(s);
      return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
    }
    if (level === 2) {
      const s = profile.h2;
      const pPr = buildParaProps(s, { accentBar: s.accentBar });
      const rPr = buildRunProps(s);
      return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
    }
    const s = profile.h3;
    const pPr = buildParaProps(s);
    const rPr = buildRunProps(s);
    return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
  }
  const body = profile.body;
  const pPr = buildParaProps({ indent: body.indent });
  const rPr = buildRunProps({ fontSize: body.fontSize, color: body.color });
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function wordTableXml(rows) {
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${xmlEscape(stripMarkdown(cell))}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
}

async function createHwpxBuffer({ title, content, profile }) {
  const styleProfile = profile || getStyleProfile(null);
  const zip = new JSZip();
  zip.file("mimetype", "application/hwp+zip", { compression: "STORE" });
  zip.file("META-INF/container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/></rootfiles>
</container>`);
  zip.file("version.xml", `<?xml version="1.0" encoding="UTF-8"?>
<hv:version xmlns:hv="http://www.hancom.co.kr/hwpml/2016/version" app="myAI" version="1.0"/>`);
  zip.file("settings.xml", `<?xml version="1.0" encoding="UTF-8"?>
<ha:settings xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app">
  <ha:configItemSet name="configuration-settings"/>
</ha:settings>`);
  zip.file("Contents/content.hpf", `<?xml version="1.0" encoding="UTF-8"?>
<opf:package xmlns:opf="http://www.idpf.org/2007/opf/" version="3.0" unique-identifier="uid">
  <opf:metadata><opf:title>${xmlEscape(title)}</opf:title></opf:metadata>
  <opf:manifest>
    <opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>
    <opf:item id="section0" href="Contents/section0.xml" media-type="application/xml"/>
    <opf:item id="settings" href="settings.xml" media-type="application/xml"/>
  </opf:manifest>
  <opf:spine><opf:itemref idref="section0"/></opf:spine>
</opf:package>`);
  zip.file("META-INF/manifest.xml", `<?xml version="1.0" encoding="UTF-8"?>
<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <odf:file-entry odf:media-type="application/hwp+zip" odf:full-path="/"/>
  <odf:file-entry odf:media-type="application/xml" odf:full-path="version.xml"/>
  <odf:file-entry odf:media-type="application/xml" odf:full-path="settings.xml"/>
  <odf:file-entry odf:media-type="application/hwpml-package+xml" odf:full-path="Contents/content.hpf"/>
  <odf:file-entry odf:media-type="application/xml" odf:full-path="Contents/header.xml"/>
  <odf:file-entry odf:media-type="application/xml" odf:full-path="Contents/section0.xml"/>
  <odf:file-entry odf:media-type="text/plain" odf:full-path="Preview/PrvText.txt"/>
</odf:manifest>`);
  zip.file("Contents/header.xml", createHwpxHeaderXml(styleProfile));
  zip.file("Contents/section0.xml", `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  ${contentToHwpxXml(content, styleProfile)}
</hs:sec>`);
  zip.file("Preview/PrvText.txt", Buffer.from(`\ufeff${stripMarkdown(content)}`, "utf8"));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// HWPX 단위: height = pt * 100, color = "#RRGGBB"
function hwpxHeight(pt) { return Math.round(pt * 100); }
function hwpxColor(hex) {
  const c = String(hex || "").trim();
  if (!c) return "#000000";
  return c.startsWith("#") ? c.toUpperCase() : `#${c.toUpperCase()}`;
}
function hwpxAlign(align) {
  const map = { left: "LEFT", center: "CENTER", right: "RIGHT", justify: "JUSTIFY" };
  return map[align] || "LEFT";
}

function buildHwpxCharPr(id, style) {
  const height = hwpxHeight(style.fontSize || 10);
  const color = hwpxColor(style.color || "#000000");
  const flags = [];
  if (style.bold) flags.push("<hh:bold/>");
  if (style.italic) flags.push("<hh:italic/>");
  if (style.underline) flags.push('<hh:underline type="SOLID" shape="SOLID" color="#000000"/>');
  return `<hh:charPr id="${id}" height="${height}" textColor="${color}" shadeColor="none" useFontSpace="0" useKerning="0">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>${flags.length ? "\n        " + flags.join("\n        ") : ""}
      </hh:charPr>`;
}

function buildHwpxParaPr(id, align, lineSpacingPct, borderFillIDRef = 1) {
  return `<hh:paraPr id="${id}" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="${align}" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin intent="0" left="0" right="0" prev="0" next="0"/>
        <hh:lineSpacing type="PERCENT" value="${lineSpacingPct}"/>
        <hh:border borderFillIDRef="${borderFillIDRef}" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>`;
}

// id 매핑 (charPr/paraPr 공통)
// 0 = body, 1 = title, 2 = h2, 3 = h3
const HWPX_ID_BODY = 0;
const HWPX_ID_TITLE = 1;
const HWPX_ID_H2 = 2;
const HWPX_ID_H3 = 3;

function createHwpxHeaderXml(profile) {
  const bodyLineSpacing = Math.round((profile.body.lineHeight || 1.35) * 100);
  const charPrs = [
    buildHwpxCharPr(HWPX_ID_BODY, { fontSize: profile.body.fontSize, color: profile.body.color }),
    buildHwpxCharPr(HWPX_ID_TITLE, { fontSize: profile.title.fontSize, color: profile.title.color, bold: profile.title.bold, underline: profile.title.underline }),
    buildHwpxCharPr(HWPX_ID_H2, { fontSize: profile.h2.fontSize, color: profile.h2.color, bold: profile.h2.bold }),
    buildHwpxCharPr(HWPX_ID_H3, { fontSize: profile.h3.fontSize, color: profile.h3.color, bold: profile.h3.bold })
  ];
  const paraPrs = [
    buildHwpxParaPr(HWPX_ID_BODY, "JUSTIFY", bodyLineSpacing),
    buildHwpxParaPr(HWPX_ID_TITLE, hwpxAlign(profile.title.align), 130),
    buildHwpxParaPr(HWPX_ID_H2, hwpxAlign(profile.h2.align), 130),
    buildHwpxParaPr(HWPX_ID_H3, "LEFT", 130)
  ];
  const styles = [
    `<hh:style id="${HWPX_ID_BODY}" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="${HWPX_ID_BODY}" charPrIDRef="${HWPX_ID_BODY}" nextStyleIDRef="${HWPX_ID_BODY}" langID="1042" lockForm="0"/>`,
    `<hh:style id="${HWPX_ID_TITLE}" type="PARA" name="문서제목" engName="Title" paraPrIDRef="${HWPX_ID_TITLE}" charPrIDRef="${HWPX_ID_TITLE}" nextStyleIDRef="${HWPX_ID_BODY}" langID="1042" lockForm="0"/>`,
    `<hh:style id="${HWPX_ID_H2}" type="PARA" name="소제목" engName="Heading2" paraPrIDRef="${HWPX_ID_H2}" charPrIDRef="${HWPX_ID_H2}" nextStyleIDRef="${HWPX_ID_BODY}" langID="1042" lockForm="0"/>`,
    `<hh:style id="${HWPX_ID_H3}" type="PARA" name="소소제목" engName="Heading3" paraPrIDRef="${HWPX_ID_H3}" charPrIDRef="${HWPX_ID_H3}" nextStyleIDRef="${HWPX_ID_BODY}" langID="1042" lockForm="0"/>`
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<hh:head xmlns:hh="http://www.hancom.co.kr/hwpml/2011/head" xmlns:hc="http://www.hancom.co.kr/hwpml/2011/core" version="1.5" secCnt="1">
  <hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>
  <hh:refList>
    <hh:fontfaces itemCnt="1">
      <hh:fontface lang="KO" fontCnt="1"><hh:font id="0" face="맑은 고딕" type="TTF"/></hh:fontface>
    </hh:fontfaces>
    <hh:borderFills itemCnt="1">
      <hh:borderFill id="1" threeD="0" shadow="0" centerLine="NONE">
        <hh:slash type="NONE" Crooked="0" isCounter="0"/>
        <hh:backSlash type="NONE" Crooked="0" isCounter="0"/>
        <hh:leftBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:rightBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:topBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:bottomBorder type="NONE" width="0.1 mm" color="#000000"/>
        <hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>
      </hh:borderFill>
    </hh:borderFills>
    <hh:charProperties itemCnt="${charPrs.length}">
      ${charPrs.join("\n      ")}
    </hh:charProperties>
    <hh:paraProperties itemCnt="${paraPrs.length}">
      ${paraPrs.join("\n      ")}
    </hh:paraProperties>
    <hh:styles itemCnt="${styles.length}">${styles.join("")}</hh:styles>
    <hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="1" autoTabRight="1"/></hh:tabProperties>
  </hh:refList>
</hh:head>`;
}

function contentToHwpxXml(content, profile) {
  void profile;
  const lines = content.split(/\n/);
  const paragraphs = lines.length ? lines : [""];
  return paragraphs.map((line, index) => {
    const text = stripMarkdown(line);
    const heading = /^(#{1,3})\s+/.exec(line);
    let idRef = HWPX_ID_BODY;
    if (heading) {
      const level = Math.min(heading[1].length, 3);
      if (level === 1) idRef = HWPX_ID_TITLE;
      else if (level === 2) idRef = HWPX_ID_H2;
      else idRef = HWPX_ID_H3;
    }
    const secPr = index === 0 ? `<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000" tabStopVal="LEFT" tabStopUnit="MILLIMETER">
      <hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0"/>
      <hp:startNum pageStartsOn="BOTH" page="1" pic="1" tbl="1" equation="1"/>
      <hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0" border="SHOW" fill="SHOW" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>
      <hp:pagePr landscape="0" width="59528" height="84188" gutterType="LEFT_ONLY">
        <hp:margin header="4252" footer="4252" gutter="0" left="8504" right="8504" top="5668" bottom="4252"/>
      </hp:pagePr>
      <hp:footNotePr autoNumFormatType="DIGIT" autoNumFormatUserChar="" autoNumFormatPrefixChar="" autoNumFormatSuffixChar="" autoNumFormatSupscript="1"/>
      <hp:endNotePr autoNumFormatType="DIGIT" autoNumFormatUserChar="" autoNumFormatPrefixChar="" autoNumFormatSuffixChar="" autoNumFormatSupscript="1"/>
      <hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0" footerInside="0" fillArea="PAPER">
        <hp:offset left="0" right="0" top="0" bottom="0"/>
      </hp:pageBorderFill>
    </hp:secPr>` : "";
    return `<hp:p id="${index}" paraPrIDRef="${idRef}" styleIDRef="${idRef}" pageBreak="0" columnBreak="0" merged="0">
    ${secPr}
    <hp:run charPrIDRef="${idRef}"><hp:t>${xmlEscape(text)}</hp:t></hp:run>
  </hp:p>`;
  }).join("\n  ");
}

function addOfficeProps(zip, title, appName) {
  const now = new Date().toISOString();
  zip.file("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${xmlEscape(title)}</dc:title>
  <dc:creator>myAI</dc:creator>
  <cp:lastModifiedBy>myAI</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified>
</cp:coreProperties>`);
  zip.file("docProps/app.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>${xmlEscape(appName)}</Application>
</Properties>`);
}

function createPdfBuffer({ title, content, profile }) {
  const styleProfile = profile || getStyleProfile(null);
  return new Promise((resolve, reject) => {
    const chunks = [];
    const doc = new PDFDocument({
      size: "A4",
      margin: 48,
      bufferPages: true,
      info: {
        Title: title,
        Author: "myAI",
        Creator: "myAI"
      }
    });
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const fontPath = resolvePdfFontPath();
    if (fontPath) {
      doc.registerFont("body", fontPath);
      doc.font("body");
    } else {
      doc.font("Helvetica");
    }

    writePdfMarkdown(doc, content, styleProfile);
    doc.end();
  });
}

export function resolvePdfFontPath() {
  const configured = process.env.EXPORT_PDF_FONT_PATH;
  const candidates = [
    configured,
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "malgun.ttf"),
    path.join(process.env.WINDIR || "C:\\Windows", "Fonts", "NotoSansKR-VF.ttf"),
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/truetype/nanum/NanumGothic.ttf"
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) || "";
}

function writePdfMarkdown(doc, content, profile) {
  const lines = content.split("\n");
  let inFence = false;
  const bodyFontSize = profile.body.fontSize;
  const bodyLineGap = Math.max(1, Math.round((profile.body.lineHeight - 1) * bodyFontSize));
  const bodyColor = profile.body.color;
  const bodyIndent = profile.body.indent || 0;

  const renderTitle = (text) => {
    const s = profile.title;
    doc.moveDown(0.2);
    doc.fontSize(s.fontSize).fillColor(s.color || "#000000").text(text, {
      align: s.align || "left",
      lineGap: 4
    });
    if (s.borderBottom) {
      const y = doc.y + 2;
      doc.save();
      doc.lineWidth(s.borderBottom.width || 1)
        .strokeColor(s.borderBottom.color || "#000000")
        .moveTo(doc.page.margins.left, y)
        .lineTo(doc.page.width - doc.page.margins.right, y)
        .stroke();
      doc.restore();
      doc.y = y + 4;
    }
    if (s.spacingAfter) doc.moveDown(s.spacingAfter / 12);
    doc.fillColor(bodyColor);
  };

  const renderH2 = (text) => {
    const s = profile.h2;
    if (s.spacingBefore) doc.moveDown(s.spacingBefore / 14);
    if (s.accentBar) {
      const startY = doc.y;
      const lineH = s.fontSize * 1.2;
      doc.save();
      doc.lineWidth(s.accentBar.width || 2)
        .strokeColor(s.accentBar.color || "#000000")
        .moveTo(doc.page.margins.left, startY + 2)
        .lineTo(doc.page.margins.left, startY + lineH)
        .stroke();
      doc.restore();
      doc.fontSize(s.fontSize).fillColor(s.color || "#000000").text(text, {
        indent: (s.accentBar.width || 2) + 4,
        lineGap: 3
      });
    } else {
      doc.fontSize(s.fontSize).fillColor(s.color || "#000000").text(text, { lineGap: 3 });
    }
    if (s.spacingAfter) doc.moveDown(s.spacingAfter / 14);
    doc.fillColor(bodyColor);
  };

  const renderH3 = (text) => {
    const s = profile.h3;
    if (s.spacingBefore) doc.moveDown(s.spacingBefore / 14);
    doc.fontSize(s.fontSize).fillColor(s.color || "#000000").text(text, {
      indent: s.indent || 0,
      lineGap: 3
    });
    if (s.spacingAfter) doc.moveDown(s.spacingAfter / 14);
    doc.fillColor(bodyColor);
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^```/.test(line.trim())) {
      inFence = !inFence;
      doc.moveDown(0.25);
      continue;
    }
    if (!line.trim()) {
      doc.moveDown(0.45);
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)/.exec(line);
    if (heading && !inFence) {
      const text = stripMarkdown(heading[2]);
      if (heading[1].length === 1) renderTitle(text);
      else if (heading[1].length === 2) renderH2(text);
      else renderH3(text);
      continue;
    }
    const bullet = /^\s*([-*+]|\d+\.)\s+(.+)/.exec(line);
    if (bullet && !inFence) {
      doc.fontSize(bodyFontSize).fillColor(bodyColor)
        .text(`• ${stripMarkdown(bullet[2])}`, { indent: 12 + bodyIndent, lineGap: bodyLineGap });
      continue;
    }
    if (parseTableRow(line) && !parseTableDivider(line) && !inFence) {
      doc.fontSize(bodyFontSize - 0.7).fillColor(bodyColor)
        .text(parseTableRow(line).map(stripMarkdown).join("    "), { lineGap: bodyLineGap });
      continue;
    }
    if (!parseTableDivider(line)) {
      doc.fontSize(inFence ? bodyFontSize - 1 : bodyFontSize).fillColor(bodyColor)
        .text(stripMarkdown(line), {
          indent: bodyIndent,
          lineGap: inFence ? Math.max(1, bodyLineGap - 1) : bodyLineGap
        });
    }
  }
}
