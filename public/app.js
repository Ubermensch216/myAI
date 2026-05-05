import { displayFileName as formatDisplayFileName, fileTypeIcon as getFileTypeIcon } from "./fileDisplay.js";
import { state, elements, getActiveRoom, createRoom, normalizeColorTheme, DEFAULT_BANNER_SRC, DEFAULT_FAVICON_HREF } from "./modules/state.js";
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
  renderActiveNotebookUi, openNotebookSelector, closeNotebookSelector, selectNotebook,
  openAdminNotebookDialog, closeAdminNotebookDialog, renderAdminDialogState,
  submitAdminToken, adminLogout, showAdminNewNotebookForm, adminCreateNotebook,
  adminDeleteNotebook, uploadAdminDocuments, scheduleAdminDetailSave, commitAdminDetailSave,
  renderAdminDetail, isAdminDialogOpen, resetAdminFileInput, requestAdminFileSelection,
  adminUiState
} from "./modules/notebook.js";

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

window.addEventListener("myai:renderrooms", () => renderRooms());
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

function deleteRoom(roomId) {
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
}

function renderBrand() {
  const appName = state.settings.appName || "Ollama Chatter";
  const banner = state.settings.appBannerDataUrl || DEFAULT_BANNER_SRC;
  state.settings.aiName = appName;
  document.title = appName;
  document.documentElement.dataset.theme = state.settings.theme || "light";
  document.documentElement.dataset.colorTheme = normalizeColorTheme(state.settings.colorTheme);
  renderThemeToggle();
  renderColorThemeToggle();
  elements.appNameText.textContent = appName;
  elements.appBannerImg.src = banner;
  elements.appBannerImg.alt = appName;
  elements.faviconLink.href = DEFAULT_FAVICON_HREF;
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
    deleteButton.addEventListener("click", (event) => { event.stopPropagation(); deleteRoom(room.id); });
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
      suggestions: message.suggestions,
      visualization: message.visualization,
      eventCards: message.eventCards,
      createdAt: message.createdAt,
      citations: message.citations
    });
  }
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

// ===== Settings =====

function openSettings() {
  elements.userTitleInput.value = state.settings.userTitle;
  elements.appNameInput.value = state.settings.appName || "Ollama Chatter";
  renderThemeToggle();
  renderColorThemeToggle();
  elements.customPromptInput.value = state.settings.customPrompt || "";
  renderBannerPreview();
  renderSystemAvatarPreview();
  renderAvatarPreview();
  elements.settingsDialog.showModal();
  elements.appBannerTrigger.focus();
}

function closeSettings() {
  elements.settingsDialog.close();
}

function setTheme(theme) {
  state.settings.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.settings.theme;
  renderThemeToggle();
}

function renderThemeToggle() {
  const theme = state.settings.theme === "dark" ? "dark" : "light";
  for (const option of elements.themeOptions) {
    const selected = option.dataset.themeValue === theme;
    option.classList.toggle("active", selected);
    option.setAttribute("aria-pressed", String(selected));
  }
}

function setColorTheme(colorTheme) {
  state.settings.colorTheme = normalizeColorTheme(colorTheme);
  document.documentElement.dataset.colorTheme = state.settings.colorTheme;
  renderColorThemeToggle();
  scheduleSave();
}

function renderColorThemeToggle() {
  const colorTheme = normalizeColorTheme(state.settings.colorTheme);
  for (const option of elements.colorThemeOptions) {
    const selected = option.dataset.colorThemeValue === colorTheme;
    option.classList.toggle("active", selected);
    option.setAttribute("aria-pressed", String(selected));
  }
}

function renderBannerPreview() {
  const banner = state.settings.appBannerDataUrl || DEFAULT_BANNER_SRC;
  const hasCustom = Boolean(state.settings.appBannerDataUrl);
  elements.appBannerPreview.src = banner;
  elements.appBannerPreview.hidden = false;
  elements.appBannerPicker.dataset.state = hasCustom ? "filled" : "default";
  elements.removeBannerButton.disabled = !hasCustom;
}

function renderAvatarPreview() {
  renderLogoPickerPreview({
    dataUrl: state.settings.userAvatarDataUrl,
    preview: elements.userAvatarPreview,
    picker: elements.userAvatarPicker
  });
}

function renderSystemAvatarPreview() {
  renderLogoPickerPreview({
    dataUrl: state.settings.systemAvatarDataUrl,
    preview: elements.systemAvatarPreview,
    picker: elements.systemAvatarPicker
  });
}

