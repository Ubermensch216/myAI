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
  return value === "water" || value === "custom" ? value : "busan";
}

export const RESPONSE_STYLES = ["default", "professional", "friendly", "candid", "quirky", "efficient", "cynical"];

export function normalizeResponseStyle(value) {
  return RESPONSE_STYLES.includes(value) ? value : "default";
}

export const DEFAULT_CUSTOM_COLOR_THEME = {
  accent: "#e6007e",
  accentDark: "#b00062",
  accentAux: "#00a3e0"
};

export function normalizeCustomColorTheme(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    accent: normalizeHexColor(source.accent, DEFAULT_CUSTOM_COLOR_THEME.accent),
    accentDark: normalizeHexColor(source.accentDark, DEFAULT_CUSTOM_COLOR_THEME.accentDark),
    accentAux: normalizeHexColor(source.accentAux, DEFAULT_CUSTOM_COLOR_THEME.accentAux)
  };
}

function normalizeHexColor(value, fallback) {
  const text = String(value || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text.toLowerCase();
  return fallback;
}

export const DEFAULT_LAYOUT = {
  leftPanelWidth: 340,
  leftPanelCollapsed: false,
  rightPanelWidth: 360,
  rightPanelCollapsed: false
};

export function normalizeLayout(value = {}) {
  return {
    leftPanelWidth: clampNumber(value.leftPanelWidth, DEFAULT_LAYOUT.leftPanelWidth, 260, 520),
    leftPanelCollapsed: Boolean(value.leftPanelCollapsed),
    rightPanelWidth: clampNumber(value.rightPanelWidth, DEFAULT_LAYOUT.rightPanelWidth, 300, 640),
    rightPanelCollapsed: Boolean(value.rightPanelCollapsed)
  };
}

export function ensureLayoutState() {
  state.layout = normalizeLayout(state.layout);
  return state.layout;
}

function clampNumber(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
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
  lawReviews: {
    items: [],
    activeId: ""
  },
  grcReviews: {
    items: [],
    activeId: ""
  },
  settings: {
    userTitle: "사용자님",
    aiName: "myAI",
    appName: "myAI",
    theme: "light",
    colorTheme: "busan",
    customColorTheme: { ...DEFAULT_CUSTOM_COLOR_THEME },
    appBannerDataUrl: "",
    appLogoDataUrl: "",
    systemAvatarDataUrl: "",
    userAvatarDataUrl: "",
    customPrompt: "",
    responseStyle: "default",
    customInstruction: ""
  },
  busy: false,
  abortController: null,
  db: null,
  cryptoKey: null,
  client: {
    documentCacheKey: ""
  },
  layout: { ...DEFAULT_LAYOUT },
  studio: {
    selectedTool: "document"
  },
  documentTemplates: {
    personal: []
  },
  customPrompts: {
    personal: [],
    seeded: false
  },
  notebooks: [],
  access: {
    configured: false,
    authenticated: false,
    token: null,
    user: null,
    options: {
      groups: [],
      super: { enabled: false }
    }
  },
  deepAnalysisEnabled: false,
  lawSearchMode: false,
  admin: {
    configured: false,
    token: null,
    authenticated: false
  }
};

window.state = state;

export function ensureDocumentCacheKey() {
  if (!state.client || typeof state.client !== "object") state.client = { documentCacheKey: "" };
  if (!state.client.documentCacheKey) state.client.documentCacheKey = generateClientSecret();
  return state.client.documentCacheKey;
}

export function documentCacheHeaders() {
  return { "X-MyAI-Document-Key": ensureDocumentCacheKey() };
}

export function accessAuthHeaders() {
  return state.access?.token ? { Authorization: `Bearer ${state.access.token}` } : {};
}

function generateClientSecret() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export const elements = {
  modelInput: document.querySelector("#modelInput"),
  modelHint: document.querySelector("#modelHint"),
  fileInput: document.querySelector("#fileInput"),
  attachFileButton: document.querySelector("#attachFileButton"),
  attachMenu: document.querySelector("#attachMenu"),
  attachFromDeviceButton: document.querySelector("#attachFromDeviceButton"),
  dropOverlay: document.querySelector("#dropOverlay"),
  chatArea: document.querySelector(".chat-area"),
  faviconLink: document.querySelector("#faviconLink"),
  appNameText: document.querySelector("#appNameText"),
  appBannerImg: document.querySelector("#appBannerImg"),
  uploadProgress: document.querySelector("#uploadProgress"),
  roomList: document.querySelector("#roomList"),
  newRoomButton: document.querySelector("#newRoomButton"),
  roomTitleInput: document.querySelector("#roomTitleInput"),
  messages: document.querySelector("#messages"),
  selectionModeToggle: document.querySelector("#selectionModeToggle"),
  bulkDeleteBar: document.querySelector("#bulkDeleteBar"),
  bulkDeleteButton: document.querySelector("#bulkDeleteButton"),
  bulkCancelButton: document.querySelector("#bulkCancelButton"),
  bulkCount: document.querySelector("#bulkCount"),
  chatForm: document.querySelector("#chatForm"),
  promptInput: document.querySelector("#promptInput"),
  stopGenerationButton: document.querySelector("#stopGenerationButton"),
  lawSearchActiveButton: document.querySelector("#lawSearchActiveButton"),
  materialToggleButton: document.querySelector("#materialToggleButton"),
  materialCountBadge: document.querySelector("#materialCountBadge"),
  materialPanel: document.querySelector("#materialPanel"),
  materialSummaryLabel: document.querySelector("#materialSummaryLabel"),
  materialList: document.querySelector("#materialList"),
  materialClearButton: document.querySelector("#materialClearButton"),
  settingsButton: document.querySelector("#settingsButton"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  settingsAdminMount: document.querySelector("#settingsAdminMount"),
  settingsAdminStatus: document.querySelector("#settingsAdminStatus"),
  closeSettingsButton: document.querySelector("#closeSettingsButton"),
  cancelSettingsButton: document.querySelector("#cancelSettingsButton"),
  userTitleInput: document.querySelector("#userTitleInput"),
  appNameInput: document.querySelector("#appNameInput"),
  themeOptions: Array.from(document.querySelectorAll(".theme-option")),
  colorThemeOptions: Array.from(document.querySelectorAll(".color-theme-option")),
  customColorPanel: document.querySelector("#customColorPanel"),
  customColorInputs: Array.from(document.querySelectorAll(".custom-color-input")),
  customColorThemeThumb: document.querySelector("#customColorThemeThumb"),
  responseStyleSelect: document.querySelector("#responseStyleSelect"),
  customInstructionInput: document.querySelector("#customInstructionInput"),
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
  reminderToastContainer: document.querySelector("#reminderToastContainer"),
  attachNotebookButton: document.querySelector("#attachNotebookButton"),
  attachCustomPromptButton: document.querySelector("#attachCustomPromptButton"),
  lawSearchButton: document.querySelector("#lawSearchButton"),
  customPromptPicker: document.querySelector("#customPromptPicker"),
  settingsSubTabCustomPrompts: document.querySelector("#settingsSubTabCustomPrompts"),
  settingsPanelCustomPrompts: document.querySelector("#settingsPanelCustomPrompts"),
  settingsCustomPromptsMount: document.querySelector("#settingsCustomPromptsMount"),
  deepAnalysisToggle: document.querySelector("#deepAnalysisToggle"),
  notebookSelectorDialog: document.querySelector("#notebookSelectorDialog"),
  closeNotebookSelectorButton: document.querySelector("#closeNotebookSelectorButton"),
  notebookAccessPanel: document.querySelector("#notebookAccessPanel"),
  notebookAccessCurrent: document.querySelector("#notebookAccessCurrent"),
  accessGroupSelect: document.querySelector("#accessGroupSelect"),
  accessLevelSelect: document.querySelector("#accessLevelSelect"),
  accessPasswordInput: document.querySelector("#accessPasswordInput"),
  accessSuperInput: document.querySelector("#accessSuperInput"),
  accessLoginButton: document.querySelector("#accessLoginButton"),
  accessLogoutButton: document.querySelector("#accessLogoutButton"),
  accessError: document.querySelector("#accessError"),
  notebookList: document.querySelector("#notebookList"),
  adminNotebookDialog: document.querySelector("#adminNotebookDialog"),
  closeAdminNotebookButton: document.querySelector("#closeAdminNotebookButton"),
  adminDialogTitleGroup: document.querySelector("#adminDialogTitleGroup"),
  adminDialogSubtitle: document.querySelector("#adminDialogSubtitle"),
  adminConsoleNav: document.querySelector("#adminConsoleNav"),
  adminUnconfiguredSection: document.querySelector("#adminUnconfiguredSection"),
  adminRecheckButton: document.querySelector("#adminRecheckButton"),
  adminAuthSection: document.querySelector("#adminAuthSection"),
  adminTokenInput: document.querySelector("#adminTokenInput"),
  adminTokenToggleButton: document.querySelector("#adminTokenToggleButton"),
  adminTokenSubmitButton: document.querySelector("#adminTokenSubmitButton"),
  adminTokenError: document.querySelector("#adminTokenError"),
  adminWorkspace: document.querySelector("#adminWorkspace"),
  adminLogoutButton: document.querySelector("#adminLogoutButton"),
  adminNotebookMenuButton: document.querySelector("#adminNotebookMenuButton"),
  adminSourcePromotionsButton: document.querySelector("#adminSourcePromotionsButton"),
  adminListPane: document.querySelector("#adminListPane"),
  adminNotebookNavSection: document.querySelector("#adminNotebookNavSection"),
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
  adminDocsEmpty: document.querySelector("#adminDocsEmpty"),
  adminStatusButton: document.querySelector("#adminStatusButton"),
  adminAccessButton: document.querySelector("#adminAccessButton"),
  adminStatusPanel: document.querySelector("#adminStatusPanel"),
  adminStatusBody: document.querySelector("#adminStatusBody"),
  adminRefreshStatusButton: document.querySelector("#adminRefreshStatusButton"),
  adminAccessPanel: document.querySelector("#adminAccessPanel"),
  adminAccessBody: document.querySelector("#adminAccessBody"),
  adminAccessRefreshButton: document.querySelector("#adminAccessRefreshButton"),
  adminSourcePromotionsPanel: document.querySelector("#adminSourcePromotionsPanel"),
  adminSourcePromotionsRefreshButton: document.querySelector("#adminSourcePromotionsRefreshButton"),
  adminSourcePromotionsBody: document.querySelector("#adminSourcePromotionsBody"),
  adminAccessGroupsTab: document.querySelector("#adminAccessGroupsTab"),
  adminAccessSuperTab: document.querySelector("#adminAccessSuperTab"),
  adminRagEvalButton: document.querySelector("#adminRagEvalButton"),
  adminRagEvalPanel: document.querySelector("#adminRagEvalPanel"),
  ragEvalGoldenSearch: document.querySelector("#ragEvalGoldenSearch"),
  ragEvalGoldenSuiteFilter: document.querySelector("#ragEvalGoldenSuiteFilter"),
  ragEvalGoldenAddButton: document.querySelector("#ragEvalGoldenAddButton"),
  ragEvalGoldenRefreshButton: document.querySelector("#ragEvalGoldenRefreshButton"),
  ragEvalGoldenStats: document.querySelector("#ragEvalGoldenStats"),
  ragEvalGoldenTableBody: document.querySelector("#ragEvalGoldenTableBody"),
  ragEvalGoldenEmpty: document.querySelector("#ragEvalGoldenEmpty"),
  ragEvalRunNotebook: document.querySelector("#ragEvalRunNotebook"),
  ragEvalRunSuite: document.querySelector("#ragEvalRunSuite"),
  ragEvalRunQuick: document.querySelector("#ragEvalRunQuick"),
  ragEvalRunK: document.querySelector("#ragEvalRunK"),
  ragEvalVariantsPreview: document.querySelector("#ragEvalVariantsPreview"),
  ragEvalRunStartButton: document.querySelector("#ragEvalRunStartButton"),
  ragEvalRunCancelButton: document.querySelector("#ragEvalRunCancelButton"),
  ragEvalRunStatus: document.querySelector("#ragEvalRunStatus"),
  ragEvalProgressTrack: document.querySelector("#ragEvalProgressTrack"),
  ragEvalProgressBar: document.querySelector("#ragEvalProgressBar"),
  ragEvalRunLog: document.querySelector("#ragEvalRunLog"),
  ragEvalRunPicker: document.querySelector("#ragEvalRunPicker"),
  ragEvalResultsRefreshButton: document.querySelector("#ragEvalResultsRefreshButton"),
  ragEvalResultsDeleteButton: document.querySelector("#ragEvalResultsDeleteButton"),
  ragEvalResultsBody: document.querySelector("#ragEvalResultsBody"),
  ragEvalHealthDays: document.querySelector("#ragEvalHealthDays"),
  ragEvalHealthNotebook: document.querySelector("#ragEvalHealthNotebook"),
  ragEvalHealthRefreshButton: document.querySelector("#ragEvalHealthRefreshButton"),
  ragEvalHealthBody: document.querySelector("#ragEvalHealthBody"),
  adminStatsButton: document.querySelector("#adminStatsButton"),
  adminStatsPanel: document.querySelector("#adminStatsPanel"),
  statsRangeSelect: document.querySelector("#statsRangeSelect"),
  statsRefreshButton: document.querySelector("#statsRefreshButton"),
  statsBody: document.querySelector("#statsBody"),
  statsKpiGrid: document.querySelector("#statsKpiGrid"),
  statsStrategicKpis: document.querySelector("#statsStrategicKpis"),
  statsGroupChart: document.querySelector("#statsGroupChart"),
  statsFeatureUsage: document.querySelector("#statsFeatureUsage"),
  statsNotebookList: document.querySelector("#statsNotebookList"),
  statsSessionList: document.querySelector("#statsSessionList"),
  statsSessionPager: document.querySelector("#statsSessionPager"),
  kgActiveNotebookLabel: document.querySelector("#kgActiveNotebookLabel"),
  kgRefreshButton: document.querySelector("#kgRefreshButton"),
  kgRebuildButton: document.querySelector("#kgRebuildButton"),
  kgRebuildStatus: document.querySelector("#kgRebuildStatus"),
  kgSearchInput: document.querySelector("#kgSearchInput"),
  kgTypeFilter: document.querySelector("#kgTypeFilter"),
  kgLimitSelect: document.querySelector("#kgLimitSelect"),
  kgRelayoutButton: document.querySelector("#kgRelayoutButton"),
  kgStatsBar: document.querySelector("#kgStatsBar"),
  kgCanvasWrap: document.querySelector(".kg-canvas-wrap"),
  kgCanvas: document.querySelector("#kgCanvas"),
  kgCanvasEmpty: document.querySelector("#kgCanvasEmpty"),
  kgLegend: document.querySelector("#kgLegend"),
  kgFullscreenButton: document.querySelector("#kgFullscreenButton"),
  kgDetailEmpty: document.querySelector("#kgDetailEmpty"),
  kgDetailBody: document.querySelector("#kgDetailBody"),
  adminNotebookAccessSection: document.querySelector("#adminNotebookAccessSection"),
  adminNotebookAccessGroups: document.querySelector("#adminNotebookAccessGroups"),
  adminNotebookAccessLevels: document.querySelector("#adminNotebookAccessLevels"),
  adminNotebookAccessSaveButton: document.querySelector("#adminNotebookAccessSaveButton"),
  adminNotebookAccessStatus: document.querySelector("#adminNotebookAccessStatus"),
  leftPanelResizer: document.querySelector("#leftPanelResizer"),
  sidebarToggleButton: document.querySelector("#sidebarToggleButton"),
  rightPanelResizer: document.querySelector("#rightPanelResizer"),
  studioPanel: document.querySelector("#studioPanel"),
  studioToggleButton: document.querySelector("#studioToggleButton"),
  studioMindmapRailButton: document.querySelector("#studioMindmapRailButton"),
  studioGraphRailButton: document.querySelector("#studioGraphRailButton"),
  studioDocumentRailButton: document.querySelector("#studioDocumentRailButton"),
  studioContent: document.querySelector("#studioContent"),
  studioMindmapButton: document.querySelector("#studioMindmapButton"),
  studioGraphButton: document.querySelector("#studioGraphButton"),
  studioDocumentButton: document.querySelector("#studioDocumentButton"),
  studioMindmapPanel: document.querySelector("#studioMindmapPanel"),
  studioGraphPanel: document.querySelector("#studioGraphPanel"),
  studioDocumentPanel: document.querySelector("#studioDocumentPanel"),
  studioDocumentEmpty: document.querySelector("#studioDocumentEmpty"),
  studioDocumentEditor: document.querySelector("#studioDocumentEditor"),
  studioDocumentEditorView: document.querySelector("#studioDocumentEditorView"),
  studioDocumentTitle: document.querySelector("#studioDocumentTitle"),
  studioDocumentType: document.querySelector("#studioDocumentType"),
  studioDocumentStyle: document.querySelector("#studioDocumentStyle"),
  studioDocumentDerivativeBtn: document.querySelector("#studioDocumentDerivativeBtn"),
  studioDocumentStructureWarnings: document.querySelector("#studioDocumentStructureWarnings"),
  studioDocumentRegenerateButton: document.querySelector("#studioDocumentRegenerateButton"),
  studioSourceGuideButton: document.querySelector("#studioSourceGuideButton"),
  studioSourceGuideEmptyButton: document.querySelector("#studioSourceGuideEmptyButton"),
  studioDocumentSaveOutputButton: document.querySelector("#studioDocumentSaveOutputButton"),
  studioDocumentDownloadButton: document.querySelector("#studioDocumentDownloadButton"),
  studioDocumentDownloadMenu: document.querySelector("#studioDocumentDownloadMenu"),
  studioDocumentDeleteButton: document.querySelector("#studioDocumentDeleteButton"),
  studioDocumentStatus: document.querySelector("#studioDocumentStatus"),
  studioDocumentIncludeCitations: document.querySelector("#studioDocumentIncludeCitations"),
  studioDocumentWarnings: document.querySelector("#studioDocumentWarnings"),
  studioOutputLibrary: document.querySelector("#studioOutputLibrary"),
  studioOutputLibraryEmpty: document.querySelector("#studioOutputLibraryEmpty"),
  studioDocumentVisualModeButton: document.querySelector("#studioDocumentVisualModeButton"),
  studioDocumentLibraryModeButton: document.querySelector("#studioDocumentLibraryModeButton"),
  studioDocumentVisual: document.querySelector("#studioDocumentVisual"),
  studioDocumentToolbar: document.querySelector("#studioDocumentToolbar"),
  studioDocumentMarkdown: document.querySelector("#studioDocumentMarkdown"),
  studioMindmapCanvas: document.querySelector("#studioMindmapCanvas"),
  studioMindmapSvg: document.querySelector("#studioMindmapSvg"),
  studioMindmapEmpty: document.querySelector("#studioMindmapEmpty"),
  studioMindmapDetails: document.querySelector("#studioMindmapDetails"),
  lawArea: document.querySelector(".law-area"),
  grcArea: document.querySelector("#grcWorkbenchContainer"),
  newLawReviewButton: document.querySelector("#newLawReviewButton"),
  lawReviewList: document.querySelector("#lawReviewList"),
  newGrcReviewButton: document.querySelector("#newGrcReviewButton"),
  grcReviewList: document.querySelector("#grcReviewList"),
  lawWorkbenchQuery: document.querySelector("#lawWorkbenchQuery"),
  lawWorkbenchLawName: document.querySelector("#lawWorkbenchLawName"),
  lawWorkbenchArticle: document.querySelector("#lawWorkbenchArticle"),
  lawWorkbenchRegion: document.querySelector("#lawWorkbenchRegion"),
  lawWorkbenchRegionField: document.querySelector("#lawWorkbenchRegionField"),
  lawWorkbenchReviewType: document.querySelector("#lawWorkbenchReviewType"),
  lawWorkbenchConditionText: document.querySelector("#lawWorkbenchConditionText"),
  lawWorkbenchRunButton: document.querySelector("#lawWorkbenchRunButton"),
  lawWorkbenchResetButton: document.querySelector("#lawWorkbenchResetButton"),
  lawWorkbenchStatus: document.querySelector("#lawWorkbenchStatus"),
  lawWorkbenchTabs: Array.from(document.querySelectorAll("[data-law-workbench-tab]")),
  lawWorkbenchBody: document.querySelector("#lawWorkbenchBody"),
  lawWorkbenchAdvanced: document.querySelector("#lawWorkbenchAdvanced"),
  lawExampleChips: Array.from(document.querySelectorAll("[data-law-example]")),
  lawWorkbenchAttachButton: document.querySelector("#lawWorkbenchAttachButton"),
  lawWorkbenchUploadInput: document.querySelector("#lawWorkbenchUploadInput"),
  lawWorkbenchAttachments: document.querySelector("#lawWorkbenchAttachments"),
  lawWorkbenchDropZone: document.querySelector("#lawWorkbenchDropZone")
};

export function ensureRoomStudio(room = getActiveRoom()) {
  if (!room) return null;
  if (!room.studio || typeof room.studio !== "object") room.studio = {};
  if (!room.studio.mindmap || typeof room.studio.mindmap !== "object") {
    room.studio.mindmap = {
      signature: "",
      data: null,
      selectedNodeId: ""
    };
  } else {
    room.studio.mindmap.signature = typeof room.studio.mindmap.signature === "string" ? room.studio.mindmap.signature : "";
    room.studio.mindmap.data = room.studio.mindmap.data || null;
    room.studio.mindmap.selectedNodeId = typeof room.studio.mindmap.selectedNodeId === "string"
      ? room.studio.mindmap.selectedNodeId
      : "";
  }
  if (!Array.isArray(room.studio.documents)) room.studio.documents = [];
  if (!Array.isArray(room.studio.outputs)) room.studio.outputs = [];
  if (typeof room.studio.activeDocumentId !== "string") room.studio.activeDocumentId = "";
  return room.studio;
}

export function ensureLawReviewStudio(review = getActiveLawReview()) {
  if (!review) return null;
  if (!review.studio || typeof review.studio !== "object") review.studio = {};
  if (!Array.isArray(review.studio.documents)) review.studio.documents = [];
  if (!Array.isArray(review.studio.outputs)) review.studio.outputs = [];
  if (typeof review.studio.activeDocumentId !== "string") review.studio.activeDocumentId = "";
  return review.studio;
}

export function ensureGrcReviewStudio(review = getActiveGrcReview()) {
  if (!review) return null;
  if (!review.studio || typeof review.studio !== "object") review.studio = {};
  if (!Array.isArray(review.studio.documents)) review.studio.documents = [];
  if (!Array.isArray(review.studio.outputs)) review.studio.outputs = [];
  if (typeof review.studio.activeDocumentId !== "string") review.studio.activeDocumentId = "";
  return review.studio;
}

export function getActiveStudio() {
  if (state.activeView === "law") {
    const review = getActiveLawReview();
    return review ? ensureLawReviewStudio(review) : null;
  }
  if (state.activeView === "grc") {
    const review = getActiveGrcReview();
    return review ? ensureGrcReviewStudio(review) : null;
  }
  if (state.activeView === "calendar") {
    return null;
  }
  const room = getActiveRoom();
  return room ? ensureRoomStudio(room) : null;
}

export function ensureLawReviewsState() {
  if (!state.lawReviews || typeof state.lawReviews !== "object") {
    state.lawReviews = { items: [], activeId: "" };
  }
  if (!Array.isArray(state.lawReviews.items)) state.lawReviews.items = [];
  state.lawReviews.items = state.lawReviews.items
    .filter((item) => item && typeof item === "object")
    .map(normalizeLawReview);
  if (!state.lawReviews.items.some((item) => item.id === state.lawReviews.activeId)) {
    state.lawReviews.activeId = state.lawReviews.items[0]?.id || "";
  }
  return state.lawReviews;
}

export function createLawReview(seed = {}) {
  const now = new Date().toISOString();
  return normalizeLawReview({
    id: seed.id || crypto.randomUUID(),
    title: seed.title || "새 법령검토",
    input: seed.input || {},
    conditions: seed.conditions || {},
    documents: Array.isArray(seed.documents) ? seed.documents : [],
    reviewResult: seed.reviewResult || null,
    reviewError: typeof seed.reviewError === "string" ? seed.reviewError : "",
    reportCreatedAt: typeof seed.reportCreatedAt === "string" ? seed.reportCreatedAt : "",
    data: seed.data || null,
    terms: seed.terms || [],
    activeTab: seed.activeTab || "review",
    sourceRoomId: seed.sourceRoomId || "",
    migratedFromRoomStudio: seed.migratedFromRoomStudio === true,
    createdAt: seed.createdAt || now,
    updatedAt: seed.updatedAt || now
  });
}

export function getActiveLawReview() {
  const reviews = ensureLawReviewsState();
  return reviews.items.find((item) => item.id === reviews.activeId) || null;
}

export function ensureGrcReviewsState() {
  if (!state.grcReviews || typeof state.grcReviews !== "object") {
    state.grcReviews = { items: [], activeId: "" };
  }
  if (!Array.isArray(state.grcReviews.items)) state.grcReviews.items = [];
  state.grcReviews.items = state.grcReviews.items
    .filter((item) => item && typeof item === "object")
    .map(normalizeGrcReview);
  if (!state.grcReviews.items.some((item) => item.id === state.grcReviews.activeId)) {
    state.grcReviews.activeId = state.grcReviews.items[0]?.id || "";
  }
  return state.grcReviews;
}

export function createGrcReview(seed = {}) {
  const now = new Date().toISOString();
  return normalizeGrcReview({
    id: seed.id || crypto.randomUUID(),
    title: seed.title || "새 내부검토",
    policyMode: seed.policyMode || "upload",
    selectedNotebookId: seed.selectedNotebookId || "",
    policyDocName: seed.policyDocName || "",
    policyText: seed.policyText || "",
    targetDocName: seed.targetDocName || "",
    targetText: seed.targetText || "",
    reviewResult: seed.reviewResult || null,
    activeTab: seed.activeTab || "dashboard",
    errorMessage: seed.errorMessage || "",
    createdAt: seed.createdAt || now,
    updatedAt: seed.updatedAt || now
  });
}

export function getActiveGrcReview() {
  const reviews = ensureGrcReviewsState();
  return reviews.items.find((item) => item.id === reviews.activeId) || null;
}

function normalizeGrcReview(review) {
  const now = new Date().toISOString();
  const normalized = {
    id: typeof review.id === "string" && review.id ? review.id : crypto.randomUUID(),
    title: typeof review.title === "string" && review.title.trim() ? review.title.trim() : "새 내부검토",
    policyMode: review.policyMode === "notebook" ? "notebook" : "upload",
    selectedNotebookId: typeof review.selectedNotebookId === "string" ? review.selectedNotebookId : "",
    policyDocName: typeof review.policyDocName === "string" ? review.policyDocName : "",
    policyText: typeof review.policyText === "string" ? review.policyText : "",
    targetDocName: typeof review.targetDocName === "string" ? review.targetDocName : "",
    targetText: typeof review.targetText === "string" ? review.targetText : "",
    reviewResult: review.reviewResult && typeof review.reviewResult === "object" ? review.reviewResult : null,
    activeTab: typeof review.activeTab === "string" ? review.activeTab : "dashboard",
    errorMessage: typeof review.errorMessage === "string" ? review.errorMessage : "",
    pinnedAt: typeof review.pinnedAt === "string" && review.pinnedAt ? review.pinnedAt : null,
    createdAt: typeof review.createdAt === "string" ? review.createdAt : now,
    updatedAt: typeof review.updatedAt === "string" ? review.updatedAt : now
  };
  Object.assign(review, normalized);
  ensureGrcReviewStudio(review);
  return review;
}

function normalizeLawReview(review) {
  const now = new Date().toISOString();
  const normalized = {
    id: typeof review.id === "string" && review.id ? review.id : crypto.randomUUID(),
    title: typeof review.title === "string" && review.title.trim() ? review.title.trim() : "새 법령검토",
    input: review.input && typeof review.input === "object" ? review.input : {},
    conditions: review.conditions && typeof review.conditions === "object" ? review.conditions : {},
    documents: Array.isArray(review.documents) ? review.documents : [],
    reviewResult: review.reviewResult && typeof review.reviewResult === "object" ? review.reviewResult : null,
    reviewError: typeof review.reviewError === "string" ? review.reviewError : "",
    reportCreatedAt: typeof review.reportCreatedAt === "string" ? review.reportCreatedAt : "",
    data: review.data || null,
    terms: Array.isArray(review.terms) ? review.terms : [],
    activeTab: typeof review.activeTab === "string" ? review.activeTab : "review",
    sourceRoomId: typeof review.sourceRoomId === "string" ? review.sourceRoomId : "",
    migratedFromRoomStudio: review.migratedFromRoomStudio === true,
    pinnedAt: typeof review.pinnedAt === "string" && review.pinnedAt ? review.pinnedAt : null,
    createdAt: typeof review.createdAt === "string" ? review.createdAt : now,
    updatedAt: typeof review.updatedAt === "string" ? review.updatedAt : now
  };
  Object.assign(review, normalized);
  ensureLawReviewStudio(review);
  return review;
}

export function ensureDocumentTemplatesState() {
  if (!state.documentTemplates || typeof state.documentTemplates !== "object") {
    state.documentTemplates = { personal: [] };
  }
  if (!Array.isArray(state.documentTemplates.personal)) state.documentTemplates.personal = [];
  return state.documentTemplates;
}

export const DEFAULT_CUSTOM_PROMPTS = [
  {
    title: "요약",
    icon: "summary",
    content: `당신은 핵심을 빠르게 전달하는 정보 큐레이터입니다. 아래 내용을 읽고 다음 형식으로 요약해 주세요.

[형식]
- 한 줄 요지: 전체를 한 문장으로
- 핵심 포인트 3가지: 각 1~2줄
- 시사점: 독자가 알아두면 좋을 함의 1가지

[규칙]
- 원문에 없는 추측·일반론 금지
- 숫자·고유명사·인용은 원문 그대로 유지
- 미사여구와 중복 제거, 결론 우선

[대상 내용]
`
  },
  {
    title: "번역(한→영)",
    icon: "translate",
    content: `당신은 한→영 전문 번역가입니다. 아래 한국어 텍스트를 영어로 옮겨 주세요.

[지침]
- 원문의 톤(공식/캐주얼/기술)을 그대로 유지
- 직역이 아닌 자연스러운 관용 표현 사용
- 고유명사·숫자·코드·인용은 원문 유지
- 의미가 모호한 부분은 가장 가능성 높은 해석을 택하고 [translator's note: ...]로 표기

[출력 형식]
1) 번역문만 먼저 출력
2) 보충이 필요할 때만 하단에 'Notes:' 섹션 추가

[원문]
`
  },
  {
    title: "코드 리뷰",
    icon: "code",
    content: `당신은 시니어 소프트웨어 엔지니어이자 코드 리뷰어입니다. 아래 코드를 다음 관점에서 점검해 주세요.

[점검 항목]
1) 정확성: 버그·엣지케이스·논리 오류
2) 안전성: 입력 검증·인젝션·비밀값 노출
3) 가독성: 네이밍·함수 분리·중복
4) 성능: 불필요한 연산·메모리·I/O
5) 테스트 용이성

[출력 형식]
- 심각도 라벨: [Critical] / [Warning] / [Suggestion]
- 항목별로: 위치(라인) · 문제 · 권장 수정안(필요 시 짧은 스니펫)
- 마지막에 종합 평가 1~2줄

[코드]
`
  },
  {
    title: "회의록 정리",
    icon: "meeting",
    content: `당신은 숙련된 회의 서기입니다. 아래 회의 내용을 다음 구조로 정리해 주세요.

[형식]
## 회의 개요
- 일시·참석자·주제 (확인 가능한 경우만)

## 주요 논의
- 안건별로 그룹화, 핵심 발언자와 입장을 한두 줄로

## 결정사항
- 합의·결정된 항목만 불릿으로

## 액션 아이템
- [ ] (담당자) 작업 — 기한
- 담당·기한 불명확 시 '미정' 표기

[규칙]
- 잡담·중복 제거, 원문에 없는 내용 추가 금지
- 보류 항목은 별도 섹션에 명시

[회의 내용]
`
  },
  {
    title: "이메일 작성",
    icon: "email",
    content: `당신은 비즈니스 커뮤니케이션 전문가입니다. 아래 요지를 정중하고 명확한 한국어 이메일로 작성해 주세요.

[형식]
- 제목: 핵심을 한 줄로(15자 내외)
- 인사말: 간결한 격식
- 본문: 1) 용건·배경 → 2) 요청·제안 → 3) 기한·후속 조치
- 맺음말: 정중한 마무리 + 서명 자리([이름], [소속])

[톤]
- 존댓말, 단정하고 간결하게
- 과장·모호한 표현 지양
- 상대 직급·관계가 명시되면 그에 맞게 격식 조정

[요지]
`
  }
];

function makeCustomPromptId() {
  return `personal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

const LEGACY_DEFAULT_PROMPT_CONTENTS = {
  "요약": "다음 내용을 핵심만 3줄로 요약해줘:\n\n",
  "번역(한→영)": "다음 한국어 텍스트를 자연스러운 영어로 번역해줘:\n\n",
  "코드 리뷰": "다음 코드를 리뷰하고 개선점과 잠재적 버그를 알려줘:\n\n",
  "회의록 정리": "다음 회의 내용을 안건/논의/결정사항/액션아이템 구조로 정리해줘:\n\n",
  "이메일 작성": "다음 내용을 정중한 비즈니스 이메일로 작성해줘:\n\n"
};

export function ensureCustomPromptsState() {
  if (!state.customPrompts || typeof state.customPrompts !== "object") {
    state.customPrompts = { personal: [], seeded: false };
  }
  if (!Array.isArray(state.customPrompts.personal)) state.customPrompts.personal = [];
  if (typeof state.customPrompts.seeded !== "boolean") state.customPrompts.seeded = false;
  if (!state.customPrompts.seeded && state.customPrompts.personal.length === 0) {
    state.customPrompts.personal = DEFAULT_CUSTOM_PROMPTS.map((p) => ({
      id: makeCustomPromptId(),
      title: p.title,
      icon: p.icon,
      content: p.content
    }));
    state.customPrompts.seeded = true;
  } else {
    for (const item of state.customPrompts.personal) {
      const legacy = LEGACY_DEFAULT_PROMPT_CONTENTS[item.title];
      if (legacy && item.content === legacy) {
        const upgraded = DEFAULT_CUSTOM_PROMPTS.find((d) => d.title === item.title);
        if (upgraded) item.content = upgraded.content;
      }
    }
  }
  return state.customPrompts;
}

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
    materialsExpanded: false,
    materialGroups: {
      notebook: false,
      attachments: false,
      generatedSources: false
    },
    pendingCalendarAction: null,
    selectedNotebookId: null,
    studio: {
      mindmap: {
        signature: "",
        data: null,
        selectedNodeId: ""
      },
      documents: [],
      activeDocumentId: ""
    },
    pinnedAt: null,
    createdAt: now,
    updatedAt: now
  };
}
