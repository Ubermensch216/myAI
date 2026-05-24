import {
  state, elements,
  DB_NAME, DB_VERSION, APP_STATE_KEY, KEY_ID,
  documentCacheHeaders, ensureDocumentCacheKey,
  normalizeCalendarViewMode, normalizeCalendarEvent, normalizeColorTheme,
  normalizeCustomColorTheme, normalizeLayout, normalizeResponseStyle,
  ensureRoomStudio, ensureDocumentTemplatesState, ensureCustomPromptsState,
  ensureLawReviewsState, createLawReview,
  ensureGrcReviewsState
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
    ensureRoomStudio(room);
  }
  state.lawReviews = stored.lawReviews && typeof stored.lawReviews === "object"
    ? {
        items: Array.isArray(stored.lawReviews.items) ? stored.lawReviews.items : [],
        activeId: typeof stored.lawReviews.activeId === "string" ? stored.lawReviews.activeId : ""
      }
    : { items: [], activeId: "" };
  ensureLawReviewsState();
  migrateLegacyLawWorkbenchFromRooms();
  state.grcReviews = stored.grcReviews && typeof stored.grcReviews === "object"
    ? {
        items: Array.isArray(stored.grcReviews.items) ? stored.grcReviews.items : [],
        activeId: typeof stored.grcReviews.activeId === "string" ? stored.grcReviews.activeId : ""
      }
    : { items: [], activeId: "" };
  ensureGrcReviewsState();
  state.activeRoomId = stored.activeRoomId || null;
  state.activeView = ["chat", "law", "grc", "calendar"].includes(stored.activeView) ? stored.activeView : "chat";
  state.client = {
    documentCacheKey: typeof stored.client?.documentCacheKey === "string" && stored.client.documentCacheKey
      ? stored.client.documentCacheKey
      : ensureDocumentCacheKey()
  };
  state.layout = normalizeLayout(stored.layout);
  const storedEvents = Array.isArray(stored.calendar?.events) ? stored.calendar.events : [];
  state.calendar.events = storedEvents.map(normalizeCalendarEvent).filter((e) => e && e.id && e.start);
  state.calendar.cursorISO = stored.calendar?.cursorISO || new Date().toISOString().slice(0, 10);
  state.calendar.viewMode = normalizeCalendarViewMode(stored.calendar?.viewMode);
  const appName = stored.settings?.appName || stored.settings?.aiName || "myAI";
  state.settings = {
    userTitle: stored.settings?.userTitle || "사용자님",
    aiName: appName,
    appName,
    theme: stored.settings?.theme === "dark" ? "dark" : "light",
    colorTheme: normalizeColorTheme(stored.settings?.colorTheme),
    customColorTheme: normalizeCustomColorTheme(stored.settings?.customColorTheme),
    appBannerDataUrl: stored.settings?.appBannerDataUrl || "",
    appLogoDataUrl: stored.settings?.appLogoDataUrl || "",
    systemAvatarDataUrl: stored.settings?.systemAvatarDataUrl || "",
    userAvatarDataUrl: stored.settings?.userAvatarDataUrl || "",
    customPrompt: stored.settings?.customPrompt || "",
    responseStyle: normalizeResponseStyle(stored.settings?.responseStyle),
    customInstruction: stored.settings?.customInstruction || ""
  };
  state.documentTemplates = ensureDocumentTemplatesState();
  if (Array.isArray(stored.documentTemplates?.personal)) {
    state.documentTemplates.personal = stored.documentTemplates.personal.filter(
      (tpl) => tpl && typeof tpl === "object" && tpl.id
    );
  }
  if (stored.customPrompts && typeof stored.customPrompts === "object") {
    state.customPrompts = {
      personal: Array.isArray(stored.customPrompts.personal)
        ? stored.customPrompts.personal.filter((p) => p && typeof p === "object" && p.id)
        : [],
      seeded: stored.customPrompts.seeded === true
    };
  }
  ensureCustomPromptsState();
}

