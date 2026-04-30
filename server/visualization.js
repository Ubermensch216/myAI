const VISUALIZATION_TYPES = new Set([
  "bar",
  "line",
  "pie",
  "scatter",
  "table",
  "kpi",
  "infographic"
]);

const TYPE_ALIASES = new Map([
  ["column", "bar"],
  ["barChart", "bar"],
  ["barchart", "bar"],
  ["bar chart", "bar"],
  ["lineChart", "line"],
  ["linechart", "line"],
  ["line chart", "line"],
  ["area", "line"],
  ["donut", "pie"],
  ["doughnut", "pie"],
  ["pieChart", "pie"],
  ["piechart", "pie"],
  ["pie chart", "pie"],
  ["bubble", "scatter"],
  ["metric", "kpi"],
  ["metrics", "kpi"],
  ["cards", "kpi"],
  ["dataTable", "table"],
  ["datatable", "table"],
  ["info", "infographic"]
]);

const KOREAN_TYPE_ALIASES = new Map([
  ["\ub9c9\ub300", "bar"],
  ["\ub9c9\ub300\ucc28\ud2b8", "bar"],
  ["\uc120", "line"],
  ["\uc120\uadf8\ub798\ud504", "line"],
  ["\uc6d0\ud615", "pie"],
  ["\ud30c\uc774", "pie"],
  ["\uc0b0\uc810\ub3c4", "scatter"],
  ["\ud45c", "table"],
  ["\uc9c0\ud45c", "kpi"],
  ["\ud575\uc2ec\uc9c0\ud45c", "kpi"],
  ["\uc778\ud3ec\uadf8\ub798\ud53d", "infographic"]
]);

const LABEL_COLUMN_KEYWORDS = [
  "age",
  "group",
  "category",
  "segment",
  "\uc5f0\ub839",
  "\uc5f0\ub839\ub300",
  "\ub098\uc774",
  "\uad6c\ubd84",
  "\ubd84\ub958",
  "\ud56d\ubaa9"
];

const VALUE_COLUMN_KEYWORDS = [
  "count",
  "total",
  "amount",
  "value",
  "score",
  "visit",
  "visits",
  "\ud69f\uc218",
  "\ubc29\ubb38",
  "\ubc29\ubb38\ud69f\uc218",
  "\ud569\uacc4",
  "\uc218\uce58",
  "\uac12",
  "\uc810\uc218"
];

const VISUALIZATION_KEYWORDS = [
  "chart",
  "graph",
  "plot",
  "dashboard",
  "visualization",
  "visualisation",
  "infographic",
  "visualize",
  "visualise",
  "차트",
  "그래프",
  "도표",
  "시각화",
  "인포그래픽",
  "대시보드",
  "막대",
  "선그래프",
  "원형"
];

const MAX_CONTEXT_TABLES = 4;
const MAX_CONTEXT_ROWS_PER_TABLE = 120;
const MAX_VISUALIZATIONS = 6;
const MAX_POINTS = 80;
const MAX_TABLE_ROWS = 80;
const MAX_TEXT_LENGTH = 600;

export function isVisualizationRequest(prompt) {
  const text = String(prompt ?? "").toLowerCase();
  return VISUALIZATION_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
}

export function hasTabularData(documents) {
  return collectTables(documents).some((table) => table.headers.length && table.rows.length);
}

export function buildVisualizationContext(documents) {
  const tables = collectTables(documents)
    .filter((table) => table.headers.length && table.rows.length)
    .slice(0, MAX_CONTEXT_TABLES);

  return {
    available: tables.length > 0,
    tableCount: tables.length,
    rowLimitPerTable: MAX_CONTEXT_ROWS_PER_TABLE,
    dataSets: tables.map((table) => {
      const rows = table.rows.slice(0, MAX_CONTEXT_ROWS_PER_TABLE);
      return {
        fileName: table.fileName,
        sheetName: table.name,
        rowCount: table.rowCount,
        columnCount: table.columnCount,
        truncated: Boolean(table.truncated || table.rows.length > rows.length),
        headers: table.headers,
        columns: table.profile?.columns ?? [],
        sampleRows: table.sampleRows ?? rows.slice(0, 12).map((row) => rowToRecord(table.headers, row)),
        rows: rows.map((row) => rowToRecord(table.headers, row))
      };
    })
  };
}

