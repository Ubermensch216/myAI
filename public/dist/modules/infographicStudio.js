import { elements, state, accessAuthHeaders } from "./state.js";
import { hydrateStoredDocuments } from "./persistence.js";
import {
  getStudioSourceContext,
  getStudioSourceDocuments,
  buildStudioRequestDocuments,
  buildStudioDocumentSignature
} from "./studio.js";

const LAYOUTS = ["summary", "timeline", "process", "comparison"];
const LAYOUT_LABELS = {
  summary: "요약 카드",
  timeline: "타임라인",
  process: "절차도",
  comparison: "비교표"
};

let _abort = null;
let _layout = "summary";
let _lastSpec = null;
const _cache = new Map(); // signature -> spec

export function bindInfographicStudioEvents() {
  elements.studioInfographicLayout?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-layout]");
    if (!button) return;
    const layout = button.dataset.layout;
    if (!LAYOUTS.includes(layout)) return;
    if (layout === _layout && _lastSpec) return;
    _layout = layout;
    syncLayoutChips();
    generateInfographic();
  });
  elements.studioInfographicGenerate?.addEventListener("click", () => {
    if (_abort) { _abort.abort(); return; }
    generateInfographic();
  });
  elements.studioInfographicExport?.addEventListener("click", () => {
    exportInfographicPng().catch((error) => {
      setStatus(`PNG 내보내기에 실패했습니다: ${error.message}`);
    });
  });
  syncLayoutChips();
}

// studio.js의 setActiveTool("infographic")에서 호출된다.
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

