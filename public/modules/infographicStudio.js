import { elements, state, accessAuthHeaders } from "./state.js";
import { hydrateStoredDocuments } from "./persistence.js";
import {
  getStudioSourceContext,
  getStudioSourceDocuments,
  buildStudioRequestDocuments,
  buildStudioDocumentSignature
} from "./studio.js";

// Infographic v2 — SVG renderer (replaces the previous HTML/CSS renderer).
// Numbers/charts/citations are drawn as SVG text/shapes; generated image assets
// (background/icons) are composited as <image> layers. "빠른 생성" omits images;
// "고급 생성" requests background/icon assets from the image worker.

const LAYOUTS = ["summary", "timeline", "process", "comparison"];
const LAYOUT_LABELS = {
  summary: "요약 카드",
  timeline: "타임라인",
  process: "절차도",
  comparison: "비교표"
};

const SVGNS = "http://www.w3.org/2000/svg";
const XLINKNS = "http://www.w3.org/1999/xlink";
const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif";

const W = 860;
const PAD = 36;
const INNER_W = W - PAD * 2;
const GAP = 22;

const C = {
  ink: "#0f172a",
  muted: "#475569",
  subtle: "#64748b",
  accent: "#0f766e",
  accentBg: "#f0fdfa",
  accentLine: "#ccfbf1",
  line: "#e2e8f0",
  cardBg: "#f8fafc",
  warn: "#b45309"
};

let _abort = null;
let _layout = "summary";
let _lastSpec = null;
let _lastSvg = null;
const _cache = new Map();

export function bindInfographicStudioEvents() {
  elements.studioInfographicLayout?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-layout]");
    if (!button) return;
    const layout = button.dataset.layout;
    if (!LAYOUTS.includes(layout)) return;
    if (layout === _layout && _lastSpec) return;
    _layout = layout;
    syncLayoutChips();
    generateInfographic("fast");
  });
  elements.studioInfographicGenerate?.addEventListener("click", () => {
    if (_abort) { _abort.abort(); return; }
    generateInfographic("fast");
  });
  elements.studioInfographicGenerateAdvanced?.addEventListener("click", () => {
    if (_abort) { _abort.abort(); return; }
    generateInfographic("advanced");
  });
  elements.studioInfographicExport?.addEventListener("click", () => {
    exportInfographicPng().catch((error) => {
      setStatus(`PNG 내보내기에 실패했습니다: ${error.message}`);
    });
  });
  syncLayoutChips();
}

export function renderInfographicStudio() {
  syncLayoutChips();
  const ctx = getStudioSourceContext();
  if (!ctx) {
    showEmpty(noContextMessage());
    return;
  }
  const signature = currentSignature(ctx);
  const cached = signature ? _cache.get(signature) : null;
  if (cached) {
    renderSpec(cached);
    return;
  }
  showEmpty(emptyPromptMessage(ctx));
}

function currentSignature(ctx) {
  if (ctx.notebookId) return `pack:${ctx.notebookId}:${_layout}`;
  const documents = getStudioSourceDocuments();
  if (!documents.length) return "";
  return `${buildStudioDocumentSignature(documents)}:${_layout}`;
}

export function isInfographicBusy() {
  return Boolean(_abort);
}

export function abortInfographic() {
  if (_abort) _abort.abort();
}

