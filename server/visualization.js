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
    source: safeText(source.source, 40) || (source.fallback ? "fallback" : "llm"),
    fallback: Boolean(source.fallback),
    fallbackNotice: safeText(source.fallbackNotice, 240),
    fallbackReason: safeText(source.fallbackReason, 400),
    summary: safeText(source.summary ?? source.title ?? "", MAX_TEXT_LENGTH),
    analysisPlan: source.analysisPlan && typeof source.analysisPlan === "object" ? source.analysisPlan : null,
    visualizations,
    insights: normalizeTextArray(source.insights ?? source.keyFindings ?? source.findings, 8),
    warnings: normalizeTextArray(source.warnings ?? source.cautions ?? source.notes, 6)
  };
}

export function normalizeVisualizationPlan(value, context = {}) {
  const source = value && typeof value === "object" ? value : {};
  const rawPlan = source.visualizationPlan ?? source.plan ?? source.chartPlan ?? source.chart ?? source;
  const dataSets = asArray(context?.dataSets);
  const dataSetIndex = clampIndex(Number(rawPlan.dataSetIndex ?? rawPlan.datasetIndex ?? rawPlan.tableIndex ?? 0), dataSets.length);
  const dataSet = dataSets[dataSetIndex];
  const headers = asArray(dataSet?.headers).map((header) => safeText(header, 120)).filter(Boolean);
  const analysisSource = source.analysis && typeof source.analysis === "object" ? source.analysis : source;
  const chartType = normalizeType(rawPlan.chartType ?? rawPlan.type ?? rawPlan.visualizationType ?? rawPlan.kind);
  const aggregation = normalizeAggregation(
    rawPlan.aggregation ?? rawPlan.aggregate ?? rawPlan.y?.aggregation ?? rawPlan.metric?.aggregation
  );

  const plan = {
    status: safeText(source.status ?? "ok", 40).toLowerCase() || "ok",
    analysis: {
      summary: safeText(analysisSource.summary ?? analysisSource.answer ?? "", MAX_TEXT_LENGTH),
      insights: normalizeTextArray(analysisSource.insights ?? analysisSource.keyFindings ?? analysisSource.findings, 8),
      warnings: normalizeTextArray(analysisSource.warnings ?? analysisSource.limitations ?? analysisSource.cautions, 6)
    },
    chartType,
    dataSetIndex,
    title: safeText(rawPlan.title ?? rawPlan.name ?? "", 160),
    subtitle: safeText(rawPlan.subtitle ?? rawPlan.description ?? rawPlan.reason ?? "", 240),
    xColumn: resolveColumn(rawPlan.xColumn ?? rawPlan.x?.column ?? rawPlan.labelColumn ?? rawPlan.categoryColumn, headers),
    yColumn: resolveColumn(rawPlan.yColumn ?? rawPlan.y?.column ?? rawPlan.valueColumn ?? rawPlan.metricColumn, headers),
    labelColumn: resolveColumn(rawPlan.labelColumn ?? rawPlan.label?.column ?? rawPlan.categoryColumn ?? rawPlan.xColumn, headers),
    seriesColumn: resolveColumn(rawPlan.seriesColumn ?? rawPlan.groupColumn ?? rawPlan.colorColumn ?? rawPlan.series?.column, headers),
    aggregation,
    reason: safeText(rawPlan.reason ?? source.reason ?? "", MAX_TEXT_LENGTH)
  };

  const errors = [];
  if (["cannot_visualize", "cannot-visualize", "error"].includes(plan.status)) {
    errors.push(safeText(source.reason ?? "The model reported that it cannot create a visualization plan.", 240));
  }
  if (!dataSet) errors.push("No dataset index in the plan matches the available table context.");
  if (!VISUALIZATION_TYPES.has(plan.chartType)) errors.push(`Unsupported chart type: ${plan.chartType || "(empty)"}.`);
  if (["bar", "line", "pie"].includes(plan.chartType) && !plan.xColumn && !plan.labelColumn) {
    errors.push(`${plan.chartType} requires xColumn or labelColumn.`);
  }
  if (["bar", "line", "pie"].includes(plan.chartType) && plan.aggregation !== "count" && !plan.yColumn) {
    errors.push(`${plan.chartType} requires yColumn unless aggregation is count.`);
  }
  if (plan.chartType === "scatter" && (!plan.xColumn || !plan.yColumn)) {
    errors.push("scatter requires xColumn and yColumn.");
  }

  return { ok: errors.length === 0, plan, errors };
}

