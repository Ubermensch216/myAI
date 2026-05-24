// 자료 브리핑 (source guide) — chat-inline prompt and result cards.
//
// Triggered right after a file finishes uploading: a prompt card appears in
// the chat asking "이 자료의 브리핑을 드릴까요?". On accept, calls the existing
// /api/source-workflow/source-guide endpoint and renders the result as an
// inline structured card with recommended-question chips and a save button.
//
// Messages are persisted in room.messages with role: "system" and a kind tag
// so renderMessages() can reroute them through these renderers on reload.

import { state, elements, accessAuthHeaders, getActiveRoom } from "./state.js";
import { scheduleSave } from "./persistence.js";
import { upsertStudioOutput } from "./documentStudio.js";

const PROMPT_KIND = "briefing_prompt";
const RESULT_KIND = "briefing_result";

export function isBriefingMessage(message) {
  return message?.role === "system"
    && (message?.kind === PROMPT_KIND || message?.kind === RESULT_KIND);
}

export function renderBriefingMessage(message, index) {
  if (!message) return null;
  if (message.kind === PROMPT_KIND) {
    if (message.dismissed || message.completed) return null;
    return renderBriefingPromptCard({ message, index });
  }
  if (message.kind === RESULT_KIND) {
    return renderBriefingResultCard({ message, index });
  }
  return null;
}

export function appendBriefingPrompt(room, document) {
  if (!room || !document) return null;
  if (!documentHasText(document)) return null;
  if (!Array.isArray(room.messages)) room.messages = [];

  // Avoid duplicate prompts for the same document if user uploads twice in a row.
  const existing = room.messages.find((msg) => msg?.kind === PROMPT_KIND
    && msg?.documentId === document.id
    && !msg?.dismissed
    && !msg?.completed);
  if (existing) return null;

  const message = {
    role: "system",
    kind: PROMPT_KIND,
    documentId: document.id,
    documentName: document.fileName || document.name || "자료",
    // Capture upload-time analysis (server-side analyzeDocument output) so the
    // prompt card can show instant value without waiting for the deeper LLM call.
    summary: typeof document.summary === "string" ? document.summary.trim() : "",
    topics: Array.isArray(document.topics) ? document.topics.filter(Boolean).slice(0, 8) : [],
    createdAt: new Date().toISOString(),
    dismissed: false,
    completed: false
  };
  const index = room.messages.length;
  room.messages.push(message);
  scheduleSave();

  if (getActiveRoom()?.id === room.id) {
    const card = renderBriefingPromptCard({ message, index });
    if (card) {
      elements.messages.append(card);
      scrollIntoViewSoft(card);
    }
  }
  return message;
}

