const SVG_NS = "http://www.w3.org/2000/svg";
const CHART_WIDTH = 720;
const CHART_HEIGHT = 360;
const PLOT = { left: 64, top: 32, right: 28, bottom: 56 };
const PALETTE = ["#0f766e", "#2563eb", "#e11d48", "#f59e0b", "#7c3aed", "#0891b2", "#16a34a", "#ea580c"];

export function formatVisualizationText(spec) {
  const normalized = normalizeSpec(spec);
  const lines = [];
  if (normalized.summary) lines.push(normalized.summary);
  if (normalized.insights.length) {
    lines.push("", "Insights");
    for (const insight of normalized.insights) lines.push(`- ${insight}`);
  }
  if (!normalized.fallback && normalized.warnings.length) {
    lines.push("", "Warnings");
    for (const warning of normalized.warnings) lines.push(`- ${warning}`);
  }
  return lines.join("\n").trim() || "Visualization is ready.";
}

export function renderVisualizationSpec(spec) {
  const normalized = normalizeSpec(spec);
  const panel = document.createElement("section");
  panel.className = "visualization-panel";

  const toolbar = document.createElement("div");
  toolbar.className = "visualization-toolbar";

  const label = document.createElement("div");
  label.className = "visualization-label";
  label.textContent = "Visualization";

  const copyButton = createIconButton("visualization-json-copy", "Copy visualization JSON", copyIconSvg());
  copyButton.addEventListener("click", async () => {
    await copyTextToClipboard(JSON.stringify(normalized, null, 2));
    showButtonFeedback(copyButton);
  });

  toolbar.append(label, copyButton);
  panel.append(toolbar);

  const grid = document.createElement("div");
  grid.className = "visualization-grid";
  for (const [index, visualization] of normalized.visualizations.entries()) {
    const block = renderVisualizationBlock(visualization, index, normalized);
    if (block) grid.append(block);
  }
  panel.append(grid);
  return panel;
}

function renderVisualizationBlock(visualization, index, spec) {
  const block = document.createElement("article");
  block.className = `visualization-item visualization-${visualization.type}`;

  const header = document.createElement("div");
  header.className = "visualization-item-header";

  const titleWrap = document.createElement("div");
  titleWrap.className = "visualization-title-wrap";
  const title = document.createElement("h3");
  title.className = "visualization-title";
  title.textContent = visualization.title || defaultTitle(visualization.type, index);
  titleWrap.append(title);

  if (visualization.subtitle) {
    const subtitle = document.createElement("p");
    subtitle.className = "visualization-subtitle";
    subtitle.textContent = visualization.subtitle;
    titleWrap.append(subtitle);
  }

  const actions = document.createElement("div");
  actions.className = "visualization-item-actions";
  header.append(titleWrap, actions);
  block.append(header);

  if (["bar", "line", "pie", "scatter"].includes(visualization.type)) {
    const svg = renderChartSvg(visualization);
    if (!svg) return null;
    const downloadButton = createIconButton("visualization-download", "Download chart as PNG", downloadIconSvg());
    downloadButton.addEventListener("click", () => downloadSvgAsPng(svg, visualization.title || defaultTitle(visualization.type, index)));
    actions.append(downloadButton);
    block.append(svg);
    if (spec.fallback) block.append(createFallbackNotice(spec));
    return block;
  }

  if (visualization.type === "kpi") {
    block.append(renderKpiGrid(visualization.items));
    return block;
  }

  if (visualization.type === "table") {
    block.append(renderDataTable(visualization));
    return block;
  }

  if (visualization.type === "infographic") {
    block.append(renderInfographic(visualization));
    return block;
  }

  return null;
}

function renderChartSvg(visualization) {
  const data = chartData(visualization);
  if (!data.length) return null;

  if (visualization.type === "pie") return renderPieSvg(visualization, data);
  if (visualization.type === "scatter") return renderScatterSvg(visualization, data);
  if (visualization.type === "line") return renderLineSvg(visualization, data);
  return renderBarSvg(visualization, data);
}

