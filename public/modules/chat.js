import { renderAssistantAnswer as renderAssistantContent } from "../answerRenderer.js";
import { formatVisualizationText, renderVisualizationSpec } from "../visualizationRenderer.js";
import { displayFileName as formatDisplayFileName } from "../fileDisplay.js";
import { state, elements, documentCacheHeaders, accessAuthHeaders, getActiveRoom, showConfirmDialog } from "./state.js";
import { scheduleSave, persistAppState, hydrateStoredDocuments } from "./persistence.js";
import {
  hasCalendarKeyword, isCalendarConfirmation, isCalendarRejection,
  isLikelyCalendarActionPrompt, classifyMessageIntent, clearPendingCalendarAction,
  executeCalendarIntent, renderCalendar, renderEventCardList, findConflictingEvents,
  buildCalendarProposalText, formatEventOneLine, maybeRequestNotificationPermission
} from "./calendar.js";
import { openWithAnswer as openDocumentStudioWithAnswer } from "./documentStudio.js";

const MB = 1024 * 1024;
const DEFAULT_MAX_UPLOAD_BYTES = 40 * MB;
const LARGE_FILE_WARNING_BYTES = 10 * MB;
const CHAT_PAYLOAD_WARNING_BYTES = 60 * MB;
const CHAT_PAYLOAD_LIMIT_BYTES = 72 * MB;
const TRIM_THRESHOLD_CHARS = 400_000;
const TRIM_BUDGET_CHARS = 400_000;

// ===== Busy / abort =====

export function setBusy(busy) {
  state.busy = busy;
  elements.sendButton.disabled = false;
  elements.sendButton.textContent = busy ? "중지" : "전송";
  elements.sendButton.classList.toggle("stop-button", busy);
  elements.fileInput.disabled = busy;
  renderDeepAnalysisToggle();
}

export function stopGeneration() {
  state.abortController?.abort();
}

export function scrollToBottom() {
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function isMessagesNearBottom(threshold = 80) {
  const { scrollTop, scrollHeight, clientHeight } = elements.messages;
  return scrollHeight - scrollTop - clientHeight <= threshold;
}

function maybeScrollToBottom(shouldScroll = isMessagesNearBottom()) {
  if (shouldScroll) scrollToBottom();
}

export function setDeepAnalysisEnabled(enabled) {
  state.deepAnalysisEnabled = Boolean(enabled) && hasDeepAnalysisContext();
  renderDeepAnalysisToggle();
}

export function renderDeepAnalysisToggle() {
  if (elements.deepAnalysisToggle) {
    const available = hasDeepAnalysisContext();
    if (!available && !state.busy) state.deepAnalysisEnabled = false;
    elements.deepAnalysisToggle.disabled = !available || state.busy;
    elements.deepAnalysisToggle.setAttribute("aria-pressed", state.deepAnalysisEnabled ? "true" : "false");
    elements.deepAnalysisToggle.setAttribute("aria-label", available ? "정밀 분석" : "정밀 분석 사용 불가");
    elements.deepAnalysisToggle.title = state.busy && state.deepAnalysisEnabled
      ? "정밀 분석 진행 중"
      : available
        ? "첨부 파일 또는 프로젝트 전체를 정밀 분석합니다 (시간이 오래 걸림)"
        : "첨부 파일을 추가하거나 프로젝트을 선택하면 정밀 분석을 사용할 수 있습니다";
  }
}

// ===== Active room helpers =====

function hasDeepAnalysisContext() {
  const room = getActiveRoom();
  if (!room) return false;
  return (Array.isArray(room.documents) && room.documents.length > 0) || Boolean(room.selectedNotebookId);
}

export function getActiveDocuments() {
  const room = getActiveRoom();
  if (!room) return [];
  if (!Array.isArray(room.documents)) room.documents = [];
  return room.documents;
}

export function estimateJsonBytes(value) {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value >= MB) return `${(value / MB).toFixed(value >= 10 * MB ? 1 : 2)} MB`;
  if (value >= 1024) return `${Math.ceil(value / 1024)} KB`;
  return `${Math.ceil(value)} B`;
}

export function estimateDocumentBytes(documentItem) {
  return estimateJsonBytes(documentItem);
}

export function estimateRoomStorageBytes(room) {
  if (!room) return 0;
  return estimateJsonBytes({
    messages: room.messages || [],
    documents: room.documents || [],
    selectedNotebookId: room.selectedNotebookId || null,
    pendingCalendarAction: room.pendingCalendarAction || null
  });
}

export function estimateAllRoomsStorageBytes() {
  return estimateJsonBytes({
    rooms: state.rooms,
    calendar: state.calendar,
    settings: state.settings
  });
}

export function getPersonalizationSettings() {
  const appName = state.settings.appName || "myAI";
  return {
    userTitle: state.settings.userTitle || "사용자님",
    aiName: appName,
    appName,
    customPrompt: state.settings.customPrompt || "",
    responseStyle: state.settings.responseStyle || "default",
    customInstruction: state.settings.customInstruction || ""
  };
}

// ===== File upload =====

const UPLOAD_PROGRESS_ICONS = {
  spinner: '<svg viewBox="0 0 24 24" class="upload-progress-spinner" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-dasharray="42 42"></circle></svg>',
  check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"></path></svg>',
  error: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.4" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="M12 7.5v5.5M12 16.6h.01" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"></path></svg>'
};

function clearUploadProgress() {
  if (elements.uploadProgress) elements.uploadProgress.textContent = "";
}

function createUploadProgressItem(fileName, state = "processing") {
  if (!elements.uploadProgress) return null;
  const item = document.createElement("span");
  item.className = `upload-progress-item ${state}`;
  const icon = document.createElement("span");
  icon.className = "upload-progress-icon";
  icon.innerHTML = state === "error" ? UPLOAD_PROGRESS_ICONS.error : UPLOAD_PROGRESS_ICONS.spinner;
  const name = document.createElement("span");
  name.className = "upload-progress-name";
  name.textContent = fileName;
  item.append(icon, name);
  elements.uploadProgress.appendChild(item);
  return item;
}

function setUploadProgressItemState(item, state, message) {
  if (!item) return;
  item.classList.remove("processing", "done", "error");
  item.classList.add(state);
  const icon = item.querySelector(".upload-progress-icon");
  if (icon) {
    if (state === "done") icon.innerHTML = UPLOAD_PROGRESS_ICONS.check;
    else if (state === "error") icon.innerHTML = UPLOAD_PROGRESS_ICONS.error;
    else icon.innerHTML = UPLOAD_PROGRESS_ICONS.spinner;
  }
  item.title = message || "";
}

