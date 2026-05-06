import {
  state, elements,
  DB_NAME, DB_VERSION, APP_STATE_KEY, KEY_ID,
  documentCacheHeaders, ensureDocumentCacheKey,
  normalizeCalendarViewMode, normalizeCalendarEvent, normalizeColorTheme
} from "./state.js";

let saveTimer = null;

// ===== IndexedDB =====

export async function initializeEncryptedStorage() {
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

// ===== Encrypted record I/O =====

export async function saveEncryptedRecord(id, value) {
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

export async function loadEncryptedRecord(id) {
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

// ===== App state load / save =====

export async function loadAppState() {
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
  state.client = {
    documentCacheKey: typeof stored.client?.documentCacheKey === "string" && stored.client.documentCacheKey
      ? stored.client.documentCacheKey
      : ensureDocumentCacheKey()
  };
  const storedEvents = Array.isArray(stored.calendar?.events) ? stored.calendar.events : [];
  state.calendar.events = storedEvents.map(normalizeCalendarEvent).filter((e) => e && e.id && e.start);
  state.calendar.cursorISO = stored.calendar?.cursorISO || new Date().toISOString().slice(0, 10);
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

export async function saveAppState() {
  await saveEncryptedRecord(APP_STATE_KEY, {
    rooms: state.rooms,
    activeRoomId: state.activeRoomId,
    activeView: state.activeView,
    client: {
      documentCacheKey: ensureDocumentCacheKey()
    },
    calendar: {
      events: state.calendar.events,
      cursorISO: state.calendar.cursorISO,
      viewMode: state.calendar.viewMode
    },
    settings: state.settings,
    savedAt: new Date().toISOString()
  });
}

export function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => persistAppState(), 100);
}

export async function persistAppState() {
  try {
    await saveAppState();
    return true;
  } catch (error) {
    handleLocalSaveError(error);
    return false;
  }
}

export function handleLocalSaveError(error) {
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

// ===== Document hydration =====

export async function hydrateStoredDocuments() {
  let changed = false;
  for (const room of state.rooms) {
    if (!Array.isArray(room.documents)) {
      room.documents = [];
      changed = true;
      continue;
    }
    for (let index = 0; index < room.documents.length; index += 1) {
      const doc = room.documents[index];
      if (normalizeStoredDocumentContent(doc)) changed = true;
      if (!doc?.id || hasPersistentDocumentContent(doc)) continue;
      try {
        const response = await fetch(`/api/documents/${doc.id}`, { headers: documentCacheHeaders() });
        if (!response.ok) continue;
        const result = await response.json();
        if (result.document) {
          normalizeStoredDocumentContent(result.document);
          room.documents[index] = result.document;
          changed = true;
        }
      } catch {
        // Keep existing summary; user can re-upload if server copy is gone.
      }
    }
  }
  if (changed) await persistAppState();
  return changed;
}

export function hasPersistentDocumentContent(doc) {
  if (doc.kind === "image") return Boolean(doc.imageBase64);
  return Boolean(
    doc.text ||
    doc.pages?.some((page) => page.text) ||
    doc.sheets?.some((sheet) => sheet.text)
  );
}

export function normalizeStoredDocumentContent(doc) {
  if (!doc || doc.kind !== "document" || doc.text) return false;
  const pageText = Array.isArray(doc.pages)
    ? doc.pages.map((p) => p.text).filter(Boolean).join("\n\n")
    : "";
  const sheetText = Array.isArray(doc.sheets)
    ? doc.sheets.map((s) => s.text).filter(Boolean).join("\n\n")
    : "";
  const text = pageText || sheetText;
  if (!text) return false;
  doc.text = text;
  doc.textLength = text.length;
  doc.preview = text.slice(0, 280);
  return true;
}
