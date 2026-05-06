// Central shared state and DOM element references.
// Every other module imports from here — no circular deps since this file
// has zero project-level imports.

export const DB_NAME = "ollama-chatter-secure";
export const DB_VERSION = 1;
export const APP_STATE_KEY = "app-state";
export const KEY_ID = "local-aes-gcm-key";
export const DEFAULT_BANNER_SRC = "/default-banner.png";
export const DEFAULT_FAVICON_HREF = "/default-icon.svg";
export const KOREAN_SHORT_WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function todayDateISO() {
  return formatLocalDate(new Date());
}

export function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function normalizeCalendarViewMode(value) {
  return value === "week" || value === "day" ? value : "month";
}

export function normalizeColorTheme(value) {
  return value === "water" ? "water" : "busan";
}

export function normalizeReminderList(value) {
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

export function normalizeRecurrence(value) {
  if (!value || typeof value !== "object") return null;
  const frequency = String(value.frequency || "").toLowerCase();
  if (!["daily", "weekly", "monthly", "yearly"].includes(frequency)) return null;
  const interval = Math.max(1, Math.min(365, Math.round(Number(value.interval) || 1)));
  const out = { frequency, interval };
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value.until || ""))) out.until = String(value.until);
  const count = Math.round(Number(value.count));
  if (Number.isFinite(count) && count > 0) out.count = Math.min(999, count);
  return out;
}

export function normalizeCalendarEvent(event) {
  if (!event || typeof event !== "object") return null;
  return {
    ...event,
    recurrence: normalizeRecurrence(event.recurrence),
    recurrenceExceptions: Array.isArray(event.recurrenceExceptions) ? event.recurrenceExceptions : [],
    reminders: normalizeReminderList(event.reminders),
    notifiedReminders: Array.isArray(event.notifiedReminders) ? event.notifiedReminders : []
  };
}

export const state = {
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
  deepAnalysisEnabled: false,
  admin: {
    configured: false,
    token: null,
    authenticated: false
  }
};

export const elements = {
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
  calendarSettingsButton: document.querySelector("#calendarSettingsButton"),
  calendarSettingsMenu: document.querySelector("#calendarSettingsMenu"),
  calendarExportButton: document.querySelector("#calendarExportButton"),
  calendarImportButton: document.querySelector("#calendarImportButton"),
  calendarImportInput: document.querySelector("#calendarImportInput"),
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
  eventRecurrenceSelect: document.querySelector("#eventRecurrenceSelect"),
  eventRecurrenceUntilInput: document.querySelector("#eventRecurrenceUntilInput"),
  eventLocationInput: document.querySelector("#eventLocationInput"),
  eventNotesInput: document.querySelector("#eventNotesInput"),
  eventDoneInput: document.querySelector("#eventDoneInput"),
  eventDoneRow: document.querySelector("#eventDoneRow"),
  eventReminderInputs: Array.from(document.querySelectorAll(".event-reminder-input")),
  eventColorOptions: Array.from(document.querySelectorAll(".event-color-option")),
  calendarConfirmDialog: document.querySelector("#calendarConfirmDialog"),
  calendarConfirmTitle: document.querySelector("#calendarConfirmTitle"),
  calendarConfirmBody: document.querySelector("#calendarConfirmBody"),
  calendarConfirmCancelButton: document.querySelector("#calendarConfirmCancelButton"),
  calendarConfirmOkButton: document.querySelector("#calendarConfirmOkButton"),
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
  deepAnalysisToggle: document.querySelector("#deepAnalysisToggle"),
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

export function showConfirmDialog({ title = "확인", body = "", okText = "확인", cancelText = "취소", danger = false } = {}) {
  const dialog = elements.calendarConfirmDialog;
  if (!dialog || typeof dialog.showModal !== "function") return Promise.resolve(window.confirm(body || title));
  return new Promise((resolve) => {
    elements.calendarConfirmTitle.textContent = title;
    elements.calendarConfirmBody.innerHTML = "";
    const lines = Array.isArray(body) ? body : String(body || "").split("\n");
    for (const line of lines.filter(Boolean)) {
      const row = document.createElement("p");
      row.textContent = line;
      elements.calendarConfirmBody.append(row);
    }
    elements.calendarConfirmOkButton.textContent = okText;
    elements.calendarConfirmCancelButton.textContent = cancelText;
    elements.calendarConfirmOkButton.classList.toggle("danger-action", !!danger);

    const cleanup = () => {
      elements.calendarConfirmOkButton.removeEventListener("click", onOk);
      elements.calendarConfirmCancelButton.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      dialog.removeEventListener("close", onClose);
    };
    const finish = (value) => {
      cleanup();
      if (dialog.open) dialog.close(value ? "ok" : "cancel");
      resolve(value);
    };
    const onOk = (event) => { event.preventDefault(); finish(true); };
    const onCancel = (event) => { event.preventDefault(); finish(false); };
    const onClose = () => { cleanup(); resolve(dialog.returnValue === "ok"); };

    elements.calendarConfirmOkButton.addEventListener("click", onOk);
    elements.calendarConfirmCancelButton.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    dialog.addEventListener("close", onClose);
    dialog.showModal();
  });
}

export function getActiveRoom() {
  return state.rooms.find((room) => room.id === state.activeRoomId) ?? null;
}

export function createRoom() {
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
