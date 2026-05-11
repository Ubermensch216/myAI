// Studio Document Editor (single-editor plain-text mode, textarea-backed).
// AI fills the chosen template into one flowing markdown body. The user
// edits that text directly in a plain <textarea> (notepad-style — no
// syntax highlighting) with a small format toolbar that inserts markdown
// fragments. Drafts live in room.studio.documents and persist via the
// room state.

import { state, elements, ensureRoomStudio, getActiveRoom } from "./state.js";
import { scheduleSave } from "./persistence.js";
import { setStudioCollapsed } from "./layout.js";

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
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeDownloadMenu();
  });

  elements.studioDocumentIncludeCitations?.addEventListener("change", () => {
    const doc = getActiveDraft();
    if (!doc) return;
    doc.exportOptions = doc.exportOptions || {};
    doc.exportOptions.includeCitations = Boolean(elements.studioDocumentIncludeCitations.checked);
    scheduleSave();
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

export function renderDocumentStudio() {
  const room = getActiveRoom();
  const studio = room ? ensureRoomStudio(room) : null;
  const doc = studio ? studio.documents.find((d) => d.id === studio.activeDocumentId) : null;

  if (!doc) {
    if (elements.studioDocumentEmpty) elements.studioDocumentEmpty.hidden = false;
    if (elements.studioDocumentEditor) elements.studioDocumentEditor.hidden = true;
    return;
  }
  if (elements.studioDocumentEmpty) elements.studioDocumentEmpty.hidden = true;
  if (elements.studioDocumentEditor) elements.studioDocumentEditor.hidden = false;

  ensureDraftMarkdown(doc);

  if (elements.studioDocumentTitle && elements.studioDocumentTitle.value !== doc.title) {
    elements.studioDocumentTitle.value = doc.title || "";
  }
  setEditorValue(doc.markdown || "");
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
    const option = document.createElement("option");
    option.value = tpl.id;
    option.textContent = tpl.name;
    groupBuiltin.append(option);
  }
  select.append(groupBuiltin);
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
