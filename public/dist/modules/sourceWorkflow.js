import { getActiveRoom } from "./state.js";
import { persistAppState } from "./persistence.js";

const SOURCE_FORMATS = [
  { id: "md", label: "Markdown (.md)" },
  { id: "pdf", label: "PDF (.pdf)" },
  { id: "docx", label: "Word (.docx)" },
  { id: "hwpx", label: "HWPX (.hwpx)" }
];

export async function openAnswerAsSourceDialog(article) {
  const room = getActiveRoom();
  if (!room || !article) return;
  const answerMarkdown = article.dataset.copyText || article.querySelector(".message-body")?.innerText || "";
  if (!answerMarkdown.trim()) {
    window.alert("자료로 추가할 답변 내용이 없습니다.");
    return;
  }

  const messageIndex = Number(article.dataset.messageIndex);
  const message = Number.isInteger(messageIndex) ? room.messages?.[messageIndex] : null;
  const dialog = buildSourceDialog({
    defaultTitle: defaultSourceTitle(room, article),
    defaultFormat: "md"
  });

  document.body.append(dialog.element);
  const result = await dialog.open();
  if (!result) {
    dialog.element.remove();
    return;
  }

  try {
    dialog.setBusy(true);
    const response = await fetch("/api/source-workflow/from-answer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageId: message?.id || (Number.isInteger(messageIndex) ? `msg_${messageIndex}` : ""),
        title: result.title,
        answerMarkdown,
        format: result.format,
        metadata: buildAnswerMetadata(message)
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || !body.ok) throw new Error(body.error || "자료 생성에 실패했습니다.");
    addGeneratedSourceToRoom(room, body.generatedSource);
    window.dispatchEvent(new CustomEvent("myai:renderrooms"));
    window.alert("AI 답변을 현재 방 자료로 추가했습니다.");
    dialog.element.remove();
  } catch (error) {
    window.alert(error?.message || "자료로 추가하지 못했습니다.");
  } finally {
    dialog.setBusy(false);
  }
}

function buildAnswerMetadata(message) {
  const metadata = {};
  if (message?.notebook) metadata.notebook = message.notebook;
  if (message?.law) metadata.law = message.law;
  if (message?.compliance) metadata.compliance = message.compliance;
  if (message?.webSearch) metadata.webSearch = message.webSearch;
  if (Array.isArray(message?.citations)) metadata.citations = message.citations;
  return metadata;
}

export function addGeneratedSourceToRoom(room, generatedSource) {
  if (!room || !generatedSource) return;
  if (!Array.isArray(room.documents)) room.documents = [];
  room.documents.push(generatedSource);
  if (room.studio?.mindmap) {
    room.studio.mindmap = {
      signature: "",
      data: null,
      selectedNodeId: ""
    };
  }
  room.updatedAt = new Date().toISOString();
  persistAppState();
}

function buildSourceDialog({ defaultTitle, defaultFormat }) {
  const overlay = document.createElement("div");
  overlay.className = "source-workflow-overlay";

  const card = document.createElement("form");
  card.className = "source-workflow-dialog";
  card.innerHTML = `
    <h3>답변을 자료로 추가</h3>
    <label class="source-workflow-field">
      <span>파일 이름</span>
      <input class="text-input" name="title" type="text" maxlength="120" required />
    </label>
    <fieldset class="source-workflow-field source-workflow-format">
      <legend>파일 형식</legend>
    </fieldset>
    <p class="source-workflow-note">AI 생성 자료로 표시되며, 이후 대화에서 보조 참고자료로 사용됩니다.</p>
    <div class="dialog-actions">
      <span class="dialog-actions-spacer"></span>
      <button type="button" class="ghost-button" data-action="cancel">취소</button>
      <button type="submit" class="send-button">자료로 추가</button>
    </div>
  `;
  overlay.append(card);

  const titleInput = card.querySelector("input[name='title']");
  titleInput.value = defaultTitle;
  const formatHost = card.querySelector(".source-workflow-format");
  for (const format of SOURCE_FORMATS) {
    const label = document.createElement("label");
    label.className = "source-workflow-radio";
    label.innerHTML = `<input type="radio" name="format" value="${format.id}" /> <span>${format.label}</span>`;
    label.querySelector("input").checked = format.id === defaultFormat;
    formatHost.append(label);
  }

  let resolveOpen = null;
  const open = () => new Promise((resolve) => {
    resolveOpen = resolve;
    requestAnimationFrame(() => titleInput.focus());
  });
  const finish = (value) => {
    if (!resolveOpen) return;
    const resolve = resolveOpen;
    resolveOpen = null;
    resolve(value);
  };

  card.addEventListener("submit", (event) => {
    event.preventDefault();
    const title = titleInput.value.trim();
    if (!title) return;
    const format = card.querySelector("input[name='format']:checked")?.value || "md";
    finish({ title, format });
  });
  card.querySelector("[data-action='cancel']")?.addEventListener("click", () => finish(null));
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) finish(null);
  });

  return {
    element: overlay,
    open,
    setBusy(busy) {
      card.querySelectorAll("button, input").forEach((el) => { el.disabled = Boolean(busy); });
      const submit = card.querySelector("button[type='submit']");
      if (submit) submit.textContent = busy ? "생성 중..." : "자료로 추가";
    }
  };
}

function defaultSourceTitle(room, article) {
  const createdAt = article.dataset.createdAt ? new Date(article.dataset.createdAt) : new Date();
  const stamp = Number.isNaN(createdAt.getTime())
    ? new Date().toISOString().slice(0, 10)
    : createdAt.toISOString().slice(0, 10);
  const roomTitle = String(room?.title || "").trim();
  return `${roomTitle || "AI 답변"} ${stamp}`.slice(0, 80);
}