export async function generateInfographic(mode = "fast") {
  const ctx = getStudioSourceContext();
  if (!ctx) {
    showEmpty(noContextMessage());
    return;
  }
  const model = elements.modelInput?.value?.trim() || "gemma4:e2b";
  const prompt = elements.studioInfographicPrompt?.value?.trim() || "";

  let requestPayload;
  let signature;
  let useAuth = false;
  if (ctx.notebookId) {
    signature = `pack:${ctx.notebookId}:${_layout}:${mode}`;
    requestPayload = { model, layout: _layout, prompt, notebookId: ctx.notebookId, mode };
    useAuth = true;
  } else {
    if (state.activeView !== "law" && state.activeView !== "grc") {
      if (await hydrateStoredDocuments()) window.dispatchEvent(new CustomEvent("myai:renderrooms"));
    }
    const documents = getStudioSourceDocuments();
    if (!documents.length) {
      showEmpty(emptyPromptMessage(ctx));
      return;
    }
    signature = `${buildStudioDocumentSignature(documents)}:${_layout}:${mode}`;
    requestPayload = { model, layout: _layout, prompt, documents: buildStudioRequestDocuments(documents), mode };
  }

  try {
    _abort = new AbortController();
    setBusy(true, mode);
    showEmpty(mode === "advanced"
      ? `${LAYOUT_LABELS[_layout]} 인포그래픽과 이미지를 생성하는 중입니다. (이미지 생성은 다소 걸릴 수 있습니다)`
      : `${LAYOUT_LABELS[_layout]} 인포그래픽을 생성하는 중입니다.`);
    const response = await fetch("/api/studio/infographic", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(useAuth ? accessAuthHeaders() : {}) },
      signal: _abort.signal,
      body: JSON.stringify(requestPayload)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "인포그래픽 생성에 실패했습니다.");
    const spec = payload.infographic;
    if (signature && spec) _cache.set(signature, spec);
    renderSpec(spec);
  } catch (error) {
    showEmpty(error?.name === "AbortError"
      ? "인포그래픽 생성을 중지했습니다."
      : (error.message || "인포그래픽 생성에 실패했습니다. 잠시 후 다시 시도하세요."));
  } finally {
    _abort = null;
    setBusy(false);
  }
}

// ── SVG element helpers ───────────────────────────────────────────────

function el(tag, attrs = {}, children = []) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    node.setAttribute(k, String(v));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child == null) continue;
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

function isWide(ch) {
  const code = ch.codePointAt(0);
  return (code >= 0x1100 && code <= 0x11FF) || (code >= 0x2E80 && code <= 0xA4CF)
    || (code >= 0xAC00 && code <= 0xD7A3) || (code >= 0xF900 && code <= 0xFAFF)
    || (code >= 0xFF00 && code <= 0xFFEF);
}

function measure(text, size) {
  let w = 0;
  for (const ch of String(text)) w += isWide(ch) ? size : size * 0.55;
  return w;
}

function wrapText(text, maxWidth, size) {
  const value = String(text || "").trim();
  if (!value) return [];
  const lines = [];
  let line = "";
  const flushChars = (chunk) => {
    for (const ch of chunk) {
      if (line && measure(line + ch, size) > maxWidth) { lines.push(line); line = ""; }
      line += ch;
    }
  };
  for (const token of value.split(/(\s+)/)) {
    if (!token) continue;
    if (measure(token, size) > maxWidth) { flushChars(token); continue; }
    if (line.trim() && measure(line + token, size) > maxWidth) { lines.push(line.trimEnd()); line = token.replace(/^\s+/, ""); }
    else line += token;
  }
  if (line.trim()) lines.push(line.trimEnd());
  return lines;
}

// Append wrapped text starting with first baseline at (x, cy + size). Returns
// the new cursor y below the text block.
function place(group, text, cy, opts = {}) {
  const size = opts.size || 14;
  const lh = opts.lineHeight || Math.round(size * 1.4);
  const x = opts.x || 0;
  const lines = opts.maxWidth ? wrapText(text, opts.maxWidth, size) : [String(text || "")];
  if (!lines.length) return cy;
  const t = el("text", {
    x, y: cy + size,
    "font-size": size,
    "font-weight": opts.weight || 400,
    fill: opts.fill || C.ink,
    "text-anchor": opts.anchor || "start"
  });
  lines.forEach((ln, i) => t.append(el("tspan", { x, dy: i === 0 ? 0 : lh }, ln)));
  group.append(t);
  return cy + (lines.length - 1) * lh + size + (opts.after != null ? opts.after : 4);
}

