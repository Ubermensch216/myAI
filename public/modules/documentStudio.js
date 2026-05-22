// Studio Document Editor (single-editor plain-text mode, textarea-backed).
// AI fills the chosen template into one flowing markdown body. The user
// edits that text directly in a plain <textarea> (notepad-style — no
// syntax highlighting) with a small format toolbar that inserts markdown
// fragments. Drafts live in room.studio.documents and persist via the
// room state.

import { state, elements, ensureRoomStudio, getActiveRoom, accessAuthHeaders } from "./state.js";
import { scheduleSave } from "./persistence.js";
import { setStudioCollapsed } from "./layout.js";
import { parseMarkdownToVisualBlocks, serializeVisualBlocksToMarkdown } from "./documentStudioMarkdown.js";
import { addGeneratedSourceToRoom } from "./sourceWorkflow.js";

const EXPORT_FORMATS = [
  { id: "docx", label: "Word (.docx)" },
  { id: "hwpx", label: "HWPX (.hwpx)" },
  { id: "pdf", label: "PDF (.pdf)" },
  { id: "md", label: "Markdown (.md)" }
];

let _templates = null;
let _activeAbort = null;
let _switchToDocumentTool = null;
let _suppressEditorChange = false;
let _visualBlocks = [];
let _openAiMenuKey = "";
let _aiEditDocumentId = "";
const _aiEditStates = new Map();

const AI_EDIT_ACTIONS = [
  { id: "rewrite", label: "재작성" },
  { id: "summarize", label: "요약" },
  { id: "shorten", label: "더 짧게" },
  { id: "expand", label: "더 길게" }
];

const AI_EDIT_TONES = [
  { id: "official", label: "공문체" },
  { id: "report", label: "보고서체" },
  { id: "plain", label: "간결하게" },
  { id: "friendly", label: "친절하게" }
];

export function registerDocumentStudioActivator(fn) {
  _switchToDocumentTool = typeof fn === "function" ? fn : null;
}

export function bindDocumentStudioEvents() {
  populateExportMenu();

  elements.studioDocumentRailButton?.addEventListener("click", () => {
    setStudioCollapsed(false);
    _switchToDocumentTool?.();
  });

  elements.studioDocumentTitle?.addEventListener("input", () => {
    const doc = getActiveDraft();
    if (!doc) return;
    doc.title = String(elements.studioDocumentTitle.value || "").slice(0, 200);
    markDirty(doc);
  });

  elements.studioDocumentTemplate?.addEventListener("change", () => {
    const doc = getActiveDraft();
    if (!doc) return;
    doc.templateId = elements.studioDocumentTemplate.value || null;
    markDirty(doc);
  });

  elements.studioDocumentRegenerateButton?.addEventListener("click", () => {
    regenerateActiveDraft().catch((error) => setStatus(`재구성 실패: ${error.message}`, true));
  });
  elements.studioSourceGuideButton?.addEventListener("click", () => {
    createSourceGuideOutput().catch((error) => setStatus(`소스 가이드 생성 실패: ${error.message}`, true));
  });
  elements.studioSourceGuideEmptyButton?.addEventListener("click", () => {
    createSourceGuideOutput().catch((error) => window.alert(error.message));
  });
  elements.studioDocumentSaveOutputButton?.addEventListener("click", () => {
    saveActiveDraftAsOutput();
  });

  elements.studioDocumentDeleteButton?.addEventListener("click", () => {
    const doc = getActiveDraft();
    if (!doc) return;
    if (!window.confirm("이 문서 초안을 삭제할까요?")) return;
    deleteActiveDraft();
  });

  elements.studioDocumentDownloadButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    const menu = elements.studioDocumentDownloadMenu;
    if (!menu) return;
    const willOpen = menu.hidden;
    closeDownloadMenu();
    if (willOpen) {
      menu.hidden = false;
      elements.studioDocumentDownloadButton.setAttribute("aria-expanded", "true");
    }
  });
  document.addEventListener("click", closeDownloadMenu);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".studio-document-ai-menu-wrap")) closeAiEditMenus();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDownloadMenu();
    if (event.key === "Escape") closeAiEditMenus();
  });

  elements.studioDocumentIncludeCitations?.addEventListener("change", () => {
    const doc = getActiveDraft();
    if (!doc) return;
    doc.exportOptions = doc.exportOptions || {};
    doc.exportOptions.includeCitations = Boolean(elements.studioDocumentIncludeCitations.checked);
    scheduleSave();
  });

  elements.studioDocumentVisualModeButton?.addEventListener("click", () => {
    setDocumentEditorMode("visual");
  });

  elements.studioDocumentRawModeButton?.addEventListener("click", () => {
    setDocumentEditorMode("raw");
  });

  elements.studioDocumentLibraryModeButton?.addEventListener("click", () => {
    setDocumentEditorMode("library");
  });

  initEditor();

  elements.studioDocumentToolbar?.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-md-action]");
    if (!button) return;
    event.preventDefault();
    applyToolbarAction(button.dataset.mdAction);
  });
}

function initEditor() {
  const ta = elements.studioDocumentMarkdown;
  if (!ta) return;
  if (!ta.placeholder) {
    ta.placeholder = "여기에서 문서를 편집하세요. 위 도구로 서식을 삽입하거나 마크다운을 직접 입력할 수 있습니다.";
  }
  ta.addEventListener("input", () => {
    if (_suppressEditorChange) return;
    const doc = getActiveDraft();
    if (!doc) return;
    doc.markdown = ta.value;
    markDirty(doc);
  });
  ta.addEventListener("keydown", (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    const key = event.key.toLowerCase();
    if (key === "b") { event.preventDefault(); applyToolbarAction("bold"); }
    else if (key === "i") { event.preventDefault(); applyToolbarAction("italic"); }
  });
}

function setEditorValue(text) {
  const ta = elements.studioDocumentMarkdown;
  if (!ta) return;
  if (ta.value === text) return;
  _suppressEditorChange = true;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  ta.value = text;
  try {
    const len = text.length;
    ta.setSelectionRange(Math.min(start, len), Math.min(end, len));
  } catch { /* ignore */ }
  _suppressEditorChange = false;
}

function resizeEditor() { /* textarea sizes itself via flex; nothing to do */ }

function getDocumentEditorMode(doc) {
  if (doc?.editorMode === "raw") return "raw";
  if (doc?.editorMode === "library") return "library";
  return "visual";
}

function setDocumentEditorMode(mode) {
  const doc = getActiveDraft();
  if (!doc) return;
  const next = mode === "raw" ? "raw" : mode === "library" ? "library" : "visual";
  if (getDocumentEditorMode(doc) === next) return;
  _openAiMenuKey = "";
  doc.editorMode = next;
  markDirty(doc);
  renderDocumentStudio();
}

