import { displayFileName as formatDisplayFileName, fileTypeIcon as getFileTypeIcon } from "./fileDisplay.js";
import { state, elements, getActiveRoom, createRoom, showConfirmDialog } from "./modules/state.js";
import { initializeEncryptedStorage, loadAppState, scheduleSave, persistAppState } from "./modules/persistence.js";
import {
  renderCalendar, shiftCalendarMonth, jumpCalendarToToday, setCalendarViewMode,
  openEventDialogForCreate, openEventDialogForEdit, closeEventDialog, submitEventForm,
  deleteCurrentEvent, applyAllDayUiState, setEventColor,
  submitCalendarCommand, hideCalendarCommandResult, startReminderWatcher,
  exportCalendarIcs, importCalendarIcsFile
} from "./modules/calendar.js";
import {
  setBusy, stopGeneration, scrollToBottom, setDeepAnalysisEnabled,
  sendMessage, uploadFiles, confirmAndRemoveUploadedFile,
  appendMessage, renderFollowupSuggestions, extractImageFilesFromPaste,
  createTitleFromPrompt, submitPromptEdit, confirmAndClearRoomDocuments,
  estimateAllRoomsStorageBytes, estimateDocumentBytes, estimateRoomStorageBytes, formatBytes
} from "./modules/chat.js";
import {
  loadNotebooks, loadAdminStatus, restoreAdminTokenSession,
  renderActiveNotebookUi, openNotebookSelector, closeNotebookSelector,
  isAdminDialogOpen, bindAdminEvents
} from "./modules/notebook.js";
import { renderBrand, closeSettings, bindSettingsEvents } from "./modules/settings.js";
import { applyLayoutState, bindLayoutEvents } from "./modules/layout.js";
import { bindStudioEvents, renderStudio } from "./modules/studio.js";

let titleTimer = null;
let dragDepth = 0;

// ===== Boot =====

async function init() {
  await initializeEncryptedStorage();
  await loadAppState();
  ensureRoom();
  bindEvents();
  renderAll();
  startReminderWatcher();
  checkStatus();
  loadNotebooks().catch(() => {});
  loadAdminStatus().catch(() => {});
  restoreAdminTokenSession();
}

init();

// ===== Custom events from sub-modules =====
// Modules avoid importing app.js to prevent circular deps; they signal via events instead.

window.addEventListener("myai:renderrooms", () => { renderRooms(); renderStudio(); });
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
  state.rooms = state.rooms.filter((room) => room.id !== roomId);
  if (!state.rooms.length) state.rooms.push(createRoom());
  if (state.activeRoomId === roomId) state.activeRoomId = state.rooms[0].id;
  scheduleSave();
  renderAll();
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
  }
  for (const content of elements.sidebarContents) {
    content.hidden = content.dataset.viewContent !== view;
  }
  if (elements.calendarArea) elements.calendarArea.hidden = view !== "calendar";
  if (elements.chatArea) elements.chatArea.hidden = view !== "chat";
}

function applyActiveView(view) {
  const next = view === "calendar" ? "calendar" : "chat";
  if (state.activeView === next) return;
  state.activeView = next;
  scheduleSave();
  renderAll();
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
      state.activeRoomId = room.id;
      scheduleSave();
      renderAll();
    });

    const title = document.createElement("span");
    title.className = "room-item-title";
    title.textContent = room.title || "제목 없는 대화";

    const count = document.createElement("span");
    count.className = "room-item-count";
    count.textContent = `${room.messages?.length ?? 0}`;

    const storage = document.createElement("span");
    storage.className = "room-item-storage";
    storage.textContent = formatBytes(estimateRoomStorageBytes(room));

    const fileIcons = document.createElement("span");
    fileIcons.className = "room-file-icons";
    const roomDocs = Array.isArray(room.documents) ? room.documents : [];
    for (const doc of roomDocs.slice(0, 6)) {
      const icon = document.createElement("span");
      icon.className = "room-file-icon";
      icon.title = doc.fileType?.toUpperCase() || "FILE";
      icon.textContent = getFileTypeIcon(doc);
      fileIcons.append(icon);
    }
    if (roomDocs.length > 6) {
      const more = document.createElement("span");
      more.className = "room-file-more";
      more.textContent = `+${roomDocs.length - 6}`;
      fileIcons.append(more);
    }

    const deleteButton = document.createElement("span");
    deleteButton.className = "room-delete";
    deleteButton.title = "대화방 삭제";
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", async (event) => { event.stopPropagation(); await deleteRoom(room.id); });
    item.append(title, storage, fileIcons, count, deleteButton);
    elements.roomList.append(item);

    if (room.id === state.activeRoomId && roomDocs.length) {
      const files = document.createElement("div");
      files.className = "room-file-titles";
      const fileToolbar = document.createElement("div");
      fileToolbar.className = "room-file-toolbar";
      const fileSummary = document.createElement("span");
      fileSummary.className = "room-file-summary";
      const documentBytes = roomDocs.reduce((sum, doc) => sum + estimateDocumentBytes(doc), 0);
      fileSummary.textContent = `첨부 ${roomDocs.length}개 · ${formatBytes(documentBytes)}`;
      const clearButton = document.createElement("button");
      clearButton.className = "room-file-clear";
      clearButton.type = "button";
      clearButton.textContent = "첨부 정리";
      clearButton.addEventListener("click", async (event) => {
        event.stopPropagation();
        await confirmAndClearRoomDocuments(room);
      });
      fileToolbar.append(fileSummary, clearButton);
      files.append(fileToolbar);
      for (const doc of roomDocs) {
        const file = document.createElement("div");
        file.className = "room-file-title";
        const label = document.createElement("span");
        label.className = "room-file-title-text";
        label.textContent = `${getFileTypeIcon(doc)} ${formatDisplayFileName(doc)}`;
        const size = document.createElement("span");
        size.className = "room-file-size";
        size.textContent = formatBytes(estimateDocumentBytes(doc));
        const removeButton = document.createElement("button");
        removeButton.className = "room-file-remove";
        removeButton.type = "button";
        removeButton.title = "자료 삭제";
        removeButton.setAttribute("aria-label", `${formatDisplayFileName(doc)} 삭제`);
        removeButton.textContent = "×";
        removeButton.addEventListener("click", async (event) => {
          event.stopPropagation();
          await confirmAndRemoveUploadedFile(doc);
        });
        file.append(label, size, removeButton);
        files.append(file);
      }
      elements.roomList.append(files);
    }
  }
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
      citations: message.citations
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
}

