import { displayFileName as formatDisplayFileName, fileTypeIcon as getFileTypeIcon } from "./fileDisplay.js";
import { state, elements, getActiveRoom, createRoom, showConfirmDialog, documentCacheHeaders } from "./modules/state.js";
import { initializeEncryptedStorage, loadAppState, scheduleSave, persistAppState } from "./modules/persistence.js";
import {
  renderCalendar, shiftCalendarMonth, jumpCalendarToToday, setCalendarViewMode,
  openEventDialogForCreate, openEventDialogForEdit, closeEventDialog, submitEventForm,
  deleteCurrentEvent, applyAllDayUiState, setEventColor,
  startReminderWatcher,
  exportCalendarIcs, importCalendarIcsFile
} from "./modules/calendar.js";
import {
  setBusy, stopGeneration, scrollToBottom, setDeepAnalysisEnabled,
  renderDeepAnalysisToggle,
  sendMessage, uploadFiles, confirmAndRemoveUploadedFile,
  appendMessage, renderFollowupSuggestions, extractImageFilesFromPaste,
  createTitleFromPrompt, submitPromptEdit, confirmAndClearRoomDocuments,
  estimateAllRoomsStorageBytes, formatBytes
} from "./modules/chat.js";
import {
  loadNotebooks, loadAdminStatus, restoreAdminTokenSession, restoreAccessSession,
  renderActiveNotebookUi, openNotebookSelector, closeNotebookSelector,
  findNotebookSummary, isAdminDialogOpen, bindAdminEvents
} from "./modules/notebook.js";
import { renderBrand, closeSettings, bindSettingsEvents } from "./modules/settings.js";
import { renderCustomPromptPicker } from "./modules/customPrompts.js";
import { applyLayoutState, bindLayoutEvents } from "./modules/layout.js";
import { bindStudioEvents, renderStudio } from "./modules/studio.js";
import { initDocTool } from "./modules/docTool.js";

let titleTimer = null;
let dragDepth = 0;

const ROOM_FILE_SVG = {
  paperclip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"></path></svg>',
  notebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"></path><path d="M5 17a3 3 0 0 1 3-3h11"></path></svg>'
};

// ===== Boot =====

async function init() {
  await initializeEncryptedStorage();
  await loadAppState();
  ensureRoom();
  bindEvents();
  renderAll();
  startReminderWatcher();
  checkStatus();
  restoreAccessSession();
  loadNotebooks().catch(() => {});
  loadAdminStatus().catch(() => {});
  restoreAdminTokenSession();
}

init();

// ===== Custom events from sub-modules =====
// Modules avoid importing app.js to prevent circular deps; they signal via events instead.

window.addEventListener("myai:renderrooms", () => { renderRooms(); renderMaterialContext(); renderStudio(); });
window.addEventListener("myai:rendermessages", () => renderMessages());
window.addEventListener("myai:renderall", () => renderAll());
window.addEventListener("myai:closeattachmenu", () => closeAttachMenu());
window.addEventListener("myai:closesettings", () => closeSettings());
window.addEventListener("myai:setview", (event) => {
  applyActiveView(event.detail === "calendar" ? "calendar" : "chat");
});

// ===== Room management =====

function ensureRoom() {
  if (!state.rooms.length) {
    const room = createRoom();
    state.rooms = [room];
    state.activeRoomId = room.id;
    scheduleSave();
    return;
  }
  if (!state.rooms.some((room) => room.id === state.activeRoomId)) {
    state.activeRoomId = state.rooms[0].id;
  }
}

function createNewRoom() {
  const room = createRoom();
  state.rooms.unshift(room);
  state.activeRoomId = room.id;
  scheduleSave();
  renderAll();
  window.dispatchEvent(new CustomEvent("myai:roomchange", { detail: { roomId: room.id } }));
  elements.promptInput.focus();
}