export async function uploadFiles(files) {
  if (!files.length) return;
  const room = getActiveRoom();
  if (!room) return;
  if (!Array.isArray(room.documents)) room.documents = [];

  clearUploadProgress();

  for (const file of files) {
    if (!shouldUploadFile(file)) continue;
    const item = createUploadProgressItem(file.name, "processing");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: documentCacheHeaders(),
        body: formData
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "업로드 실패");
      room.documents.push(result.document);
      room.updatedAt = new Date().toISOString();
      await persistAppState();
      // renderRooms triggered via custom event so chat.js doesn't import app.js
      window.dispatchEvent(new CustomEvent("myai:renderrooms"));
      setUploadProgressItemState(item, "done", `${file.name} 분석 준비 완료`);
    } catch (error) {
      setUploadProgressItemState(item, "error", `${file.name}: ${error.message}`);
    }
  }
}

function shouldUploadFile(file) {
  const size = Number(file?.size || 0);
  if (size > DEFAULT_MAX_UPLOAD_BYTES) {
    const item = createUploadProgressItem(file.name, "error");
    if (item) item.title = `${file.name}: ${formatBytes(size)} 파일은 업로드 한도 ${formatBytes(DEFAULT_MAX_UPLOAD_BYTES)}를 넘습니다.`;
    return false;
  }
  if (size >= LARGE_FILE_WARNING_BYTES) {
    return window.confirm(`${file.name}은 ${formatBytes(size)}입니다. 큰 파일은 브라우저 저장소와 채팅 전송 용량을 빠르게 사용합니다. 계속 업로드할까요?`);
  }
  return true;
}

export async function confirmAndRemoveUploadedFile(uploadedFile) {
  const fileName = formatDisplayFileName(uploadedFile);
  const confirmed = await showConfirmDialog({
    title: "첨부 삭제",
    body: `"${fileName}" 자료를 현재 대화방에서 삭제할까요?`,
    okText: "삭제",
    danger: true
  });
  if (!confirmed) return;
  await removeUploadedFile(uploadedFile);
}

export async function removeUploadedFile(uploadedFile) {
  await fetch(`/api/documents/${uploadedFile.id}`, {
    method: "DELETE",
    headers: documentCacheHeaders()
  }).catch(() => {});
  const room = getActiveRoom();
  if (!room) return;
  room.documents = getActiveDocuments().filter((f) => f.id !== uploadedFile.id);
  clearRoomMindmapCache(room);
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  if (elements.uploadProgress) {
    const fileName = String(uploadedFile.fileName || "");
    const chip = [...elements.uploadProgress.querySelectorAll(".upload-progress-item")]
      .find((item) => item.querySelector(".upload-progress-name")?.textContent === fileName);
    chip?.remove();
  }
}

export async function confirmAndClearRoomDocuments(room = getActiveRoom()) {
  if (!room || !Array.isArray(room.documents) || !room.documents.length) return;
  const totalBytes = room.documents.reduce((sum, doc) => sum + estimateDocumentBytes(doc), 0);
  const confirmed = await showConfirmDialog({
    title: "첨부 정리",
    body: `현재 대화방의 첨부 ${room.documents.length}개(${formatBytes(totalBytes)})를 정리할까요? 대화 내용은 유지됩니다.`,
    okText: "정리",
    danger: true
  });
  if (!confirmed) return;
  const documents = [...room.documents];
  await Promise.all(documents.map((doc) => fetch(`/api/documents/${doc.id}`, {
    method: "DELETE",
    headers: documentCacheHeaders()
  }).catch(() => {})));
  room.documents = [];
  clearRoomMindmapCache(room);
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  elements.uploadProgress.textContent = "현재 대화방의 첨부를 정리했습니다.";
}

function clearRoomMindmapCache(room) {
  if (!room?.studio?.mindmap) return;
  room.studio.mindmap = {
    signature: "",
    data: null,
    selectedNodeId: ""
  };
}

// ===== Send message =====

export async function sendMessage(prompt) {
  const room = getActiveRoom();
  if (!room) return;

  const userMessage = { role: "user", content: prompt, createdAt: new Date().toISOString() };
  room.messages.push(userMessage);
  room.updatedAt = userMessage.createdAt;
  if (room.title === "새 대화") room.title = createTitleFromPrompt(prompt);
  scheduleSave();

  if (room.messages.length === 1) window.dispatchEvent(new CustomEvent("myai:rendermessages"));
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
    // Only show the vague calendar request warning if the LLM classification failed or wasn't definitive.
    // If intentResult.intent is 'chat', it means the LLM explicitly decided this is a normal conversation.
    const isExplicitChat = intentResult && intentResult.intent === "chat" && !intentResult.fallbackReason;
    if (!isExplicitChat && hasCalendarKeyword(prompt) && isLikelyCalendarActionPrompt(prompt)) {
      await handleCalendarStatusMessage(
        room,
        "일정 요청으로 보이지만 날짜, 시간, 제목을 확정하지 못했습니다. 실제 캘린더에는 아직 반영하지 않았습니다. 예: \"5월 4일 오후 12시에 월클라우드 점심 식사 추가해줘\"처럼 다시 말씀해주세요."
      );
      return;
    }
  }

  await requestAssistantResponse(room);
}

export async function requestAssistantResponse(room) {
  if (await hydrateStoredDocuments()) window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  if (shouldRequestVisualizationResponse(room)) {
    await requestVisualizationResponse(room);
    return;
  }
  await requestTextAssistantResponse(room);
}

