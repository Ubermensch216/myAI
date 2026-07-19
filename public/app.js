import { displayFileName as formatDisplayFileName, fileTypeIcon as getFileTypeIcon } from "./fileDisplay.js";
import {
  state, elements, getActiveRoom, createRoom, showConfirmDialog, documentCacheHeaders,
  ensureLawReviewsState, createLawReview,
  ensureGrcReviewsState, createGrcReview, getActiveGrcReview
} from "./modules/state.js";
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
  restoreInflightForActiveRoom
} from "./modules/chat.js";
import {
  loadNotebooks, loadAdminStatus, restoreAdminTokenSession, restoreAccessSession,
  renderActiveNotebookUi, openNotebookSelector, closeNotebookSelector,
  findNotebookSummary, isAdminDialogOpen, bindAdminEvents
} from "./modules/notebook.js";
import {
  renderKnowledgePackPage, bindKnowledgePackEvents
} from "./modules/knowledgePack.js";
import { initSafeDoc, disposeSafeDoc } from "./modules/safeDoc/index.js";
import { renderBrand, closeSettings, bindSettingsEvents } from "./modules/settings.js";
import { renderCustomPromptPicker } from "./modules/customPrompts.js";
import { applyLayoutState, bindLayoutEvents } from "./modules/layout.js";
import { bindStudioEvents, renderStudio } from "./modules/studio.js";
import { bindLawWorkbenchEvents, renderLawWorkbench } from "./modules/lawWorkbench.js";
import { initDocTool } from "./modules/docTool.js";
import { toggleSelectionMode, exitSelectionMode, requestDeleteMessages, getSelectedIndicesSnapshot, refreshBulkBar } from "./modules/messageDelete.js";
import { openWithPreparedDraft } from "./modules/documentStudio.js";
import { isBriefingMessage, renderBriefingMessage } from "./modules/briefing.js";
import { bindImageGenEvents, isImageModeActive, handleImagePrompt } from "./modules/imageGen.js";

let titleTimer = null;
let dragDepth = 0;

const ROOM_FILE_SVG = {
  paperclip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"></path></svg>',
  notebook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"></path><path d="M5 17a3 3 0 0 1 3-3h11"></path></svg>',
  pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3l7 7-4 1-4 4-1 5-3-3-5 5 5-5-3-3 5-1 4-4z"></path></svg>',
  pinFilled: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor" stroke="currentColor"><path d="M14 3l7 7-4 1-4 4-1 5-3-3-5 5 5-5-3-3 5-1 4-4z"></path></svg>',
  kebab: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><circle cx="12" cy="5" r="1.7"></circle><circle cx="12" cy="12" r="1.7"></circle><circle cx="12" cy="19" r="1.7"></circle></svg>',
  menuPin: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3l7 7-4 1-4 4-1 5-3-3-5 5 5-5-3-3 5-1 4-4z"></path></svg>',
  menuRename: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><path d="M14.5 4.5l5 5L8 21H3v-5z"></path></svg>',
  menuDelete: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"></path><path d="M10 11v6M14 11v6"></path><path d="M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13"></path><path d="M9 7V4h6v3"></path></svg>'
};

function closeAllRoomKebabMenus() {
  document.querySelectorAll(".room-kebab-menu").forEach((menu) => menu.remove());
  document.querySelectorAll(".room-kebab.open").forEach((btn) => btn.classList.remove("open"));
}

document.addEventListener("click", (event) => {
  if (!event.target.closest(".room-kebab") && !event.target.closest(".room-kebab-menu")) {
    closeAllRoomKebabMenus();
  }
});
window.addEventListener("resize", closeAllRoomKebabMenus);
window.addEventListener("scroll", closeAllRoomKebabMenus, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllRoomKebabMenus();
});