export async function generateInfographic() {
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
    signature = `pack:${ctx.notebookId}:${_layout}`;
    requestPayload = { model, layout: _layout, prompt, notebookId: ctx.notebookId };
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
    signature = `${buildStudioDocumentSignature(documents)}:${_layout}`;
    requestPayload = { model, layout: _layout, prompt, documents: buildStudioRequestDocuments(documents) };
  }

  try {
    _abort = new AbortController();
    setBusy(true);
    showEmpty(`${LAYOUT_LABELS[_layout]} 인포그래픽을 생성하는 중입니다.`);
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

// ── 렌더링 ────────────────────────────────────────────────────────

function renderSpec(spec) {
  const canvas = elements.studioInfographicCanvas;
  if (!canvas || !spec) { showEmpty("표시할 인포그래픽이 없습니다."); return; }
  _lastSpec = spec;
  if (elements.studioInfographicEmpty) elements.studioInfographicEmpty.hidden = true;
  if (elements.studioInfographicExport) elements.studioInfographicExport.disabled = false;
  canvas.hidden = false;
  canvas.innerHTML = "";

  const sheet = document.createElement("article");
  sheet.className = "infographic-sheet";

  const header = document.createElement("header");
  header.className = "infographic-header";
  const h = document.createElement("h3");
  h.textContent = spec.title || "인포그래픽";
  header.append(h);
  if (spec.subtitle) {
    const sub = document.createElement("p");
    sub.className = "infographic-subtitle";
    sub.textContent = spec.subtitle;
    header.append(sub);
  }
  sheet.append(header);

  const citationMap = new Map((Array.isArray(spec.citations) ? spec.citations : []).map((c) => [c.id, c]));

  for (const block of Array.isArray(spec.blocks) ? spec.blocks : []) {
    const node = renderBlock(block, citationMap);
    if (node) sheet.append(node);
  }

  if (citationMap.size) sheet.append(renderCitations(spec.citations));

  if (Array.isArray(spec.warnings) && spec.warnings.length) {
    const warn = document.createElement("p");
    warn.className = "infographic-warning";
    warn.textContent = spec.warnings.includes("fallback_infographic")
      ? "※ 모델 생성에 실패하여 문서 요약 기반 기본 인포그래픽을 표시합니다. 검토가 필요합니다."
      : "※ 이 인포그래픽은 AI가 생성했습니다. 수치·출처를 검토하세요.";
    sheet.append(warn);
  }

  canvas.append(sheet);
}

function renderBlock(block, citationMap) {
  const section = document.createElement("section");
  section.className = `infographic-block infographic-${block.type}`;
  if (block.title) {
    const title = document.createElement("h4");
    title.className = "infographic-block-title";
    title.textContent = block.title;
    section.append(title);
  }

  if (block.type === "kpi") {
    const grid = document.createElement("div");
    grid.className = "infographic-kpi-grid";
    for (const item of block.items) {
      const card = document.createElement("div");
      card.className = "infographic-kpi";
      card.append(textDiv("infographic-kpi-value", item.value || "—"));
      card.append(textDiv("infographic-kpi-label", item.label || ""));
      if (item.note) card.append(textDiv("infographic-kpi-note", item.note));
      appendCitations(card, item.citationIds, citationMap);
      grid.append(card);
    }
    section.append(grid);
    return section;
  }

  if (block.type === "cards") {
    const grid = document.createElement("div");
    grid.className = "infographic-card-grid";
    for (const item of block.items) {
      const card = document.createElement("div");
      card.className = "infographic-card";
      if (item.title) card.append(textDiv("infographic-card-title", item.title));
      if (item.body) card.append(textDiv("infographic-card-body", item.body));
      appendCitations(card, item.citationIds, citationMap);
      grid.append(card);
    }
    section.append(grid);
    return section;
  }

  if (block.type === "timeline") {
    const list = document.createElement("ol");
    list.className = "infographic-timeline";
    for (const item of block.items) {
      const li = document.createElement("li");
      li.className = "infographic-timeline-item";
      if (item.when) li.append(textDiv("infographic-timeline-when", item.when));
      const body = document.createElement("div");
      body.className = "infographic-timeline-body";
      if (item.title) body.append(textDiv("infographic-timeline-title", item.title));
      if (item.body) body.append(textDiv("infographic-timeline-text", item.body));
      appendCitations(body, item.citationIds, citationMap);
      li.append(body);
      list.append(li);
    }
    section.append(list);
    return section;
  }

  if (block.type === "steps") {
    const list = document.createElement("ol");
    list.className = "infographic-steps";
    for (const [index, item] of block.items.entries()) {
      const li = document.createElement("li");
      li.className = "infographic-step";
      li.append(textDiv("infographic-step-num", item.label || String(index + 1)));
      const body = document.createElement("div");
      body.className = "infographic-step-body";
      if (item.title) body.append(textDiv("infographic-step-title", item.title));
      if (item.body) body.append(textDiv("infographic-step-text", item.body));
      appendCitations(body, item.citationIds, citationMap);
      li.append(body);
      list.append(li);
    }
    section.append(list);
    return section;
  }

  if (block.type === "comparison") {
    const wrap = document.createElement("div");
    wrap.className = "infographic-comparison-wrap";
    const table = document.createElement("table");
    table.className = "infographic-comparison";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    headRow.append(thEl(""));
    for (const col of block.columns) headRow.append(thEl(col));
    thead.append(headRow);
    table.append(thead);
    const tbody = document.createElement("tbody");
    for (const row of block.rows) {
      const tr = document.createElement("tr");
      const labelCell = document.createElement("th");
      labelCell.scope = "row";
      labelCell.textContent = row.label || "";
      appendCitations(labelCell, row.citationIds, citationMap);
      tr.append(labelCell);
      for (const cell of row.cells) {
        const td = document.createElement("td");
        td.textContent = cell || "";
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    wrap.append(table);
    section.append(wrap);
    return section;
  }

  return null;
}

function renderCitations(citations) {
  const footer = document.createElement("footer");
  footer.className = "infographic-citations";
  const title = document.createElement("h4");
  title.className = "infographic-block-title";
  title.textContent = "근거 출처";
  footer.append(title);
  const list = document.createElement("ul");
  for (const c of citations) {
    const li = document.createElement("li");
    const id = document.createElement("span");
    id.className = "infographic-cite-id";
    id.textContent = c.id;
    li.append(id);
    const text = document.createElement("span");
    text.textContent = [c.documentName, c.locator].filter(Boolean).join(" · ")
      + (c.excerpt ? ` — ${c.excerpt}` : "");
    li.append(text);
    list.append(li);
  }
  footer.append(list);
  return footer;
}

function appendCitations(parent, ids, citationMap) {
  const valid = (Array.isArray(ids) ? ids : []).filter((id) => citationMap.has(id));
  if (!valid.length) return;
  const wrap = document.createElement("span");
  wrap.className = "infographic-cite-badges";
  for (const id of valid) {
    const badge = document.createElement("span");
    badge.className = "infographic-cite-badge";
    badge.textContent = id;
    const cite = citationMap.get(id);
    if (cite) badge.title = [cite.documentName, cite.locator].filter(Boolean).join(" · ");
    wrap.append(badge);
  }
  parent.append(wrap);
}

function textDiv(className, text) {
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  return div;
}

function thEl(text) {
  const th = document.createElement("th");
  th.textContent = text;
  return th;
}

// ── PNG 내보내기 (HTML → SVG foreignObject → canvas) ──────────────

async function exportInfographicPng() {
  const sheet = elements.studioInfographicCanvas?.querySelector(".infographic-sheet");
  if (!sheet) throw new Error("먼저 인포그래픽을 생성하세요.");
  const rect = sheet.getBoundingClientRect();
  const width = Math.ceil(rect.width) || 720;
  const height = Math.ceil(rect.height) || 480;
  const clone = sheet.cloneNode(true);
  clone.querySelectorAll(".infographic-cite-badge").forEach((el) => { el.removeAttribute("title"); });

  const serialized = new XMLSerializer().serializeToString(clone);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<foreignObject width="100%" height="100%">`
    + `<div xmlns="http://www.w3.org/1999/xhtml">`
    + `<style>${EXPORT_CSS}</style>`
    + serialized
    + `</div></foreignObject></svg>`;

  const blob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
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

const EXPORT_CSS = `
.infographic-sheet{font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;background:#fff;color:#0f172a;padding:24px;box-sizing:border-box;width:100%;}
.infographic-header h3{margin:0 0 4px;font-size:20px;}
.infographic-subtitle{margin:0 0 16px;color:#475569;font-size:13px;}
.infographic-block{margin:0 0 18px;}
.infographic-block-title{margin:0 0 10px;font-size:15px;color:#0f766e;}
.infographic-kpi-grid{display:flex;flex-wrap:wrap;gap:12px;}
.infographic-kpi{flex:1 1 140px;background:#f0fdfa;border:1px solid #ccfbf1;border-radius:10px;padding:12px;}
.infographic-kpi-value{font-size:22px;font-weight:700;color:#0f766e;}
.infographic-kpi-label{font-size:13px;color:#334155;margin-top:4px;}
.infographic-kpi-note{font-size:11px;color:#64748b;margin-top:4px;}
.infographic-card-grid{display:flex;flex-wrap:wrap;gap:12px;}
.infographic-card{flex:1 1 220px;border:1px solid #e2e8f0;border-radius:10px;padding:12px;background:#f8fafc;}
.infographic-card-title{font-weight:600;margin-bottom:6px;}
.infographic-card-body{font-size:13px;color:#475569;}
.infographic-timeline{list-style:none;margin:0;padding:0;border-left:2px solid #14b8a6;}
.infographic-timeline-item{position:relative;padding:0 0 16px 18px;}
.infographic-timeline-when{font-weight:700;color:#0f766e;font-size:13px;}
.infographic-timeline-title{font-weight:600;}
.infographic-timeline-text{font-size:13px;color:#475569;}
.infographic-steps{list-style:none;margin:0;padding:0;}
.infographic-step{display:flex;gap:12px;margin-bottom:12px;}
.infographic-step-num{flex:0 0 32px;height:32px;border-radius:50%;background:#0f766e;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;}
.infographic-step-title{font-weight:600;}
.infographic-step-text{font-size:13px;color:#475569;}
.infographic-comparison{border-collapse:collapse;width:100%;font-size:13px;}
.infographic-comparison th,.infographic-comparison td{border:1px solid #e2e8f0;padding:8px;text-align:left;}
.infographic-comparison thead th{background:#f0fdfa;color:#0f766e;}
.infographic-citations{margin-top:18px;border-top:1px solid #e2e8f0;padding-top:12px;}
.infographic-citations ul{margin:0;padding-left:18px;font-size:12px;color:#475569;}
.infographic-cite-id{font-weight:700;color:#0f766e;margin-right:6px;}
.infographic-cite-badges{display:inline-flex;gap:4px;margin-left:6px;}
.infographic-cite-badge{font-size:10px;background:#ccfbf1;color:#0f766e;border-radius:4px;padding:1px 5px;}
.infographic-warning{margin-top:12px;font-size:12px;color:#b45309;}
`;

// ── 상태/유틸 ─────────────────────────────────────────────────────

function syncLayoutChips() {
  const container = elements.studioInfographicLayout;
  if (!container) return;
  for (const button of container.querySelectorAll("[data-layout]")) {
    button.classList.toggle("is-active", button.dataset.layout === _layout);
  }
}

function setBusy(busy) {
  if (elements.studioInfographicGenerate) {
    elements.studioInfographicGenerate.textContent = busy ? "생성 중지" : "생성";
    elements.studioInfographicGenerate.classList.toggle("is-busy", busy);
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
  if (ctx.notebookId) return "레이아웃을 고르고 ‘생성’을 누르면 이 지식팩 문서로 인포그래픽을 만듭니다.";
  if (state.activeView === "knowledge") return "지식팩 카드를 선택하세요.";
  const documents = getStudioSourceDocuments();
  if (!documents.length) return "문서를 업로드하면 인포그래픽을 생성할 수 있습니다.";
  return "레이아웃을 고르고 ‘생성’을 누르면 인포그래픽을 만듭니다.";
}

function safeFileName(name) {
  return String(name || "infographic").replace(/[^\w가-힣\- ]+/g, "").trim().slice(0, 60) || "infographic";
}