export async function requestTextAssistantResponse(room) {
  if (getActiveDocuments().length > 0 && isSearchIntent(getLastUserPrompt(room))) {
    const msg = "첨부된 파일이 있는 경우 파일 내용에 기반하여 답변하도록 되어 있어 검색이 불가능합니다.";
    const createdAt = new Date().toISOString();
    room.messages.push({ role: "assistant", content: msg, createdAt });
    room.updatedAt = createdAt;
    scheduleSave();
    window.dispatchEvent(new CustomEvent("myai:renderrooms"));
    appendMessage("assistant", msg, { persist: false, messageIndex: room.messages.length - 1, createdAt });
    scrollToBottom();
    return;
  }

  setBusy(true);
  state.abortController = new AbortController();
  const latestPrompt = getLastUserPrompt(room);
  const naverSearch = wantsExplicitWebSearch(latestPrompt);
  const lawProcessing = !naverSearch && shouldShowLawProcessing(latestPrompt);
  const thinking = appendThinking({ lawProcessing, naverSearch });
  advanceThinkingProgress(thinking, Math.max(1, getThinkingStepCount(thinking) - 2));
  let assistant = null;
  let assistantBody = null;
  let answer = "";
  const useDeepAnalysis = state.deepAnalysisEnabled;

  try {
    const payload = {
      model: elements.modelInput.value.trim() || "gemma3n:e2b",
      messages: room.messages.map(({ role, content }) => ({ role, content })),
      documents: queryTrimDocuments(getActiveDocuments(), latestPrompt),
      personalization: getPersonalizationSettings(),
      notebookId: room.selectedNotebookId || null,
      ...(useDeepAnalysis ? { mode: "map_reduce" } : {})
    };
    validateChatPayloadSize(payload);
    const response = await fetch("/api/chat", {
      method: "POST",
      signal: state.abortController.signal,
      headers: { "Content-Type": "application/json", ...accessAuthHeaders() },
      body: JSON.stringify(payload)
    });

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(errorText || "응답 생성 실패");
    }

    const notebookMeta = decodeNotebookMetaHeader(response.headers.get("X-Notebook-Meta"));
    if (notebookMeta?.law) updateThinkingLawStatus(thinking, notebookMeta.law);
    const citations = Array.isArray(notebookMeta?.citations) ? notebookMeta.citations : [];
    const webCitations = Array.isArray(notebookMeta?.webSearch?.citations) ? notebookMeta.webSearch.citations : [];
    const lawCitations = Array.isArray(notebookMeta?.law?.citations) ? notebookMeta.law.citations : [];
    const allCitations = [...citations, ...lawCitations, ...webCitations];

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      const stickToBottom = isMessagesNearBottom();
      answer += decoder.decode(value, { stream: true });
      advanceThinkingProgress(thinking, getThinkingStepCount(thinking) - 1);
      if (!assistant) {
        assistant = appendMessage("assistant", "", { persist: false, streaming: true, autoScroll: stickToBottom });
        assistantBody = assistant.querySelector(".message-body");
      }
      assistant.dataset.copyText = answer;
      renderAssistantContent(assistantBody, answer);
      maybeScrollToBottom(stickToBottom);
    }

    answer += decoder.decode();
    const finalAnswer = ensureAddressedAnswer(answer || "응답이 비어 있습니다.");
    if (!assistant) {
      const stickToBottom = isMessagesNearBottom();
      assistant = appendMessage("assistant", "", { persist: false, streaming: true, autoScroll: stickToBottom });
      assistantBody = assistant.querySelector(".message-body");
    }
    assistant.dataset.copyText = finalAnswer;
    renderAssistantContent(assistantBody, finalAnswer);
    assistant.classList.remove("streaming");
    advanceThinkingProgress(thinking, getThinkingStepCount(thinking));

    const assistantMessage = { role: "assistant", content: finalAnswer, createdAt: new Date().toISOString() };
    const noEvidenceAnswer = isNoEvidenceAnswer(finalAnswer);
    if (allCitations.length && !noEvidenceAnswer) {
      assistantMessage.citations = allCitations;
      assistantMessage.notebook = notebookMeta?.notebook ?? null;
      if (notebookMeta?.webSearch) assistantMessage.webSearch = notebookMeta.webSearch;
    }
    if (notebookMeta?.law && !noEvidenceAnswer) assistantMessage.law = notebookMeta.law;
    if (notebookMeta?.compliance && !noEvidenceAnswer) assistantMessage.compliance = notebookMeta.compliance;
    if (!noEvidenceAnswer) {
      renderLawNoticePanel(assistant, notebookMeta?.law);
      renderCitationsPanel(assistant, allCitations, notebookMeta?.law, notebookMeta?.compliance);
      if (!allCitations.length) renderLawDisclaimer(assistant, notebookMeta?.law);
    }
    setAssistantAnswerTime(assistant, assistantMessage.createdAt);
    room.messages.push(assistantMessage);
    room.updatedAt = new Date().toISOString();
    scheduleSave();
    window.dispatchEvent(new CustomEvent("myai:renderrooms"));
    if (!noEvidenceAnswer) {
      renderFollowupSuggestions(assistant, [], { loading: true });
      attachFollowupSuggestions(room, assistantMessage, assistant);
    }
  } catch (error) {
    if (error.name === "AbortError") {
      if (assistant) assistant.classList.remove("streaming");
      return;
    }
    if (!assistant) {
      const stickToBottom = isMessagesNearBottom();
      assistant = appendMessage("assistant", "", { persist: false, streaming: true, autoScroll: stickToBottom });
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
    if (useDeepAnalysis) setDeepAnalysisEnabled(false);
    maybeScrollToBottom();
  }
}

function totalDocumentTextChars(documents) {
  let total = 0;
  for (const doc of documents) {
    if (doc.kind !== "document") continue;
    if (doc.text) total += doc.text.length;
    for (const page of doc.pages || []) if (page.text) total += page.text.length;
    for (const sheet of doc.sheets || []) if (sheet.text) total += sheet.text.length;
  }
  return total;
}

function extractQueryTokens(query) {
  return [...new Set(
    String(query || "").toLowerCase()
      .split(/[\s\p{P}]+/u)
      .filter((t) => t.length >= 2)
  )];
}

function scoreTextByQuery(text, queryTokens) {
  if (!queryTokens.length) return 0;
  const lower = text.toLowerCase();
  let score = 0;
  for (const token of queryTokens) {
    if (lower.includes(token)) score++;
  }
  return score;
}

function queryTrimDocuments(documents, query) {
  if (!Array.isArray(documents) || !documents.length) return documents;
  if (totalDocumentTextChars(documents) <= TRIM_THRESHOLD_CHARS) return documents;

  const queryTokens = extractQueryTokens(query);
  const candidates = [];

  for (let docIdx = 0; docIdx < documents.length; docIdx++) {
    const doc = documents[docIdx];
    if (doc.kind !== "document") continue;
    if (doc.pages?.some((p) => p.text)) {
      doc.pages.forEach((page, i) => {
        if (page.text) candidates.push({ docIdx, source: "pages", sectionIdx: i, text: page.text });
      });
    } else if (doc.sheets?.some((s) => s.text)) {
      doc.sheets.forEach((sheet, i) => {
        if (sheet.text) candidates.push({ docIdx, source: "sheets", sectionIdx: i, text: sheet.text });
      });
    } else if (doc.text) {
      doc.text.split(/\n{2,}/).forEach((para, i) => {
        if (para.trim()) candidates.push({ docIdx, source: "text", sectionIdx: i, text: para });
      });
    }
  }

  for (const c of candidates) c.score = scoreTextByQuery(c.text, queryTokens);
  candidates.sort((a, b) => b.score - a.score || a.docIdx - b.docIdx || a.sectionIdx - b.sectionIdx);

  const keep = new Map();
  let used = 0;
  for (const c of candidates) {
    if (used >= TRIM_BUDGET_CHARS) break;
    if (used + c.text.length > TRIM_BUDGET_CHARS && used > 0) continue;
    if (!keep.has(c.docIdx)) keep.set(c.docIdx, { source: c.source, indexes: new Set() });
    keep.get(c.docIdx).indexes.add(c.sectionIdx);
    used += c.text.length;
  }

  return documents.map((doc, docIdx) => {
    if (doc.kind !== "document") return doc;
    const entry = keep.get(docIdx);
    const blankPages = (doc.pages || []).map((p) => ({ ...p, text: "" }));
    const blankSheets = (doc.sheets || []).map((s) => ({ ...s, text: "" }));
    if (!entry) return { ...doc, text: "", pages: blankPages, sheets: blankSheets };
    const { source, indexes } = entry;
    if (source === "pages") {
      return { ...doc, text: "", pages: (doc.pages || []).map((p, i) => indexes.has(i) ? p : { ...p, text: "" }), sheets: blankSheets };
    }
    if (source === "sheets") {
      return { ...doc, text: "", pages: blankPages, sheets: (doc.sheets || []).map((s, i) => indexes.has(i) ? s : { ...s, text: "" }) };
    }
    const paragraphs = doc.text.split(/\n{2,}/);
    return { ...doc, text: paragraphs.filter((_, i) => indexes.has(i)).join("\n\n"), pages: blankPages };
  });
}