export function parseVisualizationJson(content) {
  const text = stripJsonFence(String(content ?? "").trim());
  return parseJsonObject(text) ?? parseJsonObject(extractJsonObject(text));
}

export function normalizeVisualizationSpec(value) {
  const source = value && typeof value === "object" ? value : {};
  const rawVisualizations = asArray(
    source.visualizations ?? source.charts ?? source.chart ?? source.visuals ?? source.visualization ?? source.items
  );
  const singleVisualization = (source.type || source.chartType || source.visualizationType || source.kind)
    ? [source]
    : [];
  const visualizations = [...rawVisualizations, ...singleVisualization]
    .map(normalizeVisualization)
    .filter(Boolean)
    .slice(0, MAX_VISUALIZATIONS);

  return {
    version: safeText(source.version, 20) || "1.0",
    fallback: Boolean(source.fallback),
    fallbackNotice: safeText(source.fallbackNotice, 240),
    fallbackReason: safeText(source.fallbackReason, 400),
    summary: safeText(source.summary ?? source.title ?? "", MAX_TEXT_LENGTH),
    visualizations,
    insights: normalizeTextArray(source.insights ?? source.keyFindings ?? source.findings, 8),
    warnings: normalizeTextArray(source.warnings ?? source.cautions ?? source.notes, 6)
  };
}

export function buildFallbackVisualizationSpec({ prompt, context, reason = "" }) {
  const dataSet = asArray(context?.dataSets).find((item) => asArray(item?.rows).length && asArray(item?.headers).length);
  if (!dataSet) {
    return {
      version: "1.0",
      fallback: true,
      fallbackNotice: "\ubaa8\ub378\uc774 \uc2dc\uac01\ud654 JSON\uc744 \uc81c\ub300\ub85c \ub9cc\ub4e4\uc9c0 \ubabb\ud574, \ud45c \ub370\uc774\ud130\ub85c \uae30\ubcf8 \ucc28\ud2b8\ub97c \uc0dd\uc131\ud588\uc2b5\ub2c8\ub2e4.",
      fallbackReason: safeText(reason, 400),
      summary: "No tabular data was available for visualization.",
      visualizations: [],
      insights: [],
      warnings: [safeText(reason, 240)].filter(Boolean)
    };
  }

  const rows = asArray(dataSet.rows);
  const headers = asArray(dataSet.headers).map((header) => safeText(header, 120)).filter(Boolean);
  const valueColumn = pickValueColumn(headers, rows, prompt);
  const labelColumn = pickLabelColumn(headers, rows, prompt, valueColumn);
  const visualizations = [];

  if (labelColumn && valueColumn) {
    const grouped = groupNumericRows(rows, labelColumn, valueColumn);
    if (grouped.length) {
      visualizations.push({
        type: "bar",
        title: `${labelColumn}\ubcc4 ${valueColumn}`,
        subtitle: `${safeText(dataSet.fileName, 80)} / ${safeText(dataSet.sheetName, 80)}`,
        xLabel: labelColumn,
        yLabel: valueColumn,
        data: grouped
      });
    }
  }

  if (!visualizations.length && labelColumn) {
    const counts = groupCountRows(rows, labelColumn);
    if (counts.length) {
      visualizations.push({
        type: "pie",
        title: `${labelColumn} \ubd84\ud3ec`,
        subtitle: `${safeText(dataSet.fileName, 80)} / ${safeText(dataSet.sheetName, 80)}`,
        data: counts
      });
    }
  }

  visualizations.push({
    type: "table",
    title: "\ub370\uc774\ud130 \ubbf8\ub9ac\ubcf4\uae30",
    subtitle: `\uae30\ubcf8 \ucc28\ud2b8 \uc0dd\uc131\uc5d0 ${rows.length}\uac1c \ud589\uc744 \uc0ac\uc6a9\ud588\uc2b5\ub2c8\ub2e4.`,
    columns: headers.slice(0, 8),
    rows: rows.slice(0, 20).map((row) => headers.slice(0, 8).map((header) => safeText(row?.[header], 180)))
  });

  const warnings = [
    reason ? `\ubaa8\ub378 JSON\uc744 \uc0ac\uc6a9\ud560 \uc218 \uc5c6\uc5b4 \uae30\ubcf8 \ucc28\ud2b8\ub97c \uc0dd\uc131\ud588\uc2b5\ub2c8\ub2e4: ${safeText(reason, 180)}` : "",
    "\uc5c5\ub85c\ub4dc\ud55c \ud45c \ub370\uc774\ud130\ub97c \uae30\uc900\uc73c\ub85c \uc790\ub3d9 \uc0dd\uc131\ub41c \ucc28\ud2b8\uc785\ub2c8\ub2e4."
  ].filter(Boolean);

  return {
    version: "1.0",
    fallback: true,
    fallbackNotice: "\ubaa8\ub378\uc774 \uc2dc\uac01\ud654 JSON\uc744 \uc81c\ub300\ub85c \ub9cc\ub4e4\uc9c0 \ubabb\ud574, \ud45c \ub370\uc774\ud130\ub85c \uae30\ubcf8 \ucc28\ud2b8\ub97c \uc0dd\uc131\ud588\uc2b5\ub2c8\ub2e4.",
    fallbackReason: safeText(reason, 400),
    summary: "\uc5c5\ub85c\ub4dc\ud55c \ud45c \ub370\uc774\ud130\ub85c \uae30\ubcf8 \ucc28\ud2b8\ub97c \uc0dd\uc131\ud588\uc2b5\ub2c8\ub2e4.",
    visualizations,
    insights: buildFallbackInsights(rows, labelColumn, valueColumn),
    warnings
  };
}

