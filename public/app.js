import { renderAssistantAnswer as renderAssistantContent } from "./answerRenderer.js";
import {
  formatVisualizationText,
  renderVisualizationSpec
} from "./visualizationRenderer.js";
import {
  displayFileName as formatDisplayFileName,
  fileTypeIcon as getFileTypeIcon
} from "./fileDisplay.js";

const DB_NAME = "ollama-chatter-secure";
const DB_VERSION = 1;
const APP_STATE_KEY = "app-state";
const KEY_ID = "local-aes-gcm-key";
const DEFAULT_BANNER_SRC = "/default-banner.png";
const DEFAULT_FAVICON_HREF = "/default-icon.svg";
const KOREAN_SHORT_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const state = {
  rooms: [],
  activeRoomId: null,
  activeView: "chat",
  calendar: {
    events: [],
    cursorISO: todayDateISO(),
    viewMode: "month",
    editingEventId: null,
    selectedColor: "accent",
    holidaysByYear: {},
    holidayWarnings: {},
    holidayRequests: new Set(),
    reminderTimer: null
  },
  settings: {
    userTitle: "사용자님",
    aiName: "Ollama Chatter",
    appName: "Ollama Chatter",
    theme: "light",
    colorTheme: "busan",
    appBannerDataUrl: "",
    appLogoDataUrl: "",
    systemAvatarDataUrl: "",
    userAvatarDataUrl: "",
    customPrompt: ""
  },
  busy: false,
  abortController: null,
  db: null,
  cryptoKey: null,
  notebooks: [],
  admin: {
    configured: false,
    token: null,
    authenticated: false
  }
};

function todayDateISO() {
  const now = new Date();
  return formatLocalDate(now);
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeCalendarViewMode(value) {
  return value === "week" || value === "day" ? value : "month";
}

function normalizeCalendarEvent(event) {
  if (!event || typeof event !== "object") return null;
  return {
    ...event,
    reminders: normalizeReminderList(event.reminders),
    notifiedReminders: Array.isArray(event.notifiedReminders) ? event.notifiedReminders : []
  };
}

function normalizeReminderList(value) {
  const rawValues = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  const seen = new Set();
  const reminders = [];
  for (const item of rawValues) {
    const minutes = typeof item === "object" && item
      ? Number(item.minutesBefore ?? item.minutes)
      : Number(item);
    if (!Number.isFinite(minutes)) continue;
    const normalized = Math.max(0, Math.min(60 * 24 * 30, Math.round(minutes)));
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    reminders.push({ minutesBefore: normalized });
  }
  return reminders.sort((left, right) => right.minutesBefore - left.minutesBefore);
}

const elements = {
  modelInput: document.querySelector("#modelInput"),
  modelHint: document.querySelector("#modelHint"),
  fileInput: document.querySelector("#fileInput"),
  attachFileButton: document.querySelector("#attachFileButton"),
  attachMenu: document.querySelector("#attachMenu"),
  attachFromDeviceButton: document.querySelector("#attachFromDeviceButton"),
  dropOverlay: document.querySelector("#dropOverlay"),
  faviconLink: document.querySelector("#faviconLink"),
  appNameText: document.querySelector("#appNameText"),
  appBannerImg: document.querySelector("#appBannerImg"),
  uploadProgress: document.querySelector("#uploadProgress"),
  roomList: document.querySelector("#roomList"),
  newRoomButton: document.querySelector("#newRoomButton"),
  roomTitleInput: document.querySelector("#roomTitleInput"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chatForm"),
  promptInput: document.querySelector("#promptInput"),
  sendButton: document.querySelector("#sendButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  cancelSettingsButton: document.querySelector("#cancelSettingsButton"),
  userTitleInput: document.querySelector("#userTitleInput"),
  appNameInput: document.querySelector("#appNameInput"),
  themeOptions: Array.from(document.querySelectorAll(".theme-option")),
  colorThemeOptions: Array.from(document.querySelectorAll(".color-theme-option")),
  customPromptInput: document.querySelector("#customPromptInput"),
  appBannerInput: document.querySelector("#appBannerInput"),
  appBannerPreview: document.querySelector("#appBannerPreview"),
  appBannerPicker: document.querySelector("#appBannerPicker"),
  appBannerTrigger: document.querySelector("#appBannerTrigger"),
  changeBannerButton: document.querySelector("#changeBannerButton"),
  removeBannerButton: document.querySelector("#removeBannerButton"),
  systemAvatarInput: document.querySelector("#systemAvatarInput"),
  systemAvatarPreview: document.querySelector("#systemAvatarPreview"),
  systemAvatarPicker: document.querySelector("#systemAvatarPicker"),
  systemAvatarTrigger: document.querySelector("#systemAvatarTrigger"),
  changeSystemAvatarButton: document.querySelector("#changeSystemAvatarButton"),
  removeSystemAvatarButton: document.querySelector("#removeSystemAvatarButton"),
  userAvatarInput: document.querySelector("#userAvatarInput"),
  userAvatarPreview: document.querySelector("#userAvatarPreview"),
  userAvatarPicker: document.querySelector("#userAvatarPicker"),
  userAvatarTrigger: document.querySelector("#userAvatarTrigger"),
  changeAvatarButton: document.querySelector("#changeAvatarButton"),
  removeAvatarButton: document.querySelector("#removeAvatarButton"),
  appShell: document.querySelector(".app-shell"),
  primaryNavItems: Array.from(document.querySelectorAll(".primary-nav-item")),
  sidebarContents: Array.from(document.querySelectorAll(".sidebar-content")),
  calendarArea: document.querySelector(".calendar-area"),
  chatArea: document.querySelector(".chat-area"),
  calendarMonthLabel: document.querySelector("#calendarMonthLabel"),
  calendarPrevButton: document.querySelector("#calendarPrevButton"),
  calendarNextButton: document.querySelector("#calendarNextButton"),
  calendarTodayButton: document.querySelector("#calendarTodayButton"),
  calendarViewOptions: Array.from(document.querySelectorAll(".calendar-view-option")),
  calendarGrid: document.querySelector("#calendarGrid"),
  newEventButton: document.querySelector("#newEventButton"),
  upcomingEventsList: document.querySelector("#upcomingEventsList"),
  eventDialog: document.querySelector("#eventDialog"),
  eventForm: document.querySelector("#eventForm"),
  eventDialogTitle: document.querySelector("#eventDialogTitle"),
  closeEventDialogButton: document.querySelector("#closeEventDialogButton"),
  cancelEventButton: document.querySelector("#cancelEventButton"),
  deleteEventButton: document.querySelector("#deleteEventButton"),
  eventTitleInput: document.querySelector("#eventTitleInput"),
  eventAllDayInput: document.querySelector("#eventAllDayInput"),
  eventStartInput: document.querySelector("#eventStartInput"),
  eventEndInput: document.querySelector("#eventEndInput"),
  eventLocationInput: document.querySelector("#eventLocationInput"),
  eventNotesInput: document.querySelector("#eventNotesInput"),
  eventDoneInput: document.querySelector("#eventDoneInput"),
  eventDoneRow: document.querySelector("#eventDoneRow"),
  eventReminderInputs: Array.from(document.querySelectorAll(".event-reminder-input")),
  eventColorOptions: Array.from(document.querySelectorAll(".event-color-option")),
  calendarCommandForm: document.querySelector("#calendarCommandForm"),
  calendarCommandInput: document.querySelector("#calendarCommandInput"),
  calendarCommandSendButton: document.querySelector("#calendarCommandSendButton"),
  calendarCommandResult: document.querySelector("#calendarCommandResult"),
  calendarCommandResultBody: document.querySelector("#calendarCommandResultBody"),
  calendarCommandResultClose: document.querySelector("#calendarCommandResultClose"),
  reminderToastContainer: document.querySelector("#reminderToastContainer"),
  attachNotebookButton: document.querySelector("#attachNotebookButton"),
  notebookBadge: document.querySelector("#notebookBadge"),
  notebookBadgeName: document.querySelector("#notebookBadgeName"),
  notebookSelectorDialog: document.querySelector("#notebookSelectorDialog"),
  closeNotebookSelectorButton: document.querySelector("#closeNotebookSelectorButton"),
  notebookList: document.querySelector("#notebookList"),
  adminNotebookDialog: document.querySelector("#adminNotebookDialog"),
  closeAdminNotebookButton: document.querySelector("#closeAdminNotebookButton"),
  openAdminNotebookButton: document.querySelector("#openAdminNotebookButton"),
  adminDialogSubtitle: document.querySelector("#adminDialogSubtitle"),
  adminUnconfiguredSection: document.querySelector("#adminUnconfiguredSection"),
  adminRecheckButton: document.querySelector("#adminRecheckButton"),
  adminAuthSection: document.querySelector("#adminAuthSection"),
  adminTokenInput: document.querySelector("#adminTokenInput"),
  adminTokenToggleButton: document.querySelector("#adminTokenToggleButton"),
  adminTokenSubmitButton: document.querySelector("#adminTokenSubmitButton"),
  adminTokenError: document.querySelector("#adminTokenError"),
  adminWorkspace: document.querySelector("#adminWorkspace"),
  adminLogoutButton: document.querySelector("#adminLogoutButton"),
  adminNewNotebookButton: document.querySelector("#adminNewNotebookButton"),
  adminNotebookList: document.querySelector("#adminNotebookList"),
  adminBackToListButton: document.querySelector("#adminBackToListButton"),
  adminDetailEmpty: document.querySelector("#adminDetailEmpty"),
  adminNewNotebookForm: document.querySelector("#adminNewNotebookForm"),
  adminNewNotebookName: document.querySelector("#adminNewNotebookName"),
  adminNewNotebookDescription: document.querySelector("#adminNewNotebookDescription"),
  adminCancelNewNotebookButton: document.querySelector("#adminCancelNewNotebookButton"),
  adminCreateNotebookButton: document.querySelector("#adminCreateNotebookButton"),
  adminDetailContent: document.querySelector("#adminDetailContent"),
  adminDetailNameInput: document.querySelector("#adminDetailNameInput"),
  adminDetailDescriptionInput: document.querySelector("#adminDetailDescriptionInput"),
  adminDetailSaveStatus: document.querySelector("#adminDetailSaveStatus"),
  adminDeleteNotebookButton: document.querySelector("#adminDeleteNotebookButton"),
  adminDocsCount: document.querySelector("#adminDocsCount"),
  adminDropZone: document.querySelector("#adminDropZone"),
  adminFileInput: document.querySelector("#adminFileInput"),
  adminUploadProgress: document.querySelector("#adminUploadProgress"),
  adminDocsTableBody: document.querySelector("#adminDocsTableBody"),
  adminDocsEmpty: document.querySelector("#adminDocsEmpty")
};

let saveTimer = null;
let titleTimer = null;
let dragDepth = 0;

init();

async function init() {
  await initializeEncryptedStorage();
  await loadAppState();
  ensureRoom();
  await hydrateStoredDocuments();
  bindEvents();
  renderAll();
  startReminderWatcher();
  checkStatus();
  loadNotebooks().catch(() => {});
  loadAdminStatus().catch(() => {});
  restoreAdminTokenSession();
}

function bindEvents() {
  for (const item of elements.primaryNavItems) {
    item.addEventListener("click", () => setActiveView(item.dataset.viewTarget));
  }

  if (elements.newEventButton) {
    elements.newEventButton.addEventListener("click", () => openEventDialogForCreate(state.calendar.cursorISO));
  }
  if (elements.calendarPrevButton) {
    elements.calendarPrevButton.addEventListener("click", () => shiftCalendarMonth(-1));
  }
  if (elements.calendarNextButton) {
    elements.calendarNextButton.addEventListener("click", () => shiftCalendarMonth(1));
  }
  if (elements.calendarTodayButton) {
    elements.calendarTodayButton.addEventListener("click", jumpCalendarToToday);
  }
  for (const option of elements.calendarViewOptions) {
    option.addEventListener("click", () => setCalendarViewMode(option.dataset.calendarView));
  }
  if (elements.eventForm) {
    elements.eventForm.addEventListener("submit", submitEventForm);
  }
  if (elements.closeEventDialogButton) {
    elements.closeEventDialogButton.addEventListener("click", closeEventDialog);
  }
  if (elements.cancelEventButton) {
    elements.cancelEventButton.addEventListener("click", closeEventDialog);
  }
  if (elements.deleteEventButton) {
    elements.deleteEventButton.addEventListener("click", deleteCurrentEvent);
  }
  if (elements.eventAllDayInput) {
    elements.eventAllDayInput.addEventListener("change", () => {
      applyAllDayUiState(elements.eventAllDayInput.checked);
    });
  }
  for (const option of elements.eventColorOptions) {
    option.addEventListener("click", (event) => {
      event.preventDefault();
      setEventColor(option.dataset.color);
    });
  }

  if (elements.calendarCommandForm) {
    elements.calendarCommandForm.addEventListener("submit", submitCalendarCommand);
  }
  if (elements.calendarCommandResultClose) {
    elements.calendarCommandResultClose.addEventListener("click", hideCalendarCommandResult);
  }

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

  elements.settingsButton.addEventListener("click", openSettings);
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.cancelSettingsButton.addEventListener("click", closeSettings);
  const openBannerPicker = () => {
    if (!state.busy) elements.appBannerInput.click();
  };
  const openAvatarPicker = () => {
    if (!state.busy) elements.userAvatarInput.click();
  };
  const openSystemAvatarPicker = () => {
    if (!state.busy) elements.systemAvatarInput.click();
  };

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
    themeOption.addEventListener("click", () => {
      setTheme(themeOption.dataset.themeValue === "dark" ? "dark" : "light");
    });
  }

  for (const colorOption of elements.colorThemeOptions) {
    colorOption.addEventListener("click", () => {
      setColorTheme(colorOption.dataset.colorThemeValue);
    });
  }

  elements.fileInput.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files ?? []);
    await uploadFiles(files);
    elements.fileInput.value = "";
    closeAttachMenu();
  });

  elements.attachFileButton.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAttachMenu();
  });

  elements.attachFromDeviceButton.addEventListener("click", (event) => {
    event.stopPropagation();
    elements.fileInput.click();
  });

  if (elements.attachNotebookButton) {
    elements.attachNotebookButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openNotebookSelector();
    });
  }
  if (elements.notebookBadge) {
    elements.notebookBadge.addEventListener("click", (event) => {
      event.preventDefault();
      openNotebookSelector();
    });
  }
  if (elements.closeNotebookSelectorButton) {
    elements.closeNotebookSelectorButton.addEventListener("click", closeNotebookSelector);
  }
  if (elements.notebookSelectorDialog) {
    elements.notebookSelectorDialog.addEventListener("click", (event) => {
      // Click on backdrop closes the dialog.
      if (event.target === elements.notebookSelectorDialog) closeNotebookSelector();
    });
  }

  if (elements.openAdminNotebookButton) {
    elements.openAdminNotebookButton.addEventListener("click", openAdminNotebookDialog);
  }
  if (elements.closeAdminNotebookButton) {
    elements.closeAdminNotebookButton.addEventListener("click", closeAdminNotebookDialog);
  }
  if (elements.adminNotebookDialog) {
    elements.adminNotebookDialog.addEventListener("click", (event) => {
      if (event.target === elements.adminNotebookDialog) closeAdminNotebookDialog();
    });
    elements.adminNotebookDialog.addEventListener("close", () => {
      adminUiState.selectedId = null;
    });
  }
  if (elements.adminRecheckButton) {
    elements.adminRecheckButton.addEventListener("click", async () => {
      await loadAdminStatus();
      await renderAdminDialogState();
    });
  }
  if (elements.adminTokenSubmitButton) {
    elements.adminTokenSubmitButton.addEventListener("click", submitAdminToken);
  }
  if (elements.adminTokenInput) {
    elements.adminTokenInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        submitAdminToken();
      }
    });
  }
  if (elements.adminTokenToggleButton) {
    elements.adminTokenToggleButton.addEventListener("click", () => {
      const input = elements.adminTokenInput;
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      elements.adminTokenToggleButton.setAttribute(
        "aria-label",
        input.type === "password" ? "입력값 표시" : "입력값 숨김"
      );
    });
  }
  if (elements.adminLogoutButton) {
    elements.adminLogoutButton.addEventListener("click", adminLogout);
  }
  if (elements.adminNewNotebookButton) {
    elements.adminNewNotebookButton.addEventListener("click", showAdminNewNotebookForm);
  }
  if (elements.adminCancelNewNotebookButton) {
    elements.adminCancelNewNotebookButton.addEventListener("click", () => {
      hideAdminNewNotebookForm();
      renderAdminDetail();
    });
  }
  if (elements.adminNewNotebookForm) {
    elements.adminNewNotebookForm.addEventListener("submit", (event) => {
      event.preventDefault();
      adminCreateNotebook();
    });
  }
  if (elements.adminBackToListButton) {
    elements.adminBackToListButton.addEventListener("click", () => {
      adminUiState.mobileView = "list";
      applyAdminMobileView();
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
    elements.adminDropZone.addEventListener("click", () => {
      if (!adminUiState.selectedId) return;
      elements.adminFileInput?.click();
    });
    elements.adminDropZone.addEventListener("keydown", (event) => {
      if ((event.key === "Enter" || event.key === " ") && adminUiState.selectedId) {
        event.preventDefault();
        elements.adminFileInput?.click();
      }
    });
    elements.adminDropZone.addEventListener("dragover", (event) => {
      if (!adminUiState.selectedId) return;
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
      if (!adminUiState.selectedId) return;
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) uploadAdminDocuments(adminUiState.selectedId, files);
    });
  }
  if (elements.adminFileInput) {
    elements.adminFileInput.addEventListener("change", (event) => {
      const files = Array.from(event.target.files || []);
      const notebookId = adminUiState.selectedId;
      event.target.value = "";
      if (notebookId && files.length) uploadAdminDocuments(notebookId, files);
    });
  }
  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains("admin-copy-button")) {
      const text = target.dataset.copy ?? "";
      if (!text) return;
      navigator.clipboard?.writeText(text).then(() => {
        target.classList.add("copied");
        const original = target.textContent;
        target.textContent = "복사됨";
        setTimeout(() => {
          target.classList.remove("copied");
          target.textContent = original;
        }, 1200);
      }).catch(() => {});
    }
  });

  document.addEventListener("click", (event) => {
    if (elements.attachMenu.hidden) return;
    if (event.target === elements.attachFileButton || elements.attachMenu.contains(event.target)) return;
    closeAttachMenu();
  });

  window.addEventListener("dragenter", handleWindowDragEnter);
  window.addEventListener("dragover", handleWindowDragOver);
  window.addEventListener("dragleave", handleWindowDragLeave);
  window.addEventListener("drop", handleWindowDrop);

  elements.promptInput.addEventListener("paste", async (event) => {
    const files = extractImageFilesFromPaste(event);
    if (!files.length) return;
    event.preventDefault();
    await uploadFiles(files);
    elements.promptInput.focus();
  });

  elements.promptInput.addEventListener("input", () => {
    elements.promptInput.style.height = "auto";
    elements.promptInput.style.height = `${elements.promptInput.scrollHeight}px`;
  });

  elements.promptInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.chatForm.requestSubmit();
    }
  });

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
          if (state.activeView === "calendar") {
            openEventDialogForCreate(state.calendar.cursorISO);
          } else {
            createNewRoom();
          }
        } else if (key === "d") {
          setActiveView("chat");
        } else if (key === "c") {
          setActiveView("calendar");
        } else if (key === "i") {
          elements.promptInput.focus();
        }
        return;
      }
    }

    if (event.key === "Escape" && !elements.attachMenu.hidden) {
      closeAttachMenu();
      return;
    }

    if (event.key === "Escape" && state.busy) {
      event.preventDefault();
      stopGeneration();
    }
  });

  elements.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.busy) {
      stopGeneration();
      return;
    }

    const prompt = elements.promptInput.value.trim();
    if (!prompt) return;
    elements.promptInput.value = "";
    elements.promptInput.style.height = "auto";
    await sendMessage(prompt);
  });
}