function renderBarSvg(visualization, data) {
  const svg = baseSvg(visualization.title || "Bar chart");
  const plotWidth = CHART_WIDTH - PLOT.left - PLOT.right;
  const plotHeight = CHART_HEIGHT - PLOT.top - PLOT.bottom;
  const values = data.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const yScale = makeScale(min, max, PLOT.top + plotHeight, PLOT.top);
  const zeroY = yScale(0);
  drawGrid(svg, min, max, yScale);

  const slot = plotWidth / data.length;
  const barWidth = Math.max(10, Math.min(46, slot * 0.64));

  data.forEach((point, index) => {
    const x = PLOT.left + slot * index + (slot - barWidth) / 2;
    const y = yScale(Math.max(0, point.value));
    const height = Math.abs(yScale(point.value) - zeroY);
    const rect = svgElement("rect", {
      x,
      y: point.value >= 0 ? y : zeroY,
      width: barWidth,
      height: Math.max(1, height),
      rx: 5,
      fill: PALETTE[index % PALETTE.length]
    });
    rect.append(document.createElementNS(SVG_NS, "title"));
    rect.querySelector("title").textContent = `${point.label}: ${formatNumber(point.value)}`;
    svg.append(rect);

    if (shouldShowLabel(index, data.length)) {
      svg.append(textNode(PLOT.left + slot * index + slot / 2, CHART_HEIGHT - 24, truncate(point.label, 12), {
        anchor: "middle",
        size: 12,
        fill: "#475569"
      }));
    }
  });

  drawAxes(svg, visualization);
  return svg;
}

function renderLineSvg(visualization, data) {
  const svg = baseSvg(visualization.title || "Line chart");
  const plotWidth = CHART_WIDTH - PLOT.left - PLOT.right;
  const plotHeight = CHART_HEIGHT - PLOT.top - PLOT.bottom;
  const values = data.map((point) => point.value);
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  const yScale = makeScale(min, max, PLOT.top + plotHeight, PLOT.top);
  const xScale = (index) => PLOT.left + (data.length === 1 ? plotWidth / 2 : (plotWidth * index) / (data.length - 1));
  drawGrid(svg, min, max, yScale);

  const points = data.map((point, index) => `${xScale(index)},${yScale(point.value)}`).join(" ");
  svg.append(svgElement("polyline", {
    points,
    fill: "none",
    stroke: PALETTE[1],
    "stroke-width": 3,
    "stroke-linecap": "round",
    "stroke-linejoin": "round"
  }));

  data.forEach((point, index) => {
    const x = xScale(index);
    const y = yScale(point.value);
    const circle = svgElement("circle", { cx: x, cy: y, r: 4.5, fill: "#fff", stroke: PALETTE[1], "stroke-width": 2.5 });
    circle.append(document.createElementNS(SVG_NS, "title"));
    circle.querySelector("title").textContent = `${point.label}: ${formatNumber(point.value)}`;
    svg.append(circle);

    if (shouldShowLabel(index, data.length)) {
      svg.append(textNode(x, CHART_HEIGHT - 24, truncate(point.label, 12), {
        anchor: "middle",
        size: 12,
        fill: "#475569"
      }));
    }
  });

  drawAxes(svg, visualization);
  return svg;
}