function renderEditorMode(doc) {
  const mode = getDocumentEditorMode(doc);
  const visualActive = mode === "visual";
  const rawActive = mode === "raw";
  const libraryActive = mode === "library";
  if (elements.studioDocumentVisual) elements.studioDocumentVisual.hidden = !visualActive;
  if (elements.studioDocumentRaw) elements.studioDocumentRaw.hidden = !rawActive;
  if (elements.studioOutputLibrary) elements.studioOutputLibrary.hidden = !libraryActive;
  updateModeButton(elements.studioDocumentVisualModeButton, visualActive);
  updateModeButton(elements.studioDocumentRawModeButton, rawActive);
  updateModeButton(elements.studioDocumentLibraryModeButton, libraryActive);
  if (visualActive) renderVisualEditor(doc);
}

function updateModeButton(button, active) {
  if (!button) return;
  button.classList.toggle("is-active", Boolean(active));
  button.setAttribute("aria-pressed", active ? "true" : "false");
}

function renderVisualEditor(doc) {
  const root = elements.studioDocumentVisual;
  if (!root) return;
  _visualBlocks = parseMarkdownToVisualBlocks(doc.markdown || "");
  root.innerHTML = "";
  for (let index = 0; index < _visualBlocks.length; index += 1) {
    root.append(renderVisualBlock(doc, _visualBlocks[index], index));
  }
}

function renderVisualBlock(doc, block, blockIndex) {
  if (block.type === "heading") return renderHeadingBlock(doc, block, blockIndex);
  if (block.type === "paragraph") return renderParagraphBlock(doc, block, blockIndex);
  if (block.type === "bullet_list" || block.type === "numbered_list") return renderListBlock(doc, block, blockIndex);
  if (block.type === "checklist") return renderChecklistBlock(doc, block, blockIndex);
  if (block.type === "table") return renderTableBlock(doc, block, blockIndex);
  return renderRawBlock(doc, block, blockIndex);
}

function renderHeadingBlock(doc, block, blockIndex) {
  const wrap = createVisualShell("heading");
  const input = document.createElement("input");
  input.className = `studio-document-visual-heading is-h${Math.min(6, Math.max(1, Number(block.level) || 1))}`;
  input.type = "text";
  input.value = block.text || "";
  input.addEventListener("input", () => {
    block.text = input.value;
    syncVisualBlocks(doc);
  });
  appendBlockAiControls(wrap, doc, block, blockIndex, makeBlockAiTarget(block, blockIndex));
  appendVisualContent(wrap, input);
  appendAiEditPanels(wrap, doc, block, blockIndex);
  return wrap;
}

function renderParagraphBlock(doc, block, blockIndex) {
  const wrap = createVisualShell("paragraph");
  const input = document.createElement("textarea");
  input.className = "studio-document-visual-paragraph";
  input.rows = Math.max(2, Math.min(8, String(block.text || "").split("\n").length + 1));
  input.value = block.text || "";
  input.addEventListener("input", () => {
    block.text = input.value;
    syncVisualBlocks(doc);
    autosizeVisualTextarea(input);
  });
  appendBlockAiControls(wrap, doc, block, blockIndex, makeBlockAiTarget(block, blockIndex));
  appendVisualContent(wrap, input);
  appendAiEditPanels(wrap, doc, block, blockIndex);
  requestAnimationFrame(() => autosizeVisualTextarea(input));
  return wrap;
}

function renderListBlock(doc, block, blockIndex) {
  const wrap = createVisualShell(block.type === "numbered_list" ? "numbered-list" : "bullet-list");
  const list = document.createElement(block.type === "numbered_list" ? "ol" : "ul");
  list.className = "studio-document-visual-list";
  const items = Array.isArray(block.items) ? block.items : [];
  for (const item of items) {
    const li = document.createElement("li");
    const input = document.createElement("input");
    input.type = "text";
    input.value = item.text || "";
    input.addEventListener("input", () => {
      item.text = input.value;
      syncVisualBlocks(doc);
    });
    li.append(input);
    list.append(li);
  }
  appendBlockAiControls(wrap, doc, block, blockIndex, makeBlockAiTarget(block, blockIndex));
  appendVisualContent(wrap, list);
  appendAiEditPanels(wrap, doc, block, blockIndex);
  return wrap;
}

function renderChecklistBlock(doc, block, blockIndex) {
  const wrap = createVisualShell("checklist");
  const list = document.createElement("ul");
  list.className = "studio-document-visual-list studio-document-visual-checklist";
  const items = Array.isArray(block.items) ? block.items : [];
  for (const item of items) {
    const li = document.createElement("li");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = Boolean(item.checked);
    checkbox.addEventListener("change", () => {
      item.checked = checkbox.checked;
      syncVisualBlocks(doc);
    });
    const input = document.createElement("input");
    input.type = "text";
    input.value = item.text || "";
    input.addEventListener("input", () => {
      item.text = input.value;
      syncVisualBlocks(doc);
    });
    li.append(checkbox, input);
    list.append(li);
  }
  appendBlockAiControls(wrap, doc, block, blockIndex, makeBlockAiTarget(block, blockIndex));
  appendVisualContent(wrap, list);
  appendAiEditPanels(wrap, doc, block, blockIndex);
  return wrap;
}

function renderTableBlock(doc, block, blockIndex) {
  const wrap = createVisualShell("table");
  const scroller = document.createElement("div");
  scroller.className = "studio-document-visual-table-scroll";
  const table = document.createElement("table");
  table.className = "studio-document-visual-table";
  const headers = Array.isArray(block.headers) ? block.headers : [];
  const rows = Array.isArray(block.rows) ? block.rows : [];

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  headers.forEach((header, colIndex) => {
    const th = document.createElement("th");
    th.append(createTableCellEditor(doc, block, blockIndex, header, (value) => {
      block.headers[colIndex] = value;
      syncVisualBlocks(doc);
    }, makeTableCellAiTarget(blockIndex, true, -1, colIndex)));
    headerRow.append(th);
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((row, rowIndex) => {
    const tr = document.createElement("tr");
    headers.forEach((_, colIndex) => {
      const td = document.createElement("td");
      td.append(createTableCellEditor(doc, block, blockIndex, row?.[colIndex] || "", (value) => {
        if (!Array.isArray(block.rows[rowIndex])) block.rows[rowIndex] = [];
        block.rows[rowIndex][colIndex] = value;
        syncVisualBlocks(doc);
      }, makeTableCellAiTarget(blockIndex, false, rowIndex, colIndex)));
      tr.append(td);
    });
    tbody.append(tr);
  });
  table.append(tbody);
  scroller.append(table);
  appendVisualContent(wrap, scroller);
  appendAiEditPanels(wrap, doc, block, blockIndex);
  return wrap;
}

function renderRawBlock(doc, block, blockIndex) {
  const wrap = createVisualShell("raw");
  const pre = document.createElement("pre");
  pre.className = "studio-document-visual-raw";
  pre.tabIndex = 0;
  pre.dataset.blockIndex = String(blockIndex);
  pre.textContent = block.markdown || "";
  appendBlockAiControls(wrap, doc, block, blockIndex, makeBlockAiTarget(block, blockIndex));
  appendVisualContent(wrap, pre);
  appendAiEditPanels(wrap, doc, block, blockIndex);
  return wrap;
}

function createVisualShell(type) {
  const wrap = document.createElement("section");
  wrap.className = `studio-document-visual-block is-${type}`;
  return wrap;
}

function createTableInput(value, onInput) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function createTableCellEditor(doc, block, blockIndex, value, onInput, target) {
  const editor = document.createElement("div");
  editor.className = "studio-document-table-cell-editor";
  editor.append(createTableInput(value, onInput), createAiEditControls(doc, block, blockIndex, target, { compact: true }));
  return editor;
}

function appendVisualContent(wrap, ...nodes) {
  const content = document.createElement("div");
  content.className = "studio-document-visual-content";
  content.append(...nodes);
  wrap.append(content);
}

function appendBlockAiControls(wrap, doc, block, blockIndex, target) {
  if (!target) return;
  const controls = createAiEditControls(doc, block, blockIndex, target);
  controls.classList.add("studio-document-block-ai");
  wrap.append(controls);
}

function createAiEditControls(doc, block, blockIndex, target, options = {}) {
  const wrap = document.createElement("div");
  wrap.className = `studio-document-ai-menu-wrap${options.compact ? " is-compact" : ""}`;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "studio-document-ai-trigger";
  button.textContent = "AI";
  button.title = `${target.label} AI 편집`;
  button.setAttribute("aria-label", `${target.label} AI 편집 메뉴`);
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", _openAiMenuKey === target.key ? "true" : "false");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    _openAiMenuKey = _openAiMenuKey === target.key ? "" : target.key;
    renderDocumentStudio();
  });
  wrap.append(button);

  if (_openAiMenuKey === target.key) {
    const menu = document.createElement("div");
    menu.className = "studio-document-ai-menu";
    menu.setAttribute("role", "menu");
    for (const action of AI_EDIT_ACTIONS) {
      menu.append(createAiEditMenuItem(action.label, () => {
        startAiEdit(doc, block, blockIndex, target, action.id);
      }));
    }
    const toneLabel = document.createElement("div");
    toneLabel.className = "studio-document-ai-menu-label";
    toneLabel.textContent = "어조 변경";
    menu.append(toneLabel);
    for (const tone of AI_EDIT_TONES) {
      menu.append(createAiEditMenuItem(tone.label, () => {
        startAiEdit(doc, block, blockIndex, target, "tone", tone.id);
      }));
    }
    wrap.append(menu);
  }

  return wrap;
}