function createNewRoom() {
  const room = createRoom();
  state.rooms.unshift(room);
  state.activeRoomId = room.id;
  scheduleSave();
  renderAll();
  elements.promptInput.focus();
}

async function initializeEncryptedStorage() {
  state.db = await openDatabase();
  state.cryptoKey = await getOrCreateCryptoKey();
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("records")) db.createObjectStore("records", { keyPath: "id" });
      if (!db.objectStoreNames.contains("keys")) db.createObjectStore("keys", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getOrCreateCryptoKey() {
  const stored = await getStoreValue("keys", KEY_ID);
  if (stored?.key) return stored.key;

  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
  await putStoreValue("keys", { id: KEY_ID, key, createdAt: new Date().toISOString() });
  return key;
}

async function loadAppState() {
  const stored = await loadEncryptedRecord(APP_STATE_KEY);
  if (!stored) return;

  state.rooms = Array.isArray(stored.rooms) ? stored.rooms : [];
  for (const room of state.rooms) {
    if (typeof room.selectedNotebookId !== "string" && room.selectedNotebookId !== null) {
      room.selectedNotebookId = null;
    } else if (room.selectedNotebookId === undefined) {
      room.selectedNotebookId = null;
    }
  }
  state.activeRoomId = stored.activeRoomId || null;
  state.activeView = stored.activeView === "calendar" ? "calendar" : "chat";
  const storedEvents = Array.isArray(stored.calendar?.events) ? stored.calendar.events : [];
  state.calendar.events = storedEvents.map(normalizeCalendarEvent).filter((event) => event && event.id && event.start);
  state.calendar.cursorISO = stored.calendar?.cursorISO || todayDateISO();
  state.calendar.viewMode = normalizeCalendarViewMode(stored.calendar?.viewMode);
  const appName = stored.settings?.appName || stored.settings?.aiName || "Ollama Chatter";
  state.settings = {
    userTitle: stored.settings?.userTitle || "사용자님",
    aiName: appName,
    appName,
    theme: stored.settings?.theme === "dark" ? "dark" : "light",
    colorTheme: normalizeColorTheme(stored.settings?.colorTheme),
    appBannerDataUrl: stored.settings?.appBannerDataUrl || "",
    appLogoDataUrl: stored.settings?.appLogoDataUrl || "",
    systemAvatarDataUrl: stored.settings?.systemAvatarDataUrl || "",
    userAvatarDataUrl: stored.settings?.userAvatarDataUrl || "",
    customPrompt: stored.settings?.customPrompt || ""
  };
}

async function saveAppState() {
  await saveEncryptedRecord(APP_STATE_KEY, {
    rooms: state.rooms,
    activeRoomId: state.activeRoomId,
    activeView: state.activeView,
    calendar: {
      events: state.calendar.events,
      cursorISO: state.calendar.cursorISO,
      viewMode: state.calendar.viewMode
    },
    settings: state.settings,
    savedAt: new Date().toISOString()
  });
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistAppState(), 100);
}

async function persistAppState() {
  try {
    await saveAppState();
    return true;
  } catch (error) {
    handleLocalSaveError(error);
    return false;
  }
}

function handleLocalSaveError(error) {
  console.error("Encrypted local data could not be saved.", error);
  const message = formatLocalSaveError(error);
  if (elements.uploadProgress) elements.uploadProgress.textContent = message;
  if (elements.modelHint) elements.modelHint.textContent = message;
}

function formatLocalSaveError(error) {
  const text = String(error?.message ?? "");
  const quotaExceeded = error?.name === "QuotaExceededError" || error?.code === 22 || /quota/i.test(text);
  if (quotaExceeded) {
    return "브라우저 저장 공간이 부족해 변경사항을 저장하지 못했습니다. 큰 이미지나 문서를 삭제한 뒤 다시 시도해 주세요.";
  }
  return `브라우저 저장에 실패했습니다: ${text || "알 수 없는 오류"}`;
}

async function saveEncryptedRecord(id, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(value));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, state.cryptoKey, encoded);
  await putStoreValue("records", {
    id,
    iv: arrayBufferToBase64(iv.buffer),
    data: arrayBufferToBase64(cipher),
    updatedAt: new Date().toISOString()
  });
}

async function loadEncryptedRecord(id) {
  const record = await getStoreValue("records", id);
  if (!record) return null;

  try {
    const iv = base64ToUint8Array(record.iv);
    const data = base64ToUint8Array(record.data);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, state.cryptoKey, data);
    return JSON.parse(new TextDecoder().decode(plain));
  } catch (error) {
    console.warn("Encrypted local data could not be read.", error);
    return null;
  }
}