function renderBriefingPromptCard({ message, index }) {
  const card = document.createElement("section");
  card.className = "briefing-prompt";
  card.dataset.kind = PROMPT_KIND;
  card.dataset.messageIndex = String(index);
  card.dataset.state = "idle";

  const header = document.createElement("div");
  header.className = "briefing-prompt-header";
  header.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
      <path d="M14 2v6h6"/>
    </svg>
    <span class="briefing-prompt-filename" title="${escapeAttr(message.documentName)}">${escapeText(message.documentName)}</span>
  `;
  card.append(header);

  const hasSummary = Boolean(message.summary);
  const hasTopics = Array.isArray(message.topics) && message.topics.length > 0;

  if (hasSummary || hasTopics) {
    const preview = document.createElement("div");
    preview.className = "briefing-prompt-preview";

    if (hasSummary) {
      const summaryEl = document.createElement("p");
      summaryEl.className = "briefing-prompt-summary";
      summaryEl.textContent = message.summary;
      preview.append(summaryEl);
    }

    if (hasTopics) {
      const topicsEl = document.createElement("div");
      topicsEl.className = "briefing-prompt-topics";
      const tagSvg = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/><circle cx="7" cy="7" r="1.5"/></svg>`;
      topicsEl.innerHTML = tagSvg;
      for (const topic of message.topics) {
        const chip = document.createElement("span");
        chip.className = "briefing-prompt-topic-chip";
        chip.textContent = String(topic);
        topicsEl.append(chip);
      }
      preview.append(topicsEl);
    }

    card.append(preview);

    const divider = document.createElement("div");
    divider.className = "briefing-prompt-divider";
    card.append(divider);
  }

  const title = document.createElement("div");
  title.className = "briefing-prompt-title";
  title.textContent = (hasSummary || hasTopics)
    ? "더 깊이 정리해드릴까요?"
    : "이 자료의 브리핑을 드릴까요?";

  const desc = document.createElement("p");
  desc.className = "briefing-prompt-desc";
  desc.textContent = (hasSummary || hasTopics)
    ? "핵심 쟁점 · 관련 법령 · 추천 질문 · 가능한 산출물까지 정리해드려요."
    : "요약 · 핵심 쟁점 · 관련 법령 · 추천 질문 · 가능한 산출물을 한 번에 정리해드려요.";

  const actions = document.createElement("div");
  actions.className = "briefing-prompt-actions";

  const cta = document.createElement("button");
  cta.type = "button";
  cta.className = "briefing-cta";
  cta.textContent = "자료 브리핑 받기";

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "briefing-dismiss";
  dismiss.textContent = "나중에";

  actions.append(cta, dismiss);

  const status = document.createElement("p");
  status.className = "briefing-prompt-status";
  status.hidden = true;

  card.append(title, desc, actions, status);

  cta.addEventListener("click", async () => {
    const room = findRoomForMessage(message);
    if (!room) return;
    card.dataset.state = "loading";
    status.hidden = false;
    status.textContent = "자료를 정리하고 있어요…";

    try {
      const guide = await requestBriefing(room, message.documentId, message.documentName);
      message.completed = true;
      const resultMessage = appendBriefingResult(room, guide);
      card.remove();
      if (resultMessage) {
        const resultIndex = room.messages.indexOf(resultMessage);
        const resultCard = renderBriefingResultCard({ message: resultMessage, index: resultIndex });
        if (resultCard) {
          elements.messages.append(resultCard);
          scrollIntoViewSoft(resultCard);
        }
      }
    } catch (error) {
      card.dataset.state = "error";
      status.textContent = `브리핑을 만들지 못했어요: ${error.message || error}`;
      // Restore action so user can retry
      cta.disabled = false;
    }
  });

  dismiss.addEventListener("click", () => {
    message.dismissed = true;
    scheduleSave();
    card.remove();
  });

  return card;
}