function citeLine(group, ids, cy, citationMap) {
  const valid = (Array.isArray(ids) ? ids : []).filter((id) => citationMap.has(id));
  if (!valid.length) return cy;
  return place(group, `근거 ${valid.join(" ")}`, cy, { size: 10, fill: C.accent, weight: 700, after: 2 });
}

// ── Block renderers (each returns { node, height }) ───────────────────

function renderHeader(spec) {
  const g = el("g");
  let cy = 0;
  cy = place(g, spec.title || "인포그래픽", cy, { size: 26, weight: 800, fill: C.ink, maxWidth: INNER_W, after: 6 });
  if (spec.subtitle) cy = place(g, spec.subtitle, cy, { size: 15, fill: C.muted, maxWidth: INNER_W, after: 6 });
  g.append(el("line", { x1: 0, y1: cy + 2, x2: INNER_W, y2: cy + 2, stroke: C.accentLine, "stroke-width": 2 }));
  return { node: g, height: cy + 6 };
}

function blockTitle(g, title, cy) {
  if (!title) return cy;
  return place(g, title, cy, { size: 16, weight: 800, fill: C.accent, after: 10 });
}

function renderKpi(block, citationMap) {
  const g = el("g");
  let cy = blockTitle(g, block.title, 0);
  const items = block.items || [];
  const cols = Math.min(3, Math.max(1, items.length));
  const gap = 14;
  const cardW = (INNER_W - (cols - 1) * gap) / cols;
  const cardH = 104;
  const rows = Math.ceil(items.length / cols);
  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * (cardW + gap);
    const y = cy + row * (cardH + gap);
    const cg = el("g", { transform: `translate(${x},${y})` });
    cg.append(el("rect", { x: 0, y: 0, width: cardW, height: cardH, rx: 10, fill: C.accentBg, stroke: C.accentLine }));
    let icy = 14;
    icy = place(cg, item.value || "—", icy, { x: 14, size: 24, weight: 800, fill: C.accent, maxWidth: cardW - 28, after: 2 });
    icy = place(cg, item.label || "", icy, { x: 14, size: 13, fill: C.ink, maxWidth: cardW - 28, after: 2 });
    if (item.note) icy = place(cg, item.note, icy, { x: 14, size: 11, fill: C.subtle, maxWidth: cardW - 28, after: 2 });
    citeLine(cg, item.citationIds, icy, citationMap);
    g.append(cg);
  });
  return { node: g, height: cy + rows * (cardH + gap) - gap };
}

function renderCards(block, citationMap) {
  const g = el("g");
  let cy = blockTitle(g, block.title, 0);
  const items = block.items || [];
  const cols = 2;
  const gap = 14;
  const cardW = (INNER_W - (cols - 1) * gap) / cols;
  const pad = 14;
  let i = 0;
  while (i < items.length) {
    const rowItems = items.slice(i, i + cols);
    const measured = rowItems.map((item) => {
      const frag = el("g");
      let h = pad;
      if (item.title) h = place(frag, item.title, h, { x: pad, size: 15, weight: 700, fill: C.ink, maxWidth: cardW - pad * 2, after: 4 });
      if (item.body) h = place(frag, item.body, h, { x: pad, size: 13, fill: C.muted, maxWidth: cardW - pad * 2, after: 2 });
      h = citeLine(frag, item.citationIds, h, citationMap);
      return { frag, h: h + pad };
    });
    const rowH = Math.max(...measured.map((m) => m.h), 56);
    rowItems.forEach((_, c) => {
      const x = c * (cardW + gap);
      const cg = el("g", { transform: `translate(${x},${cy})` });
      cg.append(el("rect", { x: 0, y: 0, width: cardW, height: rowH, rx: 10, fill: C.cardBg, stroke: C.line }));
      cg.append(measured[c].frag);
      g.append(cg);
    });
    cy += rowH + gap;
    i += cols;
  }
  return { node: g, height: cy - gap };
}