function getStoreValue(storeName, id) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(storeName, "readonly").objectStore(storeName).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function putStoreValue(storeName, value) {
  return new Promise((resolve, reject) => {
    const request = state.db.transaction(storeName, "readwrite").objectStore(storeName).put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

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

function createRoom() {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    title: "새 대화",
    messages: [],
    documents: [],
    pendingCalendarAction: null,
    selectedNotebookId: null,
    createdAt: now,
    updatedAt: now
  };
}

async function hydrateStoredDocuments() {
  let changed = false;

  for (const room of state.rooms) {
    if (!Array.isArray(room.documents)) {
      room.documents = [];
      changed = true;
      continue;
    }

    for (let index = 0; index < room.documents.length; index += 1) {
      const documentItem = room.documents[index];
      if (normalizeStoredDocumentContent(documentItem)) changed = true;
      if (!documentItem?.id || hasPersistentDocumentContent(documentItem)) continue;

      try {
        const response = await fetch(`/api/documents/${documentItem.id}`);
        if (!response.ok) continue;
        const result = await response.json();
        if (result.document) {
          normalizeStoredDocumentContent(result.document);
          room.documents[index] = result.document;
          changed = true;
        }
      } catch {
        // Existing summary metadata is kept; the user can re-upload if the server copy is gone.
      }
    }
  }

  if (changed) await persistAppState();
  return changed;
}

function hasPersistentDocumentContent(documentItem) {
  if (documentItem.kind === "image") return Boolean(documentItem.imageBase64);
  return Boolean(
    documentItem.text ||
    documentItem.pages?.some((page) => page.text) ||
    documentItem.sheets?.some((sheet) => sheet.text)
  );
}

function normalizeStoredDocumentContent(documentItem) {
  if (!documentItem || documentItem.kind !== "document" || documentItem.text) return false;
  const pageText = Array.isArray(documentItem.pages)
    ? documentItem.pages.map((page) => page.text).filter(Boolean).join("\n\n")
    : "";
  const sheetText = Array.isArray(documentItem.sheets)
    ? documentItem.sheets.map((sheet) => sheet.text).filter(Boolean).join("\n\n")
    : "";
  const text = pageText || sheetText;
  if (!text) return false;
  documentItem.text = text;
  documentItem.textLength = text.length;
  documentItem.preview = text.slice(0, 280);
  return true;
}

function getActiveRoom() {
  return state.rooms.find((room) => room.id === state.activeRoomId) ?? null;
}

function renderAll() {
  renderBrand();
  renderPrimaryNav();
  renderRooms();
  renderHeader();
  renderMessages();
  renderCalendar();
  renderActiveNotebookUi();
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

function setActiveView(view) {
  const next = view === "calendar" ? "calendar" : "chat";
  if (state.activeView === next) return;
  state.activeView = next;
  scheduleSave();
  renderAll();
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

function renderRooms() {
  elements.roomList.innerHTML = "";

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

    const fileIcons = document.createElement("span");
    fileIcons.className = "room-file-icons";
    const roomDocuments = Array.isArray(room.documents) ? room.documents : [];
    for (const uploadedFile of roomDocuments.slice(0, 6)) {
      const icon = document.createElement("span");
      icon.className = "room-file-icon";
      icon.title = uploadedFile.fileType?.toUpperCase() || "FILE";
      icon.textContent = getFileTypeIcon(uploadedFile);
      fileIcons.append(icon);
    }
    if (roomDocuments.length > 6) {
      const more = document.createElement("span");
      more.className = "room-file-more";
      more.textContent = `+${roomDocuments.length - 6}`;
      fileIcons.append(more);
    }

    const deleteButton = document.createElement("span");
    deleteButton.className = "room-delete";
    deleteButton.title = "대화방 삭제";
    deleteButton.textContent = "×";
    deleteButton.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteRoom(room.id);
    });

    item.append(title, fileIcons, count, deleteButton);
    elements.roomList.append(item);

    if (room.id === state.activeRoomId && roomDocuments.length) {
      const files = document.createElement("div");
      files.className = "room-file-titles";
      for (const uploadedFile of roomDocuments) {
        const file = document.createElement("div");
        file.className = "room-file-title";
        const label = document.createElement("span");
        label.className = "room-file-title-text";
        label.textContent = `${getFileTypeIcon(uploadedFile)} ${formatDisplayFileName(uploadedFile)}`;

        const removeButton = document.createElement("button");
        removeButton.className = "room-file-remove";
        removeButton.type = "button";
        removeButton.title = "자료 삭제";
        removeButton.setAttribute("aria-label", `${formatDisplayFileName(uploadedFile)} 삭제`);
        removeButton.textContent = "×";
        removeButton.addEventListener("click", async (event) => {
          event.stopPropagation();
          await confirmAndRemoveUploadedFile(uploadedFile);
        });

        file.append(label, removeButton);
        files.append(file);
      }
      elements.roomList.append(files);
    }
  }
}

function deleteRoom(roomId) {
  state.rooms = state.rooms.filter((room) => room.id !== roomId);
  if (!state.rooms.length) state.rooms.push(createRoom());
  if (state.activeRoomId === roomId) state.activeRoomId = state.rooms[0].id;
  scheduleSave();
  renderAll();
}

function renderHeader() {
  const room = getActiveRoom();
  elements.roomTitleInput.value = room?.title || "";
}

function renderMessages() {
  const room = getActiveRoom();
  elements.messages.innerHTML = "";

  if (!room || !room.messages.length) {
    appendWelcomeScreen();
    return;
  }

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

function renderCalendar() {
  if (!elements.calendarGrid) return;
  renderCalendarHeader();
  renderCalendarViewToggle();
  renderCalendarGrid();
  renderUpcomingEvents();
  ensureHolidaysForCalendarRange();
}

function renderCalendarHeader() {
  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  if (elements.calendarMonthLabel) {
    elements.calendarMonthLabel.textContent = formatCalendarRangeLabel(cursor, state.calendar.viewMode);
  }
  const unit = state.calendar.viewMode === "day" ? "일" : state.calendar.viewMode === "week" ? "주" : "달";
  if (elements.calendarPrevButton) {
    elements.calendarPrevButton.title = `이전 ${unit}`;
    elements.calendarPrevButton.setAttribute("aria-label", `이전 ${unit}`);
  }
  if (elements.calendarNextButton) {
    elements.calendarNextButton.title = `다음 ${unit}`;
    elements.calendarNextButton.setAttribute("aria-label", `다음 ${unit}`);
  }
}

function renderCalendarViewToggle() {
  const viewMode = normalizeCalendarViewMode(state.calendar.viewMode);
  for (const option of elements.calendarViewOptions) {
    const isActive = option.dataset.calendarView === viewMode;
    option.classList.toggle("active", isActive);
    option.setAttribute("aria-pressed", isActive ? "true" : "false");
  }
}

function renderCalendarGrid() {
  const grid = elements.calendarGrid;
  if (!grid) return;
  grid.innerHTML = "";
  grid.className = "calendar-grid";
  grid.dataset.viewMode = state.calendar.viewMode;

  if (state.calendar.viewMode === "week") {
    renderWeekCalendarGrid(grid);
    return;
  }
  if (state.calendar.viewMode === "day") {
    renderDayCalendarGrid(grid);
    return;
  }

  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  const year = cursor.getFullYear();
  const month = cursor.getMonth();

  const firstOfMonth = new Date(year, month, 1);
  const startOffset = firstOfMonth.getDay();
  const gridStart = new Date(year, month, 1 - startOffset);
  const todayISO = todayDateISO();

  const eventsByDate = groupEventsByDate(state.calendar.events);

  for (let cellIndex = 0; cellIndex < 42; cellIndex += 1) {
    const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + cellIndex);
    const cellISO = formatLocalDate(cellDate);
    const isOutside = cellDate.getMonth() !== month;
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "calendar-day-cell";
    if (isOutside) cell.classList.add("outside");
    if (cellISO === todayISO) cell.classList.add("today");
    cell.dataset.date = cellISO;
    cell.dataset.weekday = String(cellDate.getDay());
    cell.addEventListener("click", (event) => {
      if (event.target !== cell && event.target.closest(".calendar-event-chip")) return;
      openEventDialogForCreate(cellISO);
    });

    const number = document.createElement("div");
    number.className = "calendar-day-number";
    number.textContent = String(cellDate.getDate());
    cell.append(number);

    appendHolidayBadges(cell, cellISO);

    const eventList = eventsByDate.get(cellISO) ?? [];
    if (eventList.length) {
      const eventsContainer = document.createElement("div");
      eventsContainer.className = "calendar-day-events";
      const visibleCount = Math.min(eventList.length, 3);
      for (let index = 0; index < visibleCount; index += 1) {
        const event = eventList[index];
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "calendar-event-chip";
        if (event.done) chip.classList.add("done");
        chip.dataset.color = event.color || "accent";
        chip.title = formatEventChipTitle(event);
        chip.textContent = formatEventChipLabel(event);
        chip.addEventListener("click", (evt) => {
          evt.stopPropagation();
          openEventDialogForEdit(event.id);
        });
        eventsContainer.append(chip);
      }
      if (eventList.length > visibleCount) {
        const more = document.createElement("div");
        more.className = "calendar-event-more";
        more.textContent = `+${eventList.length - visibleCount}`;
        more.addEventListener("click", (evt) => {
          evt.stopPropagation();
          state.calendar.cursorISO = cellISO;
          setCalendarViewMode("day");
        });
        eventsContainer.append(more);
      }
      cell.append(eventsContainer);
    }

    grid.append(cell);
  }
}

function renderWeekCalendarGrid(grid) {
  grid.classList.add("calendar-grid-week");
  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  const weekStart = startOfWeek(cursor);
  for (let index = 0; index < 7; index += 1) {
    const day = addDays(weekStart, index);
    grid.append(createAgendaDayColumn(day, { compact: false }));
  }
}

function renderDayCalendarGrid(grid) {
  grid.classList.add("calendar-grid-day");
  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  grid.append(createAgendaDayColumn(cursor, { compact: false, fullDay: true }));
}

function createAgendaDayColumn(date, { compact = false, fullDay = false } = {}) {
  const dateISO = formatLocalDate(date);
  const events = getEventsForDate(dateISO);
  const holidays = getHolidaysForDate(dateISO);
  const column = document.createElement("section");
  column.className = fullDay ? "calendar-agenda-day full-day" : "calendar-agenda-day";
  column.dataset.weekday = String(date.getDay());

  const header = document.createElement("button");
  header.type = "button";
  header.className = "calendar-agenda-day-header";
  header.addEventListener("click", () => openEventDialogForCreate(dateISO));

  const dayName = document.createElement("span");
  dayName.className = "calendar-agenda-weekday";
  dayName.textContent = KOREAN_SHORT_WEEKDAYS[date.getDay()];
  const dayNumber = document.createElement("span");
  dayNumber.className = "calendar-agenda-date";
  dayNumber.textContent = `${date.getMonth() + 1}/${date.getDate()}`;
  header.append(dayName, dayNumber);
  column.append(header);

  if (holidays.length) {
    const holidayList = document.createElement("div");
    holidayList.className = "calendar-agenda-holidays";
    for (const holiday of holidays) {
      const badge = document.createElement("span");
      badge.className = "calendar-holiday-badge";
      badge.textContent = holiday.name;
      holidayList.append(badge);
    }
    column.append(holidayList);
  }

  const list = document.createElement("div");
  list.className = "calendar-agenda-event-list";
  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "calendar-agenda-empty";
    empty.textContent = compact ? "일정 없음" : "등록된 일정이 없습니다.";
    list.append(empty);
  } else {
    for (const event of events) {
      list.append(createAgendaEventCard(event));
    }
  }
  column.append(list);
  return column;
}

function createAgendaEventCard(event) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "calendar-agenda-event";
  card.dataset.color = event.color || "accent";
  card.addEventListener("click", () => openEventDialogForEdit(event.id));

  const time = document.createElement("div");
  time.className = "calendar-agenda-event-time";
  time.textContent = formatAgendaEventTime(event);
  const title = document.createElement("div");
  title.className = "calendar-agenda-event-title";
  title.textContent = event.title || "(제목 없음)";
  card.append(time, title);

  if (event.location) {
    const location = document.createElement("div");
    location.className = "calendar-agenda-event-location";
    location.textContent = event.location;
    card.append(location);
  }

  if (normalizeReminderList(event.reminders).length) {
    const reminders = document.createElement("div");
    reminders.className = "calendar-agenda-event-reminders";
    reminders.textContent = normalizeReminderList(event.reminders).map(formatReminderLabel).join(", ");
    card.append(reminders);
  }

  return card;
}