function createAiEditMenuItem(label, onClick) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "studio-document-ai-menu-item";
  item.setAttribute("role", "menuitem");
  item.textContent = label;
  item.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return item;
}

function appendAiEditPanels(wrap, doc, block, blockIndex) {
  const states = Array.from(_aiEditStates.values()).filter((state) => state.target.blockIndex === blockIndex);
  for (const state of states) {
    wrap.append(renderAiEditPanel(doc, block, blockIndex, state));
  }
}

function renderAiEditPanel(doc, block, blockIndex, state) {
  const panel = document.createElement("div");
  panel.className = `studio-document-ai-preview is-${state.status}`;
  panel.setAttribute("aria-live", "polite");

  const title = document.createElement("div");
  title.className = "studio-document-ai-preview-title";
  title.textContent = state.status === "loading"
    ? `${state.actionLabel} 중`
    : state.status === "error"
      ? `${state.actionLabel} 실패`
      : `${state.actionLabel} 결과`;
  panel.append(title);

  if (state.status === "loading") {
    const loading = document.createElement("div");
    loading.className = "studio-document-ai-loading";
    loading.textContent = "선택한 항목을 편집하고 있습니다.";
    panel.append(loading);
  } else if (state.status === "error") {
    const error = document.createElement("div");
    error.className = "studio-document-ai-error";
    error.textContent = state.error || "AI 편집에 실패했습니다.";
    panel.append(error);
  } else {
    const output = document.createElement("div");
    output.className = "studio-document-ai-output";
    output.textContent = state.resultText || "";
    panel.append(output);
    if (Array.isArray(state.warnings) && state.warnings.length) {
      const warnings = document.createElement("div");
      warnings.className = "studio-document-ai-warnings";
      warnings.textContent = state.warnings.join(" · ");
      panel.append(warnings);
    }
  }

  const actions = document.createElement("div");
  actions.className = "studio-document-ai-preview-actions";
  if (state.status === "ready") {
    actions.append(
      createAiPreviewButton("적용", () => applyAiEditResult(doc, state)),
      createAiPreviewButton("아래에 삽입", () => insertAiEditResult(doc, state))
    );
  }
  if (state.status !== "loading") {
    actions.append(createAiPreviewButton("다시 생성", () => {
      startAiEdit(doc, block, blockIndex, state.target, state.action, state.tone);
    }));
  }
  actions.append(createAiPreviewButton(state.status === "loading" ? "취소" : "닫기", () => cancelAiEdit(state.key)));
  panel.append(actions);
  return panel;
}

function createAiPreviewButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button studio-document-ai-preview-button";
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  });
  return button;
}

function makeBlockAiTarget(block, blockIndex) {
  if (block.type === "heading") return { key: `block:${blockIndex}`, blockIndex, targetType: "heading", label: "제목" };
  if (block.type === "paragraph") return { key: `block:${blockIndex}`, blockIndex, targetType: "paragraph", label: "문단" };
  if (block.type === "bullet_list" || block.type === "numbered_list") {
    return { key: `block:${blockIndex}`, blockIndex, targetType: "list", label: "목록" };
  }
  if (block.type === "checklist") return { key: `block:${blockIndex}`, blockIndex, targetType: "checklist", label: "체크리스트" };
  if (block.type === "raw") return { key: `block:${blockIndex}`, blockIndex, targetType: "raw", label: "원문 블록" };
  return null;
}

function makeTableCellAiTarget(blockIndex, isHeader, rowIndex, colIndex) {
  const rowKey = isHeader ? "h" : String(rowIndex);
  const label = isHeader ? `표 머리글 ${colIndex + 1}` : `표 ${rowIndex + 1}행 ${colIndex + 1}열`;
  return {
    key: `cell:${blockIndex}:${rowKey}:${colIndex}`,
    blockIndex,
    targetType: "table_cell",
    label,
    cell: { isHeader, rowIndex, colIndex }
  };
}

async function startAiEdit(doc, block, blockIndex, target, action, tone = "") {
  const text = getAiTargetText(block, target);
  if (!text.trim()) {
    _aiEditStates.set(target.key, {
      key: target.key,
      target,
      action,
      tone,
      actionLabel: getAiActionLabel(action, tone),
      status: "error",
      error: "편집할 내용이 없습니다."
    });
    _openAiMenuKey = "";
    renderDocumentStudio();
    return;
  }

  const existing = _aiEditStates.get(target.key);
  if (existing?.controller) existing.controller.abort();

  const controller = new AbortController();
  const state = {
    key: target.key,
    target: { ...target, cell: target.cell ? { ...target.cell } : null },
    action,
    tone,
    actionLabel: getAiActionLabel(action, tone),
    status: "loading",
    controller,
    resultText: "",
    warnings: []
  };
  _aiEditStates.set(target.key, state);
  _openAiMenuKey = "";
  renderDocumentStudio();

  try {
    const response = await fetch("/api/studio/document/ai-edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        action,
        tone,
        targetType: target.targetType,
        text,
        documentTitle: doc.title || "",
        contextBefore: getAiContext(blockIndex, -1),
        contextAfter: getAiContext(blockIndex, 1),
        model: elements.modelInput?.value?.trim() || undefined
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || `status ${response.status}`);
    if (_aiEditStates.get(target.key)?.controller !== controller) return;
    _aiEditStates.set(target.key, {
      ...state,
      status: "ready",
      controller: null,
      resultText: String(body.result?.text || "").trim(),
      warnings: Array.isArray(body.result?.warnings) ? body.result.warnings : []
    });
  } catch (error) {
    if (error.name === "AbortError") return;
    if (_aiEditStates.get(target.key)?.controller !== controller) return;
    _aiEditStates.set(target.key, {
      ...state,
      status: "error",
      controller: null,
      error: error.message || "AI 편집에 실패했습니다."
    });
  } finally {
    renderDocumentStudio();
  }
}