function collectTables(documents) {
  const tables = [];
  for (const documentItem of asArray(documents)) {
    const fileName = safeText(documentItem?.fileName, 180);
    const sourceTables = collectSourceTables(documentItem);

    for (const table of sourceTables) {
      const headers = normalizeHeaders(table?.headers);
      const rows = normalizeRows(table?.rows, headers.length);
      if (!headers.length || !rows.length) continue;
      tables.push({
        fileName,
        name: safeText(table?.name ?? table?.label ?? "Sheet", 120),
        headers,
        rows,
        sampleRows: asArray(table?.sampleRows).slice(0, 12),
        rowCount: Number.isFinite(Number(table?.rowCount)) ? Number(table.rowCount) : rows.length,
        columnCount: Number.isFinite(Number(table?.columnCount)) ? Number(table.columnCount) : headers.length,
        truncated: Boolean(table?.truncated),
        profile: table?.profile && typeof table.profile === "object" ? table.profile : null
      });
    }
  }
  return tables;
}

function collectSourceTables(documentItem) {
  const documentTables = asArray(documentItem?.tables).filter((table) => Array.isArray(table?.rows));
  if (documentTables.length) return documentTables;

  const sheetTables = asArray(documentItem?.sheets).filter((sheet) => Array.isArray(sheet?.rows));
  if (sheetTables.length) return sheetTables;

  const recoveredSheets = asArray(documentItem?.sheets)
    .map((sheet, index) => recoverTableFromText(sheet?.text, sheet?.name ?? sheet?.label ?? `Sheet ${index + 1}`))
    .filter(Boolean);
  if (recoveredSheets.length) return recoveredSheets;

  const fileType = String(documentItem?.fileType ?? "").toLowerCase();
  if (["csv", "xlsx"].includes(fileType)) {
    const recovered = recoverTableFromText(documentItem?.text, documentItem?.fileName ?? "Table");
    if (recovered) return [recovered];
  }

  return [];
}