export function executeVisualizationPlan(plan, context = {}) {
  const dataSet = asArray(context?.dataSets)[plan?.dataSetIndex ?? 0];
  if (!dataSet) return { ok: false, errors: ["The selected dataset is not available."] };

  const rows = asArray(dataSet.rows);
  const headers = asArray(dataSet.headers).map((header) => safeText(header, 120)).filter(Boolean);
  const errors = validatePlanAgainstRows(plan, rows, headers);
  if (errors.length) return { ok: false, errors };

  const executionPlan = {
    ...plan,
    aggregation: effectiveAggregationForPlan(plan, rows)
  };
  const visualization = buildVisualizationFromPlan(executionPlan, dataSet, rows, headers);
  if (!visualization) return { ok: false, errors: ["The analysis plan did not produce renderable chart data."] };

  const spec = {
    version: "1.0",
    source: "llm",
    fallback: false,
    summary: plan.analysis?.summary || plan.reason || "AI analysis plan was executed successfully.",
    insights: normalizeTextArray(plan.analysis?.insights, 8),
    warnings: normalizeTextArray(plan.analysis?.warnings, 6),
    analysisPlan: {
      chartType: executionPlan.chartType,
      dataSetIndex: executionPlan.dataSetIndex,
      xColumn: executionPlan.xColumn,
      yColumn: executionPlan.yColumn,
      labelColumn: executionPlan.labelColumn,
      seriesColumn: executionPlan.seriesColumn,
      aggregation: executionPlan.aggregation,
      reason: executionPlan.reason
    },
    visualizations: [visualization]
  };

  return { ok: true, spec };
}

