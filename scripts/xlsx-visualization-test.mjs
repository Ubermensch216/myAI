import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";

import { parseUpload } from "../server/parsers.js";
import { buildVisualizationContext, executeVisualizationPlan, normalizeVisualizationPlan } from "../server/visualization.js";

let failureCount = 0;

await run("XLSX dates, formulas, blanks, merged cells", testXlsxParsing);
await run("visualization plan regression on parsed XLSX", testVisualizationPlanRegression);
await run("XLSX shared string table (sst)", testXlsxSharedStrings);
await run("XLSX multi-sheet workbook", testXlsxMultiSheet);
await run("visualization plan invalid column reference", testVisualizationPlanInvalidColumn);
await run("visualization plan count aggregation", testVisualizationPlanCountAggregation);

if (failureCount > 0) {
  process.exitCode = 1;
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    failureCount += 1;
    console.error(`not ok - ${name}`);
    console.error(error?.stack || error);
  }
}

async function testXlsxParsing() {
  const parsed = await parseFixtureWorkbook();
  const sheet = parsed.sheets[0];

  assert.equal(parsed.kind, "document");
  assert.equal(parsed.fileType, "xlsx");
  assert.deepEqual(sheet.headers, ["Date", "Region", "Sales", "FormulaTotal", "Mixed"]);
  assert.equal(sheet.rows[0][0], "2023-01-01");
  assert.equal(sheet.rows[1][0], "2023-01-02");
  assert.equal(sheet.rows[1][1], "North");
  assert.equal(sheet.rows[0][3], "20");
  assert.equal(sheet.rows[1][3], "30");
  assert.equal(sheet.rows[2][2], "");
  assert.equal(sheet.rows[0][4], "00123");
  assert.equal(sheet.rows[1][4], "ABC");
  assert.equal(sheet.profile.columns.find((column) => column.name === "Sales")?.type, "number");
  assert.equal(sheet.profile.columns.find((column) => column.name === "Mixed")?.type, "category");
}

async function testVisualizationPlanRegression() {
  const parsed = await parseFixtureWorkbook();
  const context = buildVisualizationContext([parsed]);

  const linePlan = normalizeVisualizationPlan({
    status: "ok",
    analysis: { summary: "Daily sales trend" },
    visualizationPlan: {
      chartType: "line",
      dataSetIndex: 0,
      title: "Daily Sales",
      xColumn: "Date",
      yColumn: "Sales",
      aggregation: "none"
    }
  }, context);
  assert.equal(linePlan.ok, true, linePlan.errors.join("; "));

  const lineResult = executeVisualizationPlan(linePlan.plan, context);
  assert.equal(lineResult.ok, true, lineResult.errors?.join("; "));
  assert.deepEqual(lineResult.spec.visualizations[0].data, [
    { label: "2023-01-01", value: 10 },
    { label: "2023-01-02", value: 15 }
  ]);

  const barPlan = normalizeVisualizationPlan({
    status: "ok",
    analysis: { summary: "Formula totals by region" },
    visualizationPlan: {
      chartType: "bar",
      dataSetIndex: 0,
      title: "Formula Total by Region",
      xColumn: "Region",
      yColumn: "FormulaTotal",
      aggregation: "sum"
    }
  }, context);
  assert.equal(barPlan.ok, true, barPlan.errors.join("; "));

  const barResult = executeVisualizationPlan(barPlan.plan, context);
  assert.equal(barResult.ok, true, barResult.errors?.join("; "));
  assert.deepEqual(barResult.spec.visualizations[0].data, [
    { label: "North", value: 50 },
    { label: "South", value: 0 }
  ]);
}