function closeAttachMenu() {
  elements.attachMenu.hidden = true;
  elements.attachFileButton.setAttribute("aria-expanded", "false");
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
  if (elements.calendarCommandForm) elements.calendarCommandForm.addEventListener("submit", submitCalendarCommand);
  if (elements.calendarCommandResultClose) elements.calendarCommandResultClose.addEventListener("click", hideCalendarCommandResult);
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

  // File input / attach menu
  elements.fileInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files ?? []);
    await uploadFiles(files);
    elements.fileInput.value = "";
    closeAttachMenu();
  });
  elements.attachFileButton.addEventListener("click", (event) => { event.stopPropagation(); toggleAttachMenu(); });
  elements.attachFromDeviceButton.addEventListener("click", (event) => { event.stopPropagation(); elements.fileInput.click(); });

  // Notebook
  if (elements.attachNotebookButton) {
    elements.attachNotebookButton.addEventListener("click", (event) => { event.stopPropagation(); openNotebookSelector(); });
  }
  if (elements.notebookBadge) {
    elements.notebookBadge.addEventListener("click", (event) => { event.preventDefault(); openNotebookSelector(); });
  }
  if (elements.deepAnalysisToggle) {
    elements.deepAnalysisToggle.addEventListener("click", (event) => {
      event.preventDefault();
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

  // Calendar settings menu close on outside click
  document.addEventListener("click", (event) => {
    if (!elements.calendarSettingsMenu || elements.calendarSettingsMenu.hidden) return;
    if (event.target === elements.calendarSettingsButton || elements.calendarSettingsButton?.contains(event.target)) return;
    if (elements.calendarSettingsMenu.contains(event.target)) return;
    closeCalendarSettingsMenu();
  });

  // Drag & drop
  window.addEventListener("dragenter", (event) => {
    if (!hasDraggedFiles(event)) return;
    if (isAdminDialogOpen()) return;
    event.preventDefault();
    dragDepth += 1;
    showDropOverlay();
  });
  window.addEventListener("dragover", (event) => {
    if (!hasDraggedFiles(event)) return;
    if (isAdminDialogOpen()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    showDropOverlay();
  });
  window.addEventListener("dragleave", (event) => {
    if (!hasDraggedFiles(event)) return;
    if (isAdminDialogOpen()) { dragDepth = 0; hideDropOverlay(); return; }
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) hideDropOverlay();
  });
  window.addEventListener("drop", async (event) => {
    if (!hasDraggedFiles(event)) return;
    if (isAdminDialogOpen()) { event.preventDefault(); dragDepth = 0; hideDropOverlay(); return; }
    event.preventDefault();
    dragDepth = 0;
    hideDropOverlay();
    const files = Array.from(event.dataTransfer?.files ?? []);
    await uploadFiles(files);
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
    if (isShiftOnly && (key === "n" || key === "d" || key === "c" || key === "i")) {
      const target = event.target;
      const isTyping = target instanceof HTMLElement
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      const dialogOpen = elements.settingsDialog.open || elements.eventDialog.open;
      if (!isTyping && !dialogOpen) {
        event.preventDefault();
        if (key === "n") {
          if (state.busy) return;
          if (state.activeView === "calendar") openEventDialogForCreate(state.calendar.cursorISO);
          else createNewRoom();
        } else if (key === "d") { applyActiveView("chat"); }
        else if (key === "c") { applyActiveView("calendar"); }
        else if (key === "i") { elements.promptInput.focus(); }
        return;
      }
    }
    if (event.key === "Escape" && !elements.attachMenu.hidden) { closeAttachMenu(); return; }
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