function getAiTargetText(block, target) {
  if (!block) return "";
  if (target.targetType === "heading") return String(block.text || "");
  if (target.targetType === "paragraph") return String(block.text || "");
  if (target.targetType === "raw") return String(block.markdown || "");
  if (target.targetType === "list") {
    return (Array.isArray(block.items) ? block.items : []).map((item) => item.text || "").filter(Boolean).join("\n");
  }
  if (target.targetType === "checklist") {
    return (Array.isArray(block.items) ? block.items : []).map((item) => item.text || "").filter(Boolean).join("\n");
  }
  if (target.targetType === "table_cell") {
    const cell = target.cell || {};
    if (cell.isHeader) return String(block.headers?.[cell.colIndex] || "");
    return String(block.rows?.[cell.rowIndex]?.[cell.colIndex] || "");
  }
  return "";
}

function setAiTargetText(block, target, text) {
  const value = String(text || "").trim();
  if (target.targetType === "heading") {
    block.text = value.replace(/\s*\n+\s*/g, " ");
  } else if (target.targetType === "paragraph") {
    block.text = value;
  } else if (target.targetType === "raw") {
    block.markdown = value;
  } else if (target.targetType === "list") {
    block.items = textToLineItems(value).map((item) => ({ text: item }));
  } else if (target.targetType === "checklist") {
    const previous = Array.isArray(block.items) ? block.items : [];
    block.items = textToLineItems(value).map((item, index) => ({
      text: item,
      checked: Boolean(previous[index]?.checked)
    }));
  } else if (target.targetType === "table_cell") {
    const cell = target.cell || {};
    const cellText = value.replace(/\s*\n+\s*/g, " ");
    if (cell.isHeader) {
      if (!Array.isArray(block.headers)) block.headers = [];
      block.headers[cell.colIndex] = cellText;
    } else {
      if (!Array.isArray(block.rows)) block.rows = [];
      if (!Array.isArray(block.rows[cell.rowIndex])) block.rows[cell.rowIndex] = [];
      block.rows[cell.rowIndex][cell.colIndex] = cellText;
    }
  }
}

function applyAiEditResult(doc, state) {
  const block = _visualBlocks[state.target.blockIndex];
  if (!block || state.status !== "ready") return;
  setAiTargetText(block, state.target, state.resultText);
  _aiEditStates.delete(state.key);
  syncVisualBlocks(doc);
  renderDocumentStudio();
}

function insertAiEditResult(doc, state) {
  if (state.status !== "ready") return;
  const index = Math.min(_visualBlocks.length, state.target.blockIndex + 1);
  _visualBlocks.splice(index, 0, { type: "paragraph", text: String(state.resultText || "").trim() });
  _aiEditStates.clear();
  syncVisualBlocks(doc);
  renderDocumentStudio();
}

function cancelAiEdit(key) {
  const state = _aiEditStates.get(key);
  if (state?.controller) state.controller.abort();
  _aiEditStates.delete(key);
  renderDocumentStudio();
}

function closeAiEditMenus() {
  if (!_openAiMenuKey) return;
  _openAiMenuKey = "";
  renderDocumentStudio();
}

function getAiContext(blockIndex, direction) {
  const start = direction < 0 ? Math.max(0, blockIndex - 2) : blockIndex + 1;
  const end = direction < 0 ? blockIndex : Math.min(_visualBlocks.length, blockIndex + 3);
  return serializeVisualBlocksToMarkdown(_visualBlocks.slice(start, end)).slice(0, 2000);
}

function getAiActionLabel(action, tone) {
  if (action === "tone") {
    const toneLabel = AI_EDIT_TONES.find((item) => item.id === tone)?.label || "어조 변경";
    return `어조 변경: ${toneLabel}`;
  }
  return AI_EDIT_ACTIONS.find((item) => item.id === action)?.label || "AI 편집";
}

function textToLineItems(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/, "").trim())
    .filter(Boolean);
}

function syncVisualBlocks(doc) {
  doc.markdown = serializeVisualBlocksToMarkdown(_visualBlocks);
  setEditorValue(doc.markdown);
  markDirty(doc);
}

function autosizeVisualTextarea(input) {
  input.style.height = "auto";
  input.style.height = `${Math.max(48, input.scrollHeight)}px`;
}

// ── Entry point from chat.js ─────────────────────────────────────────────