function validateChatPayloadSize(payload) {
  const payloadBytes = estimateJsonBytes(payload);
  if (payloadBytes > CHAT_PAYLOAD_LIMIT_BYTES) {
    throw new Error(`전송할 대화/첨부 용량이 ${formatBytes(payloadBytes)}입니다. 서버 요청 한도에 가까워 전송하지 않았습니다. 현재 방의 첨부를 정리하거나 큰 파일을 나눈 뒤 다시 시도해주세요.`);
  }
  if (payloadBytes > CHAT_PAYLOAD_WARNING_BYTES) {
    const confirmed = window.confirm(`이번 요청 용량이 ${formatBytes(payloadBytes)}입니다. 큰 문서/이미지가 포함되어 전송이 느리거나 실패할 수 있습니다. 계속할까요?`);
    if (!confirmed) throw new DOMException("Chat payload was cancelled by the user.", "AbortError");
  }
}

export async function requestVisualizationResponse(room) {
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
        documents: queryTrimDocuments(getActiveDocuments(), prompt),
        personalization: getPersonalizationSettings()
      })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "visualization generation failed");
    advanceThinkingProgress(thinking, getThinkingStepCount(thinking) - 1);

    const visualization = result.visualization;
    const finalAnswer = ensureAddressedAnswer(formatVisualizationText(visualization));
    assistant = appendMessage("assistant", finalAnswer, { persist: false, visualization });
    advanceThinkingProgress(thinking, getThinkingStepCount(thinking));
    const assistantMessage = { role: "assistant", content: finalAnswer, visualization, createdAt: new Date().toISOString() };
    setAssistantAnswerTime(assistant, assistantMessage.createdAt);
    room.messages.push(assistantMessage);
    room.updatedAt = assistantMessage.createdAt;
    scheduleSave();
    window.dispatchEvent(new CustomEvent("myai:renderrooms"));
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

// ===== Calendar message handlers (need chat rendering + calendar logic) =====

