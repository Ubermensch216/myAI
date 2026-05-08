import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import JSZip from "jszip";

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

export async function createExportFile({ format, title = "myAI answer", content = "" } = {}) {
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

  let buffer;
  if (normalizedFormat === "md") buffer = Buffer.from(text, "utf8");
  if (normalizedFormat === "pdf") buffer = await createPdfBuffer({ title: safeTitle, content: text });
  if (normalizedFormat === "xlsx") buffer = await createXlsxBuffer({ title: safeTitle, content: text });
  if (normalizedFormat === "docx") buffer = await createDocxBuffer({ title: safeTitle, content: text });
  if (normalizedFormat === "hwpx") buffer = await createHwpxBuffer({ title: safeTitle, content: text });

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

async function createDocxBuffer({ title, content }) {
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
    ${contentToWordXml(content)}
    <w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>
  </w:body>
</w:document>`);
  zip.file("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`);
  addOfficeProps(zip, title, "myAI DOCX Export");
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function contentToWordXml(content) {
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
      out.push(wordParagraphXml(lines[i]));
    }
    i += 1;
  }
  return out.join("\n    ");
}

function wordParagraphXml(line) {
  const text = stripMarkdown(line);
  const heading = /^(#{1,3})\s+/.exec(line);
  const style = heading ? `<w:pPr><w:pStyle w:val="Heading${Math.min(heading[1].length, 3)}"/></w:pPr>` : "";
  return `<w:p>${style}<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function wordTableXml(rows) {
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/><w:tblBorders><w:top w:val="single" w:sz="4"/><w:left w:val="single" w:sz="4"/><w:bottom w:val="single" w:sz="4"/><w:right w:val="single" w:sz="4"/><w:insideH w:val="single" w:sz="4"/><w:insideV w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>${rows.map((row) => `<w:tr>${row.map((cell) => `<w:tc><w:tcPr><w:tcW w:w="2400" w:type="dxa"/></w:tcPr><w:p><w:r><w:t xml:space="preserve">${xmlEscape(stripMarkdown(cell))}</w:t></w:r></w:p></w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;
}

async function createHwpxBuffer({ title, content }) {
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
  zip.file("Contents/header.xml", createHwpxHeaderXml());
  zip.file("Contents/section0.xml", `<?xml version="1.0" encoding="UTF-8"?>
<hs:sec xmlns:hs="http://www.hancom.co.kr/hwpml/2011/section" xmlns:hp="http://www.hancom.co.kr/hwpml/2011/paragraph">
  ${contentToHwpxXml(content)}
</hs:sec>`);
  zip.file("Preview/PrvText.txt", Buffer.from(`\ufeff${stripMarkdown(content)}`, "utf8"));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function createHwpxHeaderXml() {
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
    <hh:charProperties itemCnt="1">
      <hh:charPr id="0" height="1000" textColor="#000000" shadeColor="none" useFontSpace="0" useKerning="0">
        <hh:fontRef hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:ratio hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:spacing hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
        <hh:relSz hangul="100" latin="100" hanja="100" japanese="100" other="100" symbol="100" user="100"/>
        <hh:offset hangul="0" latin="0" hanja="0" japanese="0" other="0" symbol="0" user="0"/>
      </hh:charPr>
    </hh:charProperties>
    <hh:paraProperties itemCnt="1">
      <hh:paraPr id="0" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1" suppressLineNumbers="0" checked="0">
        <hh:align horizontal="JUSTIFY" vertical="BASELINE"/>
        <hh:heading type="NONE" idRef="0" level="0"/>
        <hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="KEEP_WORD" widowOrphan="0" keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>
        <hh:margin intent="0" left="0" right="0" prev="0" next="0"/>
        <hh:lineSpacing type="PERCENT" value="160"/>
        <hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0" connect="0" ignoreMargin="0"/>
      </hh:paraPr>
    </hh:paraProperties>
    <hh:styles itemCnt="1"><hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0" nextStyleIDRef="0" langID="1042" lockForm="0"/></hh:styles>
    <hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="1" autoTabRight="1"/></hh:tabProperties>
  </hh:refList>
</hh:head>`;
}

function contentToHwpxXml(content) {
  const lines = content.split(/\n/);
  const paragraphs = lines.length ? lines : [""];
  return paragraphs.map((line, index) => {
    const text = stripMarkdown(line);
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
    return `<hp:p id="${index}" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">
    ${secPr}
    <hp:run charPrIDRef="0"><hp:t>${xmlEscape(text)}</hp:t></hp:run>
    <hp:linesegarray><hp:lineseg textpos="0" vertpos="0" vertsize="1200" textheight="1200" baseline="1020" spacing="600" horzpos="0" horzsize="42520" flags="393216"/></hp:linesegarray>
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

function createPdfBuffer({ title, content }) {
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

    doc.fontSize(16).text(title, { lineGap: 4 });
    doc.moveDown(0.8);
    writePdfMarkdown(doc, content);
    doc.end();
  });
}

function resolvePdfFontPath() {
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

function writePdfMarkdown(doc, content) {
  const lines = content.split("\n");
  let inFence = false;
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
      const size = heading[1].length === 1 ? 15 : heading[1].length === 2 ? 13 : 12;
      doc.moveDown(0.25).fontSize(size).text(stripMarkdown(heading[2]), { lineGap: 3 });
      doc.moveDown(0.15);
      continue;
    }
    const bullet = /^\s*([-*+]|\d+\.)\s+(.+)/.exec(line);
    if (bullet && !inFence) {
      doc.fontSize(10.5).text(`• ${stripMarkdown(bullet[2])}`, { indent: 12, lineGap: 3 });
      continue;
    }
    if (parseTableRow(line) && !parseTableDivider(line) && !inFence) {
      doc.fontSize(9.8).text(parseTableRow(line).map(stripMarkdown).join("    "), { lineGap: 3 });
      continue;
    }
    if (!parseTableDivider(line)) {
      doc.fontSize(inFence ? 9.5 : 10.5).text(stripMarkdown(line), { lineGap: inFence ? 2 : 3 });
    }
  }
}