async function parseFixtureWorkbook() {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "myai-xlsx-qa-"));
  const workbookPath = path.join(tempDir, "qa-fixture.xlsx");
  try {
    await fs.writeFile(workbookPath, await buildFixtureWorkbook());
    return await parseUpload({
      path: workbookPath,
      originalname: "qa-fixture.xlsx",
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function buildFixtureWorkbook() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    </Types>
  `);
  zip.file("_rels/.rels", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>
  `);
  zip.file("xl/workbook.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="QA Fixture" sheetId="1" r:id="rId1"/>
      </sheets>
    </workbook>
  `);
  zip.file("xl/_rels/workbook.xml.rels", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    </Relationships>
  `);
  zip.file("xl/styles.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
      <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
      <borders count="1"><border/></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="2">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="14" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
      </cellXfs>
    </styleSheet>
  `);
  zip.file("xl/worksheets/sheet1.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          ${inlineCell("A1", "Date")}
          ${inlineCell("B1", "Region")}
          ${inlineCell("C1", "Sales")}
          ${inlineCell("D1", "FormulaTotal")}
          ${inlineCell("E1", "Mixed")}
        </row>
        <row r="2">
          <c r="A2" s="1"><v>44927</v></c>
          ${inlineCell("B2", "North")}
          <c r="C2"><v>10</v></c>
          <c r="D2"><f>C2*2</f><v>20</v></c>
          <c r="E2" t="str"><v>00123</v></c>
        </row>
        <row r="3">
          <c r="A3" s="1"><v>44928</v></c>
          <c r="C3"><v>15</v></c>
          <c r="D3"><f>C3*2</f><v>30</v></c>
          <c r="E3" t="str"><v>ABC</v></c>
        </row>
        <row r="4">
          <c r="A4" s="1"><v>44929</v></c>
          ${inlineCell("B4", "South")}
          <c r="C4"/>
          <c r="D4"><f>IF(C4="",0,C4*2)</f><v>0</v></c>
          <c r="E4"><v>42</v></c>
        </row>
      </sheetData>
      <mergeCells count="1">
        <mergeCell ref="B2:B3"/>
      </mergeCells>
    </worksheet>
  `);
  return zip.generateAsync({ type: "nodebuffer" });
}

// Shared string table — real-world .xlsx files produced by Excel/LibreOffice
// use an sst for string deduplication instead of inline strings.
async function testXlsxSharedStrings() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    </Types>
  `);
  zip.file("_rels/.rels", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>
  `);
  zip.file("xl/workbook.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets><sheet name="SST Sheet" sheetId="1" r:id="rId1"/></sheets>
    </workbook>
  `);
  zip.file("xl/_rels/workbook.xml.rels", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
    </Relationships>
  `);
  zip.file("xl/styles.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
      <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
      <borders count="1"><border/></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
    </styleSheet>
  `);
  // Shared strings: 0=Name, 1=Score, 2=Alice, 3=Bob, 4=Charlie
  zip.file("xl/sharedStrings.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="5" uniqueCount="5">
      <si><t>Name</t></si>
      <si><t>Score</t></si>
      <si><t>Alice</t></si>
      <si><t>Bob</t></si>
      <si><t>Charlie</t></si>
    </sst>
  `);
  zip.file("xl/worksheets/sheet1.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">
          <c r="A1" t="s"><v>0</v></c>
          <c r="B1" t="s"><v>1</v></c>
        </row>
        <row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>90</v></c></row>
        <row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>75</v></c></row>
        <row r="4"><c r="A4" t="s"><v>4</v></c><c r="B4"><v>82</v></c></row>
      </sheetData>
    </worksheet>
  `);

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "myai-sst-"));
  const xlsxPath = path.join(tempDir, "sst.xlsx");
  try {
    await fs.writeFile(xlsxPath, buf);
    const parsed = await parseUpload({
      path: xlsxPath,
      originalname: "sst.xlsx",
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    const sheet = parsed.sheets[0];
    assert.deepEqual(sheet.headers, ["Name", "Score"]);
    assert.equal(sheet.rows[0][0], "Alice");
    assert.equal(sheet.rows[1][0], "Bob");
    assert.equal(sheet.rows[2][0], "Charlie");
    assert.equal(String(sheet.rows[0][1]), "90");
    assert.equal(sheet.profile.columns.find((c) => c.name === "Score")?.type, "number");
    assert.equal(sheet.profile.columns.find((c) => c.name === "Name")?.type, "category");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Multi-sheet workbook — parser should expose all sheets; retrieval uses the first by default.
async function testXlsxMultiSheet() {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
    </Types>
  `);
  zip.file("_rels/.rels", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
    </Relationships>
  `);
  zip.file("xl/workbook.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
      xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="Revenue" sheetId="1" r:id="rId1"/>
        <sheet name="Costs" sheetId="2" r:id="rId2"/>
      </sheets>
    </workbook>
  `);
  zip.file("xl/_rels/workbook.xml.rels", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    </Relationships>
  `);
  zip.file("xl/styles.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
      <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
      <borders count="1"><border/></borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
    </styleSheet>
  `);
  zip.file("xl/worksheets/sheet1.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">${inlineCell("A1", "Month")}${inlineCell("B1", "Revenue")}</row>
        <row r="2">${inlineCell("A2", "Jan")}<c r="B2"><v>1000</v></c></row>
        <row r="3">${inlineCell("A3", "Feb")}<c r="B3"><v>1200</v></c></row>
      </sheetData>
    </worksheet>
  `);
  zip.file("xl/worksheets/sheet2.xml", xml`
    <?xml version="1.0" encoding="UTF-8"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>
        <row r="1">${inlineCell("A1", "Month")}${inlineCell("B1", "Cost")}</row>
        <row r="2">${inlineCell("A2", "Jan")}<c r="B2"><v>800</v></c></row>
      </sheetData>
    </worksheet>
  `);

  const buf = await zip.generateAsync({ type: "nodebuffer" });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "myai-multi-"));
  const xlsxPath = path.join(tempDir, "multi.xlsx");
  try {
    await fs.writeFile(xlsxPath, buf);
    const parsed = await parseUpload({
      path: xlsxPath,
      originalname: "multi.xlsx",
      mimetype: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    assert.ok(Array.isArray(parsed.sheets), "sheets should be an array");
    assert.ok(parsed.sheets.length >= 2, `expected 2+ sheets, got ${parsed.sheets.length}`);
    assert.equal(parsed.sheets[0].name, "Revenue");
    assert.equal(parsed.sheets[1].name, "Costs");
    assert.deepEqual(parsed.sheets[0].headers, ["Month", "Revenue"]);
    assert.deepEqual(parsed.sheets[1].headers, ["Month", "Cost"]);
    assert.equal(String(parsed.sheets[0].rows[0][1]), "1000");
    assert.equal(String(parsed.sheets[1].rows[0][1]), "800");
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function testVisualizationPlanInvalidColumn() {
  const parsed = await parseFixtureWorkbook();
  const context = buildVisualizationContext([parsed]);

  const plan = normalizeVisualizationPlan({
    status: "ok",
    analysis: { summary: "test" },
    visualizationPlan: {
      chartType: "bar",
      dataSetIndex: 0,
      title: "Bad Plan",
      xColumn: "Region",
      yColumn: "NonExistentColumn",
      aggregation: "sum"
    }
  }, context);
  assert.equal(plan.ok, false, "plan with non-existent column should fail validation");
  assert.ok(plan.errors.length > 0, "should report at least one error");
}

async function testVisualizationPlanCountAggregation() {
  const parsed = await parseFixtureWorkbook();
  const context = buildVisualizationContext([parsed]);

  // Count of Sales rows per Region — yColumn must be numeric for bar charts.
  const plan = normalizeVisualizationPlan({
    status: "ok",
    analysis: { summary: "Count of Sales rows by region" },
    visualizationPlan: {
      chartType: "bar",
      dataSetIndex: 0,
      title: "Sales Count by Region",
      xColumn: "Region",
      yColumn: "Sales",
      aggregation: "count"
    }
  }, context);
  assert.equal(plan.ok, true, plan.errors?.join("; "));

  const result = executeVisualizationPlan(plan.plan, context);
  assert.equal(result.ok, true, result.errors?.join("; "));
  const data = result.spec.visualizations[0].data;
  assert.ok(Array.isArray(data), "data should be an array");
  const northEntry = data.find((d) => d.label === "North");
  assert.ok(northEntry, "should have a North entry");
  assert.ok(northEntry.value >= 1, "North count should be at least 1");
}

function inlineCell(reference, value) {
  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(value)}</t></is></c>`;
}

function xml(strings, ...values) {
  return strings
    .map((part, index) => `${part}${values[index] ?? ""}`)
    .join("")
    .replace(/^\s*\n/, "")
    .trim();
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