function createRoomKebabMenu({ isPinned, onPin, onRename, onDelete, ariaLabel = "항목 메뉴" }) {
  const button = document.createElement("span");
  button.className = "room-kebab";
  button.setAttribute("role", "button");
  button.setAttribute("tabindex", "0");
  button.setAttribute("aria-label", ariaLabel);
  button.title = ariaLabel;
  button.innerHTML = ROOM_FILE_SVG.kebab;

  const buildMenuItem = (label, iconHtml, handler, opts = {}) => {
    const itemBtn = document.createElement("button");
    itemBtn.type = "button";
    itemBtn.className = "room-kebab-menu-item" + (opts.danger ? " danger" : "");
    const iconSpan = document.createElement("span");
    iconSpan.className = "room-kebab-menu-icon";
    iconSpan.innerHTML = iconHtml;
    const textSpan = document.createElement("span");
    textSpan.textContent = label;
    itemBtn.append(iconSpan, textSpan);
    itemBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      closeAllRoomKebabMenus();
      handler();
    });
    return itemBtn;
  };

  const openMenu = (event) => {
    event.stopPropagation();
    event.preventDefault();
    const wasOpen = button.classList.contains("open");
    closeAllRoomKebabMenus();
    if (wasOpen) return;
    button.classList.add("open");

    const menu = document.createElement("div");
    menu.className = "room-kebab-menu";
    menu.addEventListener("click", (e) => e.stopPropagation());

    menu.append(buildMenuItem(isPinned ? "고정 해제" : "고정", ROOM_FILE_SVG.menuPin, onPin));
    menu.append(buildMenuItem("이름 변경", ROOM_FILE_SVG.menuRename, onRename));

    const sep = document.createElement("div");
    sep.className = "room-kebab-menu-sep";
    menu.append(sep);

    menu.append(buildMenuItem("삭제", ROOM_FILE_SVG.menuDelete, onDelete, { danger: true }));

    document.body.append(menu);
    const rect = button.getBoundingClientRect();
    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    let top = rect.bottom + 4;
    if (top + menuHeight > window.innerHeight - 8) top = Math.max(8, rect.top - menuHeight - 4);
    let left = rect.right - menuWidth;
    if (left < 8) left = Math.min(rect.left, window.innerWidth - menuWidth - 8);
    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  };

  button.addEventListener("click", openMenu);
  button.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") openMenu(event);
  });

  return button;
}

function startInlineRename(itemEl, titleEl, currentTitle, onCommit) {
  if (!itemEl || !titleEl) return;
  if (itemEl.querySelector(".room-rename-input")) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "room-rename-input";
  input.value = currentTitle || "";
  input.setAttribute("aria-label", "이름 변경");
  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => e.stopPropagation());
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    if (commit) {
      const next = input.value.trim();
      if (next && next !== currentTitle) onCommit(next);
    }
    if (typeof window !== "undefined") {
      // Re-render owner is responsible for replacing the input; if it's still in DOM, restore titleEl.
      if (input.isConnected) input.replaceWith(titleEl);
    }
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

// ===== Boot =====