async function deleteRoom(roomId) {
  const confirmed = await showConfirmDialog({
    title: "대화방 삭제",
    body: "이 대화방을 삭제할까요? 대화 내용과 첨부 파일이 모두 삭제됩니다.",
    okText: "삭제",
    cancelText: "취소",
    danger: true
  });
  if (!confirmed) return;
  const room = state.rooms.find((r) => r.id === roomId);
  if (room && Array.isArray(room.documents)) {
    for (const doc of room.documents) {
      if (!doc?.id) continue;
      fetch(`/api/documents/${doc.id}`, {
        method: "DELETE",
        headers: documentCacheHeaders()
      }).catch(() => {});
    }
  }
  const wasActive = state.activeRoomId === roomId;
  state.rooms = state.rooms.filter((room) => room.id !== roomId);
  if (!state.rooms.length) state.rooms.push(createRoom());
  if (wasActive) state.activeRoomId = state.rooms[0].id;
  scheduleSave();
  renderAll();
  if (wasActive) {
    window.dispatchEvent(new CustomEvent("myai:roomchange", { detail: { roomId: state.activeRoomId } }));
  }
}

// ===== Rendering =====

export function renderAll() {
  renderBrand();
  renderPrimaryNav();
  renderRooms();
  renderHeader();
  renderMessages();
  renderCalendar();
  renderActiveNotebookUi();
  renderMaterialContext();
  applyLayoutState();
  renderStudio();
}

function renderPrimaryNav() {
  const view = state.activeView === "calendar" ? "calendar" : "chat";
  if (elements.appShell) elements.appShell.dataset.view = view;
  for (const item of elements.primaryNavItems) {
    const isActive = item.dataset.viewTarget === view;
    item.classList.toggle("active", isActive);
    item.setAttribute("aria-pressed", isActive ? "true" : "false");
    updatePrimaryNavTooltip(item);
  }
  for (const content of elements.sidebarContents) {
    content.hidden = content.dataset.viewContent !== view;
  }
  if (elements.calendarArea) elements.calendarArea.hidden = view !== "calendar";
  if (elements.chatArea) elements.chatArea.hidden = view !== "chat";
}

function updatePrimaryNavTooltip(item) {
  const label = item.dataset.navLabel || item.textContent.trim();
  const shortcutKey = item.dataset.shortcutKey;
  item.title = shortcutKey ? `${label} (shift+${shortcutKey.toUpperCase()})` : label;
}

function applyActiveView(view) {
  const next = view === "calendar" ? "calendar" : "chat";
  if (state.activeView === next) return;
  state.activeView = next;
  scheduleSave();
  renderPrimaryNav();
  if (next === "calendar") renderCalendar();
}

function renderRooms() {
  elements.roomList.innerHTML = "";
  const storageSummary = document.createElement("div");
  storageSummary.className = "room-storage-summary";
  storageSummary.textContent = `브라우저 저장 ${formatBytes(estimateAllRoomsStorageBytes())}`;
  elements.roomList.append(storageSummary);

  for (const room of state.rooms) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = `room-item${room.id === state.activeRoomId ? " active" : ""}`;
    item.addEventListener("click", () => {
      if (state.activeRoomId === room.id) return;
      state.activeRoomId = room.id;
      scheduleSave();
      renderAll();
      window.dispatchEvent(new CustomEvent("myai:roomchange", { detail: { roomId: room.id } }));
    });

    const title = document.createElement("span");
    title.className = "room-item-title";
    title.textContent = room.title || "제목 없는 대화";

    const roomDocs = Array.isArray(room.documents) ? room.documents : [];
    const indicators = document.createElement("span");
    indicators.className = "room-status-indicators";

    const attachmentIndicator = document.createElement("span");
    attachmentIndicator.className = "room-status-indicator room-attachment-indicator";
    attachmentIndicator.title = "첨부 있음";
    attachmentIndicator.setAttribute("role", "img");
    attachmentIndicator.setAttribute("aria-label", "첨부 있음");
    if (roomDocs.length) {
      attachmentIndicator.innerHTML = ROOM_FILE_SVG.paperclip;
      indicators.append(attachmentIndicator);
    }

    const notebookIndicator = document.createElement("span");
    notebookIndicator.className = "room-status-indicator room-notebook-indicator";
    notebookIndicator.title = "프로젝트 있음";
    notebookIndicator.setAttribute("role", "img");
    notebookIndicator.setAttribute("aria-label", "프로젝트 있음");
    if (room.selectedNotebookId) {
      notebookIndicator.innerHTML = ROOM_FILE_SVG.notebook;
      indicators.append(notebookIndicator);
    }
    indicators.hidden = !indicators.childElementCount;

    const deleteButton = document.createElement("span");
    deleteButton.className = "room-delete";
    deleteButton.title = "대화방 삭제";
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", async (event) => { event.stopPropagation(); await deleteRoom(room.id); });
    item.append(title, indicators, deleteButton);
    elements.roomList.append(item);
  }
}