function renderUpcomingEvents() {
  const list = elements.upcomingEventsList;
  if (!list) return;
  list.innerHTML = "";

  const now = new Date();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + 7);
  cutoff.setHours(23, 59, 59, 999);

  const upcoming = state.calendar.events
    .filter((event) => {
      const start = parseEventStart(event);
      if (!start) return false;
      if (start > cutoff) return false;
      if (event.allDay) {
        const endOfDay = new Date(start);
        endOfDay.setHours(23, 59, 59, 999);
        return endOfDay >= now;
      }
      return start >= now;
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  if (!upcoming.length) {
    const empty = document.createElement("div");
    empty.className = "upcoming-event-empty";
    empty.textContent = "7일 이내 예정된 일정이 없습니다.";
    list.append(empty);
    return;
  }

  for (const event of upcoming) {
    const item = document.createElement("div");
    item.className = "upcoming-event-item";
    if (event.done) item.classList.add("done");

    const checkBtn = document.createElement("button");
    checkBtn.type = "button";
    checkBtn.className = "upcoming-check-btn";
    checkBtn.setAttribute("aria-label", event.done ? "완료 취소" : "완료 표시");
    checkBtn.innerHTML = event.done
      ? `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" fill="currentColor" fill-opacity="0.18" stroke="currentColor" stroke-width="1.5"/><path d="M5 8l2.2 2.2L11 5.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      : `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.5"/></svg>`;
    checkBtn.addEventListener("click", () => toggleEventDone(event.id));

    const content = document.createElement("button");
    content.type = "button";
    content.className = "upcoming-event-content";
    content.addEventListener("click", () => openEventDialogForEdit(event.id));

    const title = document.createElement("div");
    title.className = "upcoming-event-title";
    title.textContent = event.title || "(제목 없음)";
    const time = document.createElement("div");
    time.className = "upcoming-event-time";
    time.textContent = formatUpcomingTime(event);
    content.append(title, time);

    const dot = document.createElement("span");
    dot.className = "calendar-event-chip";
    dot.dataset.color = event.color || "accent";
    dot.style.cssText = "width:10px;height:10px;padding:0;border-radius:50%;flex-shrink:0";
    dot.setAttribute("aria-hidden", "true");

    item.append(checkBtn, content, dot);
    list.append(item);
  }
}

async function toggleEventDone(eventId) {
  const event = state.calendar.events.find((e) => e.id === eventId);
  if (!event) return;
  event.done = !event.done;
  renderCalendar();
  scheduleSave();
}

function parseDateISO(value) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function startOfWeek(date) {
  return addDays(date, -date.getDay());
}

function formatCalendarRangeLabel(cursor, viewMode) {
  if (viewMode === "day") {
    return `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월 ${cursor.getDate()}일 (${KOREAN_SHORT_WEEKDAYS[cursor.getDay()]})`;
  }
  if (viewMode === "week") {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    return `${formatShortDate(start)} ~ ${formatShortDate(end)}`;
  }
  return `${cursor.getFullYear()}년 ${cursor.getMonth() + 1}월`;
}

function formatShortDate(date) {
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function groupEventsByDate(events) {
  const eventsByDate = new Map();
  for (const event of events) {
    const startISO = (event.start ?? "").slice(0, 10);
    if (!startISO) continue;
    const endISO = (event.end ?? "").slice(0, 10);
    const spanEnd = endISO && endISO > startISO ? endISO : startISO;

    let current = startISO;
    while (current <= spanEnd) {
      if (!eventsByDate.has(current)) eventsByDate.set(current, []);
      eventsByDate.get(current).push(event);
      if (current === spanEnd) break;
      const [y, m, d] = current.split("-").map(Number);
      current = formatLocalDate(new Date(y, m - 1, d + 1));
    }
  }
  for (const list of eventsByDate.values()) {
    list.sort(compareEventsByStart);
  }
  return eventsByDate;
}

function getEventsForDate(dateISO) {
  return state.calendar.events
    .filter((event) => String(event.start || "").slice(0, 10) === dateISO)
    .sort(compareEventsByStart);
}

function compareEventsByStart(a, b) {
  return String(a.start).localeCompare(String(b.start)) || String(a.title || "").localeCompare(String(b.title || ""));
}

function appendHolidayBadges(container, dateISO) {
  const holidays = getHolidaysForDate(dateISO);
  if (!holidays.length) return;
  container.classList.add("holiday");
  const wrapper = document.createElement("div");
  wrapper.className = "calendar-holiday-list";
  for (const holiday of holidays.slice(0, 2)) {
    const badge = document.createElement("span");
    badge.className = "calendar-holiday-badge";
    badge.textContent = holiday.name;
    wrapper.append(badge);
  }
  container.append(wrapper);
}

function getHolidaysForDate(dateISO) {
  const year = String(dateISO || "").slice(0, 4);
  const holidays = state.calendar.holidaysByYear[year] ?? [];
  return holidays.filter((holiday) => holiday.date === dateISO);
}

function getCalendarVisibleYears() {
  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  if (state.calendar.viewMode === "week") {
    const start = startOfWeek(cursor);
    const end = addDays(start, 6);
    return Array.from(new Set([start.getFullYear(), end.getFullYear()]));
  }
  if (state.calendar.viewMode === "day") return [cursor.getFullYear()];
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(year, month, 1 - firstOfMonth.getDay());
  const gridEnd = addDays(gridStart, 41);
  return Array.from(new Set([gridStart.getFullYear(), year, gridEnd.getFullYear()]));
}

function ensureHolidaysForCalendarRange() {
  for (const year of getCalendarVisibleYears()) {
    loadHolidaysForYear(year);
  }
}

async function loadHolidaysForYear(year) {
  const key = String(year);
  if (state.calendar.holidaysByYear[key] || state.calendar.holidayRequests.has(key)) return;
  state.calendar.holidayRequests.add(key);
  try {
    const response = await fetch(`/api/holidays?year=${encodeURIComponent(key)}`);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "공휴일 정보를 불러오지 못했습니다.");
    state.calendar.holidaysByYear[key] = Array.isArray(result.holidays) ? result.holidays : [];
    if (result.warning) state.calendar.holidayWarnings[key] = result.warning;
  } catch (error) {
    console.warn("Holiday data could not be loaded.", error);
    state.calendar.holidaysByYear[key] = [];
    state.calendar.holidayWarnings[key] = error.message;
  } finally {
    state.calendar.holidayRequests.delete(key);
    renderCalendar();
  }
}

function parseEventStart(event) {
  if (!event?.start) return null;
  const value = event.allDay ? `${String(event.start).slice(0, 10)}T00:00` : event.start;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseEventEnd(event) {
  if (!event?.end) return null;
  const value = event.allDay ? `${String(event.end).slice(0, 10)}T23:59` : event.end;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatEventChipLabel(event) {
  if (event.allDay) return event.title || "(제목 없음)";
  const start = parseEventStart(event);
  if (!start) return event.title || "(제목 없음)";
  const hh = String(start.getHours()).padStart(2, "0");
  const mm = String(start.getMinutes()).padStart(2, "0");
  return `${hh}:${mm} ${event.title || "(제목 없음)"}`;
}

function formatEventChipTitle(event) {
  const lines = [event.title || "(제목 없음)"];
  if (event.allDay) {
    lines.push(`종일 · ${String(event.start).slice(0, 10)}`);
  } else {
    const start = parseEventStart(event);
    const end = parseEventEnd(event);
    if (start && end) {
      lines.push(`${formatDateTime(start)} – ${formatDateTime(end)}`);
    }
  }
  if (event.location) lines.push(`장소: ${event.location}`);
  return lines.join("\n");
}

function formatUpcomingTime(event) {
  const start = parseEventStart(event);
  if (!start) return "";
  const dateLabel = `${start.getMonth() + 1}월 ${start.getDate()}일`;
  if (event.allDay) return `${dateLabel} · 종일`;
  const hh = String(start.getHours()).padStart(2, "0");
  const mm = String(start.getMinutes()).padStart(2, "0");
  return `${dateLabel} ${hh}:${mm}`;
}

function formatDateTime(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d} ${hh}:${mm}`;
}

function shiftCalendarMonth(delta) {
  const cursor = parseDateISO(state.calendar.cursorISO) ?? new Date();
  const next = state.calendar.viewMode === "week"
    ? addDays(cursor, delta * 7)
    : state.calendar.viewMode === "day"
      ? addDays(cursor, delta)
      : new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1);
  state.calendar.cursorISO = formatLocalDate(next);
  scheduleSave();
  renderCalendar();
}

function jumpCalendarToToday() {
  state.calendar.cursorISO = todayDateISO();
  scheduleSave();
  renderCalendar();
}

function setCalendarViewMode(viewMode) {
  const next = normalizeCalendarViewMode(viewMode);
  if (state.calendar.viewMode === next) return;
  state.calendar.viewMode = next;
  scheduleSave();
  renderCalendar();
}

function setEventColor(color) {
  state.calendar.selectedColor = color || "accent";
  for (const option of elements.eventColorOptions) {
    option.classList.toggle("active", option.dataset.color === state.calendar.selectedColor);
  }
}

function setReminderPicker(reminders) {
  const selected = new Set(normalizeReminderList(reminders).map((reminder) => String(reminder.minutesBefore)));
  for (const input of elements.eventReminderInputs) {
    input.checked = selected.has(input.value);
  }
}

function getSelectedReminderList() {
  return normalizeReminderList(
    elements.eventReminderInputs
      .filter((input) => input.checked)
      .map((input) => Number(input.value))
  );
}

function formatReminderLabel(reminder) {
  const minutes = Number(typeof reminder === "object" ? reminder.minutesBefore : reminder);
  if (minutes === 0) return "시작 시";
  if (minutes < 60) return `${minutes}분 전`;
  if (minutes % 10080 === 0) return `${minutes / 10080}주 전`;
  if (minutes % 1440 === 0) return `${minutes / 1440}일 전`;
  if (minutes % 60 === 0) return `${minutes / 60}시간 전`;
  return `${minutes}분 전`;
}

function formatAgendaEventTime(event) {
  if (event.allDay) return "종일";
  const start = parseEventStart(event);
  const end = parseEventEnd(event);
  if (!start) return "";
  const startText = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  if (!end) return startText;
  const endText = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  return `${startText} - ${endText}`;
}

function toLocalInputValue(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${y}-${m}-${d}T${hh}:${mm}`;
}

function applyAllDayUiState(allDay) {
  const startValue = elements.eventStartInput.value;
  const endValue = elements.eventEndInput.value;
  if (allDay) {
    elements.eventStartInput.type = "date";
    elements.eventEndInput.type = "date";
    elements.eventStartInput.value = (startValue || "").slice(0, 10);
    elements.eventEndInput.value = (endValue || "").slice(0, 10);
  } else {
    elements.eventStartInput.type = "datetime-local";
    elements.eventEndInput.type = "datetime-local";
    if (startValue && startValue.length === 10) {
      elements.eventStartInput.value = `${startValue}T09:00`;
    }
    if (endValue && endValue.length === 10) {
      elements.eventEndInput.value = `${endValue}T10:00`;
    }
  }
}

function openEventDialogForCreate(dateISO) {
  state.calendar.editingEventId = null;
  elements.eventDialogTitle.textContent = "새 일정";
  elements.eventForm.reset();
  elements.eventAllDayInput.checked = false;
  elements.eventStartInput.type = "datetime-local";
  elements.eventEndInput.type = "datetime-local";
  const baseDate = parseDateISO(dateISO) ?? new Date();
  const start = new Date(baseDate);
  start.setHours(9, 0, 0, 0);
  const end = new Date(start);
  end.setHours(start.getHours() + 1);
  elements.eventStartInput.value = toLocalInputValue(start);
  elements.eventEndInput.value = toLocalInputValue(end);
  setEventColor("accent");
  setReminderPicker([]);
  elements.deleteEventButton.hidden = true;
  elements.eventDoneRow.hidden = true;
  showEventDialog();
}

function openEventDialogForEdit(eventId) {
  const event = state.calendar.events.find((item) => item.id === eventId);
  if (!event) return;
  state.calendar.editingEventId = event.id;
  elements.eventDialogTitle.textContent = "일정 편집";
  elements.eventForm.reset();
  elements.eventTitleInput.value = event.title || "";
  elements.eventAllDayInput.checked = !!event.allDay;
  if (event.allDay) {
    elements.eventStartInput.type = "date";
    elements.eventEndInput.type = "date";
    elements.eventStartInput.value = String(event.start || "").slice(0, 10);
    elements.eventEndInput.value = String(event.end || event.start || "").slice(0, 10);
  } else {
    elements.eventStartInput.type = "datetime-local";
    elements.eventEndInput.type = "datetime-local";
    elements.eventStartInput.value = String(event.start || "").slice(0, 16);
    elements.eventEndInput.value = String(event.end || event.start || "").slice(0, 16);
  }
  elements.eventLocationInput.value = event.location || "";
  elements.eventNotesInput.value = event.notes || "";
  setReminderPicker(event.reminders);
  setEventColor(event.color || "accent");
  elements.deleteEventButton.hidden = false;
  elements.eventDoneRow.hidden = false;
  elements.eventDoneInput.checked = !!event.done;
  showEventDialog();
}

function showEventDialog() {
  if (typeof elements.eventDialog.showModal === "function") {
    elements.eventDialog.showModal();
  } else {
    elements.eventDialog.setAttribute("open", "");
  }
  setTimeout(() => elements.eventTitleInput.focus(), 0);
}

function closeEventDialog() {
  if (typeof elements.eventDialog.close === "function") {
    elements.eventDialog.close();
  } else {
    elements.eventDialog.removeAttribute("open");
  }
  state.calendar.editingEventId = null;
}

function submitEventForm(formEvent) {
  formEvent.preventDefault();
  const title = elements.eventTitleInput.value.trim();
  if (!title) {
    elements.eventTitleInput.focus();
    return;
  }
  const allDay = elements.eventAllDayInput.checked;
  const startRaw = elements.eventStartInput.value;
  const endRaw = elements.eventEndInput.value;
  if (!startRaw || !endRaw) {
    elements.eventStartInput.focus();
    return;
  }

  const startDate = new Date(allDay ? `${startRaw}T00:00` : startRaw);
  const endDate = new Date(allDay ? `${endRaw}T23:59` : endRaw);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
    elements.eventStartInput.focus();
    return;
  }
  if (endDate < startDate) {
    elements.eventEndInput.focus();
    return;
  }

  const editingId = state.calendar.editingEventId;
  const payload = {
    title,
    allDay,
    start: allDay ? startRaw.slice(0, 10) : startRaw.slice(0, 16),
    end: allDay ? endRaw.slice(0, 10) : endRaw.slice(0, 16),
    location: elements.eventLocationInput.value.trim(),
    notes: elements.eventNotesInput.value.trim(),
    reminders: getSelectedReminderList(),
    color: state.calendar.selectedColor || "accent",
    done: editingId ? elements.eventDoneInput.checked : false
  };

  const conflicts = findConflictingEvents(payload, editingId);
  if (conflicts.length) {
    const proceed = window.confirm(
      `기존 일정과 시간이 겹칩니다:\n${buildConflictWarning(conflicts)}\n\n그래도 저장할까요?`
    );
    if (!proceed) return;
  }

  const nowIso = new Date().toISOString();
  if (editingId) {
    const index = state.calendar.events.findIndex((item) => item.id === editingId);
    if (index >= 0) {
      state.calendar.events[index] = {
        ...state.calendar.events[index],
        ...payload,
        reminders: normalizeReminderList(payload.reminders),
        updatedAt: nowIso
      };
    }
  } else {
    state.calendar.events.push({
      id: crypto.randomUUID(),
      ...payload,
      reminders: normalizeReminderList(payload.reminders),
      notifiedReminders: [],
      createdAt: nowIso,
      updatedAt: nowIso
    });
  }

  state.calendar.cursorISO = String(payload.start).slice(0, 10);
  closeEventDialog();
  maybeRequestNotificationPermission(payload.reminders);
  scheduleSave();
  renderCalendar();
}

function deleteCurrentEvent() {
  const editingId = state.calendar.editingEventId;
  if (!editingId) return;
  if (!window.confirm("이 일정을 삭제할까요?")) return;
  state.calendar.events = state.calendar.events.filter((item) => item.id !== editingId);
  closeEventDialog();
  scheduleSave();
  renderCalendar();
}

function renderEventCardList(events) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-event-list";
  for (const event of events) {
    if (!event) continue;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "message-event-card";
    card.dataset.color = event.color || "accent";
    card.title = "캘린더에서 편집";
    card.addEventListener("click", () => {
      const exists = state.calendar.events.some((item) => item.id === event.id);
      if (!exists) return;
      setActiveView("calendar");
      state.calendar.cursorISO = String(event.start).slice(0, 10);
      renderCalendar();
      openEventDialogForEdit(event.id);
    });

    const title = document.createElement("div");
    title.className = "message-event-title";
    title.textContent = event.title || "(제목 없음)";

    const time = document.createElement("div");
    time.className = "message-event-time";
    time.textContent = formatEventOneLine(event).replace(` · ${event.title || "(제목 없음)"}`, "");

    card.append(title, time);
    if (event.location) {
      const loc = document.createElement("div");
      loc.className = "message-event-location";
      loc.textContent = `📍 ${event.location}`;
      card.append(loc);
    }
    wrapper.append(card);
  }
  return wrapper;
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

async function uploadFiles(files) {
  if (!files.length) return;
  const room = getActiveRoom();
  if (!room) return;
  if (!Array.isArray(room.documents)) room.documents = [];

  for (const file of files) {
    elements.uploadProgress.textContent = `${file.name} 처리 중...`;
    const formData = new FormData();
    formData.append("file", file);

    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "업로드 실패");
      room.documents.push(result.document);
      room.updatedAt = new Date().toISOString();
      const saved = await persistAppState();
      renderRooms();
      if (saved) elements.uploadProgress.textContent = `${file.name} 분석 준비 완료`;
    } catch (error) {
      elements.uploadProgress.textContent = `${file.name}: ${error.message}`;
    }
  }
}

async function confirmAndRemoveUploadedFile(uploadedFile) {
  const fileName = formatDisplayFileName(uploadedFile);
  const confirmed = window.confirm(`"${fileName}" 자료를 현재 대화방에서 삭제할까요?`);
  if (!confirmed) return;
  await removeUploadedFile(uploadedFile);
}

async function removeUploadedFile(uploadedFile) {
  await fetch(`/api/documents/${uploadedFile.id}`, { method: "DELETE" }).catch(() => {});
  const room = getActiveRoom();
  if (!room) return;
  room.documents = getActiveDocuments().filter((itemFile) => itemFile.id !== uploadedFile.id);
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  renderRooms();
}

function handleWindowDragEnter(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  dragDepth += 1;
  showDropOverlay();
}

function handleWindowDragOver(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  showDropOverlay();
}

function handleWindowDragLeave(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) hideDropOverlay();
}

async function handleWindowDrop(event) {
  if (!hasDraggedFiles(event)) return;
  event.preventDefault();
  dragDepth = 0;
  hideDropOverlay();
  const files = Array.from(event.dataTransfer?.files ?? []);
  await uploadFiles(files);
}

function hasDraggedFiles(event) {
  return Array.from(event.dataTransfer?.types ?? []).includes("Files");
}

function showDropOverlay() {
  elements.dropOverlay.hidden = false;
  elements.dropOverlay.classList.add("active");
}

function hideDropOverlay() {
  elements.dropOverlay.classList.remove("active");
  elements.dropOverlay.hidden = true;
}

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

async function sendMessage(prompt) {
  const room = getActiveRoom();
  if (!room) return;

  const userMessage = { role: "user", content: prompt, createdAt: new Date().toISOString() };
  room.messages.push(userMessage);
  room.updatedAt = userMessage.createdAt;
  if (room.title === "새 대화") room.title = createTitleFromPrompt(prompt);
  scheduleSave();

  if (room.messages.length === 1) renderMessages();
  else appendMessage("user", prompt, {
    persist: false,
    messageIndex: room.messages.length - 1,
    createdAt: userMessage.createdAt
  });

  if (room.pendingCalendarAction && isCalendarRejection(prompt)) {
    clearPendingCalendarAction(room);
    await handleCalendarStatusMessage(room, "알겠습니다. 보류 중이던 일정 등록은 취소했습니다.");
    return;
  }

  const shouldTryCalendarIntent = hasCalendarKeyword(prompt)
    || !!room.pendingCalendarAction
    || isCalendarConfirmation(prompt);

  if (shouldTryCalendarIntent) {
    const intentResult = await classifyMessageIntent(prompt, room);
    if (intentResult && intentResult.intent && intentResult.intent !== "chat") {
      if (intentResult.intent === "calendar.propose") {
        await handleCalendarProposal(room, intentResult);
        return;
      }
      await handleCalendarIntent(room, intentResult);
      return;
    }

    if (room.pendingCalendarAction && isCalendarConfirmation(prompt)) {
      await handleCalendarIntent(room, room.pendingCalendarAction);
      return;
    }

    if (hasCalendarKeyword(prompt) && isLikelyCalendarActionPrompt(prompt)) {
      await handleCalendarStatusMessage(
        room,
        "일정 요청으로 보이지만 날짜, 시간, 제목을 확정하지 못했습니다. 실제 캘린더에는 아직 반영하지 않았습니다. 예: “5월 4일 오후 12시에 월클라우드 점심 식사 추가해줘”처럼 다시 말씀해주세요."
      );
      return;
    }
  }

  await requestAssistantResponse(room);
}

const CALENDAR_KEYWORD_PATTERN = /(일정|약속|회의|미팅|캘린더|스케줄|예약|행사|모임|잡아|등록|추가|취소|삭제|지워|빼|없애|옮겨|변경|바꿔|미뤄|미루|보여줘|알려줘|조회|검색|내일|모레|어제|오늘|이번\s*주|다음\s*주|지난\s*주|\d+\s*시|오전|오후)/;
const CALENDAR_CONFIRMATION_PATTERN = /^(응|네|예|그래|좋아|오케이|ㅇㅋ|확인|진행|해줘|추가|등록|잡아|잡아줘|추가해줘|등록해줘)(\b|[,.!?\s]|$)/i;
const CALENDAR_REJECTION_PATTERN = /^(아니|아니요|취소|그만|하지마|하지\s*마|보류|됐어|괜찮아)(\b|[,.!?\s]|$)/i;
const CALENDAR_ACTION_PATTERN = /(잡아|잡을|등록|추가|예약|취소|삭제|지워|빼|없애|옮겨|변경|바꿔|미뤄|미루|조회|검색|보여줘|알려줘)/;

function hasCalendarKeyword(prompt) {
  return CALENDAR_KEYWORD_PATTERN.test(String(prompt || ""));
}

function isCalendarConfirmation(prompt) {
  return CALENDAR_CONFIRMATION_PATTERN.test(String(prompt || "").trim());
}

function isCalendarRejection(prompt) {
  return CALENDAR_REJECTION_PATTERN.test(String(prompt || "").trim());
}

function isLikelyCalendarActionPrompt(prompt) {
  return CALENDAR_ACTION_PATTERN.test(String(prompt || ""));
}

