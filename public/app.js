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

const state = {
  rooms: [],
  activeRoomId: null,
  settings: {
    userTitle: "사용자님",
    aiName: "Ollama Chatter",
    appName: "Ollama Chatter",
    theme: "light",
    colorTheme: "busan",
    appBannerDataUrl: "",
    appLogoDataUrl: "",
    userAvatarDataUrl: "",
    customPrompt: ""
  },
  busy: false,
  abortController: null,
  db: null,
  cryptoKey: null
};

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
  userAvatarInput: document.querySelector("#userAvatarInput"),
  userAvatarPreview: document.querySelector("#userAvatarPreview"),
  userAvatarPicker: document.querySelector("#userAvatarPicker"),
  userAvatarTrigger: document.querySelector("#userAvatarTrigger"),
  changeAvatarButton: document.querySelector("#changeAvatarButton"),
  removeAvatarButton: document.querySelector("#removeAvatarButton")
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
  checkStatus();
}

function bindEvents() {
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

  elements.appBannerTrigger.addEventListener("click", openBannerPicker);
  elements.changeBannerButton.addEventListener("click", openBannerPicker);
  elements.userAvatarTrigger.addEventListener("click", () => {
    if (elements.userAvatarPicker.dataset.state === "empty") openAvatarPicker();
  });
  elements.changeAvatarButton.addEventListener("click", openAvatarPicker);

  elements.removeBannerButton.addEventListener("click", () => {
    state.settings.appBannerDataUrl = "";
    renderBannerPreview();
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
    if (event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && event.key.toLowerCase() === "n") {
      const target = event.target;
      const isTyping = target instanceof HTMLElement
        && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (!isTyping) {
        event.preventDefault();
        if (!state.busy) createNewRoom();
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
  state.activeRoomId = stored.activeRoomId || null;
  const appName = stored.settings?.appName || stored.settings?.aiName || "Ollama Chatter";
  state.settings = {
    userTitle: stored.settings?.userTitle || "사용자님",
    aiName: appName,
    appName,
    theme: stored.settings?.theme === "dark" ? "dark" : "light",
    colorTheme: normalizeColorTheme(stored.settings?.colorTheme),
    appBannerDataUrl: stored.settings?.appBannerDataUrl || "",
    appLogoDataUrl: stored.settings?.appLogoDataUrl || "",
    userAvatarDataUrl: stored.settings?.userAvatarDataUrl || "",
    customPrompt: stored.settings?.customPrompt || ""
  };
}

async function saveAppState() {
  await saveEncryptedRecord(APP_STATE_KEY, {
    rooms: state.rooms,
    activeRoomId: state.activeRoomId,
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
  renderRooms();
  renderHeader();
  renderMessages();
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
      createdAt: message.createdAt
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

  await requestAssistantResponse(room);
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
        personalization: getPersonalizationSettings()
      })
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(errorText || "응답 생성 실패");
    }

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
      streaming: true,
      visualization
    });
    assistantBody = assistant.querySelector(".message-body");
    assistant.dataset.copyText = finalAnswer;
    renderAssistantContent(assistantBody, finalAnswer);
    assistantBody.append(renderVisualizationSpec(visualization));
    assistantBody.classList.add("has-visualization");
    assistant.classList.remove("streaming");
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
  if (role === "user" && state.settings.userAvatarDataUrl) {
    const avatar = document.createElement("img");
    avatar.className = "message-meta-avatar";
    avatar.src = state.settings.userAvatarDataUrl;
    avatar.alt = "";
    meta.append(metaLabel, avatar);
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
    }
  } else {
    body.textContent = text;
  }

  article.append(meta, body);
  article.append(createMessageActions(article, role, options.createdAt));
  if (role === "assistant") renderFollowupSuggestions(article, options.suggestions);
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
  const avatar = state.settings.userAvatarDataUrl;
  if (avatar) {
    elements.userAvatarPreview.src = avatar;
    elements.userAvatarPreview.hidden = false;
    elements.userAvatarPicker.dataset.state = "filled";
  } else {
    elements.userAvatarPreview.hidden = true;
    elements.userAvatarPreview.removeAttribute("src");
    elements.userAvatarPicker.dataset.state = "empty";
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