function getActiveMaterials(room = getActiveRoom()) {
  const documents = Array.isArray(room?.documents) ? room.documents : [];
  const notebook = room?.selectedNotebookId ? findNotebookSummary(room.selectedNotebookId) : null;
  return {
    documents,
    notebook,
    hasNotebook: Boolean(room?.selectedNotebookId),
    count: documents.length + (room?.selectedNotebookId ? 1 : 0)
  };
}

function renderMaterialContext() {
  const room = getActiveRoom();
  const { documents, notebook, hasNotebook, count } = getActiveMaterials(room);
  const expanded = Boolean(room?.materialsExpanded && count);

  if (elements.materialToggleButton) {
    elements.materialToggleButton.disabled = count === 0;
    elements.materialToggleButton.classList.toggle("has-materials", count > 0);
    elements.materialToggleButton.classList.toggle("expanded", expanded);
    elements.materialToggleButton.setAttribute("aria-expanded", expanded ? "true" : "false");
    elements.materialToggleButton.setAttribute("aria-label", count ? `자료 ${count}개` : "자료 없음");
    elements.materialToggleButton.title = count ? (expanded ? "자료 접기" : `자료 ${count}개 보기`) : "자료 없음";
  }

  if (elements.materialCountBadge) {
    elements.materialCountBadge.hidden = count === 0;
    elements.materialCountBadge.textContent = `${count}`;
  }

  if (!count) {
    if (room?.materialsExpanded) {
      room.materialsExpanded = false;
      scheduleSave();
    }
    if (elements.materialPanel) elements.materialPanel.hidden = true;
    if (elements.materialSummaryLabel) elements.materialSummaryLabel.textContent = "자료 0개";
    if (elements.materialList) elements.materialList.innerHTML = "";
    if (elements.materialClearButton) elements.materialClearButton.hidden = true;
    if (elements.complianceReviewButton) elements.complianceReviewButton.disabled = true;
    setDeepAnalysisEnabled(false);
    return;
  }

  if (elements.materialPanel) elements.materialPanel.hidden = !expanded;
  if (elements.materialSummaryLabel) elements.materialSummaryLabel.textContent = `자료(${count}개)`;
  if (elements.materialClearButton) elements.materialClearButton.hidden = documents.length === 0;
  if (elements.complianceReviewButton) elements.complianceReviewButton.disabled = count === 0;
  renderMaterialList({ room, documents, notebook, hasNotebook });
  renderDeepAnalysisToggle();
}

function renderMaterialList({ room, documents, notebook, hasNotebook }) {
  if (!elements.materialList) return;
  elements.materialList.innerHTML = "";
  const groups = ensureMaterialGroupState(room);

  if (hasNotebook) {
    elements.materialList.append(buildMaterialTreeGroup({
      key: "notebook",
      title: "프로젝트",
      count: 1,
      collapsed: groups.notebook,
      children: [buildNotebookMaterialItem(notebook)]
    }));
  }

  if (documents.length) {
    elements.materialList.append(buildMaterialTreeGroup({
      key: "attachments",
      title: "첨부",
      count: documents.length,
      collapsed: groups.attachments,
      children: documents.map(buildAttachmentMaterialItem)
    }));
  }
}