function recoverTableFromText(text, name) {
  const rows = parseDelimitedRows(text);
  if (rows.length < 2) return null;

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (columnCount < 2) return null;

  const headers = normalizeHeaders(rows[0].length ? rows[0] : []);
  const normalizedRows = normalizeRows(rows.slice(1), headers.length);
  if (!headers.length || !normalizedRows.length) return null;

  return {
    name,
    headers,
    rows: normalizedRows,
    sampleRows: normalizedRows.slice(0, 12).map((row) => rowToRecord(headers, row)),
    rowCount: normalizedRows.length,
    columnCount: headers.length,
    truncated: false,
    profile: null
  };
}

function parseDelimitedRows(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("# Sheet:"))
    .map((line) => splitDelimitedLine(line))
    .filter((row) => row.filter(Boolean).length >= 2)
    .slice(0, MAX_CONTEXT_ROWS_PER_TABLE + 1);
}

function splitDelimitedLine(line) {
  const delimiter = line.includes("\t") ? "\t" : ",";
  return line
    .split(delimiter)
    .map((cell) => cell.replace(/^"|"$/g, "").trim())
    .filter((cell, index, row) => cell || index < row.length - 1);
}

function normalizeVisualization(source) {
  if (!source || typeof source !== "object") return null;
  const type = normalizeType(source.type ?? source.chartType ?? source.visualizationType ?? source.kind);
  if (!VISUALIZATION_TYPES.has(type)) return null;

  const visualization = {
    type,
    title: safeText(source.title ?? source.name ?? "", 160),
    subtitle: safeText(source.subtitle ?? source.description ?? "", 240),
    xLabel: safeText(source.xLabel ?? source.xAxis ?? "", 80),
    yLabel: safeText(source.yLabel ?? source.yAxis ?? "", 80),
    data: normalizeChartData(source, type),
    series: normalizeSeries(source.series, type),
    items: normalizeKpiItems(source.items ?? source.metrics ?? source.kpis),
    columns: normalizeTextArray(source.columns ?? source.headers, 20),
    rows: normalizeTableRows(source.rows),
    sections: normalizeSections(source.sections)
  };

  if (type === "kpi" && !visualization.items.length) return null;
  if (type === "table" && (!visualization.columns.length || !visualization.rows.length)) return null;
  if (["bar", "line", "pie", "scatter"].includes(type) && !visualization.data.length && !visualization.series.length) return null;
  if (type === "infographic" && !visualization.items.length && !visualization.sections.length && !visualization.data.length) return null;

  return visualization;
}

function normalizeType(type) {
  const text = String(type ?? "").trim();
  const lower = text.toLowerCase();
  const compact = lower.replace(/[-_\s]+/g, "");
  return TYPE_ALIASES.get(text)
    ?? TYPE_ALIASES.get(lower)
    ?? TYPE_ALIASES.get(compact)
    ?? KOREAN_TYPE_ALIASES.get(text)
    ?? KOREAN_TYPE_ALIASES.get(lower)
    ?? lower;
}

function normalizeChartData(source, type) {
  if (!source || typeof source !== "object") return [];

  const direct = source.data ?? source.values ?? source.points;
  const labels = asArray(source.labels ?? source.categories ?? source.x ?? source.xValues);
  const values = asArray(source.values ?? source.y ?? source.yValues);

  if (direct && typeof direct === "object" && !Array.isArray(direct)) {
    const directLabels = asArray(direct.labels ?? direct.categories ?? direct.x ?? direct.xValues);
    const directValues = asArray(direct.values ?? direct.y ?? direct.yValues ?? direct.data);
    const paired = pairLabelsAndValues(directLabels, directValues, type);
    if (paired.length) return paired;
  }

  const paired = pairLabelsAndValues(labels, values, type);
  if (paired.length) return paired;

  return normalizeData(direct, type);
}