function renderTimeline(block, citationMap) {
  const g = el("g");
  let cy = blockTitle(g, block.title, 0);
  const railX = 6;
  g.append(el("line", { x1: railX, y1: cy, x2: railX, y2: cy, stroke: C.accent, "stroke-width": 2, "data-rail": "1" }));
  const startY = cy;
  for (const item of block.items || []) {
    const dotY = cy + 6;
    g.append(el("circle", { cx: railX, cy: dotY, r: 5, fill: C.accent }));
    let iy = cy;
    const textX = railX + 18;
    const tw = INNER_W - textX;
    if (item.when) iy = place(g, item.when, iy, { x: textX, size: 13, weight: 700, fill: C.accent, maxWidth: tw, after: 2 });
    if (item.title) iy = place(g, item.title, iy, { x: textX, size: 14, weight: 700, fill: C.ink, maxWidth: tw, after: 2 });
    if (item.body) iy = place(g, item.body, iy, { x: textX, size: 13, fill: C.muted, maxWidth: tw, after: 2 });
    iy = citeLine(g, item.citationIds, iy, citationMap);
    cy = iy + 12;
  }
  const rail = g.querySelector('[data-rail="1"]');
  if (rail) rail.setAttribute("y2", String(cy - 12));
  void startY;
  return { node: g, height: cy };
}

function renderSteps(block, citationMap) {
  const g = el("g");
  let cy = blockTitle(g, block.title, 0);
  (block.items || []).forEach((item, idx) => {
    const r = 16;
    const cxCircle = r;
    const top = cy;
    const textX = r * 2 + 14;
    const tw = INNER_W - textX;
    let iy = cy;
    if (item.title) iy = place(g, item.title, iy, { x: textX, size: 14, weight: 700, fill: C.ink, maxWidth: tw, after: 2 });
    if (item.body) iy = place(g, item.body, iy, { x: textX, size: 13, fill: C.muted, maxWidth: tw, after: 2 });
    iy = citeLine(g, item.citationIds, iy, citationMap);
    const blockH = Math.max(iy - top, r * 2);
    const circleCy = top + r;
    g.append(el("circle", { cx: cxCircle, cy: circleCy, r, fill: C.accent }));
    g.append(el("text", { x: cxCircle, y: circleCy + 5, "font-size": 14, "font-weight": 800, fill: "#ffffff", "text-anchor": "middle" }, item.label || String(idx + 1)));
    cy = top + blockH + 14;
  });
  return { node: g, height: cy };
}

function renderComparison(block) {
  const g = el("g");
  let cy = blockTitle(g, block.title, 0);
  const columns = block.columns || [];
  const rows = block.rows || [];
  const labelW = Math.round(INNER_W * 0.28);
  const colW = (INNER_W - labelW) / columns.length;
  const pad = 8;
  const headH = 34;

  // header
  const head = el("g", { transform: `translate(0,${cy})` });
  head.append(el("rect", { x: 0, y: 0, width: INNER_W, height: headH, fill: C.accentBg }));
  columns.forEach((col, c) => {
    const x = labelW + c * colW;
    head.append(el("text", { x: x + pad, y: headH / 2 + 5, "font-size": 13, "font-weight": 800, fill: C.accent }, col));
  });
  g.append(head);
  cy += headH;

  for (const row of rows) {
    const cellLines = [wrapText(row.label || "", labelW - pad * 2, 13), ...(row.cells || []).map((cell) => wrapText(cell || "", colW - pad * 2, 13))];
    const maxLines = Math.max(1, ...cellLines.map((l) => l.length));
    const rowH = maxLines * 18 + pad * 2;
    const rg = el("g", { transform: `translate(0,${cy})` });
    rg.append(el("rect", { x: 0, y: 0, width: INNER_W, height: rowH, fill: "#ffffff", stroke: C.line }));
    rg.append(el("rect", { x: 0, y: 0, width: labelW, height: rowH, fill: C.cardBg, stroke: C.line }));
    const drawCell = (lines, x, w, weight, fill) => {
      const t = el("text", { x: x + pad, y: pad + 13, "font-size": 13, "font-weight": weight, fill });
      lines.forEach((ln, i) => t.append(el("tspan", { x: x + pad, dy: i === 0 ? 0 : 18 }, ln)));
      rg.append(t);
    };
    drawCell(cellLines[0], 0, labelW, 700, C.ink);
    (row.cells || []).forEach((_, c) => {
      const x = labelW + c * colW;
      rg.append(el("line", { x1: x, y1: 0, x2: x, y2: rowH, stroke: C.line }));
      drawCell(cellLines[c + 1] || [], x, colW, 400, C.muted);
    });
    g.append(rg);
    cy += rowH;
  }
  return { node: g, height: cy };
}