export async function openWithAnswer({ title, markdown, messageId, metadata = {}, model } = {}) {
  const room = getActiveRoom();
  if (!room) return;
  const text = String(markdown || "").trim();
  if (!text) {
    window.alert("문서로 보낼 답변 내용이 없습니다.");
    return;
  }

  setStudioCollapsed(false);
  _switchToDocumentTool?.();
  await ensureTemplatesLoaded();

  const suggestedId = pickDefaultTemplateId(metadata);
  const templateId = await promptTemplateChoice(suggestedId);
  if (!templateId) return;

  const studio = ensureRoomStudio(room);
  const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const draft = {
    id: draftId,
    title: title || deriveTitleFromMarkdown(text),
    templateId,
    markdown: "",
    citations: {},
    source: {
      roomId: room.id,
      messageId: messageId || null,
      sourceType: "assistant_answer"
    },
    model: model || elements.modelInput?.value?.trim() || "gemma3n:e2b",
    answerMarkdown: text,
    metadata,
    editorMode: "visual",
    exportOptions: { includeCitations: true },
    pending: true,
    warnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  studio.documents.unshift(draft);
  studio.activeDocumentId = draftId;
  scheduleSave();

  renderDocumentStudio();
  await convertDraft(draft);
  scheduleSave();
  renderDocumentStudio();
}

export async function openWithPreparedDraft({ title, markdown, templateId, metadata = {}, citations = [], source = {} } = {}) {
  const room = getActiveRoom();
  if (!room) return;
  const text = String(markdown || "").trim();
  if (!text) {
    window.alert("문서로 만들 내용이 없습니다.");
    return;
  }

  setStudioCollapsed(false);
  _switchToDocumentTool?.();
  await ensureTemplatesLoaded();

  const studio = ensureRoomStudio(room);
  const draftId = `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const draft = {
    id: draftId,
    title: title || deriveTitleFromMarkdown(text),
    templateId: templateId || pickDefaultTemplateId(metadata),
    markdown: text,
    citations: { law: Array.isArray(citations) ? citations : [] },
    source: {
      roomId: room.id,
      sourceType: "law_workbench_report",
      ...source
    },
    metadata,
    editorMode: "visual",
    exportOptions: { includeCitations: true },
    pending: false,
    warnings: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  studio.documents.unshift(draft);
  studio.activeDocumentId = draftId;
  upsertStudioOutputFromDraft(draft, { type: "document", quiet: true });
  scheduleSave();
  renderDocumentStudio();
}

export function renderDocumentStudio() {
  const room = getActiveRoom();
  const studio = room ? ensureRoomStudio(room) : null;
  const doc = studio ? studio.documents.find((d) => d.id === studio.activeDocumentId) : null;

  if (!doc) {
    _openAiMenuKey = "";
    _aiEditDocumentId = "";
    _aiEditStates.clear();
    if (elements.studioDocumentEmpty) elements.studioDocumentEmpty.hidden = false;
    if (elements.studioDocumentEditor) elements.studioDocumentEditor.hidden = true;
    if (elements.studioDocumentVisual) elements.studioDocumentVisual.innerHTML = "";
    renderOutputLibrary(studio);
    return;
  }
  if (elements.studioDocumentEmpty) elements.studioDocumentEmpty.hidden = true;
  if (elements.studioDocumentEditor) elements.studioDocumentEditor.hidden = false;
  if (_aiEditDocumentId !== doc.id) {
    _openAiMenuKey = "";
    _aiEditStates.clear();
    _aiEditDocumentId = doc.id;
  }

  ensureDraftMarkdown(doc);

  if (elements.studioDocumentTitle && elements.studioDocumentTitle.value !== doc.title) {
    elements.studioDocumentTitle.value = doc.title || "";
  }
  setEditorValue(doc.markdown || "");
  renderEditorMode(doc);
  populateTemplateSelect(doc.templateId);
  if (!_templates || !_templates.length) {
    ensureTemplatesLoaded().then(() => {
      const current = getActiveDraft();
      if (current && current === doc) populateTemplateSelect(current.templateId);
    }).catch(() => { /* status already surfaced inside ensureTemplatesLoaded */ });
  }
  if (elements.studioDocumentIncludeCitations) {
    elements.studioDocumentIncludeCitations.checked = doc.exportOptions?.includeCitations !== false;
  }
  renderWarnings(doc);
  renderOutputLibrary(studio);
  if (doc.pending) setStatus("AI 변환 중", false, true);
  else clearStatus();
  // Editor sizing must happen after the panel is shown; defer to next frame.
  requestAnimationFrame(resizeEditor);
}

// Backfill markdown for drafts saved under the old block-based shape so the
// new single-editor UI can show them without re-running the LLM.
function ensureDraftMarkdown(doc) {
  if (typeof doc.markdown === "string" && doc.markdown.length) return;
  if (Array.isArray(doc.blocks) && doc.blocks.length) {
    doc.markdown = blocksToMarkdown(doc.blocks);
    delete doc.blocks;
    markDirty(doc);
  } else if (typeof doc.markdown !== "string") {
    doc.markdown = "";
  }
}

function blocksToMarkdown(blocks) {
  const out = [];
  for (const block of blocks) {
    if (!block || typeof block !== "object") continue;
    const t = block.type;
    if (t === "heading") {
      const level = Math.min(6, Math.max(1, Number(block.level) || 1)) + 1;
      out.push(`${"#".repeat(level)} ${block.text || ""}`);
    } else if (t === "paragraph" || t === "quote") {
      const prefix = t === "quote" ? "> " : "";
      out.push((block.text || "").split("\n").map((l) => prefix + l).join("\n"));
    } else if (t === "bullet_list" || t === "source_list") {
      out.push((block.items || []).map((item) => `- ${item}`).join("\n"));
    } else if (t === "numbered_list") {
      out.push((block.items || []).map((item, i) => `${i + 1}. ${item}`).join("\n"));
    } else if (t === "checklist") {
      out.push((block.items || []).map((item) => `- [${item?.checked ? "x" : " "}] ${item?.text || ""}`).join("\n"));
    } else if (t === "table") {
      const cols = Array.isArray(block.columns) ? block.columns : [];
      if (!cols.length) continue;
      const header = `| ${cols.join(" | ")} |`;
      const divider = `| ${cols.map(() => "---").join(" | ")} |`;
      const rows = Array.isArray(block.rows) ? block.rows : [];
      const body = rows.map((row) => `| ${cols.map((_, i) => String(row[i] ?? "")).join(" | ")} |`);
      out.push([header, divider, ...body].join("\n"));
    } else if (t === "spacer") {
      out.push("---");
    }
    out.push("");
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// ── Source guide / Studio output library ─────────────────────────────────

async function createSourceGuideOutput() {
  const room = getActiveRoom();
  if (!room) throw new Error("활성 대화방이 없습니다.");
  const documents = Array.isArray(room.documents) ? room.documents.filter((doc) => doc?.kind === "document") : [];
  if (!documents.length && !room.selectedNotebookId) {
    throw new Error("소스 가이드를 만들 첨부 자료나 선택된 프로젝트가 없습니다.");
  }

  setStatus("소스 가이드 생성 중", false, true);
  const response = await fetch("/api/source-workflow/source-guide", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...accessAuthHeaders() },
    body: JSON.stringify({
      title: `${room.title || "자료"} 소스 가이드`,
      documents,
      notebookId: room.selectedNotebookId || "",
      model: elements.modelInput?.value?.trim() || undefined
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    throw new Error(body.error || `status ${response.status}`);
  }

  const guide = body.guide;
  const studio = ensureRoomStudio(room);
  const output = upsertStudioOutput({
    id: guide.id,
    type: "source_guide",
    title: guide.title || "소스 가이드",
    markdown: guide.markdown || "",
    source: {
      roomId: room.id,
      sourceType: "source_guide",
      sourceScope: guide.sourceScope || {}
    },
    metadata: {
      sourceScope: guide.sourceScope || {},
      warnings: Array.isArray(guide.warnings) ? guide.warnings : []
    },
    createdAt: guide.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  const draft = openOutputAsDraft(output, { activate: false });
  studio.activeDocumentId = draft.id;
  setStatus("소스 가이드를 생성했습니다.");
  scheduleSave();
  renderDocumentStudio();
}

function saveActiveDraftAsOutput() {
  const doc = getActiveDraft();
  if (!doc) return;
  const output = upsertStudioOutputFromDraft(doc, { type: "document" });
  setStatus(`산출물 보관됨: ${output.title}`);
  scheduleSave();
  renderDocumentStudio();
}

function upsertStudioOutputFromDraft(doc, { type = "document", quiet = false } = {}) {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const output = upsertStudioOutput({
    id: doc.outputId || "",
    type,
    title: doc.title || "Studio 문서",
    markdown: doc.markdown || "",
    citations: doc.citations || {},
    source: doc.source || { roomId: room?.id || "", sourceType: "studio_document" },
    metadata: doc.metadata || {},
    createdAt: doc.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  doc.outputId = output.id;
  if (!quiet && studio) renderOutputLibrary(studio);
  return output;
}

function upsertStudioOutput(input) {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!studio) return null;
  if (!Array.isArray(studio.outputs)) studio.outputs = [];
  const now = new Date().toISOString();
  const id = input.id || `studio_output_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const output = {
    id,
    type: input.type || "document",
    title: String(input.title || "Studio 산출물").trim().slice(0, 160),
    markdown: String(input.markdown || "").trim(),
    citations: input.citations || {},
    source: input.source || {},
    metadata: input.metadata || {},
    createdAt: input.createdAt || now,
    updatedAt: input.updatedAt || now
  };
  const existing = studio.outputs.findIndex((item) => item.id === id);
  if (existing >= 0) studio.outputs.splice(existing, 1);
  studio.outputs.unshift(output);
  studio.outputs = studio.outputs.slice(0, 60);
  return output;
}

function renderOutputLibrary(studio = ensureRoomStudio()) {
  const outputs = Array.isArray(studio?.outputs) ? studio.outputs : [];
  const libraryButton = elements.studioDocumentLibraryModeButton;
  if (libraryButton) libraryButton.textContent = `산출물 ${outputs.length}`;
  for (const root of [elements.studioOutputLibrary, elements.studioOutputLibraryEmpty]) {
    if (!root) continue;
    root.innerHTML = "";
    const isTabPane = root === elements.studioOutputLibrary;
    if (!isTabPane) {
      const header = document.createElement("div");
      header.className = "studio-output-library-header";
      const title = document.createElement("h4");
      title.textContent = `산출물 ${outputs.length}`;
      header.append(title);
      root.append(header);
    }
    if (!outputs.length) {
      const empty = document.createElement("p");
      empty.className = "studio-output-empty";
      empty.textContent = "보관된 Studio 산출물이 없습니다.";
      root.append(empty);
      continue;
    }
    const list = document.createElement("div");
    list.className = "studio-output-list";
    for (const output of outputs) list.append(renderOutputItem(output));
    root.append(list);
  }
}

function renderOutputItem(output) {
  const item = document.createElement("article");
  item.className = "studio-output-item";
  const main = document.createElement("div");
  main.className = "studio-output-main";
  const title = document.createElement("div");
  title.className = "studio-output-title";
  title.textContent = output.title || "Studio 산출물";
  const meta = document.createElement("div");
  meta.className = "studio-output-meta";
  meta.textContent = `${output.type === "source_guide" ? "소스 가이드" : "문서"} · ${formatOutputDate(output.updatedAt || output.createdAt)}`;
  main.append(title, meta);

  const actions = document.createElement("div");
  actions.className = "studio-output-actions";
  actions.append(outputActionButton("열기", () => {
    const draft = openOutputAsDraft(output);
    if (draft && draft.editorMode !== "visual") {
      draft.editorMode = "visual";
      markDirty(draft);
    }
    renderDocumentStudio();
  }));
  actions.append(outputActionButton("자료로 추가", () => addOutputAsRoomSource(output).catch((error) => window.alert(error.message))));
  actions.append(outputActionButton("승인 요청", () => requestOutputPromotion(output).catch((error) => window.alert(error.message))));
  actions.append(outputActionButton("삭제", () => deleteOutput(output.id)));

  item.append(main, actions);
  return item;
}

function outputActionButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button studio-output-action";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function openOutputAsDraft(output, { activate = true } = {}) {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const existing = studio.documents.find((doc) => doc.outputId === output.id);
  if (existing) {
    if (activate) studio.activeDocumentId = existing.id;
    return existing;
  }
  const draft = {
    id: `draft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    outputId: output.id,
    title: output.title || "Studio 산출물",
    templateId: null,
    markdown: output.markdown || "",
    citations: output.citations || {},
    source: output.source || { roomId: room?.id || "", sourceType: output.type || "studio_output" },
    metadata: output.metadata || {},
    editorMode: "visual",
    exportOptions: { includeCitations: true },
    pending: false,
    warnings: [],
    createdAt: output.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  studio.documents.unshift(draft);
  if (activate) studio.activeDocumentId = draft.id;
  scheduleSave();
  return draft;
}

async function addOutputAsRoomSource(output) {
  const room = getActiveRoom();
  if (!room) throw new Error("활성 대화방이 없습니다.");
  if (!String(output.markdown || "").trim()) throw new Error("자료로 추가할 산출물 내용이 없습니다.");
  const response = await fetch("/api/source-workflow/from-answer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messageId: output.source?.messageId || output.source?.sourceMessageId || "",
      title: output.title || "Studio 산출물",
      answerMarkdown: output.markdown,
      format: "md",
      metadata: output.metadata || {}
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error || "자료 생성에 실패했습니다.");
  addGeneratedSourceToRoom(room, body.generatedSource);
  window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  window.alert("Studio 산출물을 현재 방 자료로 추가했습니다.");
}

async function requestOutputPromotion(output) {
  const room = getActiveRoom();
  if (!room?.selectedNotebookId) {
    throw new Error("승인 요청 대상 프로젝트를 먼저 선택하세요.");
  }
  const response = await fetch("/api/source-workflow/promotions", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...accessAuthHeaders() },
    body: JSON.stringify({
      notebookId: room.selectedNotebookId,
      title: output.title,
      markdown: output.markdown,
      sourceType: output.type || "studio_output",
      sourceRoomId: room.id,
      sourceOutputId: output.id,
      generatedAt: output.createdAt,
      citations: flattenCitations(output.citations),
      metadata: output.metadata || {}
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) throw new Error(body.error || "승인 요청에 실패했습니다.");
  window.alert("관리자 승인 요청을 등록했습니다.");
}

function deleteOutput(outputId) {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!studio) return;
  studio.outputs = (studio.outputs || []).filter((output) => output.id !== outputId);
  scheduleSave();
  renderDocumentStudio();
}

function flattenCitations(citations) {
  if (Array.isArray(citations)) return citations;
  if (!citations || typeof citations !== "object") return [];
  return Object.values(citations).flatMap((value) => Array.isArray(value) ? value : []);
}

function formatOutputDate(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// ── Template management ──────────────────────────────────────────────────

async function ensureTemplatesLoaded() {
  if (_templates) return _templates;
  try {
    const response = await fetch("/api/studio/document/templates");
    if (!response.ok) throw new Error(`status ${response.status}`);
    const body = await response.json();
    if (!body.ok || !Array.isArray(body.templates)) throw new Error("invalid response");
    _templates = body.templates;
  } catch (error) {
    setStatus(`템플릿 목록을 불러오지 못했습니다: ${error.message}`, true);
    _templates = [];
  }
  return _templates;
}

function populateTemplateSelect(activeId) {
  const select = elements.studioDocumentTemplate;
  if (!select) return;
  const previous = select.value;
  select.innerHTML = "";
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "템플릿";
  placeholder.disabled = true;
  placeholder.hidden = true;
  select.append(placeholder);
  const templates = Array.isArray(_templates) ? _templates : [];
  
  const personalTemplates = (state.documentTemplates && Array.isArray(state.documentTemplates.personal)) ? state.documentTemplates.personal : [];
  
  if (personalTemplates.length > 0) {
    const groupPersonal = document.createElement("optgroup");
    groupPersonal.label = "내 템플릿";
    for (const tpl of personalTemplates) {
      const option = document.createElement("option");
      option.value = tpl.id;
      option.textContent = tpl.name;
      groupPersonal.append(option);
    }
    select.append(groupPersonal);
  }
  
  const groupBuiltin = document.createElement("optgroup");
  groupBuiltin.label = "기본 템플릿";
  for (const tpl of templates) {
    if (personalTemplates.some(p => p.id === tpl.id)) continue;
    const option = document.createElement("option");
    option.value = tpl.id;
    option.textContent = tpl.name;
    groupBuiltin.append(option);
  }
  if (groupBuiltin.children.length > 0) {
    select.append(groupBuiltin);
  }
  const desired = activeId || previous || "";
  const inBuiltin = templates.some((t) => t.id === desired);
  const inPersonal = personalTemplates.some((t) => t.id === desired);
  if (desired && !inBuiltin && !inPersonal) {
    const fallback = document.createElement("option");
    fallback.value = desired;
    fallback.textContent = desired;
    select.append(fallback);
  }
  select.value = desired || "";
}

function pickDefaultTemplateId(metadata) {
  if (!metadata || typeof metadata !== "object") return _templates?.[0]?.id || "planning_proposal";
  if (metadata.lawWorkbench) return "law_review_opinion";
  if (metadata.compliance || metadata.law) return "review_report";
  return _templates?.[0]?.id || "planning_proposal";
}

function promptTemplateChoice(suggestedId) {
  const templates = Array.isArray(_templates) ? _templates : [];
  if (!templates.length) return Promise.resolve(suggestedId || "");
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "studio-doc-template-picker";
    const card = document.createElement("div");
    card.className = "studio-doc-template-picker-card";
    const title = document.createElement("h3");
    title.className = "studio-doc-template-picker-title";
    title.textContent = "어떤 템플릿으로 문서를 만들까요?";
    const list = document.createElement("div");
    list.className = "studio-doc-template-picker-list";

    let selectedId = suggestedId || templates[0].id;

    const renderOptions = () => {
      list.innerHTML = "";
      for (const tpl of templates) {
        const opt = document.createElement("button");
        opt.type = "button";
        opt.className = "studio-doc-template-picker-option";
        opt.dataset.templateId = tpl.id;
        if (tpl.id === selectedId) opt.classList.add("is-selected");
        const name = document.createElement("div");
        name.className = "studio-doc-template-picker-name";
        name.textContent = tpl.name || tpl.id;
        opt.append(name);
        if (tpl.description) {
          const desc = document.createElement("div");
          desc.className = "studio-doc-template-picker-desc";
          desc.textContent = tpl.description;
          opt.append(desc);
        }
        opt.addEventListener("click", () => {
          selectedId = tpl.id;
          renderOptions();
        });
        opt.addEventListener("dblclick", () => {
          selectedId = tpl.id;
          close(selectedId);
        });
        list.append(opt);
      }
    };

    const actions = document.createElement("div");
    actions.className = "studio-doc-template-picker-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "ghost-button";
    cancelBtn.textContent = "취소";
    cancelBtn.addEventListener("click", () => close(null));
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "send-button";
    okBtn.textContent = "선택";
    okBtn.addEventListener("click", () => close(selectedId));
    actions.append(cancelBtn, okBtn);

    card.append(title, list, actions);
    overlay.append(card);

    const onKeydown = (event) => {
      if (event.key === "Escape") { event.preventDefault(); close(null); }
      else if (event.key === "Enter") { event.preventDefault(); close(selectedId); }
    };
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(null);
    });

    function close(result) {
      document.removeEventListener("keydown", onKeydown);
      overlay.remove();
      resolve(result);
    }

    renderOptions();
    document.addEventListener("keydown", onKeydown);
    document.body.append(overlay);
    okBtn.focus();
  });
}

// ── Conversion / regeneration ────────────────────────────────────────────

async function convertDraft(draft) {
  if (_activeAbort) _activeAbort.abort();
  const controller = new AbortController();
  _activeAbort = controller;
  setStatus("AI 변환 중", false, true);
  try {
    const personalTemplates = (state.documentTemplates && Array.isArray(state.documentTemplates.personal)) ? state.documentTemplates.personal : [];
    const personalTemplate = personalTemplates.find(t => t.id === draft.templateId);
    
    const bodyPayload = {
        title: draft.title,
        answerMarkdown: draft.answerMarkdown,
        templateId: draft.templateId,
        metadata: draft.metadata || {},
        source: draft.source,
        model: draft.model
    };
    
    if (personalTemplate) {
      bodyPayload.template = personalTemplate;
    }

    const response = await fetch("/api/studio/document/from-answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify(bodyPayload)
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) {
      throw new Error(body.error || `status ${response.status}`);
    }
    if (!isDraftAlive(draft)) return;
    draft.templateId = body.templateId || draft.templateId;
    draft.title = body.document?.title || draft.title;
    draft.markdown = typeof body.markdown === "string" ? body.markdown : blocksToMarkdown(body.document?.blocks || []);
    draft.citations = body.document?.citations || {};
    draft.warnings = Array.isArray(body.warnings) ? body.warnings : [];
    draft.pending = false;
    draft.updatedAt = new Date().toISOString();
    delete draft.blocks;
    upsertStudioOutputFromDraft(draft, { type: "document", quiet: true });
    setStatus("");
  } catch (error) {
    if (error.name === "AbortError") return;
    // Draft was deleted while the conversion was in flight — surface nothing.
    if (!isDraftAlive(draft)) return;
    draft.pending = false;
    draft.warnings = [...(draft.warnings || []), { code: "convert_failed", message: `변환 오류: ${error.message}` }];
    setStatus(`변환 실패: ${error.message}`, true);
    throw error;
  } finally {
    if (_activeAbort === controller) _activeAbort = null;
  }
}

function isDraftAlive(draft) {
  const room = getActiveRoom();
  if (!room) return false;
  const studio = ensureRoomStudio(room);
  return studio.documents.includes(draft);
}

async function regenerateActiveDraft() {
  const doc = getActiveDraft();
  if (!doc) return;
  if (!doc.answerMarkdown) {
    setStatus("재구성할 원본 답변이 없습니다.", true);
    return;
  }
  doc.templateId = elements.studioDocumentTemplate?.value || doc.templateId;
  doc.pending = true;
  renderDocumentStudio();
  await convertDraft(doc);
  scheduleSave();
  renderDocumentStudio();
}

function deleteActiveDraft() {
  const room = getActiveRoom();
  if (!room) return;
  const studio = ensureRoomStudio(room);
  if (_activeAbort) {
    _activeAbort.abort();
    _activeAbort = null;
  }
  studio.documents = studio.documents.filter((d) => d.id !== studio.activeDocumentId);
  studio.activeDocumentId = studio.documents[0]?.id || "";
  closeDownloadMenu();
  clearStatus();
  const warnNode = elements.studioDocumentWarnings;
  if (warnNode) warnNode.textContent = "";
  scheduleSave();
  renderDocumentStudio();
}

// ── Toolbar / markdown insertions ────────────────────────────────────────

function applyToolbarAction(action) {
  const ta = elements.studioDocumentMarkdown;
  if (!ta) return;
  const value = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const atLineStart = start === 0 || before.endsWith("\n");
  const prevLineBlank = before.length === 0 || before.endsWith("\n\n");

  let replacement = selected;
  let cursorOffset = 0;
  let prefixWithBlock = false;

  switch (action) {
    case "h1": replacement = applyLinePrefix(selected || "제목", "# "); break;
    case "h2": replacement = applyLinePrefix(selected || "소제목", "## "); break;
    case "h3": replacement = applyLinePrefix(selected || "소제목", "### "); break;
    case "bold": replacement = `**${selected || "굵게"}**`; cursorOffset = selected ? 0 : -2; break;
    case "italic": replacement = `*${selected || "기울임"}*`; cursorOffset = selected ? 0 : -1; break;
    case "code": replacement = `\`${selected || "code"}\``; cursorOffset = selected ? 0 : -1; break;
    case "ul": replacement = applyLinePrefix(selected || "항목", "- "); break;
    case "ol": replacement = applyNumberedList(selected); break;
    case "check": replacement = applyLinePrefix(selected || "할 일", "- [ ] "); break;
    case "quote": replacement = applyLinePrefix(selected || "인용", "> "); break;
    case "hr":
      replacement = "---\n";
      prefixWithBlock = true;
      break;
    case "link": {
      const url = window.prompt("링크 URL을 입력하세요", "https://");
      if (!url) return;
      replacement = `[${selected || "링크 텍스트"}](${url})`;
      break;
    }
    case "table":
      replacement = "| 항목 | 내용 |\n| --- | --- |\n| 1 | 내용 1 |\n| 2 | 내용 2 |\n";
      prefixWithBlock = true;
      break;
    default: return;
  }

  if (prefixWithBlock && !atLineStart) {
    replacement = `\n\n${replacement}`;
  } else if (prefixWithBlock && atLineStart && !prevLineBlank) {
    replacement = `\n${replacement}`;
  }

  const newValue = before + replacement + after;
  ta.value = newValue;
  const caret = (before + replacement).length + cursorOffset;
  try { ta.setSelectionRange(caret, caret); } catch { /* ignore */ }
  ta.focus();

  const doc = getActiveDraft();
  if (doc) {
    doc.markdown = newValue;
    markDirty(doc);
  }
}