async function init() {
  await initializeEncryptedStorage();
  await loadAppState();
  ensureRoom();
  if (state.activeView === "law") ensureLawReview();
  bindEvents();
  renderAll();
  // 저장된 뷰가 문서보안이면 applyActiveView 를 거치지 않고 곧장 복원되므로
  // 여기서 초기화한다. (applyActiveView 는 뷰가 이미 같으면 조기 반환한다)
  if (state.activeView === "safedoc") initSafeDoc();
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
window.addEventListener("myai:renderlawreviews", () => renderLawReviews());
window.addEventListener("myai:rendermessages", () => renderMessages());
window.addEventListener("myai:renderall", () => renderAll());

window.scheduleSave = scheduleSave;
window.renderGrcReviews = renderGrcReviews;
window.addEventListener("myai:closeattachmenu", () => closeAttachMenu());
window.addEventListener("myai:closesettings", () => closeSettings());
window.addEventListener("myai:setview", (event) => {
  applyActiveView(normalizeView(event.detail));
});

window.addEventListener("myai:grc:save-output", async (event) => {
  const { title, markdown, metadata = {}, source = {} } = event.detail;
  try {
    await openWithPreparedDraft({
      title,
      markdown,
      metadata,
      source: {
        sourceType: "grc_review",
        roomId: state.activeView === "law" ? "" : state.activeRoomId || "",
        ...source
      }
    });
  } catch (error) {
    console.error("GRC Studio output saving failed:", error);
  }
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

function ensureLawReview() {
  const reviews = ensureLawReviewsState();
  if (!reviews.items.length) {
    const review = createLawReview();
    reviews.items.unshift(review);
    reviews.activeId = review.id;
    scheduleSave();
  }
  return reviews.items.find((item) => item.id === reviews.activeId) || null;
}

function createNewLawReview() {
  const reviews = ensureLawReviewsState();
  const review = createLawReview();
  reviews.items.unshift(review);
  reviews.activeId = review.id;
  state.activeView = "law";
  scheduleSave();
  renderAll();
  elements.lawWorkbenchQuery?.focus();
}

function ensureGrcReview() {
  const reviews = ensureGrcReviewsState();
  if (!reviews.items.length) {
    const review = createGrcReview();
    reviews.items.unshift(review);
    reviews.activeId = review.id;
    scheduleSave();
  }
  return reviews.items.find((item) => item.id === reviews.activeId) || null;
}

function createNewGrcReview() {
  const reviews = ensureGrcReviewsState();
  const review = createGrcReview();
  reviews.items.unshift(review);
  reviews.activeId = review.id;
  state.activeView = "grc";
  scheduleSave();
  renderAll();
  window.dispatchEvent(new CustomEvent("myai:grcreviewchange", { detail: { reviewId: review.id } }));
  if (window.MyAIFrontend?.mountGrcWorkbench) window.MyAIFrontend.mountGrcWorkbench();
}

async function deleteGrcReview(reviewId) {
  const confirmed = await showConfirmDialog({
    title: "내부검토 삭제",
    body: "이 내부검토 항목을 삭제할까요? 검토 결과와 입력 내용이 모두 삭제됩니다.",
    okText: "삭제",
    cancelText: "취소",
    danger: true
  });
  if (!confirmed) return;
  const reviews = ensureGrcReviewsState();
  const wasActive = reviews.activeId === reviewId;
  reviews.items = reviews.items.filter((item) => item.id !== reviewId);
  if (wasActive) reviews.activeId = reviews.items[0]?.id || "";
  scheduleSave();
  renderAll();
  if (wasActive) {
    window.dispatchEvent(new CustomEvent("myai:grcreviewchange", { detail: { reviewId: reviews.activeId } }));
    if (window.MyAIFrontend?.mountGrcWorkbench) window.MyAIFrontend.mountGrcWorkbench();
  }
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
  renderLawReviews();
  renderGrcReviews();
  renderHeader();
  renderMessages();
  renderCalendar();
  renderLawWorkbench();
  renderActiveNotebookUi();
  renderMaterialContext();
  applyLayoutState();
  renderStudio();
}

function renderPrimaryNav() {
  const view = normalizeView(state.activeView);
  state.activeView = view;
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
  if (elements.lawArea) elements.lawArea.hidden = view !== "law";
  if (elements.grcArea) elements.grcArea.hidden = view !== "grc";
  if (elements.knowledgeArea) elements.knowledgeArea.hidden = view !== "knowledge";
  if (elements.safeDocArea) elements.safeDocArea.hidden = view !== "safedoc";
}

function updatePrimaryNavTooltip(item) {
  const label = item.dataset.navLabel || item.textContent.trim();
  const shortcutKey = item.dataset.shortcutKey;
  item.title = shortcutKey ? `${label} (shift+${shortcutKey.toUpperCase()})` : label;
}

function applyActiveView(view) {
  const next = normalizeView(view);
  if (state.activeView === next) return;
  // 문서보안 화면을 떠날 때는 작업 세션(원본 문서·개인정보 원문·대응표)을 즉시
  // 폐기한다. SPA라 화면만 숨기면 메모리에 계속 남는다.
  if (state.activeView === "safedoc") disposeSafeDoc();
  if (next === "law") ensureLawReview();
  state.activeView = next;
  scheduleSave();
  renderPrimaryNav();
  renderStudio();
  if (next === "calendar") renderCalendar();
  if (next === "law") {
    renderLawReviews();
    renderLawWorkbench();
    elements.lawWorkbenchQuery?.focus();
  }
  if (next === "grc") {
    ensureGrcReview();
    renderGrcReviews();
    if (window.MyAIFrontend && typeof window.MyAIFrontend.mountGrcWorkbench === "function") {
      window.MyAIFrontend.mountGrcWorkbench();
    }
  }
  if (next === "knowledge") {
    renderKnowledgePackPage();
  }
  if (next === "safedoc") {
    initSafeDoc();
  }
  window.dispatchEvent(new CustomEvent("myai:viewchange", { detail: { view: next } }));
}

function normalizeView(view) {
  return view === "calendar" || view === "law" || view === "grc" || view === "knowledge" || view === "safedoc" ? view : "chat";
}

function sortRoomsForRender(rooms) {
  const indexed = rooms.map((room, originalIndex) => ({ room, originalIndex }));
  indexed.sort((a, b) => {
    const aPin = a.room.pinnedAt || null;
    const bPin = b.room.pinnedAt || null;
    if (aPin && !bPin) return -1;
    if (!aPin && bPin) return 1;
    if (aPin && bPin) {
      if (aPin > bPin) return -1;
      if (aPin < bPin) return 1;
      return 0;
    }
    return a.originalIndex - b.originalIndex;
  });
  return indexed.map(({ room }) => room);
}

function renderRooms() {
  elements.roomList.innerHTML = "";

  const sortedRooms = sortRoomsForRender(state.rooms);

  for (const room of sortedRooms) {
    const isPinned = Boolean(room.pinnedAt);
    const item = document.createElement("button");
    item.type = "button";
    item.className = `room-item${room.id === state.activeRoomId ? " active" : ""}${isPinned ? " pinned" : ""}`;
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

    if (isPinned) {
      const pinInd = document.createElement("span");
      pinInd.className = "room-status-indicator room-pin-indicator";
      pinInd.title = "고정됨";
      pinInd.setAttribute("role", "img");
      pinInd.setAttribute("aria-label", "고정됨");
      pinInd.innerHTML = ROOM_FILE_SVG.pinFilled;
      indicators.append(pinInd);
    }

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
    notebookIndicator.title = "지식팩 있음";
    notebookIndicator.setAttribute("role", "img");
    notebookIndicator.setAttribute("aria-label", "지식팩 있음");
    if (room.selectedNotebookId) {
      notebookIndicator.innerHTML = ROOM_FILE_SVG.notebook;
      indicators.append(notebookIndicator);
    }
    indicators.hidden = !indicators.childElementCount;

    const kebab = createRoomKebabMenu({
      isPinned,
      ariaLabel: "대화방 메뉴",
      onPin: () => {
        room.pinnedAt = room.pinnedAt ? null : new Date().toISOString();
        scheduleSave();
        renderRooms();
      },
      onRename: () => {
        startInlineRename(item, title, room.title, (next) => {
          room.title = next;
          room.updatedAt = new Date().toISOString();
          scheduleSave();
          renderRooms();
          renderHeader();
        });
      },
      onDelete: () => { deleteRoom(room.id); }
    });

    item.append(title, indicators, kebab);
    elements.roomList.append(item);
  }
}

function sortLawReviewsForRender(reviewsList) {
  const indexed = reviewsList.map((review, originalIndex) => ({ review, originalIndex }));
  indexed.sort((a, b) => {
    const aPin = a.review.pinnedAt || null;
    const bPin = b.review.pinnedAt || null;
    if (aPin && !bPin) return -1;
    if (!aPin && bPin) return 1;
    if (aPin && bPin) {
      if (aPin > bPin) return -1;
      if (aPin < bPin) return 1;
    }
    const aUpdated = String(a.review.updatedAt || "");
    const bUpdated = String(b.review.updatedAt || "");
    if (aUpdated !== bUpdated) return bUpdated.localeCompare(aUpdated);
    return a.originalIndex - b.originalIndex;
  });
  return indexed.map(({ review }) => review);
}

async function deleteLawReview(reviewId) {
  const confirmed = await showConfirmDialog({
    title: "법령검토 삭제",
    body: "이 법령검토 항목을 삭제할까요? 검토 결과와 입력 내용이 모두 삭제됩니다.",
    okText: "삭제",
    cancelText: "취소",
    danger: true
  });
  if (!confirmed) return;
  const reviews = ensureLawReviewsState();
  const wasActive = reviews.activeId === reviewId;
  reviews.items = reviews.items.filter((item) => item.id !== reviewId);
  if (wasActive) reviews.activeId = reviews.items[0]?.id || "";
  scheduleSave();
  renderAll();
}

function renderLawReviews() {
  if (!elements.lawReviewList) return;
  const reviews = ensureLawReviewsState();
  elements.lawReviewList.innerHTML = "";
  const sortedReviews = sortLawReviewsForRender(reviews.items);

  if (!sortedReviews.length) {
    const empty = document.createElement("div");
    empty.className = "law-review-list-empty";
    empty.textContent = "아직 검토 목록이 없습니다.";
    elements.lawReviewList.append(empty);
    return;
  }

  for (const review of sortedReviews) {
    const isPinned = Boolean(review.pinnedAt);
    const item = document.createElement("button");
    item.type = "button";
    item.className = `room-item law-review-item${review.id === reviews.activeId ? " active" : ""}${isPinned ? " pinned" : ""}`;
    item.addEventListener("click", () => {
      if (reviews.activeId === review.id) return;
      reviews.activeId = review.id;
      state.activeView = "law";
      scheduleSave();
      renderAll();
      elements.lawWorkbenchQuery?.focus();
    });

    const title = document.createElement("span");
    title.className = "room-item-title";
    title.textContent = review.title || "새 법령검토";

    const pinIndicator = document.createElement("span");
    pinIndicator.className = "room-pin-indicator";
    pinIndicator.setAttribute("role", "img");
    pinIndicator.setAttribute("aria-label", "고정됨");
    pinIndicator.title = "고정됨";
    pinIndicator.innerHTML = ROOM_FILE_SVG.pinFilled;
    pinIndicator.hidden = !isPinned;

    const kebab = createRoomKebabMenu({
      isPinned,
      ariaLabel: "법령검토 메뉴",
      onPin: () => {
        review.pinnedAt = review.pinnedAt ? null : new Date().toISOString();
        review.updatedAt = new Date().toISOString();
        scheduleSave();
        renderLawReviews();
      },
      onRename: () => {
        startInlineRename(item, title, review.title, (next) => {
          review.title = next;
          review.updatedAt = new Date().toISOString();
          scheduleSave();
          renderLawReviews();
        });
      },
      onDelete: () => { deleteLawReview(review.id); }
    });

    item.append(title, pinIndicator, kebab);
    elements.lawReviewList.append(item);
  }
}

function renderGrcReviews() {
  if (!elements.grcReviewList) return;
  const reviews = ensureGrcReviewsState();
  elements.grcReviewList.innerHTML = "";
  const sortedReviews = sortLawReviewsForRender(reviews.items);

  if (!sortedReviews.length) {
    const empty = document.createElement("div");
    empty.className = "law-review-list-empty";
    empty.textContent = "아직 내부검토 항목이 없습니다.";
    elements.grcReviewList.append(empty);
    return;
  }

  for (const review of sortedReviews) {
    const isPinned = Boolean(review.pinnedAt);
    const item = document.createElement("button");
    item.type = "button";
    item.className = `room-item law-review-item${review.id === reviews.activeId ? " active" : ""}${isPinned ? " pinned" : ""}`;
    item.addEventListener("click", () => {
      if (reviews.activeId === review.id) return;
      reviews.activeId = review.id;
      state.activeView = "grc";
      scheduleSave();
      renderAll();
      window.dispatchEvent(new CustomEvent("myai:grcreviewchange", { detail: { reviewId: review.id } }));
      if (window.MyAIFrontend?.mountGrcWorkbench) window.MyAIFrontend.mountGrcWorkbench();
    });

    const title = document.createElement("span");
    title.className = "room-item-title";
    title.textContent = review.title || "새 내부검토";

    const pinIndicator = document.createElement("span");
    pinIndicator.className = "room-pin-indicator";
    pinIndicator.setAttribute("role", "img");
    pinIndicator.setAttribute("aria-label", "고정됨");
    pinIndicator.title = "고정됨";
    pinIndicator.innerHTML = ROOM_FILE_SVG.pinFilled;
    pinIndicator.hidden = !isPinned;

    const kebab = createRoomKebabMenu({
      isPinned,
      ariaLabel: "내부검토 메뉴",
      onPin: () => {
        review.pinnedAt = review.pinnedAt ? null : new Date().toISOString();
        review.updatedAt = new Date().toISOString();
        scheduleSave();
        renderGrcReviews();
      },
      onRename: () => {
        startInlineRename(item, title, review.title, (next) => {
          review.title = next;
          review.updatedAt = new Date().toISOString();
          scheduleSave();
          renderGrcReviews();
        });
      },
      onDelete: () => { deleteGrcReview(review.id); }
    });

    item.append(title, pinIndicator, kebab);
    elements.grcReviewList.append(item);
  }
}

function formatLawReviewDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ko-KR", { month: "short", day: "numeric" });
}

function getActiveMaterials(room = getActiveRoom()) {
  const documents = Array.isArray(room?.documents) ? room.documents : [];
  const generatedSources = documents.filter(isGeneratedSource);
  const attachments = documents.filter((doc) => !isGeneratedSource(doc));
  const notebook = room?.selectedNotebookId ? findNotebookSummary(room.selectedNotebookId) : null;
  return {
    documents,
    attachments,
    generatedSources,
    notebook,
    hasNotebook: Boolean(room?.selectedNotebookId),
    count: documents.length + (room?.selectedNotebookId ? 1 : 0)
  };
}

function renderMaterialContext() {
  const room = getActiveRoom();
  const { documents, attachments, generatedSources, notebook, hasNotebook, count } = getActiveMaterials(room);
  const expanded = Boolean(room?.materialsExpanded && count);

  if (elements.materialToggleButton) {
    elements.materialToggleButton.hidden = count === 0;
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
    setDeepAnalysisEnabled(false);
    return;
  }

  if (elements.materialPanel) elements.materialPanel.hidden = !expanded;
  if (elements.materialSummaryLabel) elements.materialSummaryLabel.textContent = `자료(${count}개)`;
  if (elements.materialClearButton) elements.materialClearButton.hidden = documents.length === 0;
  renderMaterialList({ room, documents, attachments, generatedSources, notebook, hasNotebook });
  renderDeepAnalysisToggle();
}

function renderMaterialList({ room, documents, attachments, generatedSources, notebook, hasNotebook }) {
  if (!elements.materialList) return;
  elements.materialList.innerHTML = "";
  const groups = ensureMaterialGroupState(room);

  if (hasNotebook) {
    elements.materialList.append(buildMaterialTreeGroup({
      key: "notebook",
      title: "지식팩",
      count: 1,
      collapsed: groups.notebook,
      children: [buildNotebookMaterialItem(notebook)]
    }));
  }

  if (attachments.length) {
    elements.materialList.append(buildMaterialTreeGroup({
      key: "attachments",
      title: "첨부",
      count: attachments.length,
      collapsed: groups.attachments,
      children: attachments.map(buildAttachmentMaterialItem)
    }));
  }

  if (generatedSources.length) {
    elements.materialList.append(buildMaterialTreeGroup({
      key: "generatedSources",
      title: "AI 생성 자료",
      count: generatedSources.length,
      collapsed: groups.generatedSources,
      children: generatedSources.map(buildAttachmentMaterialItem)
    }));
  }
}

function ensureMaterialGroupState(room = getActiveRoom()) {
  if (!room) return { notebook: false, attachments: false, generatedSources: false };
  if (!room.materialGroups || typeof room.materialGroups !== "object") {
    room.materialGroups = { notebook: false, attachments: false, generatedSources: false };
  }
  room.materialGroups.notebook = Boolean(room.materialGroups.notebook);
  room.materialGroups.attachments = Boolean(room.materialGroups.attachments);
  room.materialGroups.generatedSources = Boolean(room.materialGroups.generatedSources);
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
  item.title = "지식팩 변경";
  item.addEventListener("click", () => openNotebookSelector());
  const icon = document.createElement("span");
  icon.className = "material-tree-icon";
  icon.innerHTML = ROOM_FILE_SVG.notebook;
  const name = document.createElement("span");
  name.className = "material-tree-name";
  name.textContent = notebook?.name || "지식팩";
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
  if (isGeneratedSource(doc)) {
    const badges = document.createElement("span");
    badges.className = "source-trust-badges";
    for (const label of doc.labels || ["AI 생성", "검증 필요"]) {
      const badge = document.createElement("span");
      badge.className = "source-trust-badge";
      badge.textContent = label;
      badges.append(badge);
    }
    name.append(" ", badges);
  }
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

function isGeneratedSource(doc) {
  return doc?.trustLevel === "generated" || doc?.origin === "assistant_answer" || doc?.type === "generated_answer";
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

function renderHeader() {
  const room = getActiveRoom();
  elements.roomTitleInput.value = room?.title || "";
}

function renderMessages() {
  const room = getActiveRoom();
  elements.messages.innerHTML = "";
  if (!room || !room.messages.length) {
    appendWelcomeScreen();
    restoreInflightForActiveRoom();
    return;
  }
  for (const [index, message] of room.messages.entries()) {
    if (isBriefingMessage(message)) {
      const card = renderBriefingMessage(message, index);
      if (card) elements.messages.append(card);
      continue;
    }
    appendMessage(message.role, message.content, {
      persist: false,
      messageIndex: index,
      suggestions: shouldRenderMessageSuggestions(message) ? message.suggestions : [],
      visualization: message.visualization,
      eventCards: message.eventCards,
      createdAt: message.createdAt,
      citations: message.citations,
      law: message.law,
      compliance: message.compliance,
      sources: message.sources,
      image: message.image
    });
  }
  restoreInflightForActiveRoom();
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
    elements.modelInput.value = status.defaultModel || "gemma4:e2b";
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

function renderLawSearchMode() {
  const btn = elements.lawSearchButton;
  if (btn) btn.setAttribute("aria-pressed", String(state.lawSearchMode));
  const activeBtn = elements.lawSearchActiveButton;
  if (activeBtn) {
    activeBtn.hidden = !state.lawSearchMode;
    activeBtn.setAttribute("aria-pressed", String(state.lawSearchMode));
    activeBtn.setAttribute("aria-label", state.lawSearchMode ? "법령검색 모드 끄기" : "법령검색 모드");
    activeBtn.title = state.lawSearchMode ? "법령검색 모드 끄기" : "법령검색 모드";
  }
  const ta = elements.promptInput;
  if (ta) {
    const appName = state.settings?.appName || "myAI";
    ta.placeholder = state.lawSearchMode
      ? "법령 검색 모드: 공식 근거가 확인된 경우에만 답변합니다"
      : `${appName}에게 물어보세요 [Shift+I]`;
  }
}

function toggleLawSearchMode() {
  state.lawSearchMode = !state.lawSearchMode;
  renderLawSearchMode();
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
      else if (state.activeView === "law") createNewLawReview();
      else if (state.activeView === "knowledge") {
        // 지식팩 뷰에서 shift+N: 대화 뷰로 전환 후 새 대화 생성
        applyActiveView("chat");
        createNewRoom();
      }
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
  elements.newLawReviewButton?.addEventListener("click", createNewLawReview);
  elements.newGrcReviewButton?.addEventListener("click", createNewGrcReview);
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
  bindLawWorkbenchEvents();
  bindKnowledgePackEvents();
  initDocTool();
  bindImageGenEvents();

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
  if (elements.selectionModeToggle) {
    elements.selectionModeToggle.addEventListener("click", (event) => {
      event.preventDefault();
      toggleSelectionMode();
    });
  }
  if (elements.bulkDeleteButton) {
    elements.bulkDeleteButton.addEventListener("click", (event) => {
      event.preventDefault();
      const indices = getSelectedIndicesSnapshot();
      if (!indices.length) return;
      requestDeleteMessages(indices);
    });
  }
  if (elements.bulkCancelButton) {
    elements.bulkCancelButton.addEventListener("click", (event) => {
      event.preventDefault();
      exitSelectionMode();
    });
  }
  refreshBulkBar();

  // Notebook
  if (elements.attachNotebookButton) {
    elements.attachNotebookButton.addEventListener("click", (event) => {
      event.stopPropagation();
      openNotebookSelector();
      closeAttachMenu();
    });
  }
  if (elements.attachCustomPromptButton) {
    elements.attachCustomPromptButton.addEventListener("click", (event) => { event.stopPropagation(); toggleCustomPromptPicker(); });
  }
  if (elements.lawSearchButton) {
    elements.lawSearchButton.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleLawSearchMode();
      closeAttachMenu();
    });
  }
  if (elements.lawSearchActiveButton) {
    elements.lawSearchActiveButton.addEventListener("click", (event) => {
      event.preventDefault();
      toggleLawSearchMode();
    });
  }
  renderLawSearchMode();
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

  if (elements.stopGenerationButton) {
    elements.stopGenerationButton.addEventListener("click", () => stopGeneration());
  }

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
    if (isImageModeActive()) {
      await handleImagePrompt(prompt);
      return;
    }
    await sendMessage(prompt);
  });
}