function renderHero(block) {
  const g = el("g");
  const pad = 22;
  let cy = pad;
  if (block.title) cy = place(g, block.title, cy, { x: pad, size: 26, weight: 800, fill: C.accent, maxWidth: INNER_W - pad * 2, after: 6 });
  if (block.subtitle) cy = place(g, block.subtitle, cy, { x: pad, size: 16, weight: 700, fill: C.ink, maxWidth: INNER_W - pad * 2, after: 6 });
  if (block.body) cy = place(g, block.body, cy, { x: pad, size: 14, fill: C.muted, maxWidth: INNER_W - pad * 2, after: 4 });
  const h = cy + pad;
  const rect = el("rect", { x: 0, y: 0, width: INNER_W, height: h, rx: 12, fill: C.accentBg, stroke: C.accentLine });
  g.insertBefore(rect, g.firstChild);
  return { node: g, height: h };
}

function renderChart(block, citationMap) {
  const g = el("g");
  let cy = blockTitle(g, block.title, 0);
  const data = block.data || [];
  const chartH = 200;
  const axisY = cy + chartH;
  const labelH = 26;
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const n = data.length;
  const slot = INNER_W / n;
  const scaleY = (v) => axisY - (v / maxVal) * (chartH - 10);

  // baseline
  g.append(el("line", { x1: 0, y1: axisY, x2: INNER_W, y2: axisY, stroke: C.line, "stroke-width": 1.5 }));

  if (block.type === "chart_bar") {
    const barW = Math.min(slot * 0.6, 80);
    data.forEach((d, i) => {
      const cx = i * slot + slot / 2;
      const y = scaleY(d.value);
      g.append(el("rect", { x: cx - barW / 2, y, width: barW, height: axisY - y, rx: 4, fill: C.accent }));
      g.append(el("text", { x: cx, y: y - 6, "font-size": 12, "font-weight": 700, fill: C.ink, "text-anchor": "middle" }, formatVal(d.value, block.unit)));
    });
  } else {
    const pts = data.map((d, i) => [i * slot + slot / 2, scaleY(d.value)]);
    g.append(el("polyline", { points: pts.map((p) => p.join(",")).join(" "), fill: "none", stroke: C.accent, "stroke-width": 2.5 }));
    pts.forEach(([px, py], i) => {
      g.append(el("circle", { cx: px, cy: py, r: 4, fill: C.accent }));
      g.append(el("text", { x: px, y: py - 8, "font-size": 11, "font-weight": 700, fill: C.ink, "text-anchor": "middle" }, formatVal(data[i].value, block.unit)));
    });
  }

  // x labels
  data.forEach((d, i) => {
    const cx = i * slot + slot / 2;
    const lbl = wrapText(d.label, slot - 6, 11).slice(0, 2);
    const t = el("text", { x: cx, y: axisY + 16, "font-size": 11, fill: C.muted, "text-anchor": "middle" });
    lbl.forEach((ln, k) => t.append(el("tspan", { x: cx, dy: k === 0 ? 0 : 13 }, ln)));
    g.append(t);
  });

  let endY = axisY + labelH;
  const allCites = [...new Set(data.flatMap((d) => d.citationIds || []))];
  endY = citeLine(g, allCites, endY, citationMap);
  return { node: g, height: endY };
}