export function buildFallbackVisualizationSpec({ prompt, context, reason = "", modelText = "" }) {
  const dataSet = asArray(context?.dataSets).find((item) => asArray(item?.rows).length && asArray(item?.headers).length);
  const recoveredAnalysis = extractModelAnalysis(modelText);
  if (!dataSet) {
    return {
      version: "1.0",
      source: "fallback",
      fallback: true,
      fallbackNotice: "AI 분석 계획을 검증하지 못해 자동 fallback 결과를 표시합니다.",
      fallbackReason: safeText(reason, 400),
      summary: recoveredAnalysis.summary || "No tabular data was available for visualization.",
      visualizations: [],
      insights: recoveredAnalysis.insights,
      warnings: [safeText(reason, 240)].filter(Boolean)
    };
  }

  const rows = asArray(dataSet.rows);
  const headers = asArray(dataSet.headers).map((header) => safeText(header, 120)).filter(Boolean);
  const requestedType = pickRequestedVisualizationType(prompt);
  const valueColumn = pickValueColumn(headers, rows, prompt);
  const labelColumn = pickLabelColumn(headers, rows, prompt, valueColumn);
  const visualizations = [];

  if (requestedType === "scatter") {
    const scatterColumns = pickScatterColumns(headers, rows, prompt);
    const scatterData = buildScatterRows(rows, scatterColumns.xColumn, scatterColumns.yColumn, labelColumn);
    if (scatterData.length) {
      visualizations.push({
        type: "scatter",
        title: `${scatterColumns.xColumn}\uc640 ${scatterColumns.yColumn} \uad00\uacc4`,
        subtitle: `${safeText(dataSet.fileName, 80)} / ${safeText(dataSet.sheetName, 80)}`,
        xLabel: scatterColumns.xColumn,
        yLabel: scatterColumns.yColumn,
        data: scatterData
      });
    }
  }

  if (!visualizations.length && labelColumn && valueColumn) {
    const grouped = groupNumericRows(rows, labelColumn, valueColumn);
    if (grouped.length) {
      visualizations.push({
        type: requestedType === "line" ? "line" : "bar",
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
        type: requestedType === "pie" ? "pie" : "bar",
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
    source: "fallback",
    fallback: true,
    fallbackNotice: "AI 분석 계획을 검증하지 못해 자동 fallback 차트를 표시합니다.",
    fallbackReason: safeText(reason, 400),
    summary: recoveredAnalysis.summary || "\uc5c5\ub85c\ub4dc\ud55c \ud45c \ub370\uc774\ud130\ub85c \uae30\ubcf8 \ucc28\ud2b8\ub97c \uc0dd\uc131\ud588\uc2b5\ub2c8\ub2e4.",
    visualizations,
    insights: mergeInsights(recoveredAnalysis.insights, buildFallbackInsights(rows, labelColumn, valueColumn)),
    warnings
  };
}

function extractModelAnalysis(value) {
  const text = String(value ?? "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!text || /^[\s{[]/.test(text)) return { summary: "", insights: [] };

  const cleanedLines = text
    .split(/\r?\n/)
    .map((line) => line
      .replace(/^\s{0,3}(?:[-*+•]|\d+[.)])\s*/, "")
      .replace(/^\s{0,3}#{1,6}\s*/, "")
      .trim())
    .filter((line) => line && !/^[{}\[\],:]+$/.test(line));

  const summary = safeText(cleanedLines[0] || firstSentence(text), MAX_TEXT_LENGTH);
  const insightCandidates = cleanedLines.slice(1).length
    ? cleanedLines.slice(1)
    : text.split(/(?<=[.!?。！？])\s+/).slice(1);

  return {
    summary,
    insights: normalizeTextArray(insightCandidates, 6)
  };
}

function mergeInsights(primary, fallback) {
  const seen = new Set();
  return [...asArray(primary), ...asArray(fallback)]
    .map((item) => safeText(item, MAX_TEXT_LENGTH))
    .filter((item) => {
      const key = item.toLowerCase();
      if (!item || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8);
}

function firstSentence(value) {
  return String(value ?? "").split(/(?<=[.!?。！？])\s+/)[0] || "";
}

function pickRequestedVisualizationType(prompt) {
  const text = String(prompt ?? "").toLowerCase();
  if (/\bscatter\b|scatterplot|scatter plot|bubble|\uc0b0\uc810\ub3c4/.test(text)) return "scatter";
  if (/\bline\b|linechart|line chart|trend|\uc120\uadf8\ub798\ud504|\uc120 \uadf8\ub798\ud504|\ucd94\uc774/.test(text)) return "line";
  if (/\bpie\b|piechart|pie chart|donut|doughnut|\uc6d0\ud615|\ud30c\uc774/.test(text)) return "pie";
  if (/\bbar\b|barchart|bar chart|column|\ub9c9\ub300/.test(text)) return "bar";
  return "bar";
}

function validatePlanAgainstRows(plan, rows, headers) {
  const errors = [];
  const hasColumn = (column) => !column || headers.includes(column);
  if (!rows.length) errors.push("The selected dataset has no rows.");
  if (!hasColumn(plan.xColumn)) errors.push(`Unknown xColumn: ${plan.xColumn}.`);
  if (!hasColumn(plan.yColumn)) errors.push(`Unknown yColumn: ${plan.yColumn}.`);
  if (!hasColumn(plan.labelColumn)) errors.push(`Unknown labelColumn: ${plan.labelColumn}.`);
  if (!hasColumn(plan.seriesColumn)) errors.push(`Unknown seriesColumn: ${plan.seriesColumn}.`);

  if (["bar", "line", "pie"].includes(plan.chartType)) {
    const labelColumn = plan.xColumn || plan.labelColumn;
    const aggregation = plan.aggregation || defaultAggregation(plan.yColumn);
    if (!labelColumn) errors.push(`${plan.chartType} requires a category or x column.`);
    if (aggregation !== "count" && !plan.yColumn) errors.push(`${plan.chartType} requires a numeric y column.`);
    if (plan.yColumn && !isMostlyNumericColumn(rows, plan.yColumn)) {
      errors.push(`${plan.yColumn} must be numeric for ${plan.chartType}.`);
    }
  }

  if (plan.chartType === "scatter") {
    if (!plan.xColumn || !plan.yColumn) errors.push("scatter requires numeric xColumn and yColumn.");
    if (plan.xColumn && !isMostlyNumericColumn(rows, plan.xColumn)) errors.push(`${plan.xColumn} must be numeric for scatter.`);
    if (plan.yColumn && !isMostlyNumericColumn(rows, plan.yColumn)) errors.push(`${plan.yColumn} must be numeric for scatter.`);
  }

  return errors;
}

function effectiveAggregationForPlan(plan, rows) {
  if (!["bar", "line", "pie"].includes(plan.chartType)) return plan.aggregation;
  const labelColumn = plan.xColumn || plan.labelColumn;
  if (plan.aggregation === "none" && hasDuplicateLabels(rows, labelColumn)) {
    return defaultAggregation(plan.yColumn);
  }
  return plan.aggregation || defaultAggregation(plan.yColumn);
}

function hasDuplicateLabels(rows, labelColumn) {
  if (!labelColumn) return false;
  const seen = new Set();
  for (const row of rows) {
    const label = safeText(row?.[labelColumn], 120);
    if (!label) continue;
    if (seen.has(label)) return true;
    seen.add(label);
  }
  return false;
}

function buildVisualizationFromPlan(plan, dataSet, rows, headers) {
  const subtitle = [
    `${safeText(dataSet.fileName, 80)} / ${safeText(dataSet.sheetName, 80)}`,
    plan.reason
  ].filter(Boolean).join(" - ");

  if (plan.chartType === "scatter") {
    const labelColumn = plan.labelColumn || plan.seriesColumn || "";
    const data = buildScatterRows(rows, plan.xColumn, plan.yColumn, labelColumn);
    if (!data.length) return null;
    return {
      type: "scatter",
      title: plan.title || `${plan.xColumn} and ${plan.yColumn}`,
      subtitle,
      xLabel: plan.xColumn,
      yLabel: plan.yColumn,
      data
    };
  }

  if (["bar", "line", "pie"].includes(plan.chartType)) {
    const labelColumn = plan.xColumn || plan.labelColumn;
    const aggregation = plan.aggregation || defaultAggregation(plan.yColumn);
    const data = aggregation === "count"
      ? groupCountRows(rows, labelColumn)
      : aggregation === "none"
        ? rawNumericRows(rows, labelColumn, plan.yColumn)
      : aggregateNumericRows(rows, labelColumn, plan.yColumn, aggregation);
    const sortedData = plan.chartType === "line" ? sortChartData(data) : data;
    if (!sortedData.length) return null;
    return {
      type: plan.chartType,
      title: plan.title || `${labelColumn} by ${plan.yColumn || "count"}`,
      subtitle,
      xLabel: labelColumn,
      yLabel: aggregation === "count" ? "count" : plan.yColumn,
      data: sortedData
    };
  }

  if (plan.chartType === "table") {
    const columns = uniqueValues([plan.xColumn, plan.yColumn, plan.labelColumn, plan.seriesColumn, ...headers]).slice(0, 8);
    return {
      type: "table",
      title: plan.title || "Data table",
      subtitle,
      columns,
      rows: rows.slice(0, 40).map((row) => columns.map((column) => safeText(row?.[column], 180)))
    };
  }

  if (plan.chartType === "kpi") {
    const items = buildKpiItemsFromPlan(rows, plan);
    if (!items.length) return null;
    return {
      type: "kpi",
      title: plan.title || "Key metrics",
      subtitle,
      items
    };
  }

  if (plan.chartType === "infographic") {
    const labelColumn = plan.xColumn || plan.labelColumn || headers.find((header) => !isMostlyNumericColumn(rows, header));
    const yColumn = plan.yColumn || headers.find((header) => isMostlyNumericColumn(rows, header));
    const data = labelColumn && yColumn ? aggregateNumericRows(rows, labelColumn, yColumn, plan.aggregation || defaultAggregation(yColumn)) : [];
    return {
      type: "infographic",
      title: plan.title || "Infographic summary",
      subtitle,
      data,
      items: buildKpiItemsFromPlan(rows, { ...plan, yColumn }),
      sections: plan.reason ? [{ title: "AI analysis plan", body: plan.reason, items: [] }] : []
    };
  }

  return null;
}

function aggregateNumericRows(rows, labelColumn, valueColumn, aggregation = "average") {
  const groups = new Map();
  for (const row of rows) {
    const label = safeText(row?.[labelColumn], 120);
    const value = parseNumber(row?.[valueColumn]);
    if (!label || !Number.isFinite(value)) continue;
    const current = groups.get(label) ?? { sum: 0, count: 0, min: value, max: value };
    current.sum += value;
    current.count += 1;
    current.min = Math.min(current.min, value);
    current.max = Math.max(current.max, value);
    groups.set(label, current);
  }

  return Array.from(groups.entries())
    .map(([label, stats]) => ({ label, value: roundNumber(aggregateValue(stats, aggregation)) }))
    .filter((point) => Number.isFinite(point.value))
    .slice(0, MAX_POINTS);
}

function rawNumericRows(rows, labelColumn, valueColumn) {
  return rows
    .map((row, index) => {
      const label = safeText(row?.[labelColumn], 120) || `Row ${index + 1}`;
      const value = parseNumber(row?.[valueColumn]);
      if (!Number.isFinite(value)) return null;
      return { label, value: roundNumber(value) };
    })
    .filter(Boolean)
    .slice(0, MAX_POINTS);
}

function aggregateValue(stats, aggregation) {
  if (aggregation === "sum") return stats.sum;
  if (aggregation === "min") return stats.min;
  if (aggregation === "max") return stats.max;
  if (aggregation === "count") return stats.count;
  return stats.sum / Math.max(1, stats.count);
}

function buildKpiItemsFromPlan(rows, plan) {
  if (!rows.length) return [];
  if (!plan.yColumn || !isMostlyNumericColumn(rows, plan.yColumn)) {
    return [{ label: "Rows", value: String(rows.length), note: "Number of rows used for the AI analysis plan." }];
  }

  const values = rows.map((row) => parseNumber(row?.[plan.yColumn])).filter(Number.isFinite);
  if (!values.length) return [];
  const sum = values.reduce((total, value) => total + value, 0);
  const average = sum / values.length;
  return [
    { label: `${plan.yColumn} avg`, value: String(roundNumber(average)), note: "Average over valid numeric rows." },
    { label: `${plan.yColumn} min`, value: String(roundNumber(Math.min(...values))), note: "Minimum value." },
    { label: `${plan.yColumn} max`, value: String(roundNumber(Math.max(...values))), note: "Maximum value." }
  ];
}

function sortChartData(data) {
  return [...data].sort((left, right) => compareLabels(left.label, right.label));
}

function compareLabels(left, right) {
  const leftNumber = parseNumber(left);
  const rightNumber = parseNumber(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) return leftTime - rightTime;
  return String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
}

function normalizeAggregation(value) {
  const text = String(value ?? "").trim().toLowerCase().replace(/[-_\s]+/g, "");
  if (["avg", "average", "mean"].includes(text)) return "average";
  if (["sum", "total"].includes(text)) return "sum";
  if (["count", "frequency", "freq"].includes(text)) return "count";
  if (["min", "minimum"].includes(text)) return "min";
  if (["max", "maximum"].includes(text)) return "max";
  if (["none", "raw"].includes(text)) return "none";
  return "";
}

function defaultAggregation(valueColumn) {
  return valueColumn ? "average" : "count";
}

function resolveColumn(value, headers) {
  const raw = value && typeof value === "object" ? value.column ?? value.name ?? value.field : value;
  const text = String(raw ?? "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  const compact = lower.replace(/[-_\s]+/g, "");
  return headers.find((header) => header === text)
    ?? headers.find((header) => header.toLowerCase() === lower)
    ?? headers.find((header) => header.toLowerCase().replace(/[-_\s]+/g, "") === compact)
    ?? "";
}

function clampIndex(value, length) {
  if (!length) return 0;
  const index = Number.isInteger(value) ? value : 0;
  return Math.min(Math.max(index, 0), length - 1);
}

function uniqueValues(values) {
  const seen = new Set();
  return values
    .map((value) => safeText(value, 120))
    .filter((value) => {
      if (!value || seen.has(value)) return false;
      seen.add(value);
      return true;
    });
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

function pickScatterColumns(headers, rows, prompt) {
  const promptText = String(prompt ?? "").toLowerCase();
  const numericCandidates = headers
    .filter((header) => isMostlyNumericColumn(rows, header))
    .map((header, index) => {
      const normalized = String(header ?? "").toLowerCase();
      const promptIndex = normalized ? promptText.indexOf(normalized) : -1;
      return {
        header,
        index,
        promptIndex,
        score: scoreHeader(header, promptText, VALUE_COLUMN_KEYWORDS)
      };
    })
    .sort((left, right) => {
      const leftMentioned = left.promptIndex >= 0;
      const rightMentioned = right.promptIndex >= 0;
      if (leftMentioned && rightMentioned) return left.promptIndex - right.promptIndex;
      if (leftMentioned !== rightMentioned) return leftMentioned ? -1 : 1;
      if (right.score !== left.score) return right.score - left.score;
      return left.index - right.index;
    });

  return {
    xColumn: numericCandidates[0]?.header ?? "",
    yColumn: numericCandidates.find((candidate) => candidate.header !== numericCandidates[0]?.header)?.header ?? ""
  };
}

function scoreHeader(header, promptText, keywords) {
  const normalized = String(header ?? "").toLowerCase();
  let score = promptText.includes(normalized) && normalized ? 6 : 0;
  score += scoreHeaderPromptAliases(normalized, promptText);
  for (const keyword of keywords) {
    if (normalized.includes(keyword.toLowerCase())) score += 4;
    if (promptText.includes(keyword.toLowerCase())) score += 1;
  }
  return score;
}

function scoreHeaderPromptAliases(normalizedHeader, promptText) {
  const aliases = [
    { match: /(^|_)date($|_)|time|day/, words: ["\ub0a0\uc9dc", "\uc77c\uc790", "\uc77c\ubcc4", "\uae30\uac04", "\ucd94\uc774"], score: 8 },
    { match: /model/, words: ["\ubaa8\ub378", "llm"], score: 8 },
    { match: /task|category|type/, words: ["\uc791\uc5c5", "\uc720\ud615", "\ubd84\ub958", "\uce74\ud14c\uace0\ub9ac"], score: 8 },
    { match: /provider/, words: ["\uc81c\uacf5", "\uc5d4\uc9c4", "provider"], score: 6 },
    { match: /accuracy/, words: ["\uc815\ud655\ub3c4", "accuracy"], score: 8 },
    { match: /latency/, words: ["\uc9c0\uc5f0", "\uc751\ub2f5\uc2dc\uac04", "latency"], score: 8 },
    { match: /token/, words: ["\ud1a0\ud070", "token"], score: 8 },
    { match: /error/, words: ["\uc624\ub958", "error"], score: 8 },
    { match: /satisfaction/, words: ["\ub9cc\uc871", "satisfaction"], score: 8 }
  ];

  return aliases.reduce((total, alias) => {
    if (!alias.match.test(normalizedHeader)) return total;
    return total + (alias.words.some((word) => promptText.includes(word.toLowerCase())) ? alias.score : 0);
  }, 0);
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

function buildScatterRows(rows, xColumn, yColumn, labelColumn) {
  if (!xColumn || !yColumn) return [];
  return rows
    .map((row, index) => {
      const x = parseNumber(row?.[xColumn]);
      const y = parseNumber(row?.[yColumn]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return {
        label: safeText(row?.[labelColumn], 120) || `Point ${index + 1}`,
        x: roundNumber(x),
        y: roundNumber(y)
      };
    })
    .filter(Boolean)
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