function ensureMaterialGroupState(room = getActiveRoom()) {
  if (!room) return { notebook: false, attachments: false };
  if (!room.materialGroups || typeof room.materialGroups !== "object") {
    room.materialGroups = { notebook: false, attachments: false };
  }
  room.materialGroups.notebook = Boolean(room.materialGroups.notebook);
  room.materialGroups.attachments = Boolean(room.materialGroups.attachments);
  return room.materialGroups;
}

function buildMaterialTreeGroup({ key, title, count, collapsed, children }) {
  const group = document.createElement("section");
  group.className = "material-tree-group";
  group.classList.toggle("collapsed", collapsed);

  const header = document.createElement("button");
  header.type = "button";
  header.className = "material-tree-header";
  header.title = collapsed ? `${title} 펼치기` : `${title} 접기`;
  header.setAttribute("aria-expanded", collapsed ? "false" : "true");
  header.addEventListener("click", () => toggleMaterialGroup(key));

  const caret = document.createElement("span");
  caret.className = "material-tree-caret";
  caret.innerHTML = `<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="width:10px;height:10px;transition:transform 0.15s;${collapsed ? "" : "transform:rotate(90deg);"}"><path d="M4 2l4 4-4 4"/></svg>`;
  const label = document.createElement("span");
  label.className = "material-tree-label";
  label.textContent = `${title}(${count})`;
  header.append(caret, label);

  const childList = document.createElement("div");
  childList.className = "material-tree-children";
  childList.hidden = collapsed;
  for (const child of children) childList.append(child);

  group.append(header, childList);
  return group;
}

function buildNotebookMaterialItem(notebook) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "material-tree-item material-tree-item-action";
  item.title = "프로젝트 변경";
  item.addEventListener("click", () => openNotebookSelector());
  const icon = document.createElement("span");
  icon.className = "material-tree-icon";
  icon.innerHTML = ROOM_FILE_SVG.notebook;
  const name = document.createElement("span");
  name.className = "material-tree-name";
  name.textContent = notebook?.name || "프로젝트";
  item.append(icon, name);
  return item;
}

function buildAttachmentMaterialItem(doc) {
  const item = document.createElement("div");
  item.className = "material-tree-item";
  const type = document.createElement("span");
  type.className = "material-tree-type";
  type.textContent = getFileTypeIcon(doc);
  const name = document.createElement("span");
  name.className = "material-tree-name";
  name.textContent = formatDisplayFileName(doc);
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "material-tree-remove";
  removeButton.title = "첨부 삭제";
  removeButton.setAttribute("aria-label", `${formatDisplayFileName(doc)} 삭제`);
  removeButton.textContent = "×";
  removeButton.addEventListener("click", async (event) => {
    event.preventDefault();
    await confirmAndRemoveUploadedFile(doc);
  });
  item.append(type, name, removeButton);
  return item;
}

function toggleMaterialGroup(key) {
  const room = getActiveRoom();
  const groups = ensureMaterialGroupState(room);
  if (!room || !(key in groups)) return;
  groups[key] = !groups[key];
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  renderMaterialContext();
}

function toggleMaterialPanel() {
  const room = getActiveRoom();
  const { count } = getActiveMaterials(room);
  if (!room || !count) return;
  room.materialsExpanded = !room.materialsExpanded;
  if (!room.materialsExpanded) setDeepAnalysisEnabled(false);
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  renderMaterialContext();
}

function prefillComplianceReviewPrompt() {
  const room = getActiveRoom();
  const { count } = getActiveMaterials(room);
  if (!room || !count || !elements.promptInput) return;
  elements.promptInput.value = [
    "현재 자료를 기준으로 법령 적합성 검토를 수행해줘.",
    "내부 근거와 공식 법령 근거를 분리하고, 주요 리스크와 보완 권고를 표로 정리해줘.",
    "최종 법률의견이 아니라 업무 참고용 검토 초안으로 작성해줘."
  ].join(" ");
  elements.promptInput.style.height = "auto";
  elements.promptInput.style.height = `${elements.promptInput.scrollHeight}px`;
  elements.promptInput.focus();
}