export async function handleCalendarIntent(room, intentResult) {
  setBusy(true);
  const thinking = appendThinking();
  try {
    const outcome = await executeCalendarIntent(intentResult);
    if (outcome.mutated) { scheduleSave(); renderCalendar(); }
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

export async function handleCalendarProposal(room, intentResult) {
  setBusy(true);
  const thinking = appendThinking();
  try {
    const payload = intentResult?.payload || {};
    if (!payload.title || !payload.start) {
      appendCalendarAssistantMessage(room, "일정 후보를 만들기에는 정보가 부족합니다. 날짜, 시간, 제목을 함께 알려주세요.");
      return;
    }
    const pendingAction = { intent: "calendar.create", payload, createdAt: new Date().toISOString() };
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

export async function handleCalendarStatusMessage(room, text) {
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

export function appendCalendarAssistantMessage(room, text, { eventCards = [] } = {}) {
  const createdAt = new Date().toISOString();
  const assistantMessage = { role: "assistant", content: text, createdAt, eventCards };
  room.messages.push(assistantMessage);
  room.updatedAt = createdAt;
  scheduleSave();
  window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  const article = appendMessage("assistant", text, {
    persist: false,
    messageIndex: room.messages.length - 1,
    createdAt,
    eventCards
  });
  setAssistantAnswerTime(article, createdAt);
  return article;
}

// ===== Follow-up suggestions =====

export async function attachFollowupSuggestions(room, assistantMessage, assistantArticle) {
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
  return [
    "위와 관련하여 놓친 부분이나 예외 케이스가 있을까?",
    "위 내용을 실제로 적용할 때 가장 먼저 해야 할 것은 뭐야?",
    "위와 관련해서 더 깊이 알아야 할 개념이나 배경이 있어?"
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

// ===== Message rendering =====

const ANSWER_EXPORT_FORMATS = [
  { id: "md", label: "Markdown", extension: "md" },
  { id: "xlsx", label: "Excel", extension: "xlsx" },
  { id: "pdf", label: "PDF", extension: "pdf" },
  { id: "hwpx", label: "HWPX", extension: "hwpx" },
  { id: "docx", label: "Word", extension: "docx" }
];

export function appendMessage(role, text, options = {}) {
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
      if (visualText) article.dataset.copyText = `${text}\n\n${visualText}`;
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
  if (role === "assistant" && Array.isArray(options.citations) && options.citations.length && !isNoEvidenceAnswer(text)) {
    renderLawNoticePanel(article, options.law);
    renderCitationsPanel(article, options.citations, options.law, options.compliance);
  } else if (role === "assistant" && options.law && !isNoEvidenceAnswer(text)) {
    renderLawNoticePanel(article, options.law);
    renderLawDisclaimer(article, options.law);
  }
  elements.messages.append(article);
  if (options.autoScroll !== false) scrollToBottom();
  return article;
}

export function renderFollowupSuggestions(article, suggestions = [], options = {}) {
  const stickToBottom = isMessagesNearBottom();
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
    maybeScrollToBottom(stickToBottom);
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
  maybeScrollToBottom(stickToBottom);
}

export function renderCitationsPanel(article, citations, law = null, compliance = null) {
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
  for (const citation of groupCitationsByType(citations, compliance)) {
    const item = document.createElement("li");
    if (citation.groupLabel) {
      item.className = "message-citation-group";
      item.textContent = citation.groupLabel;
      list.append(item);
      continue;
    }
    const lawKind = classifyLawCitation(citation);
    const isLawCitation = Boolean(lawKind);
    item.className = `message-citation-item ${isLawCitation ? "law-citation" : ""}${lawKind ? ` law-citation-${lawKind}` : ""}`;
    const marker = document.createElement("span");
    marker.className = "message-citation-marker";
    marker.textContent = `[${citation.citationId}]`;
    const source = document.createElement("span");
    source.className = "message-citation-source";
    const docName = citation.url ? document.createElement("a") : document.createElement("span");
    docName.className = "citation-doc";
    docName.textContent = formatCitationDocumentName(citation);
    if (citation.url) {
      docName.href = citation.url;
      docName.target = "_blank";
      docName.rel = "noopener noreferrer";
      docName.title = isLawCitation ? `${LAW_BADGE_LABELS[lawKind] || "공식 법령"} 원문 열기: ${citation.url}` : citation.url;
    }
    if (isLawCitation) {
      const badge = document.createElement("span");
      badge.className = `law-source-badge law-source-badge-${lawKind}`;
      badge.textContent = LAW_BADGE_LABELS[lawKind] || "공식 법령";
      source.append(badge);
    }
    source.append(docName);
    appendLawCitationMeta(source, citation, lawKind);
    item.append(marker, source);
    if (isLawCitation && citation.excerpt) {
      item.append(buildLawExcerpt(citation));
    }
    list.append(item);
  }
  wrapper.append(list);
  article.append(wrapper);
  renderLawDisclaimer(article, law);
}

export function renderLawNoticePanel(article, law) {
  if (!article) return;
  article.querySelector(".law-verification-warning")?.remove();
  const verification = law?.verification;
  const failed = Array.isArray(verification?.results)
    ? verification.results.filter((item) => item && item.valid === false)
    : [];
  if (!failed.length) return;
  const warning = document.createElement("div");
  warning.className = "law-verification-warning";
  const title = document.createElement("div");
  title.className = "law-verification-title";
  title.textContent = "조문 인용 검증 경고";
  warning.append(title);
  const list = document.createElement("ul");
  for (const item of failed.slice(0, 6)) {
    const li = document.createElement("li");
    li.textContent = `${item.citation || item.canonical}: ${formatLawVerificationReason(item.reason)}`;
    list.append(li);
  }
  warning.append(list);
  article.append(warning);
}

const LAW_BADGE_LABELS = {
  statute: "공식 법령",
  precedent: "공식 판례",
  interpretation: "법령해석례",
  admin_rule: "행정규칙",
  ordinance: "자치법규"
};

function classifyLawCitation(citation) {
  if (!citation) return null;
  const sourceType = String(citation.sourceType || "");
  const recordType = String(citation.recordType || "");
  const citationId = String(citation.citationId || "");
  if (sourceType === "law" || recordType === "statute" || /^L\d/.test(citationId)) return "statute";
  if (sourceType === "law_precedent" || recordType === "precedent" || /^P\d/.test(citationId)) return "precedent";
  if (sourceType === "law_interpretation" || recordType === "interpretation" || /^I\d/.test(citationId)) return "interpretation";
  if (sourceType === "law_admin_rule" || recordType === "admin_rule" || /^R\d/.test(citationId)) return "admin_rule";
  if (sourceType === "law_ordinance" || recordType === "ordinance" || /^O\d/.test(citationId)) return "ordinance";
  return null;
}

function appendLawCitationMeta(source, citation, lawKind) {
  if (!lawKind) {
    if (citation.locator && citation.locator !== source.querySelector(".citation-doc")?.textContent) {
      const locator = document.createElement("span");
      locator.className = "citation-locator";
      locator.textContent = `· ${citation.locator}`;
      source.append(locator);
    }
    return;
  }
  const docNameText = source.querySelector(".citation-doc")?.textContent || "";
  if (citation.locator && citation.locator !== docNameText) {
    const locator = document.createElement("span");
    locator.className = "citation-locator";
    locator.textContent = `· ${citation.locator}`;
    source.append(locator);
  }
  if (lawKind === "statute") {
    if (citation.title && citation.title !== docNameText) appendMeta(source, `· ${citation.title}`);
    if (citation.effectiveDate) appendMeta(source, `· 시행일 ${citation.effectiveDate}`);
    return;
  }
  if (lawKind === "precedent") {
    if (citation.caseNumber) appendMeta(source, `· ${citation.caseNumber}`);
    if (citation.court) appendMeta(source, `· ${citation.court}`);
    if (citation.date) appendMeta(source, `· 선고일 ${citation.date}`);
    if (citation.caseType) appendMeta(source, `· ${citation.caseType}`);
    return;
  }
  if (lawKind === "interpretation") {
    if (citation.agency) appendMeta(source, `· ${citation.agency}`);
    if (citation.date) appendMeta(source, `· 회신일 ${citation.date}`);
    return;
  }
  if (lawKind === "admin_rule") {
    if (citation.kind) appendMeta(source, `· ${citation.kind}`);
    if (citation.agency) appendMeta(source, `· ${citation.agency}`);
    if (citation.effectiveDate) appendMeta(source, `· 시행일 ${citation.effectiveDate}`);
    return;
  }
  if (lawKind === "ordinance") {
    if (citation.region) appendMeta(source, `· ${citation.region}`);
    if (citation.kind) appendMeta(source, `· ${citation.kind}`);
    if (citation.effectiveDate) appendMeta(source, `· 시행일 ${citation.effectiveDate}`);
  }
}

function appendMeta(source, text) {
  const node = document.createElement("span");
  node.className = "citation-locator";
  node.textContent = text;
  source.append(node);
}

function buildLawExcerpt(citation) {
  const wrapper = document.createElement("details");
  wrapper.className = "law-excerpt";
  const summary = document.createElement("summary");
  summary.className = "law-excerpt-summary";
  const previewLine = String(citation.excerpt || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  const truncatedHint = citation.excerptTruncated ? " (일부)" : "";
  summary.textContent = `조문 발췌 보기${truncatedHint}${previewLine ? ` — ${previewLine}…` : ""}`;
  wrapper.append(summary);
  const body = document.createElement("div");
  body.className = "law-excerpt-body";
  body.textContent = citation.excerpt;
  wrapper.append(body);
  if (citation.excerptTruncated && citation.url) {
    const more = document.createElement("a");
    more.className = "law-excerpt-link";
    more.href = citation.url;
    more.target = "_blank";
    more.rel = "noopener noreferrer";
    more.textContent = "law.go.kr에서 전문 보기 →";
    wrapper.append(more);
  }
  return wrapper;
}

function renderLawDisclaimer(article, law) {
  article.querySelector(".law-disclaimer")?.remove();
  const level = law?.disclaimer;
  if (!level) return;
  const disclaimer = document.createElement("div");
  disclaimer.className = `law-disclaimer law-disclaimer-${level}`;
  disclaimer.textContent = level === "mandatory"
    ? "이 답변은 공식 법령 정보를 바탕으로 한 일반 정보입니다. 구체적 사건의 법률 자문이나 대리 행위가 아니며, 필요한 경우 변호사 등 전문가 상담을 받으세요."
    : "이 답변은 공식 법령 정보를 바탕으로 한 일반 정보이며, 구체적 사건의 법률 자문은 전문가 상담이 필요합니다.";
  const citationsPanel = article.querySelector(".message-citations");
  if (citationsPanel) article.insertBefore(disclaimer, citationsPanel);
  else article.append(disclaimer);
}

function formatCitationDocumentName(citation) {
  const lawKind = classifyLawCitation(citation);
  if (lawKind === "statute") {
    return citation.locator
      || [citation.lawName || citation.documentName, citation.article].filter(Boolean).join(" ")
      || "공식 법령";
  }
  if (lawKind === "precedent") return citation.title || citation.locator || "공식 판례";
  if (lawKind === "interpretation") return citation.title || citation.locator || "법령해석례";
  if (lawKind === "admin_rule") return citation.title || citation.locator || "행정규칙";
  if (lawKind === "ordinance") return citation.title || citation.locator || "자치법규";
  return citation.documentName || citation.lawName || "출처 미상";
}

function isLegalCitation(item) {
  return Boolean(classifyLawCitation(item));
}

function groupCitationsByType(citations, compliance = null) {
  const internalLabel = compliance?.mode === "department_legal_review" ? "내부 자료" : null;
  const groups = [
    ["프로젝트", (item) => !isLegalCitation(item) && ((!item.sourceType && !/^W/.test(String(item.citationId || ""))) || item.sourceType === "notebook")],
    ["법령", (item) => classifyLawCitation(item) === "statute"],
    ["판례", (item) => classifyLawCitation(item) === "precedent"],
    ["법령해석례", (item) => classifyLawCitation(item) === "interpretation"],
    ["행정규칙", (item) => classifyLawCitation(item) === "admin_rule"],
    ["자치법규", (item) => classifyLawCitation(item) === "ordinance"],
    ["웹", (item) => !isLegalCitation(item) && (item.sourceType === "naver" || item.sourceType === "web" || /^W/.test(String(item.citationId || "")))]
  ];
  if (internalLabel) groups[0][0] = internalLabel;
  const output = [];
  for (const [label, predicate] of groups) {
    const items = citations.filter(predicate);
    if (!items.length) continue;
    if (citations.length !== items.length) output.push({ groupLabel: label });
    output.push(...items);
  }
  return output;
}

function formatLawVerificationReason(reason) {
  if (reason === "article_not_found" || reason === "NOT_FOUND") return "해당 조문을 찾을 수 없습니다.";
  if (reason === "LAW_NOT_CONFIGURED") return "법령 API 키가 설정되어 있지 않습니다.";
  if (reason === "LAW_API_ERROR") return "공식 법령 조회 중 오류가 발생했습니다.";
  return String(reason || "검증 실패");
}

export function createMessageActions(article, role, createdAt = "") {
  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(createCopyButton(article, role));
  if (role === "assistant") {
    actions.append(createDownloadButton(article));
    actions.append(createSendToStudioButton(article));
  }
  if (role === "user") actions.append(createEditButton(article));
  if (role === "assistant" && createdAt) actions.append(createMessageTime(createdAt));
  return actions;
}

function createSendToStudioButton(article) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action-button send-to-studio-button";
  button.title = "스튜디오>문서";
  button.setAttribute("aria-label", "스튜디오>문서");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h8l4 4v14H7z"></path>
      <path d="M15 3v4h4"></path>
      <path d="M9 12h8M9 16h8M9 8h4"></path>
    </svg>
  `;
  button.addEventListener("click", () => sendArticleToStudio(article));
  return button;
}

function sendArticleToStudio(article) {
  const text = article.dataset.copyText || article.querySelector(".message-body")?.innerText || "";
  if (!text.trim()) {
    window.alert("문서로 보낼 답변 내용이 없습니다.");
    return;
  }
  const room = getActiveRoom();
  const idx = Number(article.dataset.messageIndex);
  const message = room && Number.isInteger(idx) ? room.messages[idx] : null;
  const metadata = {};
  if (message?.notebook) metadata.notebook = message.notebook;
  if (message?.law) metadata.law = message.law;
  if (message?.compliance) metadata.compliance = message.compliance;
  if (message?.webSearch) metadata.webSearch = message.webSearch;
  if (Array.isArray(message?.citations) && message.citations.length) metadata.citations = message.citations;
  openDocumentStudioWithAnswer({
    title: room?.title || "",
    markdown: text,
    messageId: message?.id || (Number.isInteger(idx) ? `msg_${idx}` : null),
    metadata,
    model: elements.modelInput?.value?.trim() || ""
  }).catch((error) => {
    console.error("send-to-studio failed", error);
    window.alert(error?.message || "스튜디오로 전송에 실패했습니다.");
  });
}

export function setAssistantAnswerTime(article, createdAt) {
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

function createDownloadButton(article) {
  const wrapper = document.createElement("div");
  wrapper.className = "message-download";

  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action-button download-answer-button";
  button.title = "답변 다운로드";
  button.setAttribute("aria-label", "답변 다운로드");
  button.setAttribute("aria-haspopup", "menu");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <path d="M7 10l5 5 5-5"></path>
      <path d="M12 15V3"></path>
    </svg>
  `;

  const menu = document.createElement("div");
  menu.className = "download-menu";
  menu.setAttribute("role", "menu");
  menu.hidden = true;

  for (const format of ANSWER_EXPORT_FORMATS) {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "download-menu-item";
    item.setAttribute("role", "menuitem");
    item.textContent = `${format.label} (.${format.extension})`;
    item.addEventListener("click", async () => {
      closeDownloadMenu(wrapper);
      await downloadAnswer(article, format.id, item);
    });
    menu.append(item);
  }

  button.addEventListener("click", (event) => {
    event.stopPropagation();
    const willOpen = menu.hidden;
    closeAllDownloadMenus();
    if (willOpen) {
      menu.hidden = false;
      button.setAttribute("aria-expanded", "true");
    }
  });

  wrapper.append(button, menu);
  return wrapper;
}

function closeDownloadMenu(wrapper) {
  const menu = wrapper.querySelector(".download-menu");
  const button = wrapper.querySelector(".download-answer-button");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function closeAllDownloadMenus() {
  document.querySelectorAll(".message-download").forEach(closeDownloadMenu);
}

document.addEventListener("click", closeAllDownloadMenus);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeAllDownloadMenus();
});

async function downloadAnswer(article, format, trigger) {
  const content = article.dataset.copyText || article.querySelector(".message-body")?.innerText || "";
  if (!content.trim()) return;
  const label = trigger.textContent;
  trigger.disabled = true;
  trigger.textContent = "생성 중...";
  try {
    const response = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        format,
        title: createExportTitle(article),
        content
      })
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.error || "파일을 생성하지 못했습니다.");
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get("Content-Disposition")) || `myai-answer.${format}`;
    triggerBrowserDownload(blob, filename);
  } catch (error) {
    window.alert(error.message || "파일을 생성하지 못했습니다.");
  } finally {
    trigger.disabled = false;
    trigger.textContent = label;
  }
}

function createExportTitle(article) {
  const createdAt = article.dataset.createdAt ? new Date(article.dataset.createdAt) : new Date();
  const stamp = Number.isNaN(createdAt.getTime())
    ? new Date().toISOString().slice(0, 10)
    : createdAt.toISOString().slice(0, 10);
  return `myAI 답변 ${stamp}`;
}

function filenameFromDisposition(value) {
  if (!value) return "";
  const utf8Match = /filename\*=UTF-8''([^;]+)/i.exec(value);
  if (utf8Match) {
    try { return decodeURIComponent(utf8Match[1]); } catch { return utf8Match[1]; }
  }
  const asciiMatch = /filename="([^"]+)"/i.exec(value);
  return asciiMatch ? asciiMatch[1] : "";
}