function formatVal(v, unit) {
  const num = Number.isInteger(v) ? String(v) : v.toFixed(1);
  return unit ? `${num}${unit}` : num;
}

function renderFlow(block, citationMap) {
  const g = el("g");
  let cy = blockTitle(g, block.title, 0);
  const items = block.items || [];
  const n = items.length;
  const arrow = 22;
  const boxW = Math.max(90, (INNER_W - arrow * (n - 1)) / n);
  const pad = 8;
  const measured = items.map((item) => {
    const tl = wrapText(item.title, boxW - pad * 2, 13);
    const bl = item.body ? wrapText(item.body, boxW - pad * 2, 11).slice(0, 3) : [];
    return { tl, bl, h: pad * 2 + tl.length * 17 + bl.length * 14 };
  });
  const boxH = Math.max(...measured.map((m) => m.h), 50);
  items.forEach((item, i) => {
    const x = i * (boxW + arrow);
    const bg = el("g", { transform: `translate(${x},${cy})` });
    bg.append(el("rect", { x: 0, y: 0, width: boxW, height: boxH, rx: 8, fill: C.accentBg, stroke: C.accentLine }));
    const tt = el("text", { x: pad, y: pad + 13, "font-size": 13, "font-weight": 700, fill: C.ink });
    measured[i].tl.forEach((ln, k) => tt.append(el("tspan", { x: pad, dy: k === 0 ? 0 : 17 }, ln)));
    bg.append(tt);
    if (measured[i].bl.length) {
      const bt = el("text", { x: pad, y: pad + measured[i].tl.length * 17 + 13, "font-size": 11, fill: C.muted });
      measured[i].bl.forEach((ln, k) => bt.append(el("tspan", { x: pad, dy: k === 0 ? 0 : 14 }, ln)));
      bg.append(bt);
    }
    g.append(bg);
    if (i < n - 1) {
      const ax = x + boxW;
      const ay = cy + boxH / 2;
      g.append(el("path", { d: `M${ax + 4} ${ay} L${ax + arrow - 4} ${ay}`, stroke: C.accent, "stroke-width": 2 }));
      g.append(el("path", { d: `M${ax + arrow - 9} ${ay - 4} L${ax + arrow - 4} ${ay} L${ax + arrow - 9} ${ay + 4}`, fill: "none", stroke: C.accent, "stroke-width": 2 }));
    }
  });
  let endY = cy + boxH + 8;
  const allCites = [...new Set(items.flatMap((it) => it.citationIds || []))];
  endY = citeLine(g, allCites, endY, citationMap);
  return { node: g, height: endY };
}

function renderCitations(citations) {
  const g = el("g");
  let cy = 0;
  g.append(el("line", { x1: 0, y1: cy, x2: INNER_W, y2: cy, stroke: C.line }));
  cy += 12;
  cy = place(g, "근거 출처", cy, { size: 14, weight: 800, fill: C.accent, after: 8 });
  for (const c of citations) {
    const text = `[${c.id}] ${[c.documentName, c.locator].filter(Boolean).join(" · ")}${c.excerpt ? ` — ${c.excerpt}` : ""}`;
    cy = place(g, text, cy, { size: 12, fill: C.muted, maxWidth: INNER_W, after: 4 });
  }
  return { node: g, height: cy };
}

function renderBlock(block, citationMap) {
  switch (block.type) {
    case "kpi": return renderKpi(block, citationMap);
    case "cards": return renderCards(block, citationMap);
    case "timeline": return renderTimeline(block, citationMap);
    case "steps": return renderSteps(block, citationMap);
    case "comparison": return renderComparison(block);
    case "hero": return renderHero(block);
    case "chart_bar":
    case "chart_line": return renderChart(block, citationMap);
    case "flow": return renderFlow(block, citationMap);
    default: return null;
  }
}