async function classifyMessageIntent(prompt, room = getActiveRoom()) {
  try {
    const response = await fetch("/api/agent/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        model: elements.modelInput.value.trim() || "gemma3n:e2b",
        currentDate: new Date().toISOString(),
        messages: getCalendarIntentMessages(room),
        pendingAction: room?.pendingCalendarAction || null
      })
    });
    if (!response.ok) return { intent: "chat", payload: {} };
    return await response.json();
  } catch {
    return { intent: "chat", payload: {} };
  }
}

function getCalendarIntentMessages(room) {
  if (!room || !Array.isArray(room.messages)) return [];
  return room.messages
    .slice(-8)
    .map(({ role, content }) => ({ role, content }));
}

function clearPendingCalendarAction(room) {
  if (!room?.pendingCalendarAction) return;
  room.pendingCalendarAction = null;
  scheduleSave();
}

async function handleCalendarIntent(room, intentResult) {
  setBusy(true);
  const thinking = appendThinking();
  try {
    const outcome = await executeCalendarIntent(intentResult);

    if (outcome.mutated) {
      scheduleSave();
      renderCalendar();
    }
    if (outcome.mutated && ["calendar.create", "calendar.delete", "calendar.update"].includes(intentResult.intent)) {
      clearPendingCalendarAction(room);
    }

    appendCalendarAssistantMessage(room, outcome.text, { eventCards: outcome.eventCards ?? [] });
  } finally {
    removeThinking(thinking);
    setBusy(false);
    scrollToBottom();
  }
}

async function handleCalendarProposal(room, intentResult) {
  setBusy(true);
  const thinking = appendThinking();
  try {
    const payload = intentResult?.payload || {};
    if (!payload.title || !payload.start) {
      appendCalendarAssistantMessage(
        room,
        "일정 후보를 만들기에는 정보가 부족합니다. 날짜, 시간, 제목을 함께 알려주세요."
      );
      return;
    }

    const pendingAction = {
      intent: "calendar.create",
      payload,
      createdAt: new Date().toISOString()
    };
    room.pendingCalendarAction = pendingAction;
    room.updatedAt = pendingAction.createdAt;
    scheduleSave();

    const conflicts = findConflictingEvents({
      start: payload.start,
      end: payload.end || payload.start,
      allDay: !!payload.allDay
    });
    const text = buildCalendarProposalText(payload, conflicts);
    appendCalendarAssistantMessage(room, text, { eventCards: conflicts.slice(0, 3) });
  } finally {
    removeThinking(thinking);
    setBusy(false);
    scrollToBottom();
  }
}

async function handleCalendarStatusMessage(room, text) {
  setBusy(true);
  const thinking = appendThinking();
  try {
    appendCalendarAssistantMessage(room, text);
  } finally {
    removeThinking(thinking);
    setBusy(false);
    scrollToBottom();
  }
}

function appendCalendarAssistantMessage(room, text, { eventCards = [] } = {}) {
  const createdAt = new Date().toISOString();
  const assistantMessage = {
    role: "assistant",
    content: text,
    createdAt,
    eventCards
  };
  room.messages.push(assistantMessage);
  room.updatedAt = createdAt;
  scheduleSave();
  renderRooms();

  const article = appendMessage("assistant", text, {
    persist: false,
    messageIndex: room.messages.length - 1,
    createdAt,
    eventCards
  });
  setAssistantAnswerTime(article, createdAt);
  return article;
}

function buildCalendarProposalText(payload, conflicts) {
  const summary = formatEventOneLine(payload);
  if (conflicts.length) {
    return [
      `일정 후보를 확인했습니다: ${summary}`,
      "다만 아래 기존 일정과 시간이 겹칩니다.",
      buildConflictWarning(conflicts),
      "그래도 이 일정으로 추가할까요?"
    ].join("\n");
  }
  return `일정 후보를 확인했습니다: ${summary}\n이 일정으로 캘린더에 추가할까요?`;
}

function applyCalendarCreate(payload) {
  if (!payload?.title || !payload?.start) {
    return { text: "일정 정보를 이해하지 못했습니다. 제목과 시간을 다시 알려주세요.", eventCards: [] };
  }
  const nowIso = new Date().toISOString();
  const event = createCalendarEventFromPayload(payload, nowIso);
  state.calendar.events.push(event);
  state.calendar.cursorISO = String(event.start).slice(0, 10);
  maybeRequestNotificationPermission(event.reminders);
  return {
    mutated: true,
    text: `✓ 일정을 추가했습니다: ${formatEventOneLine(event)}`,
    eventCards: [event]
  };
}

function createCalendarEventFromPayload(payload, nowIso = new Date().toISOString()) {
  return {
    id: crypto.randomUUID(),
    title: payload.title,
    allDay: !!payload.allDay,
    start: payload.start,
    end: payload.end || payload.start,
    location: payload.location || "",
    notes: payload.notes || "",
    reminders: normalizeReminderList(payload.reminders),
    notifiedReminders: [],
    color: "accent",
    createdAt: nowIso,
    updatedAt: nowIso
  };
}

function applyCalendarList(payload) {
  const fromISO = payload?.from ? String(payload.from).slice(0, 10) : null;
  const toISO = payload?.to ? String(payload.to).slice(0, 10) : null;
  const query = (payload?.query || "").toLowerCase();

  const matches = state.calendar.events
    .filter((event) => {
      const eventDate = String(event.start).slice(0, 10);
      if (fromISO && eventDate < fromISO) return false;
      if (toISO && eventDate > toISO) return false;
      if (query && !(event.title || "").toLowerCase().includes(query)) return false;
      return true;
    })
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));

  if (!matches.length) {
    const range = fromISO || toISO
      ? `${fromISO || "?"} ~ ${toISO || "?"} 범위`
      : "조건";
    return { text: `해당 ${range}에서 일정을 찾지 못했습니다.`, eventCards: [] };
  }

  const header = `${matches.length}개의 일정을 찾았습니다.`;
  return { text: header, eventCards: matches.slice(0, 20) };
}

function applyCalendarDelete(payload) {
  const matchTitle = (payload?.matchTitle || "").toLowerCase();
  const fromISO = payload?.from ? String(payload.from).slice(0, 10) : null;
  const toISO = payload?.to ? String(payload.to).slice(0, 10) : null;

  if (!matchTitle && !fromISO && !toISO) {
    return { text: "삭제할 일정의 제목 또는 날짜를 알려주세요.", eventCards: [] };
  }

  const candidates = state.calendar.events.filter((event) => {
    if (matchTitle && !(event.title || "").toLowerCase().includes(matchTitle)) return false;
    const eventDate = String(event.start).slice(0, 10);
    if (fromISO && eventDate < fromISO) return false;
    if (toISO && eventDate > toISO) return false;
    return true;
  });

  if (!candidates.length) {
    const desc = matchTitle
      ? `"${payload.matchTitle}"`
      : formatDateRangeLabel(fromISO, toISO);
    return { text: `${desc} 와 일치하는 일정을 찾지 못했습니다.`, eventCards: [] };
  }

  if (!matchTitle) {
    const ids = new Set(candidates.map((event) => event.id));
    state.calendar.events = state.calendar.events.filter((event) => !ids.has(event.id));
    const dateLabel = formatDateRangeLabel(fromISO, toISO);
    return {
      mutated: true,
      text: `✓ ${dateLabel}의 일정 ${candidates.length}건을 삭제했습니다.`,
      eventCards: candidates.slice(0, 10)
    };
  }

  if (candidates.length > 1) {
    return {
      text: `"${payload.matchTitle}" 와 일치하는 일정이 ${candidates.length}건 있습니다. 좀 더 구체적으로 (날짜 등) 알려주세요.`,
      eventCards: candidates.slice(0, 10)
    };
  }

  const target = candidates[0];
  state.calendar.events = state.calendar.events.filter((event) => event.id !== target.id);
  return {
    mutated: true,
    text: `✓ 일정을 삭제했습니다: ${formatEventOneLine(target)}`,
    eventCards: []
  };
}

function formatDateRangeLabel(fromISO, toISO) {
  if (fromISO && toISO && fromISO === toISO) return formatKoreanDate(fromISO);
  if (fromISO && toISO) return `${formatKoreanDate(fromISO)} ~ ${formatKoreanDate(toISO)}`;
  if (fromISO) return `${formatKoreanDate(fromISO)} 이후`;
  if (toISO) return `${formatKoreanDate(toISO)} 이전`;
  return "범위";
}

function formatKoreanDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!m) return String(iso || "");
  return `${Number(m[2])}월 ${Number(m[3])}일`;
}

function applyCalendarUpdate(payload) {
  const matchTitle = (payload?.matchTitle || "").toLowerCase();
  const changes = payload?.changes || {};
  if (!matchTitle) {
    return { text: "수정할 일정의 제목을 알려주세요.", eventCards: [] };
  }
  if (!Object.keys(changes).length) {
    return { text: "어떤 항목을 바꿀지 알려주세요.", eventCards: [] };
  }
  const candidates = state.calendar.events.filter((event) =>
    (event.title || "").toLowerCase().includes(matchTitle)
  );
  if (!candidates.length) {
    return { text: `"${payload.matchTitle}" 와 일치하는 일정을 찾지 못했습니다.`, eventCards: [] };
  }
  if (candidates.length > 1) {
    return {
      text: `"${payload.matchTitle}" 와 일치하는 일정이 ${candidates.length}건 있습니다. 좀 더 구체적으로 알려주세요.`,
      eventCards: candidates.slice(0, 10)
    };
  }
  const target = candidates[0];
  const index = state.calendar.events.findIndex((item) => item.id === target.id);
  const merged = {
    ...target,
    ...changes,
    reminders: changes.reminders !== undefined ? normalizeReminderList(changes.reminders) : target.reminders,
    updatedAt: new Date().toISOString()
  };
  if (changes.location === "") delete merged.location;
  if (changes.notes === "") delete merged.notes;
  state.calendar.events[index] = merged;
  state.calendar.cursorISO = String(merged.start).slice(0, 10);
  maybeRequestNotificationPermission(merged.reminders);
  return {
    mutated: true,
    text: `✓ 일정을 수정했습니다: ${formatEventOneLine(merged)}`,
    eventCards: [merged]
  };
}

function formatEventOneLine(event) {
  const start = parseEventStart(event);
  if (!start) return event.title || "(제목 없음)";
  const dateLabel = `${start.getMonth() + 1}월 ${start.getDate()}일`;
  if (event.allDay) return `${dateLabel} 종일 · ${event.title || "(제목 없음)"}`;
  const hh = String(start.getHours()).padStart(2, "0");
  const mm = String(start.getMinutes()).padStart(2, "0");
  return `${dateLabel} ${hh}:${mm} · ${event.title || "(제목 없음)"}`;
}

function findConflictingEvents({ start, end, allDay }, excludeId) {
  if (!start) return [];
  const newStartMs = (allDay ? new Date(`${String(start).slice(0, 10)}T00:00`) : new Date(start)).getTime();
  const newEndRaw = end || start;
  const newEndMs = (allDay ? new Date(`${String(newEndRaw).slice(0, 10)}T23:59`) : new Date(newEndRaw)).getTime();
  if (Number.isNaN(newStartMs) || Number.isNaN(newEndMs)) return [];

  return state.calendar.events.filter((event) => {
    if (event.id === excludeId) return false;
    const existingStart = parseEventStart(event);
    const existingEnd = parseEventEnd(event) || existingStart;
    if (!existingStart || !existingEnd) return false;
    return existingStart.getTime() < newEndMs && existingEnd.getTime() > newStartMs;
  });
}

function buildConflictWarning(conflicts) {
  return conflicts
    .slice(0, 3)
    .map((event) => `· ${formatEventOneLine(event)}`)
    .join("\n");
}

async function submitCalendarCommand(formEvent) {
  formEvent.preventDefault();
  const prompt = elements.calendarCommandInput.value.trim();
  if (!prompt) return;
  if (state.busy) return;

  setCalendarCommandBusy(true);
  showCalendarCommandResult({ text: "처리 중…", kind: "info", events: [] });
  try {
    const intentResult = hasCalendarKeyword(prompt)
      ? await classifyMessageIntent(prompt)
      : { intent: "chat", payload: {} };

    if (!intentResult || intentResult.intent === "chat") {
      showCalendarCommandResult({
        text: "캘린더와 관련된 요청만 처리할 수 있습니다. 채팅 뷰에서 다시 시도해 주세요.",
        kind: "warning",
        events: []
      });
      return;
    }

    if (intentResult.intent === "calendar.propose") {
      const room = getActiveRoom();
      if (room) {
        room.pendingCalendarAction = {
          intent: "calendar.create",
          payload: intentResult.payload,
          createdAt: new Date().toISOString()
        };
        scheduleSave();
      }
      const conflicts = findConflictingEvents({
        start: intentResult.payload?.start,
        end: intentResult.payload?.end || intentResult.payload?.start,
        allDay: !!intentResult.payload?.allDay
      });
      showCalendarCommandResult({
        text: buildCalendarProposalText(intentResult.payload, conflicts),
        kind: conflicts.length ? "warning" : "info",
        events: conflicts.slice(0, 3)
      });
      elements.calendarCommandInput.value = "";
      return;
    }

    const outcome = await executeCalendarIntent(intentResult);
    if (outcome.mutated) {
      scheduleSave();
      renderCalendar();
    }
    showCalendarCommandResult({
      text: outcome.text,
      kind: outcome.kind || "info",
      events: outcome.eventCards || []
    });
    elements.calendarCommandInput.value = "";
  } finally {
    setCalendarCommandBusy(false);
    elements.calendarCommandInput.focus();
  }
}

async function executeCalendarIntent(intentResult) {
  const { intent, payload } = intentResult;
  if (intent === "calendar.create") return await applyCalendarCreateAsync(payload);
  if (intent === "calendar.list") return applyCalendarList(payload);
  if (intent === "calendar.delete") return applyCalendarDelete(payload);
  if (intent === "calendar.update") return applyCalendarUpdate(payload);
  return { text: "처리할 수 없는 일정 의도입니다.", eventCards: [] };
}

async function applyCalendarCreateAsync(payload) {
  if (!payload?.title || !payload?.start) {
    return { text: "일정 정보를 이해하지 못했습니다. 제목과 시간을 다시 알려주세요.", eventCards: [] };
  }
  if (isDailyRepeatCreatePayload(payload)) {
    return await applyDailyRepeatCalendarCreateAsync(payload);
  }
  const conflicts = findConflictingEvents({
    start: payload.start,
    end: payload.end || payload.start,
    allDay: !!payload.allDay
  });
  if (conflicts.length) {
    const proceed = window.confirm(
      `기존 일정과 시간이 겹칩니다:\n${buildConflictWarning(conflicts)}\n\n그래도 추가할까요?`
    );
    if (!proceed) {
      return {
        text: "기존 일정과 겹쳐 추가하지 않았습니다.",
        kind: "warning",
        eventCards: conflicts.slice(0, 3)
      };
    }
  }
  const result = applyCalendarCreate(payload);
  if (conflicts.length && result.mutated) {
    result.text = `${result.text} (⚠️ 기존 일정과 시간이 겹칩니다)`;
    result.kind = "warning";
  }
  return result;
}