function applyLinePrefix(text, prefix) {
  const lines = (text || "").split("\n");
  return lines.map((line) => (line.startsWith(prefix) ? line : `${prefix}${line}`)).join("\n");
}

function applyNumberedList(text) {
  const lines = (text || "항목").split("\n");
  return lines.map((line, i) => `${i + 1}. ${line.replace(/^\d+\.\s+/, "")}`).join("\n");
}

// ── Export ───────────────────────────────────────────────────────────────

function populateExportMenu() {
  const menu = elements.studioDocumentDownloadMenu;
  if (!menu) return;
  menu.innerHTML = "";
  for (const format of EXPORT_FORMATS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "download-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = format.label;
    item.addEventListener("click", async () => {
      closeDownloadMenu();
      await downloadCurrent(format.id, item);
    });
    menu.append(item);
  }
}

function closeDownloadMenu() {
  const menu = elements.studioDocumentDownloadMenu;
  if (menu) menu.hidden = true;
  elements.studioDocumentDownloadButton?.setAttribute("aria-expanded", "false");
}

async function downloadCurrent(format, trigger) {
  const doc = getActiveDraft();
  if (!doc) return;
  const original = trigger.textContent;
  trigger.disabled = true;
  trigger.textContent = "생성 중…";
  try {
    const response = await fetch("/api/studio/document/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format,
        document: {
          title: doc.title,
          templateId: doc.templateId,
          markdown: doc.markdown,
          citations: doc.citations
        },
        options: {
          includeCitations: doc.exportOptions?.includeCitations !== false,
          includeGeneratedAt: Boolean(doc.exportOptions?.includeGeneratedAt)
        }
      })
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || `status ${response.status}`);
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get("Content-Disposition")) || `${doc.title || "document"}.${format}`;
    triggerDownload(blob, filename);
  } catch (error) {
    window.alert(`문서 내보내기에 실패했습니다. ${error.message}`);
  } finally {
    trigger.disabled = false;
    trigger.textContent = original;
  }
}