function migrateLegacyLawWorkbenchFromRooms() {
  const reviews = ensureLawReviewsState();
  const existingRoomIds = new Set(
    reviews.items
      .filter((item) => item.migratedFromRoomStudio && item.sourceRoomId)
      .map((item) => item.sourceRoomId)
  );
  for (const room of state.rooms) {
    const workbench = room?.studio?.lawWorkbench;
    if (!hasLegacyLawWorkbench(workbench) || existingRoomIds.has(room.id)) continue;
    const input = workbench.input && typeof workbench.input === "object" ? workbench.input : {};
    const title = deriveLegacyLawReviewTitle(input, room);
    reviews.items.push(createLawReview({
      id: `law_review_${room.id}`,
      title,
      input,
      data: workbench.data || null,
      terms: Array.isArray(workbench.terms) ? workbench.terms : [],
      activeTab: typeof workbench.activeTab === "string" ? workbench.activeTab : "main",
      sourceRoomId: room.id,
      migratedFromRoomStudio: true,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt
    }));
    existingRoomIds.add(room.id);
  }
  ensureLawReviewsState();
}

function hasLegacyLawWorkbench(workbench) {
  if (!workbench || typeof workbench !== "object") return false;
  const input = workbench.input && typeof workbench.input === "object" ? workbench.input : {};
  return Boolean(
    workbench.data ||
    (Array.isArray(workbench.terms) && workbench.terms.length) ||
    input.query ||
    input.lawName ||
    input.article ||
    input.region
  );
}

function deriveLegacyLawReviewTitle(input, room) {
  const fromInput = input.query || [input.lawName, input.article].filter(Boolean).join(" ");
  const base = String(fromInput || room?.title || "법령검토").trim();
  return base.slice(0, 80) || "법령검토";
}

export async function saveAppState() {
  await saveEncryptedRecord(APP_STATE_KEY, {
    rooms: state.rooms,
    activeRoomId: state.activeRoomId,
    activeView: state.activeView,
    lawReviews: ensureLawReviewsState(),
    grcReviews: ensureGrcReviewsState(),
    layout: normalizeLayout(state.layout),
    client: {
      documentCacheKey: ensureDocumentCacheKey()
    },
    calendar: {
      events: state.calendar.events,
      cursorISO: state.calendar.cursorISO,
      viewMode: state.calendar.viewMode
    },
    settings: state.settings,
    documentTemplates: ensureDocumentTemplatesState(),
    customPrompts: ensureCustomPromptsState(),
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
      if (normalizeGeneratedSourceDocument(doc)) changed = true;
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

export function normalizeGeneratedSourceDocument(doc) {
  if (!doc || typeof doc !== "object") return false;
  const generated = doc.trustLevel === "generated" || doc.origin === "assistant_answer" || doc.type === "generated_answer";
  if (!generated) return false;

  let changed = false;
  if (doc.kind !== "document") {
    doc.kind = "document";
    changed = true;
  }
  if (doc.origin !== "assistant_answer") {
    doc.origin = "assistant_answer";
    changed = true;
  }
  if (doc.trustLevel !== "generated") {
    doc.trustLevel = "generated";
    changed = true;
  }
  if (doc.sourceTrust !== 0.5) {
    doc.sourceTrust = 0.5;
    changed = true;
  }
  if (!Array.isArray(doc.labels) || !doc.labels.includes("AI 생성") || !doc.labels.includes("검증 필요")) {
    doc.labels = ["AI 생성", "검증 필요"];
    changed = true;
  }
  if (typeof doc.text === "string") {
    if (doc.textLength !== doc.text.length) {
      doc.textLength = doc.text.length;
      changed = true;
    }
    if (doc.preview !== doc.text.slice(0, 280)) {
      doc.preview = doc.text.slice(0, 280);
      changed = true;
    }
  }
  if (!Array.isArray(doc.citations)) {
    doc.citations = [];
    changed = true;
  }
  return changed;
}