function isDailyRepeatCreatePayload(payload) {
  return payload?.repeat?.frequency === "daily"
    && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.repeat.from || ""))
    && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.repeat.to || ""));
}

async function applyDailyRepeatCalendarCreateAsync(payload) {
  const eventPayloads = expandDailyRepeatPayloads(payload);
  if (!eventPayloads.length) {
    return { text: "반복 등록할 날짜 범위를 이해하지 못했습니다.", eventCards: [] };
  }

  const conflicts = [];
  for (const eventPayload of eventPayloads) {
    conflicts.push(...findConflictingEvents({
      start: eventPayload.start,
      end: eventPayload.end || eventPayload.start,
      allDay: !!eventPayload.allDay
    }));
  }

  if (conflicts.length) {
    const uniqueConflicts = dedupeEvents(conflicts);
    const proceed = window.confirm(
      `반복 등록 중 기존 일정과 겹치는 항목이 ${uniqueConflicts.length}건 있습니다:\n${buildConflictWarning(uniqueConflicts)}\n\n그래도 모두 추가할까요?`
    );
    if (!proceed) {
      return {
        text: "기존 일정과 겹쳐 반복 일정을 추가하지 않았습니다.",
        kind: "warning",
        eventCards: uniqueConflicts.slice(0, 5)
      };
    }
  }

  const nowIso = new Date().toISOString();
  const events = eventPayloads.map((eventPayload) => createCalendarEventFromPayload(eventPayload, nowIso));
  state.calendar.events.push(...events);
  state.calendar.cursorISO = payload.repeat.from;
  maybeRequestNotificationPermission(payload.reminders);

  const rangeLabel = formatDateRangeLabel(payload.repeat.from, payload.repeat.to);
  const result = {
    mutated: true,
    text: `✓ ${rangeLabel}에 ${payload.title} 일정 ${events.length}건을 추가했습니다.`,
    eventCards: events.slice(0, 20)
  };
  if (conflicts.length) {
    result.kind = "warning";
    result.text = `${result.text} (⚠️ 기존 일정과 겹치는 항목이 있습니다)`;
  }
  return result;
}

function expandDailyRepeatPayloads(payload) {
  const from = parseDateISO(payload.repeat?.from);
  const to = parseDateISO(payload.repeat?.to);
  if (!from || !to || from.getTime() > to.getTime()) return [];

  const startDate = parseEventStart(payload);
  const endDate = parseEventEnd(payload) || startDate;
  const durationMs = startDate && endDate
    ? Math.max(0, endDate.getTime() - startDate.getTime())
    : 0;
  const startTime = extractTimePart(payload.start) || "09:00";
  const maxDays = 370;
  const eventPayloads = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());

  while (cursor.getTime() <= to.getTime() && eventPayloads.length < maxDays) {
    const dateISO = formatLocalDate(cursor);
    const start = payload.allDay ? dateISO : `${dateISO}T${startTime}`;
    let end = start;
    if (!payload.allDay) {
      const startAt = new Date(start);
      const endAt = new Date(startAt.getTime() + durationMs);
      end = `${formatLocalDate(endAt)}T${String(endAt.getHours()).padStart(2, "0")}:${String(endAt.getMinutes()).padStart(2, "0")}`;
    }
    eventPayloads.push({
      ...payload,
      repeat: undefined,
      start,
      end
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return eventPayloads;
}

function extractTimePart(value) {
  return /T(\d{2}:\d{2})/.exec(String(value || ""))?.[1] || null;
}

function dedupeEvents(events) {
  const seen = new Set();
  const out = [];
  for (const event of events) {
    if (!event?.id || seen.has(event.id)) continue;
    seen.add(event.id);
    out.push(event);
  }
  return out;
}

function setCalendarCommandBusy(busy) {
  if (!elements.calendarCommandForm) return;
  elements.calendarCommandForm.classList.toggle("busy", !!busy);
  elements.calendarCommandSendButton.textContent = busy ? "처리 중…" : "요청";
}

function showCalendarCommandResult({ text, kind = "info", events = [] }) {
  if (!elements.calendarCommandResult) return;
  const body = elements.calendarCommandResultBody;
  body.innerHTML = "";
  elements.calendarCommandResult.classList.remove("kind-info", "kind-warning", "kind-error");
  elements.calendarCommandResult.classList.add(`kind-${kind}`);

  const textEl = document.createElement("div");
  textEl.className = "calendar-command-result-text";
  textEl.textContent = text;
  body.append(textEl);

  if (Array.isArray(events) && events.length) {
    body.append(renderEventCardList(events));
  }
  elements.calendarCommandResult.hidden = false;
}

function hideCalendarCommandResult() {
  if (!elements.calendarCommandResult) return;
  elements.calendarCommandResult.hidden = true;
  elements.calendarCommandResultBody.innerHTML = "";
}

function startReminderWatcher() {
  if (state.calendar.reminderTimer) return;
  checkDueReminders();
  state.calendar.reminderTimer = window.setInterval(checkDueReminders, 60 * 1000);
}

function checkDueReminders() {
  const now = Date.now();
  let changed = false;
  for (const event of state.calendar.events) {
    const reminders = normalizeReminderList(event.reminders);
    if (!reminders.length) continue;
    const start = getReminderBaseDate(event);
    if (!start) continue;
    if (!Array.isArray(event.notifiedReminders)) event.notifiedReminders = [];

    for (const reminder of reminders) {
      const fireAt = start.getTime() - reminder.minutesBefore * 60 * 1000;
      const key = `${event.start}:${reminder.minutesBefore}`;
      const isDue = fireAt <= now && now - fireAt < 10 * 60 * 1000;
      if (!isDue || event.notifiedReminders.includes(key)) continue;
      event.notifiedReminders.push(key);
      changed = true;
      showReminderNotification(event, reminder);
    }
  }
  if (changed) scheduleSave();
}

function getReminderBaseDate(event) {
  if (!event?.start) return null;
  const value = event.allDay ? `${String(event.start).slice(0, 10)}T09:00` : event.start;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function showReminderNotification(event, reminder) {
  const title = event.title || "일정";
  const body = `${formatReminderLabel(reminder)} · ${formatEventOneLine(event)}`;
  if ("Notification" in window && Notification.permission === "granted") {
    new Notification(title, {
      body,
      icon: DEFAULT_FAVICON_HREF
    });
  }
  showReminderToast(title, body);
}

function showReminderToast(title, body) {
  if (!elements.reminderToastContainer) {
    if (elements.uploadProgress) elements.uploadProgress.textContent = `${title}: ${body}`;
    return;
  }
  const toast = document.createElement("div");
  toast.className = "reminder-toast";
  const titleEl = document.createElement("div");
  titleEl.className = "reminder-toast-title";
  titleEl.textContent = title;
  const bodyEl = document.createElement("div");
  bodyEl.className = "reminder-toast-body";
  bodyEl.textContent = body;
  toast.append(titleEl, bodyEl);
  elements.reminderToastContainer.append(toast);
  window.setTimeout(() => toast.remove(), 10000);
}

function maybeRequestNotificationPermission(reminders) {
  if (!normalizeReminderList(reminders).length) return;
  if (!("Notification" in window)) return;
  if (Notification.permission === "default") {
    const request = Notification.requestPermission();
    if (request?.catch) request.catch(() => {});
  }
}

async function requestAssistantResponse(room) {
  if (await hydrateStoredDocuments()) renderRooms();
  if (shouldRequestVisualizationResponse(room)) {
    await requestVisualizationResponse(room);
    return;
  }

  await requestTextAssistantResponse(room);
}

async function requestTextAssistantResponse(room) {
  setBusy(true);
  state.abortController = new AbortController();
  const thinking = appendThinking();
  advanceThinkingProgress(thinking, Math.max(1, getThinkingStepCount(thinking) - 2));
  let assistant = null;
  let assistantBody = null;
  let answer = "";

  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      signal: state.abortController.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: elements.modelInput.value.trim() || "gemma3n:e2b",
        messages: room.messages.map(({ role, content }) => ({ role, content })),
        documents: getActiveDocuments(),
        personalization: getPersonalizationSettings(),
        notebookId: room.selectedNotebookId || null
      })
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(errorText || "응답 생성 실패");
    }

    const notebookMeta = decodeNotebookMetaHeader(response.headers.get("X-Notebook-Meta"));
    const citations = Array.isArray(notebookMeta?.citations) ? notebookMeta.citations : [];

    const reader = response.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      answer += decoder.decode(value, { stream: true });
      advanceThinkingProgress(thinking, getThinkingStepCount(thinking) - 1);
      if (!assistant) {
        assistant = appendMessage("assistant", "", { persist: false, streaming: true });
        assistantBody = assistant.querySelector(".message-body");
      }
      assistant.dataset.copyText = answer;
      renderAssistantContent(assistantBody, answer);
      scrollToBottom();
    }

    answer += decoder.decode();
    const finalAnswer = ensureAddressedAnswer(answer || "응답이 비어 있습니다.");
    if (!assistant) {
      assistant = appendMessage("assistant", "", { persist: false, streaming: true });
      assistantBody = assistant.querySelector(".message-body");
    }
    assistant.dataset.copyText = finalAnswer;
    renderAssistantContent(assistantBody, finalAnswer);
    assistant.classList.remove("streaming");
    advanceThinkingProgress(thinking, getThinkingStepCount(thinking));
    const assistantMessage = { role: "assistant", content: finalAnswer, createdAt: new Date().toISOString() };
    if (citations.length) {
      assistantMessage.citations = citations;
      assistantMessage.notebook = notebookMeta?.notebook ?? null;
      renderCitationsPanel(assistant, citations);
    }
    setAssistantAnswerTime(assistant, assistantMessage.createdAt);
    room.messages.push(assistantMessage);
    room.updatedAt = new Date().toISOString();
    scheduleSave();
    renderRooms();
    renderFollowupSuggestions(assistant, [], { loading: true });
    attachFollowupSuggestions(room, assistantMessage, assistant).finally(scrollToBottom);
  } catch (error) {
    if (error.name === "AbortError") {
      if (assistant) assistant.classList.remove("streaming");
      return;
    }

    if (!assistant) {
      assistant = appendMessage("assistant", "", { persist: false, streaming: true });
      assistantBody = assistant.querySelector(".message-body");
    }
    const errorText = `[오류] ${error.message}`;
    assistant.dataset.copyText = errorText;
    renderAssistantContent(assistantBody, errorText);
    assistant.classList.remove("streaming");
  } finally {
    removeThinking(thinking);
    state.abortController = null;
    setBusy(false);
    scrollToBottom();
  }
}

async function requestVisualizationResponse(room) {
  setBusy(true);
  state.abortController = new AbortController();
  const thinking = appendThinking();
  advanceThinkingProgress(thinking, Math.max(1, getThinkingStepCount(thinking) - 2));
  let assistant = null;
  let assistantBody = null;

  try {
    const prompt = getLastUserPrompt(room);
    const response = await fetch("/api/visualize", {
      method: "POST",
      signal: state.abortController.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        prompt,
        model: elements.modelInput.value.trim() || "gemma3n:e2b",
        messages: room.messages.map(({ role, content }) => ({ role, content })),
        documents: getActiveDocuments(),
        personalization: getPersonalizationSettings()
      })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "visualization generation failed");
    advanceThinkingProgress(thinking, getThinkingStepCount(thinking) - 1);

    const visualization = result.visualization;
    const finalAnswer = ensureAddressedAnswer(formatVisualizationText(visualization));
    assistant = appendMessage("assistant", finalAnswer, {
      persist: false,
      visualization
    });
    advanceThinkingProgress(thinking, getThinkingStepCount(thinking));

    const assistantMessage = {
      role: "assistant",
      content: finalAnswer,
      visualization,
      createdAt: new Date().toISOString()
    };
    setAssistantAnswerTime(assistant, assistantMessage.createdAt);
    room.messages.push(assistantMessage);
    room.updatedAt = assistantMessage.createdAt;
    scheduleSave();
    renderRooms();
    renderFollowupSuggestions(assistant, [], { loading: true });
    attachFollowupSuggestions(room, assistantMessage, assistant).finally(scrollToBottom);
  } catch (error) {
    if (error.name === "AbortError") {
      if (assistant) assistant.classList.remove("streaming");
      return;
    }

    if (!assistant) {
      assistant = appendMessage("assistant", "", { persist: false, streaming: true });
      assistantBody = assistant.querySelector(".message-body");
    }
    const errorText = `[?ㅻ쪟] ${error.message}`;
    assistant.dataset.copyText = errorText;
    renderAssistantContent(assistantBody, errorText);
    assistant.classList.remove("streaming");
  } finally {
    removeThinking(thinking);
    state.abortController = null;
    setBusy(false);
    scrollToBottom();
  }
}

function createTitleFromPrompt(prompt) {
  return prompt.replace(/\s+/g, " ").slice(0, 28) || "새 대화";
}

function ensureAddressedAnswer(answer) {
  const userTitle = state.settings.userTitle;
  if (!userTitle || answer.startsWith("[오류]")) return answer;
  if (answer.slice(0, 120).includes(userTitle)) return answer;
  return `${userTitle}, ${answer}`;
}

async function attachFollowupSuggestions(room, assistantMessage, assistantArticle) {
  const suggestions = await requestFollowupSuggestions(room).catch((error) => {
    console.warn("Follow-up suggestions could not be generated.", error);
    return buildLocalFollowupSuggestions(room);
  });
  const visibleSuggestions = suggestions.length ? suggestions : buildLocalFollowupSuggestions(room);

  if (!visibleSuggestions.length) {
    assistantArticle.querySelector(".followup-suggestions")?.remove();
    return;
  }

  assistantMessage.suggestions = visibleSuggestions;
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  renderFollowupSuggestions(assistantArticle, visibleSuggestions);
}

async function requestFollowupSuggestions(room) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  const response = await fetch("/api/followups", {
    method: "POST",
    signal: controller.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: elements.modelInput.value.trim() || "gemma3n:e2b",
      messages: room.messages.map(({ role, content }) => ({ role, content })),
      personalization: getPersonalizationSettings()
    })
  }).finally(() => clearTimeout(timeout));

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "follow-up suggestion failed");
  return Array.isArray(result.suggestions) ? result.suggestions.slice(0, 3) : [];
}

function buildLocalFollowupSuggestions(room) {
  const lastUserMessage = [...room.messages].reverse().find((message) => message.role !== "assistant");
  const topic = createFollowupTopic(lastUserMessage?.content);
  return [
    `${topic}을 더 구체적으로 설명해줘`,
    `${topic}에서 꼭 확인해야 할 점은 뭐야?`,
    "다음 단계로 무엇을 확인하면 좋을까?"
  ];
}

function createFollowupTopic(content) {
  const topic = String(content || "")
    .replace(/\s+/g, " ")
    .replace(/[.!?。？！]+$/g, "")
    .trim()
    .slice(0, 42);
  return topic ? `"${topic}"` : "이 내용";
}