function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
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

export function editUserPrompt(article) {
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
    if (event.key === "Escape") { event.preventDefault(); cancelPromptEdit(article); return; }
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitPromptEdit(article, textarea.value); }
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
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"></path><path d="m6 6 12 12"></path></svg>`;
  button.addEventListener("click", () => cancelPromptEdit(article));
  return button;
}

function createConfirmEditButton(article, textarea) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action-button confirm-edit-button";
  button.title = "수정 완료";
  button.setAttribute("aria-label", "수정 완료");
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 10 4 15l5 5"></path><path d="M20 4v7a4 4 0 0 1-4 4H4"></path></svg>`;
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

export async function submitPromptEdit(article, nextContent) {
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
  window.dispatchEvent(new CustomEvent("myai:renderall"));
  await requestAssistantResponse(room);
}

// ===== Thinking card =====

export function appendThinking(options = {}) {
  const wrapper = document.createElement("div");
  wrapper.className = "thinking-card";
  if (options.lawProcessing) wrapper.classList.add("thinking-card-law");
  const row = document.createElement("div");
  row.className = "thinking-row";
  const dots = document.createElement("span");
  dots.className = "thinking-dots";
  dots.setAttribute("aria-hidden", "true");
  dots.innerHTML = "<span></span><span></span><span></span>";
  const text = document.createElement("span");
  text.className = "thinking-text";
  text.textContent = options.naverSearch
    ? "네이버 검색 중..."
    : options.lawProcessing ? "공식 법령 근거 확인 중..." : "Thinking...";
  row.append(dots, text);

  const details = document.createElement("details");
  details.className = "thinking-details";
  const summary = document.createElement("summary");
  summary.textContent = "처리 단계 보기";
  const list = document.createElement("ul");
  const steps = buildProcessingSteps(options);
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
  if (options.naverSearch) {
    const status = document.createElement("div");
    status.className = "thinking-law-status";
    status.textContent = "네이버 검색으로 최신 정보를 조회하고 있습니다.";
    wrapper.append(status);
  } else if (options.lawProcessing) {
    const status = document.createElement("div");
    status.className = "thinking-law-status";
    status.textContent = "Korean Law Engine으로 공식 법령 정보를 조회하고 있습니다.";
    wrapper.append(status);
  }
  wrapper.dataset.completedSteps = "0";
  elements.messages.append(wrapper);
  updateThinkingProgress(wrapper, 0);
  scrollToBottom();
  return wrapper;
}