function filenameFromDisposition(value) {
  if (!value) return "";
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8Match) {
    try { return decodeURIComponent(utf8Match[1]); } catch { return utf8Match[1]; }
  }
  const asciiMatch = /filename="([^"]+)"/i.exec(value);
  return asciiMatch ? asciiMatch[1] : "";
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── Helpers ──────────────────────────────────────────────────────────────

function getActiveDraft() {
  const room = getActiveRoom();
  if (!room) return null;
  const studio = ensureRoomStudio(room);
  return studio.documents.find((d) => d.id === studio.activeDocumentId) || null;
}

function markDirty(doc) {
  doc.updatedAt = new Date().toISOString();
  scheduleSave();
}

function deriveTitleFromMarkdown(markdown) {
  const heading = markdown.match(/^\s*#{1,6}\s+(.+?)\s*$/m);
  if (heading) return heading[1].slice(0, 160);
  const firstLine = markdown.split("\n").map((l) => l.trim()).find(Boolean);
  return (firstLine || "문서").slice(0, 160);
}

function setStatus(text, isError = false, isLoading = false) {
  const node = elements.studioDocumentStatus;
  if (!node) return;
  if (!text) {
    node.hidden = true;
    node.textContent = "";
    node.classList.remove("is-error", "is-loading");
    return;
  }
  node.hidden = false;
  node.classList.toggle("is-error", Boolean(isError));
  node.classList.toggle("is-loading", Boolean(isLoading) && !isError);
  if (isLoading && !isError) {
    node.innerHTML = `
      <span class="studio-document-status-spinner" aria-hidden="true"></span>
      <span class="studio-document-status-text"></span>
      <span class="studio-document-status-dots" aria-hidden="true"><i></i><i></i><i></i></span>
    `;
    const textNode = node.querySelector(".studio-document-status-text");
    if (textNode) textNode.textContent = String(text).replace(/[…\.]+$/, "");
  } else {
    node.textContent = text;
  }
}

function clearStatus() {
  setStatus("");
}

function renderWarnings(doc) {
  const node = elements.studioDocumentWarnings;
  if (!node) return;
  const warnings = Array.isArray(doc.warnings) ? doc.warnings : [];
  if (!warnings.length) {
    node.textContent = "";
    return;
  }
  const human = warnings.map((w) => {
    if (w && typeof w === "object") return w.message || w.code || "";
    const text = String(w || "");
    if (text.startsWith("fallback_doc")) return ""; // legacy redundant warning
    if (text.startsWith("convert_failed")) return text.replace("convert_failed: ", "변환 오류: ");
    if (text.startsWith("model_fallback")) return text.replace("model_fallback: ", "AI 변환 실패: ");
    return text;
  }).filter(Boolean);
  node.textContent = human.join(" / ");
}