function warningText(spec) {
  if (!Array.isArray(spec.warnings) || !spec.warnings.length) return "";
  if (spec.warnings.includes("fallback_infographic")) {
    return "※ 모델 생성에 실패하여 문서 요약 기반 기본 인포그래픽을 표시합니다. 검토가 필요합니다.";
  }
  if (spec.warnings.some((w) => /image_assets_unavailable|asset_failed/.test(w))) {
    return "※ 일부 이미지 생성에 실패했습니다(텍스트/수치는 정상). 이미지 워커 상태를 확인하세요.";
  }
  return "※ 이 인포그래픽은 AI가 생성했습니다. 수치·출처를 검토하세요.";
}

/** Pure builder — returns an <svg> element for the given spec. Exported for tests. */
export function buildInfographicSvg(spec) {
  const groups = [renderHeader(spec)];
  const citationMap = new Map((Array.isArray(spec.citations) ? spec.citations : []).map((c) => [c.id, c]));
  for (const block of Array.isArray(spec.blocks) ? spec.blocks : []) {
    const rendered = renderBlock(block, citationMap);
    if (rendered) groups.push(rendered);
  }
  if (citationMap.size) groups.push(renderCitations(spec.citations));
  const warn = warningText(spec);
  if (warn) {
    const wg = el("g");
    place(wg, warn, 0, { size: 12, fill: C.warn, maxWidth: INNER_W });
    groups.push({ node: wg, height: 20 });
  }

  let total = PAD;
  for (const g of groups) total += g.height + GAP;
  total = Math.max(total - GAP + PAD, 200);

  const svg = el("svg", {
    xmlns: SVGNS, "xmlns:xlink": XLINKNS,
    width: W, height: Math.round(total), viewBox: `0 0 ${W} ${Math.round(total)}`,
    "font-family": FONT
  });
  svg.style.maxWidth = "100%";
  svg.style.height = "auto";
  svg.append(el("rect", { x: 0, y: 0, width: W, height: total, fill: "#ffffff" }));

  const bg = (Array.isArray(spec.visualAssets) ? spec.visualAssets : []).find((a) => a.type === "generated_background" && a.assetId);
  if (bg) {
    const img = el("image", { x: 0, y: 0, width: W, height: total, opacity: bg.opacity ?? 0.14, preserveAspectRatio: "xMidYMid slice" });
    const url = `/api/image/assets/${encodeURIComponent(bg.assetId)}`;
    img.setAttribute("href", url);
    img.setAttributeNS(XLINKNS, "xlink:href", url);
    svg.append(img);
  }

  let y = PAD;
  for (const g of groups) {
    g.node.setAttribute("transform", `translate(${PAD},${y})`);
    svg.append(g.node);
    y += g.height + GAP;
  }
  return svg;
}

// ── Render / export ───────────────────────────────────────────────────

function renderSpec(spec) {
  const canvas = elements.studioInfographicCanvas;
  if (!canvas || !spec) { showEmpty("표시할 인포그래픽이 없습니다."); return; }
  _lastSpec = spec;
  if (elements.studioInfographicEmpty) elements.studioInfographicEmpty.hidden = true;
  if (elements.studioInfographicExport) elements.studioInfographicExport.disabled = false;
  canvas.hidden = false;
  canvas.innerHTML = "";
  const sheet = document.createElement("div");
  sheet.className = "infographic-sheet";
  _lastSvg = buildInfographicSvg(spec);
  sheet.append(_lastSvg);
  canvas.append(sheet);
}

async function inlineImages(svg) {
  const images = Array.from(svg.querySelectorAll("image"));
  await Promise.all(images.map(async (img) => {
    const href = img.getAttribute("href") || img.getAttributeNS(XLINKNS, "href");
    if (!href || href.startsWith("data:")) return;
    try {
      const res = await fetch(href, { cache: "force-cache" });
      const blob = await res.blob();
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
      img.setAttribute("href", dataUrl);
      img.setAttributeNS(XLINKNS, "xlink:href", dataUrl);
    } catch {
      img.remove();
    }
  }));
}