export function removeThinking(thinking) {
  thinking?.remove();
}

export function updateThinkingProgress(thinking, completedCount) {
  if (!thinking) return;
  const items = Array.from(thinking.querySelectorAll(".thinking-details li"));
  const safeCount = Math.max(0, Math.min(completedCount, items.length));
  thinking.dataset.completedSteps = String(safeCount);
  for (const [index, item] of items.entries()) {
    item.classList.toggle("done", index < safeCount);
    item.classList.toggle("active", index === safeCount);
    const marker = item.querySelector(".thinking-step-marker");
    if (marker) marker.textContent = "▷";
  }
}

export function advanceThinkingProgress(thinking, completedCount = null) {
  if (!thinking) return;
  const nextCount = completedCount ?? Number(thinking.dataset.completedSteps || 0) + 1;
  updateThinkingProgress(thinking, nextCount);
}

export function updateThinkingLawStatus(thinking, law) {
  if (!thinking) return;
  const status = thinking.querySelector(".thinking-law-status");
  if (!status) return;
  if (law?.ok && Array.isArray(law.citations) && law.citations.length) {
    const labels = law.citations
      .map((item) => item.locator || [item.lawName, item.article].filter(Boolean).join(" "))
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    status.textContent = labels ? `법령 근거 확인: ${labels}` : "법령 근거 확인 완료";
    status.classList.remove("warning");
    return;
  }
  if (law?.error) {
    status.textContent = `법령 조회 상태: ${law.error}`;
    status.classList.add("warning");
  }
}

export function getThinkingStepCount(thinking) {
  return thinking?.querySelectorAll(".thinking-details li").length ?? 0;
}

function buildProcessingSteps(options = {}) {
  const steps = ["사용자 질문 확인", "대화 맥락 정리"];
  const { displayFileName: fmt } = { displayFileName: formatDisplayFileName };
  const documents = getActiveDocuments().filter((f) => f.kind === "document");
  const images = getActiveDocuments().filter((f) => f.kind === "image");
  if (documents.length) steps.push(`문서 컨텍스트 구성: ${documents.map(fmt).join(", ")}`);
  if (images.length) steps.push(`이미지 입력 포함: ${images.map(fmt).join(", ")}`);
  steps.push("LLM 스트리밍 응답 수신");
  steps.push("근거 중심 답변 표시");
  if (options.naverSearch) {
    steps.splice(Math.max(2, steps.length - 2), 0, "네이버 검색으로 최신 정보 조회", "검색 결과 정리 및 근거 구성");
  } else if (options.lawProcessing) {
    steps.splice(Math.max(2, steps.length - 2), 0, "Korean Law Engine으로 공식 법령 정보 조회", "법령명·조항·공식 링크 근거 정리");
  }
  return steps;
}