function appendMessage(role, text, options = {}) {
  const article = document.createElement("article");
  article.className = `message ${role}`;
  if (options.streaming) article.classList.add("streaming");
  article.dataset.copyText = text;
  if (Number.isInteger(options.messageIndex)) article.dataset.messageIndex = String(options.messageIndex);
  if (options.createdAt) article.dataset.createdAt = options.createdAt;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  const metaLabel = document.createElement("span");
  metaLabel.textContent = role === "user" ? state.settings.userTitle : state.settings.aiName;
  const avatarSrc = role === "user" ? state.settings.userAvatarDataUrl : state.settings.systemAvatarDataUrl;
  if (avatarSrc) {
    const avatar = document.createElement("img");
    avatar.className = "message-meta-avatar";
    avatar.src = avatarSrc;
    avatar.alt = "";
    meta.append(avatar, metaLabel);
  } else {
    meta.append(metaLabel);
  }

  const body = document.createElement("div");
  body.className = "message-body";
  if (role === "assistant") {
    renderAssistantContent(body, text);
    if (options.visualization) {
      body.append(renderVisualizationSpec(options.visualization));
      body.classList.add("has-visualization");
      const visualText = formatVisualizationText(options.visualization);
      if (visualText) {
        article.dataset.copyText = `${text}\n\n${visualText}`;
      }
    }
    if (Array.isArray(options.eventCards) && options.eventCards.length) {
      body.append(renderEventCardList(options.eventCards));
      body.classList.add("has-event-cards");
      const cardText = options.eventCards.map(formatEventOneLine).join("\n");
      const currentText = article.dataset.copyText || text;
      article.dataset.copyText = `${currentText}\n\n${cardText}`;
    }
  } else {
    body.textContent = text;
  }

  article.append(meta, body);
  article.append(createMessageActions(article, role, options.createdAt));
  if (role === "assistant") renderFollowupSuggestions(article, options.suggestions);
  if (role === "assistant" && Array.isArray(options.citations) && options.citations.length) {
    renderCitationsPanel(article, options.citations);
  }
  elements.messages.append(article);
  scrollToBottom();
  return article;
}

function renderFollowupSuggestions(article, suggestions = [], options = {}) {
  article.querySelector(".followup-suggestions")?.remove();
  const items = Array.isArray(suggestions)
    ? suggestions.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 3)
    : [];
  if (!items.length && !options.loading) return;

  const wrapper = document.createElement("div");
  wrapper.className = "followup-suggestions";

  const label = document.createElement("div");
  label.className = "followup-label";
  label.textContent = "이어서 물어볼 만한 질문";
  wrapper.append(label);

  if (options.loading) {
    const status = document.createElement("div");
    status.className = "followup-status";
    status.textContent = "추천 질문을 준비하는 중...";
    wrapper.append(status);
    article.append(wrapper);
    return;
  }

  const list = document.createElement("div");
  list.className = "followup-list";

  for (const question of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "followup-question";
    button.textContent = question;
    button.addEventListener("click", async () => {
      if (state.busy) return;
      elements.promptInput.value = "";
      elements.promptInput.style.height = "auto";
      await sendMessage(question);
    });
    list.append(button);
  }

  wrapper.append(list);
  article.append(wrapper);
}

function createMessageActions(article, role, createdAt = "") {
  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(createCopyButton(article, role));
  if (role === "user") actions.append(createEditButton(article));
  if (role === "assistant" && createdAt) actions.append(createMessageTime(createdAt));
  return actions;
}

function setAssistantAnswerTime(article, createdAt) {
  if (!article || !createdAt) return;
  article.dataset.createdAt = createdAt;
  const actions = article.querySelector(".message-actions");
  if (!actions || actions.querySelector(".message-time")) return;
  actions.append(createMessageTime(createdAt));
}

function createMessageTime(createdAt) {
  const time = document.createElement("time");
  time.className = "message-time";
  time.dateTime = createdAt;
  time.textContent = formatMessageTime(createdAt);
  return time;
}

function formatMessageTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

function createCopyButton(article, role) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action-button copy-answer-button";
  button.title = role === "user" ? "프롬프트 복사" : "답변 복사";
  button.setAttribute("aria-label", role === "user" ? "프롬프트 복사" : "답변 복사");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="9" width="10" height="10" rx="2"></rect>
      <path d="M5 15V7a2 2 0 0 1 2-2h8"></path>
    </svg>
    <span class="copy-feedback">copied</span>
  `;
  button.addEventListener("click", async () => {
    const text = article.dataset.copyText || article.querySelector(".message-body")?.innerText || "";
    await copyTextToClipboard(text);
    button.classList.add("copied");
    setTimeout(() => button.classList.remove("copied"), 900);
  });
  return button;
}

function createEditButton(article) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action-button edit-prompt-button";
  button.title = "프롬프트 수정";
  button.setAttribute("aria-label", "프롬프트 수정");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 20h9"></path>
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"></path>
    </svg>
  `;
  button.addEventListener("click", () => editUserPrompt(article));
  return button;
}

function editUserPrompt(article) {
  const room = getActiveRoom();
  const messageIndex = Number(article.dataset.messageIndex);
  if (!room || !Number.isInteger(messageIndex) || messageIndex < 0) return;

  const message = room.messages[messageIndex];
  if (!message || message.role !== "user") return;

  article.classList.add("editing");
  article.dataset.originalText = message.content;
  const body = article.querySelector(".message-body");
  const actions = article.querySelector(".message-actions");
  if (!body || !actions) return;

  body.innerHTML = "";
  const textarea = document.createElement("textarea");
  textarea.className = "prompt-edit-input";
  textarea.value = message.content;
  textarea.rows = Math.max(2, Math.min(8, message.content.split(/\r?\n/).length));
  textarea.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      cancelPromptEdit(article);
      return;
    }

    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submitPromptEdit(article, textarea.value);
    }
  });

  body.append(textarea);
  actions.innerHTML = "";
  actions.append(createCancelEditButton(article));
  actions.append(createConfirmEditButton(article, textarea));
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
}

function createCancelEditButton(article) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action-button cancel-edit-button";
  button.title = "수정 취소";
  button.setAttribute("aria-label", "수정 취소");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M18 6 6 18"></path>
      <path d="m6 6 12 12"></path>
    </svg>
  `;
  button.addEventListener("click", () => cancelPromptEdit(article));
  return button;
}

function createConfirmEditButton(article, textarea) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action-button confirm-edit-button";
  button.title = "수정 완료";
  button.setAttribute("aria-label", "수정 완료");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 10 4 15l5 5"></path>
      <path d="M20 4v7a4 4 0 0 1-4 4H4"></path>
    </svg>
  `;
  button.addEventListener("click", () => submitPromptEdit(article, textarea.value));
  return button;
}

function cancelPromptEdit(article) {
  const originalText = article.dataset.originalText || article.dataset.copyText || "";
  const body = article.querySelector(".message-body");
  const actions = article.querySelector(".message-actions");
  if (!body || !actions) return;

  article.classList.remove("editing");
  article.dataset.copyText = originalText;
  delete article.dataset.originalText;
  body.textContent = originalText;
  actions.innerHTML = "";
  actions.append(createCopyButton(article, "user"));
  actions.append(createEditButton(article));
}

async function submitPromptEdit(article, nextContent) {
  const room = getActiveRoom();
  const messageIndex = Number(article.dataset.messageIndex);
  const content = nextContent.trim();
  if (!room || !Number.isInteger(messageIndex) || !content || state.busy) return;

  const message = room.messages[messageIndex];
  if (!message || message.role !== "user") return;

  message.content = content;
  message.updatedAt = new Date().toISOString();
  room.messages = room.messages.slice(0, messageIndex + 1);
  room.updatedAt = new Date().toISOString();
  if (messageIndex === 0) room.title = createTitleFromPrompt(content);
  scheduleSave();
  renderAll();
  await requestAssistantResponse(room);
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
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

function appendThinking() {
  const wrapper = document.createElement("div");
  wrapper.className = "thinking-card";

  const row = document.createElement("div");
  row.className = "thinking-row";

  const dots = document.createElement("span");
  dots.className = "thinking-dots";
  dots.setAttribute("aria-hidden", "true");
  dots.innerHTML = "<span></span><span></span><span></span>";

  const text = document.createElement("span");
  text.className = "thinking-text";
  text.textContent = "Thinking...";

  row.append(dots, text);

  const details = document.createElement("details");
  details.className = "thinking-details";
  const summary = document.createElement("summary");
  summary.textContent = "처리 단계 보기";
  const list = document.createElement("ul");
  const steps = buildProcessingSteps();
  for (const [index, step] of steps.entries()) {
    const item = document.createElement("li");
    item.dataset.stepIndex = String(index);
    const marker = document.createElement("span");
    marker.className = "thinking-step-marker";
    marker.textContent = "▷";
    const label = document.createElement("span");
    label.className = "thinking-step-label";
    label.textContent = step;
    item.append(marker, label);
    list.append(item);
  }
  details.append(summary, list);
  wrapper.append(row, details);
  wrapper.dataset.completedSteps = "0";
  elements.messages.append(wrapper);
  updateThinkingProgress(wrapper, 0);
  scrollToBottom();
  return wrapper;
}

function removeThinking(thinking) {
  thinking?.remove();
}

function updateThinkingProgress(thinking, completedCount) {
  if (!thinking) return;
  const items = Array.from(thinking.querySelectorAll(".thinking-details li"));
  const safeCount = Math.max(0, Math.min(completedCount, items.length));
  thinking.dataset.completedSteps = String(safeCount);

  for (const [index, item] of items.entries()) {
    const done = index < safeCount;
    const active = index === safeCount;
    item.classList.toggle("done", done);
    item.classList.toggle("active", active);
    const marker = item.querySelector(".thinking-step-marker");
    if (marker) marker.textContent = "▷";
  }
}

function advanceThinkingProgress(thinking, completedCount = null) {
  if (!thinking) return;
  const nextCount = completedCount ?? Number(thinking.dataset.completedSteps || 0) + 1;
  updateThinkingProgress(thinking, nextCount);
}

function getThinkingStepCount(thinking) {
  return thinking?.querySelectorAll(".thinking-details li").length ?? 0;
}

function buildProcessingSteps() {
  const steps = ["사용자 질문 확인", "대화 맥락 정리"];
  const documents = getActiveDocuments().filter((uploadedFile) => uploadedFile.kind === "document");
  const images = getActiveDocuments().filter((uploadedFile) => uploadedFile.kind === "image");

  if (documents.length) {
    steps.push(`문서 컨텍스트 구성: ${documents.map(formatDisplayFileName).join(", ")}`);
  }

  if (images.length) {
    steps.push(`이미지 입력 포함: ${images.map(formatDisplayFileName).join(", ")}`);
  }

  steps.push("Ollama 스트리밍 응답 수신");
  steps.push("근거 중심 답변 표시");
  return steps;
}

function getActiveDocuments() {
  const room = getActiveRoom();
  if (!room) return [];
  if (!Array.isArray(room.documents)) room.documents = [];
  return room.documents;
}

function getPersonalizationSettings() {
  const appName = state.settings.appName || "Ollama Chatter";
  return {
    userTitle: state.settings.userTitle || "사용자님",
    aiName: appName,
    appName,
    customPrompt: state.settings.customPrompt || ""
  };
}

function shouldRequestVisualizationResponse(room) {
  const prompt = getLastUserPrompt(room);
  return hasVisualizationIntent(prompt) && hasVisualizableDocuments();
}

function getLastUserPrompt(room) {
  const message = [...(room?.messages ?? [])].reverse().find((item) => item.role !== "assistant");
  return String(message?.content ?? "");
}

function hasVisualizationIntent(prompt) {
  return /chart|graph|plot|dashboard|visuali[sz]e|visuali[sz]ation|infographic|차트|그래프|도표|시각화|인포그래픽|대시보드|막대|원형|선그래프/i.test(String(prompt ?? ""));
}

function hasVisualizableDocuments() {
  return getActiveDocuments().some((documentItem) => {
    const tables = Array.isArray(documentItem.tables) ? documentItem.tables : [];
    const sheets = Array.isArray(documentItem.sheets) ? documentItem.sheets : [];
    const hasRows = [...tables, ...sheets].some((table) => Array.isArray(table?.rows) && table.rows.length > 0);
    if (hasRows) return true;

    const fileType = String(documentItem.fileType || "").toLowerCase();
    const hasSheetText = sheets.some((sheet) => isTableLikeText(sheet?.text));
    const hasDocumentText = isTableLikeText(documentItem.text);
    return ["csv", "xlsx"].includes(fileType) && (hasSheetText || hasDocumentText);
  });
}

function isTableLikeText(value) {
  const lines = String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 8);
  return lines.filter((line) => line.includes(",") || line.includes("\t")).length >= 2;
}

function extractImageFilesFromPaste(event) {
  const items = Array.from(event.clipboardData?.items ?? []);
  return items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      const extension = file.type.split("/")[1] || "png";
      return new File([file], `clipboard-image-${Date.now()}-${index}.${extension}`, {
        type: file.type
      });
    })
    .filter(Boolean);
}

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