function pairLabelsAndValues(labels, values, type) {
  if (!labels.length || !values.length) return [];
  return labels
    .map((label, index) => normalizePoint({ label, value: values[index] }, type, index))
    .filter(Boolean)
    .slice(0, MAX_POINTS);
}

function normalizeData(value, type) {
  return asArray(value)
    .map((item, index) => normalizePoint(item, type, index))
    .filter(Boolean)
    .slice(0, MAX_POINTS);
}

function normalizeSeries(value, type) {
  return asArray(value)
    .map((series) => {
      if (!series || typeof series !== "object") return null;
      const data = normalizeData(series.data ?? series.values ?? series.points, type);
      if (!data.length) return null;
      return {
        name: safeText(series.name ?? series.label ?? "", 80),
        data
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function normalizePoint(item, type, index) {
  if (Array.isArray(item)) {
    if (type === "scatter") {
      const x = parseNumber(item[0]);
      const y = parseNumber(item[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { label: safeText(item[2] ?? `Point ${index + 1}`, 120), x, y };
    }
    const value = parseNumber(item[1] ?? item[0]);
    if (!Number.isFinite(value)) return null;
    return { label: safeText(item[0] ?? `Item ${index + 1}`, 120), value };
  }

  if (!item || typeof item !== "object") {
    const value = parseNumber(item);
    return Number.isFinite(value) ? { label: `Item ${index + 1}`, value } : null;
  }

  if (type === "scatter") {
    const x = parseNumber(item.x);
    const y = parseNumber(item.y ?? item.value);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      label: safeText(item.label ?? item.name ?? `Point ${index + 1}`, 120),
      x,
      y
    };
  }

  const value = parseNumber(item.value ?? item.y ?? item.amount ?? item.count);
  if (!Number.isFinite(value)) return null;
  return {
    label: safeText(item.label ?? item.name ?? item.x ?? `Item ${index + 1}`, 120),
    value
  };
}

function normalizeKpiItems(value) {
  return asArray(value)
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      return {
        label: safeText(item.label ?? item.name ?? `Metric ${index + 1}`, 120),
        value: safeText(item.value ?? item.amount ?? item.count ?? "", 120),
        note: safeText(item.note ?? item.description ?? "", 220)
      };
    })
    .filter((item) => item && item.value)
    .slice(0, 12);
}

function normalizeSections(value) {
  return asArray(value)
    .map((section, index) => {
      if (!section || typeof section !== "object") return null;
      const body = safeText(section.body ?? section.text ?? section.description ?? "", MAX_TEXT_LENGTH);
      return {
        title: safeText(section.title ?? section.label ?? `Section ${index + 1}`, 120),
        body,
        items: normalizeTextArray(section.items ?? section.bullets, 8)
      };
    })
    .filter((section) => section && (section.body || section.items.length))
    .slice(0, 8);
}

function normalizeTableRows(value) {
  return asArray(value)
    .map((row) => {
      if (row && typeof row === "object" && !Array.isArray(row)) {
        return Object.values(row).map((cell) => safeText(cell, 180));
      }
      return asArray(row).map((cell) => safeText(cell, 180));
    })
    .filter((row) => row.some(Boolean))
    .slice(0, MAX_TABLE_ROWS);
}

function pickLabelColumn(headers, rows, prompt, excludedColumn = "") {
  const promptText = String(prompt ?? "").toLowerCase();
  const candidates = headers.filter((header) => header !== excludedColumn);
  return candidates
    .map((header) => ({
      header,
      score: scoreHeader(header, promptText, LABEL_COLUMN_KEYWORDS)
        + (isMostlyNumericColumn(rows, header) ? -2 : 2)
        + (uniqueCount(rows, header) <= Math.max(20, rows.length / 2) ? 1 : 0)
    }))
    .sort((left, right) => right.score - left.score)[0]?.header ?? candidates[0] ?? "";
}

function pickValueColumn(headers, rows, prompt) {
  const promptText = String(prompt ?? "").toLowerCase();
  return headers
    .filter((header) => isMostlyNumericColumn(rows, header))
    .map((header) => ({
      header,
      score: scoreHeader(header, promptText, VALUE_COLUMN_KEYWORDS)
    }))
    .sort((left, right) => right.score - left.score)[0]?.header ?? "";
}

function scoreHeader(header, promptText, keywords) {
  const normalized = String(header ?? "").toLowerCase();
  let score = promptText.includes(normalized) && normalized ? 6 : 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword.toLowerCase())) score += 4;
    if (promptText.includes(keyword.toLowerCase())) score += 1;
  }
  return score;
}