function renderScatterSvg(visualization, data) {
  const svg = baseSvg(visualization.title || "Scatter chart");
  const plotWidth = CHART_WIDTH - PLOT.left - PLOT.right;
  const plotHeight = CHART_HEIGHT - PLOT.top - PLOT.bottom;
  const xs = data.map((point) => point.x);
  const ys = data.map((point) => point.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(...ys);
  const xScale = makeScale(xMin, xMax, PLOT.left, PLOT.left + plotWidth);
  const yScale = makeScale(yMin, yMax, PLOT.top + plotHeight, PLOT.top);
  drawGrid(svg, yMin, yMax, yScale);

  data.forEach((point, index) => {
    const circle = svgElement("circle", {
      cx: xScale(point.x),
      cy: yScale(point.y),
      r: 6,
      fill: PALETTE[index % PALETTE.length],
      opacity: 0.86
    });
    circle.append(document.createElementNS(SVG_NS, "title"));
    circle.querySelector("title").textContent = `${point.label}: ${formatNumber(point.x)}, ${formatNumber(point.y)}`;
    svg.append(circle);
  });

  drawAxes(svg, visualization);
  svg.append(textNode(PLOT.left, CHART_HEIGHT - 24, formatNumber(xMin), { anchor: "start", size: 12, fill: "#64748b" }));
  svg.append(textNode(CHART_WIDTH - PLOT.right, CHART_HEIGHT - 24, formatNumber(xMax), { anchor: "end", size: 12, fill: "#64748b" }));
  return svg;
}

function renderPieSvg(visualization, data) {
  const svg = baseSvg(visualization.title || "Pie chart");
  const positiveData = data.filter((point) => point.value > 0);
  if (!positiveData.length) return null;

  const total = positiveData.reduce((sum, point) => sum + point.value, 0);
  const centerX = 250;
  const centerY = 170;
  const radius = 112;
  let angle = -Math.PI / 2;

  positiveData.forEach((point, index) => {
    const slice = (point.value / total) * Math.PI * 2;
    const path = describeArc(centerX, centerY, radius, angle, angle + slice);
    const segment = svgElement("path", {
      d: path,
      fill: PALETTE[index % PALETTE.length],
      stroke: "#fff",
      "stroke-width": 2
    });
    segment.append(document.createElementNS(SVG_NS, "title"));
    segment.querySelector("title").textContent = `${point.label}: ${formatNumber(point.value)}`;
    svg.append(segment);
    angle += slice;
  });

  const legendX = 420;
  positiveData.slice(0, 8).forEach((point, index) => {
    const y = 82 + index * 28;
    svg.append(svgElement("rect", { x: legendX, y: y - 10, width: 14, height: 14, rx: 3, fill: PALETTE[index % PALETTE.length] }));
    const percent = `${Math.round((point.value / total) * 100)}%`;
    svg.append(textNode(legendX + 22, y + 1, `${truncate(point.label, 20)} (${percent})`, {
      anchor: "start",
      size: 13,
      fill: "#334155"
    }));
  });

  svg.append(textNode(centerX, centerY - 4, "Total", { anchor: "middle", size: 13, fill: "#64748b", weight: 700 }));
  svg.append(textNode(centerX, centerY + 20, formatNumber(total), { anchor: "middle", size: 22, fill: "#0f172a", weight: 900 }));
  return svg;
}

function renderKpiGrid(items) {
  const grid = document.createElement("div");
  grid.className = "visualization-kpi-grid";
  for (const item of items) {
    const card = document.createElement("div");
    card.className = "visualization-kpi";
    const label = document.createElement("div");
    label.className = "visualization-kpi-label";
    label.textContent = item.label;
    const value = document.createElement("div");
    value.className = "visualization-kpi-value";
    value.textContent = item.value;
    card.append(label, value);
    if (item.note) {
      const note = document.createElement("div");
      note.className = "visualization-kpi-note";
      note.textContent = item.note;
      card.append(note);
    }
    grid.append(card);
  }
  return grid;
}

function renderDataTable(visualization) {
  const wrapper = document.createElement("div");
  wrapper.className = "visualization-table-wrap";
  const table = document.createElement("table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const column of visualization.columns) {
    const th = document.createElement("th");
    th.textContent = column;
    headRow.append(th);
  }
  thead.append(headRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const row of visualization.rows) {
    const tr = document.createElement("tr");
    for (const cell of row) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.append(td);
    }
    tbody.append(tr);
  }
  table.append(tbody);
  wrapper.append(table);
  return wrapper;
}

function renderInfographic(visualization) {
  const wrapper = document.createElement("div");
  wrapper.className = "visualization-infographic";
  if (visualization.items.length) wrapper.append(renderKpiGrid(visualization.items));
  if (visualization.data.length) wrapper.append(renderBarSvg({ ...visualization, type: "bar" }, visualization.data));

  for (const section of visualization.sections) {
    const card = document.createElement("section");
    card.className = "visualization-info-section";
    const title = document.createElement("h4");
    title.textContent = section.title;
    card.append(title);
    if (section.body) {
      const body = document.createElement("p");
      body.textContent = section.body;
      card.append(body);
    }
    if (section.items.length) {
      const list = document.createElement("ul");
      for (const item of section.items) {
        const li = document.createElement("li");
        li.textContent = item;
        list.append(li);
      }
      card.append(list);
    }
    wrapper.append(card);
  }

  return wrapper;
}