function renderLogoPickerPreview({ dataUrl, preview, picker }) {
  if (dataUrl) {
    preview.src = dataUrl;
    preview.hidden = false;
    picker.dataset.state = "filled";
  } else {
    preview.hidden = true;
    preview.removeAttribute("src");
    picker.dataset.state = "empty";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
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

  // Settings
  elements.settingsButton.addEventListener("click", openSettings);
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.cancelSettingsButton.addEventListener("click", closeSettings);

  const openBannerPicker = () => { if (!state.busy) elements.appBannerInput.click(); };
  const openAvatarPicker = () => { if (!state.busy) elements.userAvatarInput.click(); };
  const openSystemAvatarPicker = () => { if (!state.busy) elements.systemAvatarInput.click(); };

  elements.appBannerTrigger.addEventListener("click", openBannerPicker);
  elements.changeBannerButton.addEventListener("click", openBannerPicker);
  elements.systemAvatarTrigger.addEventListener("click", () => {
    if (elements.systemAvatarPicker.dataset.state === "empty") openSystemAvatarPicker();
  });
  elements.changeSystemAvatarButton.addEventListener("click", openSystemAvatarPicker);
  elements.userAvatarTrigger.addEventListener("click", () => {
    if (elements.userAvatarPicker.dataset.state === "empty") openAvatarPicker();
  });
  elements.changeAvatarButton.addEventListener("click", openAvatarPicker);

  elements.removeBannerButton.addEventListener("click", () => {
    state.settings.appBannerDataUrl = "";
    renderBannerPreview();
  });
  elements.removeSystemAvatarButton.addEventListener("click", () => {
    state.settings.systemAvatarDataUrl = "";
    renderSystemAvatarPreview();
  });
  elements.removeAvatarButton.addEventListener("click", () => {
    state.settings.userAvatarDataUrl = "";
    renderAvatarPreview();
  });

  elements.appBannerInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.settings.appBannerDataUrl = await readFileAsDataUrl(file);
    renderBannerPreview();
    elements.appBannerInput.value = "";
  });
  elements.systemAvatarInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.settings.systemAvatarDataUrl = await readFileAsDataUrl(file);
    renderSystemAvatarPreview();
    elements.systemAvatarInput.value = "";
  });
  elements.userAvatarInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.settings.userAvatarDataUrl = await readFileAsDataUrl(file);
    renderAvatarPreview();
    elements.userAvatarInput.value = "";
  });

  elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.userTitle = elements.userTitleInput.value.trim() || "사용자님";
    state.settings.appName = elements.appNameInput.value.trim() || "Ollama Chatter";
    state.settings.aiName = state.settings.appName || "Ollama Chatter";
    state.settings.customPrompt = elements.customPromptInput.value.trim();
    scheduleSave();
    closeSettings();
    renderAll();
  });

  for (const themeOption of elements.themeOptions) {
    themeOption.addEventListener("click", () => setTheme(themeOption.dataset.themeValue === "dark" ? "dark" : "light"));
  }
  for (const colorOption of elements.colorThemeOptions) {
    colorOption.addEventListener("click", () => setColorTheme(colorOption.dataset.colorThemeValue));
  }

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

  // Admin notebook dialog
  if (elements.openAdminNotebookButton) {
    elements.openAdminNotebookButton.addEventListener("click", openAdminNotebookDialog);
  }
  if (elements.closeAdminNotebookButton) {
    elements.closeAdminNotebookButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeAdminNotebookDialog();
    });
  }
  if (elements.adminNotebookDialog) {
    elements.adminNotebookDialog.addEventListener("click", (event) => {
      if (event.target === elements.adminNotebookDialog) {
        event.preventDefault();
        event.stopPropagation();
        closeAdminNotebookDialog();
      }
    });
    elements.adminNotebookDialog.addEventListener("close", () => {
      resetAdminFileInput();
      adminUiState.selectedId = null;
      dragDepth = 0;
      hideDropOverlay();
    });
  }
  if (elements.adminRecheckButton) {
    elements.adminRecheckButton.addEventListener("click", async () => {
      await loadAdminStatus();
      await renderAdminDialogState();
    });
  }
  if (elements.adminTokenSubmitButton) elements.adminTokenSubmitButton.addEventListener("click", submitAdminToken);
  if (elements.adminTokenInput) {
    elements.adminTokenInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); submitAdminToken(); }
    });
  }
  if (elements.adminTokenToggleButton) {
    elements.adminTokenToggleButton.addEventListener("click", () => {
      const input = elements.adminTokenInput;
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      elements.adminTokenToggleButton.setAttribute("aria-label", input.type === "password" ? "입력값 표시" : "입력값 숨김");
    });
  }
  if (elements.adminLogoutButton) elements.adminLogoutButton.addEventListener("click", adminLogout);
  if (elements.adminNewNotebookButton) elements.adminNewNotebookButton.addEventListener("click", showAdminNewNotebookForm);
  if (elements.adminCancelNewNotebookButton) {
    elements.adminCancelNewNotebookButton.addEventListener("click", () => {
      if (elements.adminNewNotebookForm) elements.adminNewNotebookForm.hidden = true;
      renderAdminDetail();
    });
  }
  if (elements.adminNewNotebookForm) {
    elements.adminNewNotebookForm.addEventListener("submit", (event) => { event.preventDefault(); adminCreateNotebook(); });
  }
  if (elements.adminBackToListButton) {
    elements.adminBackToListButton.addEventListener("click", () => {
      adminUiState.mobileView = "list";
      if (elements.adminWorkspace) {
        elements.adminWorkspace.dataset.mobileView = "list";
        const isMobile = window.matchMedia?.("(max-width: 720px)")?.matches ?? false;
        if (elements.adminBackToListButton) elements.adminBackToListButton.hidden = !isMobile;
      }
    });
  }
  if (elements.adminDetailNameInput) {
    elements.adminDetailNameInput.addEventListener("input", () => scheduleAdminDetailSave());
    elements.adminDetailNameInput.addEventListener("blur", () => commitAdminDetailSave());
  }
  if (elements.adminDetailDescriptionInput) {
    elements.adminDetailDescriptionInput.addEventListener("input", () => scheduleAdminDetailSave());
    elements.adminDetailDescriptionInput.addEventListener("blur", () => commitAdminDetailSave());
  }
  if (elements.adminDeleteNotebookButton) {
    elements.adminDeleteNotebookButton.addEventListener("click", () => {
      const notebook = adminUiState.selectedNotebook;
      if (notebook) adminDeleteNotebook(notebook.id, notebook.name);
    });
  }
  if (elements.adminDropZone) {
    elements.adminDropZone.addEventListener("click", (event) => {
      if (!isAdminDialogOpen() || !adminUiState.selectedId) return;
      event.preventDefault();
      event.stopPropagation();
      requestAdminFileSelection();
    });
    elements.adminDropZone.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!isAdminDialogOpen() || !adminUiState.selectedId) return;
      event.preventDefault();
      event.stopPropagation();
      requestAdminFileSelection();
    });
    elements.adminDropZone.addEventListener("dragover", (event) => {
      if (!isAdminDialogOpen() || !adminUiState.selectedId) return;
      event.preventDefault();
      event.stopPropagation();
      elements.adminDropZone.classList.add("dragover");
    });
    elements.adminDropZone.addEventListener("dragleave", (event) => {
      event.stopPropagation();
      elements.adminDropZone.classList.remove("dragover");
    });
    elements.adminDropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      elements.adminDropZone.classList.remove("dragover");
      dragDepth = 0;
      hideDropOverlay();
      if (!isAdminDialogOpen() || !adminUiState.selectedId) return;
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) uploadAdminDocuments(adminUiState.selectedId, files);
    });
  }
  if (elements.adminFileInput) {
    elements.adminFileInput.addEventListener("click", (event) => event.stopPropagation());
    elements.adminFileInput.addEventListener("change", (event) => {
      const files = Array.from(event.target.files || []);
      const notebookId = adminUiState.selectedId;
      event.target.value = "";
      if (!isAdminDialogOpen() || !notebookId || !files.length) return;
      uploadAdminDocuments(notebookId, files);
    });
  }

  // Admin copy buttons
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains("admin-copy-button")) {
      const text = target.dataset.copy ?? "";
      if (!text) return;
      navigator.clipboard?.writeText(text).then(() => {
        target.classList.add("copied");
        const original = target.textContent;
        target.textContent = "복사됨";
        setTimeout(() => { target.classList.remove("copied"); target.textContent = original; }, 1200);
      }).catch(() => {});
    }
  });

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