function isMostlyNumericColumn(rows, header) {
  const values = rows.map((row) => row?.[header]).filter((value) => String(value ?? "").trim());
  if (!values.length) return false;
  const numericCount = values.filter((value) => Number.isFinite(parseNumber(value))).length;
  return numericCount / values.length >= 0.65;
}

function uniqueCount(rows, header) {
  return new Set(rows.map((row) => safeText(row?.[header], 120)).filter(Boolean)).size;
}

function groupNumericRows(rows, labelColumn, valueColumn) {
  const groups = new Map();
  for (const row of rows) {
    const label = safeText(row?.[labelColumn], 120);
    const value = parseNumber(row?.[valueColumn]);
    if (!label || !Number.isFinite(value)) continue;
    const current = groups.get(label) ?? 0;
    groups.set(label, current + value);
  }
  return Array.from(groups.entries())
    .map(([label, value]) => ({ label, value: roundNumber(value) }))
    .slice(0, MAX_POINTS);
}

function groupCountRows(rows, labelColumn) {
  const groups = new Map();
  for (const row of rows) {
    const label = safeText(row?.[labelColumn], 120);
    if (!label) continue;
    groups.set(label, (groups.get(label) ?? 0) + 1);
  }
  return Array.from(groups.entries())
    .map(([label, value]) => ({ label, value }))
    .slice(0, MAX_POINTS);
}

function buildFallbackInsights(rows, labelColumn, valueColumn) {
  const insights = [`${rows.length}\uac1c \ud589\uc744 \uc2dc\uac01\ud654\uc5d0 \uc0ac\uc6a9\ud588\uc2b5\ub2c8\ub2e4.`];
  if (labelColumn) insights.push(`\ubd84\ub958 \uae30\uc900 \ud544\ub4dc\ub294 "${labelColumn}"\uc785\ub2c8\ub2e4.`);
  if (valueColumn) insights.push(`\uc218\uce58 \ud544\ub4dc\ub294 "${valueColumn}"\uc785\ub2c8\ub2e4.`);
  return insights;
}

function roundNumber(value) {
  return Math.round(value * 10000) / 10000;
}

function normalizeHeaders(value) {
  return asArray(value)
    .map((header, index) => safeText(header, 120) || `Column ${index + 1}`)
    .slice(0, 60);
}

function normalizeRows(rows, width) {
  return asArray(rows)
    .map((row) => asArray(row).slice(0, width).map((cell) => safeText(cell, 180)))
    .filter((row) => row.some(Boolean));
}

function rowToRecord(headers, row) {
  return Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
}

function normalizeTextArray(value, limit) {
  return asArray(value)
    .map((item) => safeText(item, MAX_TEXT_LENGTH))
    .filter(Boolean)
    .slice(0, limit);
}

function parseJsonObject(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? text.slice(start, end + 1) : "";
}

function stripJsonFence(text) {
  return text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
}

function parseNumber(value) {
  const text = String(value ?? "")
    .trim()
    .replace(/,/g, "")
    .replace(/[%$]/g, "");
  if (!text) return NaN;
  return Number(text);
}

function safeText(value, maxLength = MAX_TEXT_LENGTH) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