async function requestBriefing(room, documentId, fallbackName) {
  const documents = Array.isArray(room.documents) ? room.documents : [];
  const target = documents.find((doc) => doc?.id === documentId);
  if (!target) throw new Error("자료를 찾을 수 없습니다. 첨부가 삭제되었을 수 있어요.");

  const response = await fetch("/api/source-workflow/source-guide", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...accessAuthHeaders() },
    body: JSON.stringify({
      title: `${fallbackName || target.fileName || "자료"} 브리핑`,
      documents: [target],
      notebookId: room.selectedNotebookId || "",
      model: elements.modelInput?.value?.trim() || undefined
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.ok) {
    throw new Error(body.error || `요청 실패 (status ${response.status})`);
  }
  return body.guide;
}

function appendBriefingResult(room, guide) {
  if (!room || !guide) return null;
  if (!Array.isArray(room.messages)) room.messages = [];
  const message = {
    role: "system",
    kind: RESULT_KIND,
    guide,
    createdAt: guide.createdAt || new Date().toISOString()
  };
  room.messages.push(message);
  scheduleSave();
  return message;
}

function renderBriefingResultCard({ message, index }) {
  const guide = message?.guide;
  if (!guide) return null;

  const card = document.createElement("article");
  card.className = "briefing-result";
  card.dataset.kind = RESULT_KIND;
  card.dataset.messageIndex = String(index);

  const header = document.createElement("div");
  header.className = "briefing-result-header";
  header.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 5h10a4 4 0 0 1 4 4v10H8a4 4 0 0 1-4-4z"/>
      <path d="M8 9h6M8 13h5"/>
    </svg>
  `;
  const title = document.createElement("div");
  title.className = "briefing-result-title";
  title.textContent = guide.title || "자료 브리핑";
  header.append(title);

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "briefing-result-save";
  saveBtn.textContent = "스튜디오에 보관";
  saveBtn.addEventListener("click", () => {
    const room = findRoomForMessage(message) || getActiveRoom();
    if (!room) return;
    const stored = upsertStudioOutput({
      id: guide.id,
      type: "source_guide",
      title: guide.title || "자료 브리핑",
      markdown: guide.markdown || "",
      source: {
        roomId: room.id,
        sourceType: "source_guide",
        sourceScope: guide.sourceScope || {}
      },
      metadata: {
        sourceScope: guide.sourceScope || {},
        warnings: Array.isArray(guide.warnings) ? guide.warnings : []
      },
      createdAt: guide.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });
    if (stored) {
      saveBtn.textContent = "스튜디오에 보관됨";
      saveBtn.dataset.saved = "true";
      saveBtn.disabled = true;
      scheduleSave();
    }
  });
  header.append(saveBtn);

  card.append(header);

  if (Array.isArray(guide.warnings) && guide.warnings.length) {
    const warn = document.createElement("div");
    warn.className = "briefing-result-warnings";
    warn.textContent = guide.warnings.map((w) => w?.message || "").filter(Boolean).join(" · ")
      || "일부 항목은 보완이 필요해요.";
    card.append(warn);
  }

  appendSection(card, "요약", { summary: guide.summary });
  appendSection(card, "핵심 쟁점", { list: guide.keyIssues });
  appendSection(card, "관련 법령/기준", { list: guide.relatedLaws });
  appendSection(card, "추천 질문", { questions: guide.recommendedQuestions });
  appendSection(card, "가능한 산출물", { list: guide.possibleOutputs });

  return card;
}

function appendSection(card, heading, payload) {
  const section = document.createElement("section");
  section.className = "briefing-section";
  const h = document.createElement("div");
  h.className = "briefing-section-heading";
  h.textContent = heading;
  section.append(h);

  if (payload.summary && String(payload.summary).trim()) {
    const p = document.createElement("p");
    p.className = "briefing-section-summary";
    p.textContent = String(payload.summary).trim();
    section.append(p);
  } else if (Array.isArray(payload.list) && payload.list.length) {
    const ul = document.createElement("ul");
    ul.className = "briefing-section-list";
    for (const item of payload.list) {
      const text = String(item || "").trim();
      if (!text) continue;
      const li = document.createElement("li");
      li.textContent = text;
      ul.append(li);
    }
    if (!ul.children.length) return;
    section.append(ul);
  } else if (Array.isArray(payload.questions) && payload.questions.length) {
    const wrap = document.createElement("div");
    wrap.className = "briefing-section-questions";
    for (const q of payload.questions) {
      const text = String(q || "").trim();
      if (!text) continue;
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "briefing-question-chip";
      chip.textContent = text;
      chip.addEventListener("click", () => {
        sendQuestionFromBriefing(text);
      });
      wrap.append(chip);
    }
    if (!wrap.children.length) return;
    section.append(wrap);
  } else {
    return;
  }

  card.append(section);
}

async function sendQuestionFromBriefing(question) {
  if (!elements.promptInput) return;
  if (state.busy) {
    elements.promptInput.value = question;
    elements.promptInput.focus();
    return;
  }
  const { sendMessage } = await import("./chat.js");
  elements.promptInput.value = "";
  elements.promptInput.style.height = "auto";
  await sendMessage(question);
}

function findRoomForMessage(message) {
  const active = getActiveRoom();
  if (active && Array.isArray(active.messages) && active.messages.includes(message)) return active;
  if (!Array.isArray(state.rooms)) return active || null;
  for (const room of state.rooms) {
    if (Array.isArray(room.messages) && room.messages.includes(message)) return room;
  }
  return active || null;
}

function documentHasText(doc) {
  if (!doc) return false;
  if (typeof doc.text === "string" && doc.text.trim()) return true;
  if (Array.isArray(doc.pages) && doc.pages.some((p) => String(p?.text || "").trim())) return true;
  if (Array.isArray(doc.sheets) && doc.sheets.some((s) => String(s?.text || "").trim())) return true;
  return false;
}

function scrollIntoViewSoft(el) {
  if (!el || !elements.messages) return;
  elements.messages.scrollTop = elements.messages.scrollHeight;
}

function escapeText(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeText(str).replace(/"/g, "&quot;");
}