function baseSvg(title) {
  const svg = svgElement("svg", {
    class: "visualization-svg",
    viewBox: `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`,
    role: "img",
    "aria-label": title
  });
  svg.append(svgElement("rect", { x: 0, y: 0, width: CHART_WIDTH, height: CHART_HEIGHT, rx: 10, fill: "#ffffff" }));
  return svg;
}

function drawGrid(svg, min, max, yScale) {
  for (let step = 0; step <= 4; step += 1) {
    const value = min + ((max - min) * step) / 4;
    const y = yScale(value);
    svg.append(svgElement("line", {
      x1: PLOT.left,
      x2: CHART_WIDTH - PLOT.right,
      y1: y,
      y2: y,
      stroke: "#e2e8f0",
      "stroke-width": 1
    }));
    svg.append(textNode(PLOT.left - 10, y + 4, formatNumber(value), {
      anchor: "end",
      size: 11,
      fill: "#64748b"
    }));
  }
}

function drawAxes(svg, visualization) {
  const x1 = PLOT.left;
  const y1 = CHART_HEIGHT - PLOT.bottom;
  const x2 = CHART_WIDTH - PLOT.right;
  const y2 = PLOT.top;
  svg.append(svgElement("line", { x1, y1, x2, y2: y1, stroke: "#94a3b8", "stroke-width": 1.4 }));
  svg.append(svgElement("line", { x1, y1, x2: x1, y2, stroke: "#94a3b8", "stroke-width": 1.4 }));
  if (visualization.xLabel) {
    svg.append(textNode((x1 + x2) / 2, CHART_HEIGHT - 6, visualization.xLabel, {
      anchor: "middle",
      size: 12,
      fill: "#64748b",
      weight: 700
    }));
  }
  if (visualization.yLabel) {
    const label = textNode(16, (y1 + y2) / 2, visualization.yLabel, {
      anchor: "middle",
      size: 12,
      fill: "#64748b",
      weight: 700
    });
    label.setAttribute("transform", `rotate(-90 16 ${(y1 + y2) / 2})`);
    svg.append(label);
  }
}

function chartData(visualization) {
  if (visualization.data?.length) return visualization.data;
  return visualization.series?.[0]?.data ?? [];
}

function createFallbackNotice(spec) {
  const note = document.createElement("p");
  note.className = "visualization-fallback-note";
  note.textContent = spec.fallbackNotice || "모델이 시각화 JSON을 만들지 못해 표 데이터로 기본 차트를 생성했습니다.";
  return note;
}

function normalizeSpec(spec) {
  const source = spec && typeof spec === "object" ? spec : {};
  return {
    version: String(source.version || "1.0"),
    fallback: Boolean(source.fallback),
    fallbackNotice: String(source.fallbackNotice || "").trim(),
    fallbackReason: String(source.fallbackReason || "").trim(),
    summary: String(source.summary || "").trim(),
    insights: asArray(source.insights).map(String).filter(Boolean).slice(0, 8),
    warnings: asArray(source.warnings).map(String).filter(Boolean).slice(0, 6),
    visualizations: asArray(source.visualizations).map(normalizeVisualization).filter(Boolean)
  };
}

