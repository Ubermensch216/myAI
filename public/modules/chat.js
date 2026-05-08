import { renderAssistantAnswer as renderAssistantContent } from "../answerRenderer.js";
import { formatVisualizationText, renderVisualizationSpec } from "../visualizationRenderer.js";
import { displayFileName as formatDisplayFileName } from "../fileDisplay.js";
import { state, elements, documentCacheHeaders, getActiveRoom, showConfirmDialog } from "./state.js";
import { scheduleSave, persistAppState, hydrateStoredDocuments } from "./persistence.js";
import {
  hasCalendarKeyword, isCalendarConfirmation, isCalendarRejection,
  isLikelyCalendarActionPrompt, classifyMessageIntent, clearPendingCalendarAction,
  executeCalendarIntent, renderCalendar, renderEventCardList, findConflictingEvents,
  buildCalendarProposalText, formatEventOneLine, maybeRequestNotificationPermission
} from "./calendar.js";

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
  state.deepAnalysisEnabled = Boolean(enabled);
  if (elements.deepAnalysisToggle) {
    elements.deepAnalysisToggle.setAttribute("aria-pressed", state.deepAnalysisEnabled ? "true" : "false");
  }
}

// ===== Active room helpers =====

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
  const appName = state.settings.appName || "Ollama Chatter";
  return {
    userTitle: state.settings.userTitle || "사용자님",
    aiName: appName,
    appName,
    customPrompt: state.settings.customPrompt || ""
  };
}

// ===== File upload =====

export async function uploadFiles(files) {
  if (!files.length) return;
  const room = getActiveRoom();
  if (!room) return;
  if (!Array.isArray(room.documents)) room.documents = [];

  for (const file of files) {
    if (!shouldUploadFile(file)) continue;
    elements.uploadProgress.textContent = `${file.name} 처리 중...`;
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
      const saved = await persistAppState();
      // renderRooms triggered via custom event so chat.js doesn't import app.js
      window.dispatchEvent(new CustomEvent("myai:renderrooms"));
      if (saved) elements.uploadProgress.textContent = `${file.name} 분석 준비 완료`;
    } catch (error) {
      elements.uploadProgress.textContent = `${file.name}: ${error.message}`;
    }
  }
}

function shouldUploadFile(file) {
  const size = Number(file?.size || 0);
  if (size > DEFAULT_MAX_UPLOAD_BYTES) {
    elements.uploadProgress.textContent = `${file.name}: ${formatBytes(size)} 파일은 업로드 한도 ${formatBytes(DEFAULT_MAX_UPLOAD_BYTES)}를 넘습니다.`;
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
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  window.dispatchEvent(new CustomEvent("myai:renderrooms"));
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
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  elements.uploadProgress.textContent = "현재 대화방의 첨부를 정리했습니다.";
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
  setBusy(true);
  state.abortController = new AbortController();
  const thinking = appendThinking();
  advanceThinkingProgress(thinking, Math.max(1, getThinkingStepCount(thinking) - 2));
  let assistant = null;
  let assistantBody = null;
  let answer = "";

  try {
    const useDeepAnalysis = state.deepAnalysisEnabled;
    const payload = {
      model: elements.modelInput.value.trim() || "gemma3n:e2b",
      messages: room.messages.map(({ role, content }) => ({ role, content })),
      documents: queryTrimDocuments(getActiveDocuments(), getLastUserPrompt(room)),
      personalization: getPersonalizationSettings(),
      notebookId: room.selectedNotebookId || null,
      ...(useDeepAnalysis ? { mode: "map_reduce" } : {})
    };
    validateChatPayloadSize(payload);
    const response = await fetch("/api/chat", {
      method: "POST",
      signal: state.abortController.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (useDeepAnalysis) setDeepAnalysisEnabled(false);

    if (!response.ok || !response.body) {
      const errorText = await response.text();
      throw new Error(errorText || "응답 생성 실패");
    }

    const notebookMeta = decodeNotebookMetaHeader(response.headers.get("X-Notebook-Meta"));
    const citations = Array.isArray(notebookMeta?.citations) ? notebookMeta.citations : [];
    const webCitations = Array.isArray(notebookMeta?.webSearch?.citations) ? notebookMeta.webSearch.citations : [];
    const allCitations = [...citations, ...webCitations];

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
      renderCitationsPanel(assistant, allCitations);
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
    "방금 논의한 내용의 핵심을 요약하고, 실무 적용 시 가장 주의할 점을 알려줘",
    "이 주제와 관련하여 우리가 간과했을 만한 리스크나 반대 관점이 있을까?",
    "이 개념을 실제 운영 환경이나 더 큰 규모의 프로젝트에 적용한다면 어떻게 변화해야 할까?"
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
    renderCitationsPanel(article, options.citations);
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

export function renderCitationsPanel(article, citations) {
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
    const docName = citation.url ? document.createElement("a") : document.createElement("span");
    docName.className = "citation-doc";
    docName.textContent = citation.documentName || "출처 미상";
    if (citation.url) {
      docName.href = citation.url;
      docName.target = "_blank";
      docName.rel = "noopener noreferrer";
      docName.title = citation.url;
    }
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

export function createMessageActions(article, role, createdAt = "") {
  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(createCopyButton(article, role));
  if (role === "assistant") actions.append(createDownloadButton(article));
  if (role === "user") actions.append(createEditButton(article));
  if (role === "assistant" && createdAt) actions.append(createMessageTime(createdAt));
  return actions;
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

export function appendThinking() {
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

export function getThinkingStepCount(thinking) {
  return thinking?.querySelectorAll(".thinking-details li").length ?? 0;
}

function buildProcessingSteps() {
  const steps = ["사용자 질문 확인", "대화 맥락 정리"];
  const { displayFileName: fmt } = { displayFileName: formatDisplayFileName };
  const documents = getActiveDocuments().filter((f) => f.kind === "document");
  const images = getActiveDocuments().filter((f) => f.kind === "image");
  if (documents.length) steps.push(`문서 컨텍스트 구성: ${documents.map(fmt).join(", ")}`);
  if (images.length) steps.push(`이미지 입력 포함: ${images.map(fmt).join(", ")}`);
  steps.push("Ollama 스트리밍 응답 수신");
  steps.push("근거 중심 답변 표시");
  return steps;
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