function renderHeader() {
  const room = getActiveRoom();
  elements.roomTitleInput.value = room?.title || "";
}

function renderMessages() {
  const room = getActiveRoom();
  elements.messages.innerHTML = "";
  if (!room || !room.messages.length) { appendWelcomeScreen(); return; }
  for (const [index, message] of room.messages.entries()) {
    appendMessage(message.role, message.content, {
      persist: false,
      messageIndex: index,
      suggestions: shouldRenderMessageSuggestions(message) ? message.suggestions : [],
      visualization: message.visualization,
      eventCards: message.eventCards,
      createdAt: message.createdAt,
      citations: message.citations,
      law: message.law,
      compliance: message.compliance
    });
  }
}

function shouldRenderMessageSuggestions(message) {
  if (message?.role !== "assistant") return true;
  return !isNoEvidenceAnswerText(message.content);
}

function isNoEvidenceAnswerText(answer) {
  const text = String(answer || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  return [
    /관련 정보를 찾을 수 없습니다/i,
    /정보를 찾을 수 없습니다/i,
    /찾을 수 없(?:습니다|었)/i,
    /확인(?:할|이) 수 없(?:습니다|었)/i,
    /검색 결과(?:만)?으로는 확인되지 않습니다/i,
    /검색 결과가 없습니다/i,
    /자료가 부족/i,
    /근거가 부족/i,
    /provided context does not contain/i,
    /not found in the provided context/i,
    /no relevant information/i,
    /could not find/i
  ].some((pattern) => pattern.test(text));
}

function appendWelcomeScreen() {
  const welcome = document.createElement("div");
  welcome.className = "welcome-screen";
  const name = document.createElement("div");
  name.className = "welcome-name";
  name.textContent = state.settings.userTitle;
  const prompt = document.createElement("div");
  prompt.className = "welcome-prompt";
  prompt.textContent = "입력을 기다리고 있습니다.";
  const sub = document.createElement("div");
  sub.className = "welcome-sub";
  sub.textContent = `${state.settings.aiName}에게 첫 질문을 입력해 주세요.`;
  welcome.append(name, prompt, sub);
  elements.messages.append(welcome);
}

// ===== Status check =====

async function checkStatus() {
  try {
    const response = await fetch("/api/status");
    const status = await response.json();
    if (!status.ok) throw new Error(status.error || "Ollama 연결 실패");
    elements.modelInput.value = status.defaultModel || "gemma3n:e2b";
    elements.modelHint.textContent = "설정에서 개인화와 테마를 변경할 수 있습니다.";
  } catch (error) {
    elements.modelHint.textContent = `Ollama 연결 오류: ${error.message}`;
  }
}

// ===== Drag & drop =====

function toggleAttachMenu() {
  if (elements.attachMenu.hidden) openAttachMenu();
  else closeAttachMenu();
}

function openAttachMenu() {
  elements.attachMenu.hidden = false;
  elements.attachFileButton.setAttribute("aria-expanded", "true");
  if (elements.customPromptPicker && !elements.customPromptPicker.hidden) {
    closeCustomPromptPicker();
  }
}

function closeAttachMenu() {
  elements.attachMenu.hidden = true;
  elements.attachFileButton.setAttribute("aria-expanded", "false");
}

function toggleCustomPromptPicker() {
  if (!elements.customPromptPicker) return;
  if (elements.customPromptPicker.hidden) openCustomPromptPicker();
  else closeCustomPromptPicker();
}

function openCustomPromptPicker() {
  if (!elements.customPromptPicker) return;
  renderCustomPromptPicker(elements.customPromptPicker, insertPromptToInput);
  elements.customPromptPicker.hidden = false;
  elements.attachCustomPromptButton?.setAttribute("aria-expanded", "true");
  closeAttachMenu();
}

function closeCustomPromptPicker() {
  if (!elements.customPromptPicker) return;
  elements.customPromptPicker.hidden = true;
  elements.attachCustomPromptButton?.setAttribute("aria-expanded", "false");
}

function insertPromptToInput(prompt) {
  const ta = elements.promptInput;
  if (!ta || !prompt) return;
  const text = prompt.content || "";
  const start = ta.selectionStart ?? ta.value.length;
  const end = ta.selectionEnd ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(end);
  ta.value = before + text + after;
  const caret = start + text.length;
  ta.focus();
  try { ta.setSelectionRange(caret, caret); } catch (_) {}
  ta.dispatchEvent(new Event("input", { bubbles: true }));
  closeCustomPromptPicker();
}

function toggleCalendarSettingsMenu() {
  if (!elements.calendarSettingsMenu) return;
  if (elements.calendarSettingsMenu.hidden) openCalendarSettingsMenu();
  else closeCalendarSettingsMenu();
}

function openCalendarSettingsMenu() {
  if (!elements.calendarSettingsMenu) return;
  elements.calendarSettingsMenu.hidden = false;
  elements.calendarSettingsButton?.setAttribute("aria-expanded", "true");
}

function closeCalendarSettingsMenu() {
  if (!elements.calendarSettingsMenu) return;
  elements.calendarSettingsMenu.hidden = true;
  elements.calendarSettingsButton?.setAttribute("aria-expanded", "false");
}

function showDropOverlay() {
  elements.dropOverlay.hidden = false;
  elements.dropOverlay.classList.add("active");
}

function hideDropOverlay() {
  elements.dropOverlay.classList.remove("active");
  elements.dropOverlay.hidden = true;
}

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function isTypingShortcutTarget(target) {
  return target instanceof HTMLElement
    && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
}

function isShortcutDialogOpen() {
  return Boolean(elements.settingsDialog.open || elements.eventDialog.open);
}

function findPrimaryNavShortcutView(key) {
  const navItem = elements.primaryNavItems.find((item) => item.dataset.shortcutKey?.toLowerCase() === key);
  return navItem?.dataset.viewTarget || "";
}

function handleGlobalShortcut(key) {
  if (key === "n") {
    if (!state.busy) {
      if (state.activeView === "calendar") openEventDialogForCreate(state.calendar.cursorISO);
      else createNewRoom();
    }
    return true;
  }

  const viewTarget = findPrimaryNavShortcutView(key);
  if (viewTarget) {
    applyActiveView(viewTarget);
    return true;
  }

  if (key === "i") {
    elements.promptInput.focus();
    return true;
  }

  return false;
}

// ===== Event binding =====

function bindEvents() {
  // Nav
  for (const item of elements.primaryNavItems) {
    item.addEventListener("click", () => applyActiveView(item.dataset.viewTarget));
  }

  // Calendar
  if (elements.newEventButton) elements.newEventButton.addEventListener("click", () => openEventDialogForCreate(state.calendar.cursorISO));
  if (elements.calendarPrevButton) elements.calendarPrevButton.addEventListener("click", () => shiftCalendarMonth(-1));
  if (elements.calendarNextButton) elements.calendarNextButton.addEventListener("click", () => shiftCalendarMonth(1));
  if (elements.calendarTodayButton) elements.calendarTodayButton.addEventListener("click", jumpCalendarToToday);
  for (const option of elements.calendarViewOptions) {
    option.addEventListener("click", () => setCalendarViewMode(option.dataset.calendarView));
  }
  if (elements.eventForm) elements.eventForm.addEventListener("submit", submitEventForm);
  if (elements.closeEventDialogButton) elements.closeEventDialogButton.addEventListener("click", closeEventDialog);
  if (elements.cancelEventButton) elements.cancelEventButton.addEventListener("click", closeEventDialog);
  if (elements.deleteEventButton) elements.deleteEventButton.addEventListener("click", deleteCurrentEvent);
  if (elements.eventAllDayInput) {
    elements.eventAllDayInput.addEventListener("change", () => applyAllDayUiState(elements.eventAllDayInput.checked));
  }
  for (const option of elements.eventColorOptions) {
    option.addEventListener("click", (event) => { event.preventDefault(); setEventColor(option.dataset.color); });
  }
  if (elements.calendarSettingsButton) {
    elements.calendarSettingsButton.addEventListener("click", (event) => { event.stopPropagation(); toggleCalendarSettingsMenu(); });
  }
  if (elements.calendarExportButton) {
    elements.calendarExportButton.addEventListener("click", () => { closeCalendarSettingsMenu(); exportCalendarIcs(); });
  }
  if (elements.calendarImportButton) {
    elements.calendarImportButton.addEventListener("click", () => { closeCalendarSettingsMenu(); elements.calendarImportInput?.click(); });
  }
  if (elements.calendarImportInput) {
    elements.calendarImportInput.addEventListener("change", async (event) => {
      await importCalendarIcsFile(event.target.files?.[0]);
      event.target.value = "";
    });
  }

  // Rooms
  elements.newRoomButton.addEventListener("click", createNewRoom);
  elements.roomTitleInput.addEventListener("input", () => {
    const room = getActiveRoom();
    if (!room) return;
    room.title = elements.roomTitleInput.value.trim() || "제목 없는 대화";
    room.updatedAt = new Date().toISOString();
    renderRooms();
    clearTimeout(titleTimer);
    titleTimer = setTimeout(() => scheduleSave(), 250);
  });

  bindSettingsEvents();
  bindLayoutEvents();
  bindStudioEvents();
  initDocTool();

  // File input / attach menu
  elements.fileInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files ?? []);
    await uploadFiles(files);
    elements.fileInput.value = "";
    closeAttachMenu();
  });
  elements.attachFileButton.addEventListener("click", (event) => { event.stopPropagation(); toggleAttachMenu(); });
  elements.attachFromDeviceButton.addEventListener("click", (event) => { event.stopPropagation(); elements.fileInput.click(); });
  if (elements.materialToggleButton) {
    elements.materialToggleButton.addEventListener("click", (event) => {
      event.preventDefault();
      toggleMaterialPanel();
    });
  }
  if (elements.materialClearButton) {
    elements.materialClearButton.addEventListener("click", async (event) => {
      event.preventDefault();
      await confirmAndClearRoomDocuments();
    });
  }
  if (elements.complianceReviewButton) {
    elements.complianceReviewButton.addEventListener("click", (event) => {
      event.preventDefault();
      prefillComplianceReviewPrompt();
    });
  }

  // Notebook
  if (elements.attachNotebookButton) {
    elements.attachNotebookButton.addEventListener("click", (event) => { event.stopPropagation(); openNotebookSelector(); });
  }
  if (elements.attachCustomPromptButton) {
    elements.attachCustomPromptButton.addEventListener("click", (event) => { event.stopPropagation(); toggleCustomPromptPicker(); });
  }
  if (elements.deepAnalysisToggle) {
    elements.deepAnalysisToggle.addEventListener("click", (event) => {
      event.preventDefault();
      if (elements.deepAnalysisToggle.disabled) return;
      setDeepAnalysisEnabled(!state.deepAnalysisEnabled);
    });
  }
  if (elements.closeNotebookSelectorButton) {
    elements.closeNotebookSelectorButton.addEventListener("click", closeNotebookSelector);
  }
  if (elements.notebookSelectorDialog) {
    elements.notebookSelectorDialog.addEventListener("click", (event) => {
      if (event.target === elements.notebookSelectorDialog) closeNotebookSelector();
    });
  }

  bindAdminEvents({ hideDropOverlay, resetDragDepth: () => { dragDepth = 0; } });

  // Attach menu close on outside click
  document.addEventListener("click", (event) => {
    if (elements.attachMenu.hidden) return;
    if (event.target === elements.attachFileButton || elements.attachMenu.contains(event.target)) return;
    closeAttachMenu();
  });

  // Custom prompt picker close on outside click
  document.addEventListener("click", (event) => {
    if (!elements.customPromptPicker || elements.customPromptPicker.hidden) return;
    if (event.target === elements.attachCustomPromptButton) return;
    if (elements.attachCustomPromptButton?.contains(event.target)) return;
    if (elements.customPromptPicker.contains(event.target)) return;
    closeCustomPromptPicker();
  });

  // Calendar settings menu close on outside click
  document.addEventListener("click", (event) => {
    if (!elements.calendarSettingsMenu || elements.calendarSettingsMenu.hidden) return;
    if (event.target === elements.calendarSettingsButton || elements.calendarSettingsButton?.contains(event.target)) return;
    if (elements.calendarSettingsMenu.contains(event.target)) return;
    closeCalendarSettingsMenu();
  });

  // Drag & drop — scoped to the chat area only
  const dropZone = elements.chatArea;
  if (dropZone) {
    dropZone.addEventListener("dragenter", (event) => {
      if (!hasDraggedFiles(event)) return;
      if (isAdminDialogOpen()) return;
      event.preventDefault();
      dragDepth += 1;
      showDropOverlay();
    });
    dropZone.addEventListener("dragover", (event) => {
      if (!hasDraggedFiles(event)) return;
      if (isAdminDialogOpen()) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    });
    dropZone.addEventListener("dragleave", (event) => {
      if (!hasDraggedFiles(event)) return;
      if (isAdminDialogOpen()) { dragDepth = 0; hideDropOverlay(); return; }
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) hideDropOverlay();
    });
    dropZone.addEventListener("drop", async (event) => {
      if (!hasDraggedFiles(event)) return;
      if (isAdminDialogOpen()) { event.preventDefault(); dragDepth = 0; hideDropOverlay(); return; }
      event.preventDefault();
      dragDepth = 0;
      hideDropOverlay();
      const files = Array.from(event.dataTransfer?.files ?? []);
      await uploadFiles(files);
    });
  }

  // Prevent the browser from navigating to a file dropped outside the chat area
  window.addEventListener("dragover", (event) => {
    if (hasDraggedFiles(event)) event.preventDefault();
  });
  window.addEventListener("drop", (event) => {
    if (hasDraggedFiles(event)) event.preventDefault();
  });

  // Paste images
  elements.promptInput.addEventListener("paste", async (event) => {
    const files = extractImageFilesFromPaste(event);
    if (!files.length) return;
    event.preventDefault();
    await uploadFiles(files);
    elements.promptInput.focus();
  });

  // Prompt input auto-resize
  elements.promptInput.addEventListener("input", () => {
    elements.promptInput.style.height = "auto";
    elements.promptInput.style.height = `${elements.promptInput.scrollHeight}px`;
  });

  // Prompt submit (Enter) / stop (Enter while busy)
  elements.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.chatForm.requestSubmit();
    }
  });

  // Global keyboard shortcuts
  window.addEventListener("keydown", (event) => {
    const isShiftOnly = event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
    const key = event.key.toLowerCase();
    if (isShiftOnly && !isTypingShortcutTarget(event.target) && !isShortcutDialogOpen()) {
      if (handleGlobalShortcut(key)) {
        event.preventDefault();
        return;
      }
    }
    if (event.key === "Escape" && !elements.attachMenu.hidden) { closeAttachMenu(); return; }
    if (event.key === "Escape" && elements.customPromptPicker && !elements.customPromptPicker.hidden) { closeCustomPromptPicker(); return; }
    if (event.key === "Escape" && elements.calendarSettingsMenu && !elements.calendarSettingsMenu.hidden) { closeCalendarSettingsMenu(); return; }
    if (event.key === "Escape" && state.busy) { event.preventDefault(); stopGeneration(); }
  });

  // Chat form submit
  elements.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) { stopGeneration(); return; }
    const prompt = elements.promptInput.value.trim();
    if (!prompt) return;
    elements.promptInput.value = "";
    elements.promptInput.style.height = "auto";
    await sendMessage(prompt);
  });
}