function wantsExplicitWebSearch(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return false;
  if (/네이버[^!?\n]{0,80}(검색|조회|뉴스|웹|찾아|찾아줘|찾기|확인|알려)/u.test(text)) return true;
  if (/(검색|조회|뉴스|찾아|찾기|확인|알려)[^!?\n]{0,40}네이버/u.test(text)) return true;
  return /웹\s*검색|인터넷\s*(에서|검색|뉴스)|구글\s*(검색|에서)|온라인\s*검색|실시간\s*(뉴스|검색|정보)/u.test(text);
}

function shouldShowLawProcessing(prompt) {
  const text = String(prompt || "");
  if (!text.trim()) return false;
  if (wantsExplicitWebSearch(text)) return false;
  if (/법령\s*적합성|컴플라이언스|법적\s*리스크|법령\s*리스크|근거\s*보고서|상위\s*법령|준수\s*여부|위반\s*가능성|개인정보\s*보호법|민원|계약|용역|행정절차|조문|판례|법령|법률/u.test(text)) return true;
  return /법령|법률|조문|조항|법에서|법령에서|근거\s*법|인용\s*검증|조문\s*검증|위법|적법|컴플라이언스|준수|판례|해석례|시행령|시행규칙|고시|예규|헌법|민법|형법|상법|개인정보\s*보호법|근로기준법|도로교통법|국가공무원법|제\s*\d+\s*조/u.test(text);
}

// ===== Visualization helpers =====

function shouldRequestVisualizationResponse(room) {
  return hasVisualizationIntent(getLastUserPrompt(room)) && hasVisualizableDocuments();
}

function getLastUserPrompt(room) {
  const message = [...(room?.messages ?? [])].reverse().find((item) => item.role !== "assistant");
  return String(message?.content ?? "");
}

function hasVisualizationIntent(prompt) {
  return /chart|graph|plot|dashboard|visuali[sz]e|visuali[sz]ation|infographic|차트|그래프|도표|시각화|인포그래픽|대시보드|막대|원형|선그래프/i.test(String(prompt ?? ""));
}

function isSearchIntent(text) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  return (
    /네이버.{0,12}(검색|뉴스|웹|조회|찾아|알아)/i.test(t) ||
    /(검색해서|검색해줘|검색해봐|찾아봐|찾아줘|알아봐|웹에서 찾|인터넷에서 찾)/i.test(t) ||
    /(최신|오늘|현재|실시간).{0,20}(정보|뉴스|동향|현황|조회|검색|찾아)/i.test(t)
  );
}

function hasVisualizableDocuments() {
  return getActiveDocuments().some((doc) => {
    const tables = Array.isArray(doc.tables) ? doc.tables : [];
    const sheets = Array.isArray(doc.sheets) ? doc.sheets : [];
    if ([...tables, ...sheets].some((t) => Array.isArray(t?.rows) && t.rows.length > 0)) return true;
    const fileType = String(doc.fileType || "").toLowerCase();
    return ["csv", "xlsx"].includes(fileType)
      && (sheets.some((s) => isTableLikeText(s?.text)) || isTableLikeText(doc.text));
  });
}

function isTableLikeText(value) {
  const lines = String(value ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 8);
  return lines.filter((l) => l.includes(",") || l.includes("\t")).length >= 2;
}

// ===== Misc helpers =====

export function createTitleFromPrompt(prompt) {
  return prompt.replace(/\s+/g, " ").slice(0, 28) || "새 대화";
}

function ensureAddressedAnswer(answer) {
  return answer;
}

function isNoEvidenceAnswer(answer) {
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
    } catch { /* ignore */ }
  }
  return null;
}

async function copyTextToClipboard(text) {
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return; }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export function extractImageFilesFromPaste(event) {
  const items = Array.from(event.clipboardData?.items ?? []);
  return items
    .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
    .map((item, index) => {
      const file = item.getAsFile();
      if (!file) return null;
      const extension = file.type.split("/")[1] || "png";
      return new File([file], `clipboard-image-${Date.now()}-${index}.${extension}`, { type: file.type });
    })
    .filter(Boolean);
}

// ===== Source badges (input sources) =====

const SOURCE_BADGE_SVG = {
  notebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z"/><path d="M5 17a3 3 0 0 1 3-3h11"/></svg>',
  paperclip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  scales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v16M5 8h14M5 8l-2 6a3 3 0 0 0 6 0L7 8M19 8l-2 6a3 3 0 0 0 6 0l-2-6M8 20h8"/></svg>'
};

const MAX_FILE_BADGES = 5;

function composeInputSources({ notebook, documents, images, lawProcessing, naverSearch }) {
  return {
    notebook: notebook ? { id: notebook.id, name: notebook.name || "" } : null,
    documents: Array.isArray(documents)
      ? documents.map((d) => ({ id: d.id, displayName: d.displayName || "" })).filter((d) => d.displayName)
      : [],
    images: Array.isArray(images)
      ? images.map((d) => ({ id: d.id, displayName: d.displayName || "" })).filter((d) => d.displayName)
      : [],
    naverSearch: naverSearch ? "guessed" : null,
    lawEngine: lawProcessing ? "guessed" : null
  };
}

function mergeServerConfirmation(sources, notebookMeta) {
  const next = {
    notebook: sources?.notebook ?? null,
    documents: Array.isArray(sources?.documents) ? sources.documents : [],
    images: Array.isArray(sources?.images) ? sources.images : [],
    naverSearch: sources?.naverSearch ?? null,
    lawEngine: sources?.lawEngine ?? null
  };
  const meta = notebookMeta || null;
  if (meta?.law?.ok) {
    next.lawEngine = "confirmed";
  } else if (next.lawEngine === "guessed") {
    next.lawEngine = null;
  }
  if (meta?.webSearch) {
    next.naverSearch = "confirmed";
  } else if (next.naverSearch === "guessed") {
    next.naverSearch = null;
  }
  if (meta?.notebook && !next.notebook) {
    next.notebook = { id: meta.notebook.id || "", name: meta.notebook.name || "" };
  }
  return next;
}

function isEmptySources(sources) {
  if (!sources) return true;
  if (sources.notebook) return false;
  if (Array.isArray(sources.documents) && sources.documents.length) return false;
  if (Array.isArray(sources.images) && sources.images.length) return false;
  if (sources.naverSearch) return false;
  if (sources.lawEngine) return false;
  return true;
}