async function exportInfographicPng() {
  if (!_lastSvg) throw new Error("먼저 인포그래픽을 생성하세요.");
  const clone = _lastSvg.cloneNode(true);
  await inlineImages(clone);
  const width = Number(clone.getAttribute("width")) || W;
  const height = Number(clone.getAttribute("height")) || 600;
  const serialized = new XMLSerializer().serializeToString(clone);
  const blob = new Blob([serialized], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((png) => {
          if (!png) { reject(new Error("이미지 변환 실패")); return; }
          const link = document.createElement("a");
          link.href = URL.createObjectURL(png);
          link.download = `${safeFileName(_lastSpec?.title || "infographic")}.png`;
          document.body.append(link);
          link.click();
          link.remove();
          URL.revokeObjectURL(link.href);
          resolve();
        }, "image/png");
      };
      image.onerror = () => reject(new Error("브라우저가 인포그래픽을 이미지로 변환하지 못했습니다."));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ── Status / util ─────────────────────────────────────────────────────

function syncLayoutChips() {
  const container = elements.studioInfographicLayout;
  if (!container) return;
  for (const button of container.querySelectorAll("[data-layout]")) {
    button.classList.toggle("is-active", button.dataset.layout === _layout);
  }
}

function setBusy(busy, mode) {
  const fast = elements.studioInfographicGenerate;
  const adv = elements.studioInfographicGenerateAdvanced;
  if (fast) {
    fast.textContent = busy && mode === "fast" ? "생성 중지" : "빠른 생성";
    fast.classList.toggle("is-busy", busy && mode === "fast");
    fast.disabled = busy && mode !== "fast";
  }
  if (adv) {
    adv.textContent = busy && mode === "advanced" ? "생성 중지" : "고급 생성";
    adv.classList.toggle("is-busy", busy && mode === "advanced");
    adv.disabled = busy && mode !== "advanced";
  }
  elements.studioInfographicCanvas?.classList.toggle("is-loading", busy);
}

function setStatus(message) {
  showEmpty(message);
}

function showEmpty(message) {
  if (elements.studioInfographicCanvas) {
    elements.studioInfographicCanvas.hidden = true;
    elements.studioInfographicCanvas.innerHTML = "";
  }
  if (elements.studioInfographicExport) elements.studioInfographicExport.disabled = true;
  if (elements.studioInfographicEmpty) {
    elements.studioInfographicEmpty.hidden = false;
    elements.studioInfographicEmpty.textContent = message;
  }
}

function noContextMessage() {
  if (state.activeView === "law") return "법령검토 항목을 선택하면 인포그래픽을 만들 수 있습니다.";
  if (state.activeView === "grc") return "내부검토 항목을 선택하면 인포그래픽을 만들 수 있습니다.";
  if (state.activeView === "knowledge") return "지식팩 카드를 선택하면 해당 지식팩 문서로 인포그래픽을 만들 수 있습니다.";
  return "대화방을 선택하면 인포그래픽을 만들 수 있습니다.";
}

function emptyPromptMessage(ctx) {
  if (ctx.notebookId) return "레이아웃을 고르고 ‘빠른 생성’을 누르면 이 지식팩 문서로 인포그래픽을 만듭니다.";
  if (state.activeView === "knowledge") return "지식팩 카드를 선택하세요.";
  const documents = getStudioSourceDocuments();
  if (!documents.length) return "문서를 업로드하면 인포그래픽을 생성할 수 있습니다.";
  return "레이아웃을 고르고 ‘빠른 생성’을 누르면 인포그래픽을 만듭니다. ‘고급 생성’은 배경·아이콘 이미지를 포함합니다.";
}

function safeFileName(name) {
  return String(name || "infographic").replace(/[^\w가-힣\- ]+/g, "").trim().slice(0, 60) || "infographic";
}