function normalizeColorTheme(value) {
  return value === "water" ? "water" : "busan";
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
  const hasCustomBanner = Boolean(state.settings.appBannerDataUrl);
  elements.appBannerPreview.src = banner;
  elements.appBannerPreview.hidden = false;
  elements.appBannerPicker.dataset.state = hasCustomBanner ? "filled" : "default";
  elements.removeBannerButton.disabled = !hasCustomBanner;
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
  const avatar = dataUrl;
  if (avatar) {
    preview.src = avatar;
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

function closeSettings() {
  elements.settingsDialog.close();
}

function setBusy(busy) {
  state.busy = busy;
  elements.sendButton.disabled = false;
  elements.sendButton.textContent = busy ? "중지" : "전송";
  elements.sendButton.classList.toggle("stop-button", busy);
  elements.fileInput.disabled = busy;
}

function stopGeneration() {
  state.abortController?.abort();
}

function scrollToBottom() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

// ===== Department Notebooks (RAG) =====

const ADMIN_TOKEN_SESSION_KEY = "myai_admin_token";

async function loadNotebooks() {
  try {
    const response = await fetch("/api/notebooks");
    if (!response.ok) return;
    const result = await response.json();
    state.notebooks = Array.isArray(result.notebooks) ? result.notebooks : [];
    renderActiveNotebookUi();
  } catch (error) {
    console.warn("노트북 목록을 불러오지 못했습니다:", error.message);
  }
}

async function loadAdminStatus() {
  try {
    const response = await fetch("/api/admin/status");
    if (!response.ok) return;
    const result = await response.json();
    state.admin.configured = Boolean(result.configured);
  } catch (error) {
    state.admin.configured = false;
  }
}

function restoreAdminTokenSession() {
  try {
    const stored = sessionStorage.getItem(ADMIN_TOKEN_SESSION_KEY);
    if (stored) {
      state.admin.token = stored;
      state.admin.authenticated = true;
    }
  } catch {
    // sessionStorage may be blocked; ignore.
  }
}

function findNotebookSummary(notebookId) {
  if (!notebookId) return null;
  return state.notebooks.find((notebook) => notebook.id === notebookId) ?? null;
}

function getActiveNotebookId() {
  return getActiveRoom()?.selectedNotebookId ?? null;
}

function renderActiveNotebookUi() {
  const id = getActiveNotebookId();
  const notebook = findNotebookSummary(id);

  if (!elements.notebookBadge) return;

  if (notebook) {
    elements.notebookBadge.hidden = false;
    elements.notebookBadgeName.textContent = notebook.name;
    elements.notebookBadge.title = `부서노트북: ${notebook.name}`;
  } else {
    elements.notebookBadge.hidden = true;
  }
}

async function openNotebookSelector() {
  if (!elements.notebookSelectorDialog) return;
  closeAttachMenu();
  await loadNotebooks();
  renderNotebookSelectorList();
  if (!elements.notebookSelectorDialog.open) {
    elements.notebookSelectorDialog.showModal();
  }
}

function closeNotebookSelector() {
  if (elements.notebookSelectorDialog?.open) {
    elements.notebookSelectorDialog.close();
  }
}

function renderNotebookSelectorList() {
  if (!elements.notebookList) return;
  elements.notebookList.innerHTML = "";
  const activeId = getActiveNotebookId();

  // Always show the "off" sentinel first.
  elements.notebookList.append(buildNotebookListItem({
    id: null,
    name: "사용 안 함",
    description: "일반 대화 모드",
    isOff: true,
    isActive: !activeId
  }, () => {
    selectNotebook(null);
    closeNotebookSelector();
  }));

  if (state.notebooks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "notebook-list-empty";
    empty.textContent = "등록된 부서노트북이 없습니다.";
    elements.notebookList.append(empty);
    return;
  }

  for (const notebook of state.notebooks) {
    elements.notebookList.append(buildNotebookListItem({
      id: notebook.id,
      name: notebook.name,
      description: notebook.description,
      meta: `문서 ${notebook.documentCount ?? 0}`,
      isActive: notebook.id === activeId
    }, () => {
      selectNotebook(notebook.id);
      closeNotebookSelector();
    }));
  }
}

function buildNotebookListItem(item, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "notebook-list-item";
  if (item.isOff) button.classList.add("notebook-list-item-off");
  if (item.isActive) button.classList.add("active");

  const content = document.createElement("div");
  content.className = "notebook-list-content";
  const name = document.createElement("span");
  name.className = "notebook-list-name";
  name.textContent = item.name;
  content.append(name);
  if (item.description) {
    const desc = document.createElement("span");
    desc.className = "notebook-list-description";
    desc.textContent = item.description;
    content.append(desc);
  }

  const trailing = document.createElement("span");
  trailing.className = "notebook-list-trailing";
  if (item.meta) {
    const meta = document.createElement("span");
    meta.className = "notebook-list-meta";
    meta.textContent = item.meta;
    trailing.append(meta);
  }
  const check = document.createElement("span");
  check.className = "notebook-list-check";
  check.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;
  trailing.append(check);

  button.append(content, trailing);
  button.addEventListener("click", onSelect);
  return button;
}

function selectNotebook(notebookId) {
  const room = getActiveRoom();
  if (!room) return;
  const next = notebookId ? String(notebookId) : null;
  if (room.selectedNotebookId === next) {
    renderActiveNotebookUi();
    return;
  }
  room.selectedNotebookId = next;
  room.updatedAt = new Date().toISOString();
  renderActiveNotebookUi();
  scheduleSave();
}

function clearNotebookSelection() {
  selectNotebook(null);
}

// ===== Citations =====

function decodeNotebookMetaHeader(headerValue) {
  if (!headerValue) return null;
  try {
    const json = atob(headerValue);
    const decoded = decodeURIComponent(escape(json));
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    try {
      const parsed = JSON.parse(atob(headerValue));
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // ignore
    }
  }
  return null;
}

function renderCitationsPanel(article, citations) {
  if (!article) return;
  article.querySelector(".message-citations")?.remove();
  if (!Array.isArray(citations) || !citations.length) return;

  const wrapper = document.createElement("div");
  wrapper.className = "message-citations";

  const title = document.createElement("div");
  title.className = "message-citations-title";
  title.textContent = "출처";
  wrapper.append(title);

  const list = document.createElement("ol");
  list.className = "message-citations-list";

  for (const citation of citations) {
    const item = document.createElement("li");
    item.className = "message-citation-item";

    const marker = document.createElement("span");
    marker.className = "message-citation-marker";
    marker.textContent = `[${citation.citationId}]`;

    const source = document.createElement("span");
    source.className = "message-citation-source";
    const docName = document.createElement("span");
    docName.className = "citation-doc";
    docName.textContent = citation.documentName || "출처 미상";
    source.append(docName);
    if (citation.locator) {
      const locator = document.createElement("span");
      locator.className = "citation-locator";
      locator.textContent = `· ${citation.locator}`;
      source.append(locator);
    }

    item.append(marker, source);
    list.append(item);
  }

  wrapper.append(list);
  article.append(wrapper);
}

// ===== Admin notebook panel =====

function adminAuthHeader() {
  return state.admin.token ? { Authorization: `Bearer ${state.admin.token}` } : {};
}

async function openAdminNotebookDialog() {
  if (!elements.adminNotebookDialog) return;
  closeSettings();
  // Refresh server admin status in case it was just configured.
  await loadAdminStatus();
  if (!state.admin.configured) {
    showAdminUnconfigured();
  } else if (state.admin.authenticated && state.admin.token) {
    showAdminContent();
    await refreshAdminNotebooks();
  } else {
    showAdminLogin();
  }
  if (!elements.adminNotebookDialog.open) elements.adminNotebookDialog.showModal();
}

function showAdminUnconfigured() {
  if (elements.adminTokenSection) elements.adminTokenSection.hidden = false;
  if (elements.adminNotebookContent) elements.adminNotebookContent.hidden = true;
  if (elements.adminTokenInput) {
    elements.adminTokenInput.value = "";
    elements.adminTokenInput.disabled = true;
  }
  if (elements.adminTokenSubmitButton) elements.adminTokenSubmitButton.disabled = true;
  if (elements.adminTokenError) {
    elements.adminTokenError.hidden = false;
    elements.adminTokenError.textContent = "서버에 ADMIN_TOKEN이 설정되어 있지 않습니다. .env에 ADMIN_TOKEN을 추가하고 서버를 재시작하세요.";
  }
}

function closeAdminNotebookDialog() {
  if (elements.adminNotebookDialog?.open) elements.adminNotebookDialog.close();
}

function showAdminLogin() {
  if (elements.adminTokenSection) elements.adminTokenSection.hidden = false;
  if (elements.adminNotebookContent) elements.adminNotebookContent.hidden = true;
  if (elements.adminTokenInput) {
    elements.adminTokenInput.value = "";
    elements.adminTokenInput.disabled = false;
  }
  if (elements.adminTokenSubmitButton) elements.adminTokenSubmitButton.disabled = false;
  if (elements.adminTokenError) elements.adminTokenError.hidden = true;
}

function showAdminContent() {
  if (elements.adminTokenSection) elements.adminTokenSection.hidden = true;
  if (elements.adminNotebookContent) elements.adminNotebookContent.hidden = false;
  hideNewNotebookForm();
}

async function submitAdminToken() {
  const token = (elements.adminTokenInput?.value ?? "").trim();
  if (!token) {
    showAdminTokenError("토큰을 입력하세요.");
    return;
  }
  try {
    const response = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) {
      showAdminTokenError("인증 실패. 토큰을 확인하세요.");
      return;
    }
    state.admin.token = token;
    state.admin.authenticated = true;
    try {
      sessionStorage.setItem(ADMIN_TOKEN_SESSION_KEY, token);
    } catch {
      // sessionStorage may be blocked; the token still works for this tab.
    }
    showAdminContent();
    await refreshAdminNotebooks();
  } catch (error) {
    showAdminTokenError(`인증 요청 실패: ${error.message}`);
  }
}

function showAdminTokenError(message) {
  if (!elements.adminTokenError) return;
  elements.adminTokenError.textContent = message;
  elements.adminTokenError.hidden = false;
}

function adminLogout() {
  state.admin.token = null;
  state.admin.authenticated = false;
  try {
    sessionStorage.removeItem(ADMIN_TOKEN_SESSION_KEY);
  } catch {
    // ignore
  }
  showAdminLogin();
}

function showNewNotebookForm() {
  if (elements.adminNewNotebookForm) elements.adminNewNotebookForm.hidden = false;
  if (elements.adminNewNotebookName) {
    elements.adminNewNotebookName.value = "";
    elements.adminNewNotebookName.focus();
  }
  if (elements.adminNewNotebookDescription) elements.adminNewNotebookDescription.value = "";
}

function hideNewNotebookForm() {
  if (elements.adminNewNotebookForm) elements.adminNewNotebookForm.hidden = true;
}

async function adminCreateNotebook() {
  const name = (elements.adminNewNotebookName?.value ?? "").trim();
  const description = (elements.adminNewNotebookDescription?.value ?? "").trim();
  if (!name) {
    alert("노트북 이름을 입력하세요.");
    return;
  }
  try {
    const response = await fetch("/api/notebooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeader() },
      body: JSON.stringify({ name, description })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "노트북 생성 실패");
    }
    hideNewNotebookForm();
    await refreshAdminNotebooks();
    await loadNotebooks();
  } catch (error) {
    alert(`노트북 생성 실패: ${error.message}`);
  }
}

async function adminDeleteNotebook(notebookId, notebookName) {
  if (!confirm(`부서노트북 "${notebookName}"을(를) 삭제할까요? 등록된 모든 문서가 사라집니다.`)) return;
  try {
    const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
      method: "DELETE",
      headers: adminAuthHeader()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "삭제 실패");
    }
    await refreshAdminNotebooks();
    await loadNotebooks();
    for (const room of state.rooms) {
      if (room.selectedNotebookId === notebookId) room.selectedNotebookId = null;
    }
    renderActiveNotebookUi();
    scheduleSave();
  } catch (error) {
    alert(`삭제 실패: ${error.message}`);
  }
}

let pendingAdminUploadNotebookId = null;

function triggerAdminDocumentUpload(notebookId) {
  if (!elements.adminNotebookFileInput) return;
  pendingAdminUploadNotebookId = notebookId;
  elements.adminNotebookFileInput.value = "";
  elements.adminNotebookFileInput.click();
}

async function handleAdminDocumentUploadChange(event) {
  const file = event.target.files?.[0];
  const notebookId = pendingAdminUploadNotebookId;
  pendingAdminUploadNotebookId = null;
  event.target.value = "";
  if (!file || !notebookId) return;
  await adminUploadDocument(notebookId, file);
}

async function adminUploadDocument(notebookId, file) {
  try {
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/documents`, {
      method: "POST",
      headers: adminAuthHeader(),
      body: formData
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "업로드 실패");
    }
    await refreshAdminNotebooks();
    await loadNotebooks();
  } catch (error) {
    alert(`업로드 실패: ${error.message}`);
  }
}

async function adminDeleteDocument(notebookId, documentId, documentName) {
  if (!confirm(`문서 "${documentName}"을(를) 삭제할까요?`)) return;
  try {
    const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/documents/${encodeURIComponent(documentId)}`, {
      method: "DELETE",
      headers: adminAuthHeader()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "삭제 실패");
    }
    await refreshAdminNotebooks();
    await loadNotebooks();
  } catch (error) {
    alert(`삭제 실패: ${error.message}`);
  }
}

async function refreshAdminNotebooks() {
  if (!elements.adminNotebookList) return;
  elements.adminNotebookList.innerHTML = "<div class='admin-notebook-empty'>불러오는 중...</div>";
  try {
    const listResponse = await fetch("/api/notebooks");
    const listResult = await listResponse.json();
    const summaries = Array.isArray(listResult.notebooks) ? listResult.notebooks : [];

    const detailedNotebooks = await Promise.all(
      summaries.map(async (summary) => {
        try {
          const response = await fetch(`/api/notebooks/${encodeURIComponent(summary.id)}`);
          if (!response.ok) return summary;
          const data = await response.json();
          return data.notebook ?? summary;
        } catch {
          return summary;
        }
      })
    );

    elements.adminNotebookList.innerHTML = "";
    if (!detailedNotebooks.length) {
      const empty = document.createElement("div");
      empty.className = "admin-notebook-empty";
      empty.textContent = "등록된 노트북이 없습니다. 새 노트북을 만드세요.";
      elements.adminNotebookList.append(empty);
      return;
    }

    for (const notebook of detailedNotebooks) {
      elements.adminNotebookList.append(buildAdminNotebookCard(notebook));
    }
  } catch (error) {
    elements.adminNotebookList.innerHTML = "";
    const errorBox = document.createElement("div");
    errorBox.className = "admin-notebook-empty";
    errorBox.textContent = `목록을 불러오지 못했습니다: ${error.message}`;
    elements.adminNotebookList.append(errorBox);
  }
}

function buildAdminNotebookCard(notebook) {
  const card = document.createElement("div");
  card.className = "admin-notebook-card";

  const header = document.createElement("div");
  header.className = "admin-notebook-card-header";

  const title = document.createElement("div");
  title.className = "admin-notebook-card-title";
  const name = document.createElement("span");
  name.className = "admin-notebook-card-name";
  name.textContent = notebook.name;
  title.append(name);
  if (notebook.description) {
    const desc = document.createElement("span");
    desc.className = "admin-notebook-card-description";
    desc.textContent = notebook.description;
    title.append(desc);
  }

  const actions = document.createElement("div");
  actions.className = "admin-notebook-card-actions";
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "ghost-button";
  deleteButton.textContent = "삭제";
  deleteButton.addEventListener("click", () => adminDeleteNotebook(notebook.id, notebook.name));
  actions.append(deleteButton);

  header.append(title, actions);
  card.append(header);

  const body = document.createElement("div");
  body.className = "admin-notebook-card-body";

  const documents = Array.isArray(notebook.documents) ? notebook.documents : [];
  if (!documents.length) {
    const empty = document.createElement("div");
    empty.className = "admin-notebook-doc-empty";
    empty.textContent = "등록된 문서가 없습니다.";
    body.append(empty);
  } else {
    const list = document.createElement("ul");
    list.className = "admin-notebook-doc-list";
    for (const doc of documents) {
      const item = document.createElement("li");
      item.className = "admin-notebook-doc-item";

      const docName = document.createElement("span");
      docName.className = "admin-notebook-doc-name";
      docName.textContent = doc.name;

      const meta = document.createElement("span");
      meta.className = "admin-notebook-doc-meta";
      const sizeKb = doc.sizeBytes ? `${Math.max(1, Math.round(doc.sizeBytes / 1024))} KB` : "";
      const chunkInfo = doc.chunkCount ? `${doc.chunkCount} chunks` : "";
      meta.textContent = [chunkInfo, sizeKb].filter(Boolean).join(" · ");

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "admin-notebook-doc-remove";
      remove.textContent = "삭제";
      remove.addEventListener("click", () => adminDeleteDocument(notebook.id, doc.id, doc.name));

      item.append(docName, meta, remove);
      list.append(item);
    }
    body.append(list);
  }

  const addDoc = document.createElement("button");
  addDoc.type = "button";
  addDoc.className = "ghost-button admin-notebook-add-doc";
  addDoc.textContent = "+ 문서 추가";
  addDoc.addEventListener("click", () => triggerAdminDocumentUpload(notebook.id));
  body.append(addDoc);

  card.append(body);
  return card;
}