function normalizeVisualization(value) {
  const item = value && typeof value === "object" ? value : {};
  return {
    type: String(item.type || "").toLowerCase(),
    title: String(item.title || "").trim(),
    subtitle: String(item.subtitle || "").trim(),
    xLabel: String(item.xLabel || "").trim(),
    yLabel: String(item.yLabel || "").trim(),
    data: asArray(item.data).map(normalizePoint).filter(Boolean),
    series: asArray(item.series).map((series) => ({
      name: String(series?.name || "").trim(),
      data: asArray(series?.data).map(normalizePoint).filter(Boolean)
    })).filter((series) => series.data.length),
    items: asArray(item.items).map((entry) => ({
      label: String(entry?.label || "").trim(),
      value: String(entry?.value || "").trim(),
      note: String(entry?.note || "").trim()
    })).filter((entry) => entry.label && entry.value),
    columns: asArray(item.columns).map(String).filter(Boolean),
    rows: asArray(item.rows).map((row) => asArray(row).map(String)).filter((row) => row.length),
    sections: asArray(item.sections).map((section) => ({
      title: String(section?.title || "").trim(),
      body: String(section?.body || "").trim(),
      items: asArray(section?.items).map(String).filter(Boolean)
    })).filter((section) => section.title || section.body || section.items.length)
  };
}

function normalizePoint(point, index) {
  if (!point || typeof point !== "object") return null;
  const label = String(point.label || point.name || `Item ${index + 1}`).trim();
  const value = parseNumber(point.value);
  const x = parseNumber(point.x);
  const y = parseNumber(point.y);
  if (Number.isFinite(x) && Number.isFinite(y)) return { label, x, y };
  if (Number.isFinite(value)) return { label, value };
  return null;
}

function makeScale(min, max, outputMin, outputMax) {
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.2);
    min -= padding;
    max += padding;
  }
  return (value) => outputMin + ((value - min) / (max - min)) * (outputMax - outputMin);
}

function describeArc(cx, cy, radius, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArc = endAngle - startAngle <= Math.PI ? 0 : 1;
  return [
    `M ${cx} ${cy}`,
    `L ${start.x} ${start.y}`,
    `A ${radius} ${radius} 0 ${largeArc} 0 ${end.x} ${end.y}`,
    "Z"
  ].join(" ");
}

function polarToCartesian(cx, cy, radius, angle) {
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle)
  };
}

function svgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, String(value));
  }
  return element;
}

function textNode(x, y, value, options = {}) {
  const text = svgElement("text", {
    x,
    y,
    fill: options.fill ?? "#334155",
    "font-size": options.size ?? 12,
    "font-weight": options.weight ?? 500,
    "text-anchor": options.anchor ?? "start",
    "font-family": "Inter, Segoe UI, Arial, sans-serif"
  });
  text.textContent = value;
  return text;
}

function createIconButton(className, label, icon) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `visualization-action ${className}`;
  button.title = label;
  button.setAttribute("aria-label", label);
  button.innerHTML = icon;
  return button;
}

function copyIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2"></rect>
      <path d="M5 15V7a2 2 0 0 1 2-2h8"></path>
    </svg>
  `;
}

function downloadIconSvg() {
  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12"></path>
      <path d="m7 10 5 5 5-5"></path>
      <path d="M5 21h14"></path>
    </svg>
  `;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall through to the textarea copy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function showButtonFeedback(button) {
  button.classList.add("copied");
  clearTimeout(button.copyResetTimer);
  button.copyResetTimer = setTimeout(() => button.classList.remove("copied"), 900);
}

function downloadSvgAsPng(svg, title) {
  const source = new XMLSerializer().serializeToString(svg);
  const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement("canvas");
    canvas.width = CHART_WIDTH * 2;
    canvas.height = CHART_HEIGHT * 2;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(url);
    canvas.toBlob((pngBlob) => {
      if (!pngBlob) return;
      downloadBlob(pngBlob, `${safeFileName(title)}.png`);
    }, "image/png");
  };
  image.src = url;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function defaultTitle(type, index) {
  return `${type || "visualization"} ${index + 1}`;
}

function shouldShowLabel(index, total) {
  if (total <= 10) return true;
  const interval = Math.ceil(total / 8);
  return index % interval === 0 || index === total - 1;
}

function truncate(value, length) {
  const text = String(value ?? "");
  return text.length > length ? `${text.slice(0, length - 1)}...` : text;
}

function parseNumber(value) {
  const text = String(value ?? "").trim().replace(/,/g, "").replace(/[%$]/g, "");
  if (!text) return NaN;
  const number = Number(text);
  return Number.isFinite(number) ? number : NaN;
}

function formatNumber(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function safeFileName(value) {
  return String(value || "visualization")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}
