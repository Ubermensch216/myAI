import { state, ensureCustomPromptsState } from "./state.js";
import { scheduleSave } from "./persistence.js";

let editingPromptId = null;

const ICON_KEYS = [
  "default", "summary", "translate", "code", "meeting", "email",
  "doc", "idea", "chat", "brain", "book", "search",
  "edit", "calendar", "chart", "image", "clock", "flag",
  "tag", "folder", "link", "bookmark", "check", "lock",
  "globe", "terminal", "database", "sparkles",
];

const ICON_PATHS = {
  default:   `<path d="M12 3l2.5 5.5L20 9.5l-4 4 1 5.5-5-2.6L7 19l1-5.5-4-4 5.5-1L12 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  summary:   `<path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  translate: `<path d="M4 5h9M8.5 5v2M4 9c1.5 4 4.5 6 8 6M11 7c-1 4-4 7-7 8M13 20l4-9 4 9M14.5 17h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  code:      `<path d="m9 8-4 4 4 4M15 8l4 4-4 4M13 6l-2 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  meeting:   `<circle cx="8" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 19c0-2.8 2.2-5 5-5s5 2.2 5 5M13 19c0-2.8 2.2-5 5-5s3 1 3 1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  email:     `<rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  doc:       `<path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z M14 3v5h5 M9 13h7 M9 17h7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`,
  idea:      `<path d="M9 18h6 M10 21h4 M12 3a6 6 0 0 0-4 10.5c1 1 1.5 2 1.5 3.5h5c0-1.5.5-2.5 1.5-3.5A6 6 0 0 0 12 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`,
  chat:      `<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  brain:     `<path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-2 3 3 3 0 0 0 1 2 3 3 0 0 0 0 4 3 3 0 0 0 4 2 2 2 0 0 0 4 0V4a3 3 0 0 0-4 0z M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 2 3 3 3 0 0 1-1 2 3 3 0 0 1 0 4 3 3 0 0 1-4 2 2 2 0 0 1-4 0" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>`,
  book:      `<path d="M4 4h6a3 3 0 0 1 3 3v13 M20 4h-6a3 3 0 0 0-3 3v13 M4 4v15h6a3 3 0 0 1 3 2 M20 4v15h-6a3 3 0 0 0-3 2" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`,
  search:    `<circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="m20 20-4.5-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  edit:      `<path d="M4 20h4l10-10-4-4L4 16v4z M14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`,
  calendar:  `<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 9h18 M8 3v4 M16 3v4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  chart:     `<path d="M4 20V10 M10 20V4 M16 20v-8 M22 20H2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`,
  image:     `<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m4 18 5-5 4 4 3-3 4 4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  clock:     `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M12 7v5l3 2" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  flag:      `<path d="M5 21V4 M5 4h13l-2 4 2 4H5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`,
  tag:       `<path d="M3 12V4h8l10 10-8 8L3 12z M8 8h.01" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`,
  folder:    `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  link:      `<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
  bookmark:  `<path d="M6 3h12v18l-6-4-6 4V3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>`,
  check:     `<path d="m4 12 5 5L20 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
  lock:      `<rect x="5" y="11" width="14" height="10" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 11V7a4 4 0 0 1 8 0v4" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  globe:     `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 12h18 M12 3a14 14 0 0 1 0 18 M12 3a14 14 0 0 0 0 18" fill="none" stroke="currentColor" stroke-width="1.4"/>`,
  terminal:  `<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m7 9 3 3-3 3 M13 15h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  database:  `<ellipse cx="12" cy="5" rx="8" ry="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M4 5v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5V5 M4 11v6c0 1.4 3.6 2.5 8 2.5s8-1.1 8-2.5v-6" fill="none" stroke="currentColor" stroke-width="1.6"/>`,
  sparkles:  `<path d="M12 3v4 M12 17v4 M3 12h4 M17 12h4 M6 6l2.5 2.5 M15.5 15.5 18 18 M6 18l2.5-2.5 M15.5 8.5 18 6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`,
};

function iconSvg(key, size = 18) {
  const inner = ICON_PATHS[key] || ICON_PATHS.default;
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${inner}</svg>`;
}

function makePromptId() {
  return `personal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function createNewPrompt() {
  const p = { id: makePromptId(), title: "새 프롬프트", icon: "default", content: "" };
  ensureCustomPromptsState().personal.push(p);
  scheduleSave();
  return p;
}

function firstLine(text) {
  const t = (text || "").trim();
  if (!t) return "";
  const line = t.split(/\r?\n/).find((s) => s.trim().length > 0) || "";
  return line.length > 80 ? line.slice(0, 80) + "…" : line;
}

export function renderCustomPromptsSettings(mountElement) {
  if (!mountElement) return;
  ensureCustomPromptsState();

  mountElement.innerHTML = `
    <div class="cprompt-layout">
      <aside class="cprompt-sidebar">
        <div class="cprompt-sidebar-header">
          <div class="cprompt-sidebar-title-group">
            <h4 class="cprompt-sidebar-title">나의 프롬프트</h4>
            <span class="cprompt-count-badge" id="cpromptCount">0</span>
          </div>
          <button type="button" class="cprompt-add-btn" id="cpromptNewBtn" title="새 프롬프트 생성" aria-label="새 프롬프트 생성">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
        <div id="cpromptList" class="cprompt-list"></div>
      </aside>
      <section id="cpromptEditorContainer" class="cprompt-editor"></section>
    </div>
  `;

  const listMount = mountElement.querySelector("#cpromptList");
  const editorMount = mountElement.querySelector("#cpromptEditorContainer");

  mountElement.querySelector("#cpromptNewBtn").addEventListener("click", () => {
    const p = createNewPrompt();
    editingPromptId = p.id;
    renderCustomPromptsSettings(mountElement);
  });

  renderList(listMount, mountElement);
  renderEditor(editorMount, mountElement);
}

function renderList(listMount, rootMount) {
  listMount.innerHTML = "";
  const prompts = ensureCustomPromptsState().personal;
  const countEl = rootMount.querySelector("#cpromptCount");
  if (countEl) countEl.textContent = String(prompts.length);

  if (prompts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "cprompt-list-empty";
    empty.textContent = "프롬프트가 없습니다.\n우측 상단 + 버튼으로 추가하세요.";
    empty.style.whiteSpace = "pre-line";
    listMount.append(empty);
    return;
  }

  prompts.forEach((p) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "cprompt-list-item" + (editingPromptId === p.id ? " is-active" : "");

    const iconSpan = document.createElement("span");
    iconSpan.className = "cprompt-list-item-icon";
    iconSpan.innerHTML = iconSvg(p.icon || "default", 16);

    const body = document.createElement("span");
    body.className = "cprompt-list-item-body";

    const titleEl = document.createElement("span");
    titleEl.className = "cprompt-list-item-title";
    titleEl.textContent = p.title || "제목 없음";

    const preview = firstLine(p.content);
    body.append(titleEl);
    if (preview) {
      const previewEl = document.createElement("span");
      previewEl.className = "cprompt-list-item-preview";
      previewEl.textContent = preview;
      body.append(previewEl);
    }

    item.append(iconSpan, body);
    item.addEventListener("click", () => {
      editingPromptId = p.id;
      renderCustomPromptsSettings(rootMount);
    });
    listMount.append(item);
  });
}

function renderEditor(editorMount, rootMount) {
  editorMount.innerHTML = "";
  if (!editingPromptId) {
    const empty = document.createElement("div");
    empty.className = "cprompt-editor-empty";
    empty.innerHTML = `
      <svg class="cprompt-editor-empty-icon" viewBox="0 0 24 24" width="56" height="56" aria-hidden="true"><path d="M12 3l2.5 5.5L20 9.5l-4 4 1 5.5-5-2.6L7 19l1-5.5-4-4 5.5-1L12 3z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
      <div class="cprompt-editor-empty-title">프롬프트를 선택하세요</div>
      <div class="cprompt-editor-empty-desc">자주 쓰는 지시문을 저장해두면 채팅창의 '+' 메뉴에서 1-클릭으로 불러올 수 있습니다. 좌측에서 선택하거나 새로 만드세요.</div>
    `;
    editorMount.append(empty);
    return;
  }

  const prompts = ensureCustomPromptsState().personal;
  const p = prompts.find((x) => x.id === editingPromptId);
  if (!p) {
    editingPromptId = null;
    renderEditor(editorMount, rootMount);
    return;
  }

  // ---- Header: title + actions ----
  const header = document.createElement("div");
  header.className = "cprompt-header";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "cprompt-title-input";
  titleInput.value = p.title || "";
  titleInput.placeholder = "프롬프트 이름";
  titleInput.maxLength = 60;
  titleInput.addEventListener("input", () => {
    p.title = titleInput.value;
    scheduleSave();
    const listMount = rootMount.querySelector("#cpromptList");
    if (listMount) renderList(listMount, rootMount);
  });

  const dupBtn = document.createElement("button");
  dupBtn.type = "button";
  dupBtn.className = "cprompt-action-btn";
  dupBtn.title = "복제";
  dupBtn.setAttribute("aria-label", "프롬프트 복제");
  dupBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
  dupBtn.addEventListener("click", () => {
    const copy = {
      id: makePromptId(),
      title: (p.title || "제목 없음") + " (복사)",
      icon: p.icon || "default",
      content: p.content || ""
    };
    ensureCustomPromptsState().personal.push(copy);
    editingPromptId = copy.id;
    scheduleSave();
    renderCustomPromptsSettings(rootMount);
  });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "cprompt-action-btn is-danger";
  delBtn.title = "삭제";
  delBtn.setAttribute("aria-label", "프롬프트 삭제");
  delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  delBtn.addEventListener("click", () => {
    if (confirm(`'${p.title || "제목 없음"}' 프롬프트를 삭제하시겠습니까?`)) {
      state.customPrompts.personal = state.customPrompts.personal.filter((x) => x.id !== p.id);
      editingPromptId = null;
      scheduleSave();
      renderCustomPromptsSettings(rootMount);
    }
  });

  header.append(titleInput, dupBtn, delBtn);

  // ---- Icon picker ----
  const iconField = document.createElement("div");
  iconField.className = "cprompt-field";

  const iconLabel = document.createElement("div");
  iconLabel.className = "cprompt-field-label";
  iconLabel.textContent = "아이콘";

  const iconGrid = document.createElement("div");
  iconGrid.className = "cprompt-icon-grid";

  ICON_KEYS.forEach((key) => {
    const btn = document.createElement("button");
    btn.type = "button";
    const selected = (p.icon || "default") === key;
    btn.className = "cprompt-icon-btn" + (selected ? " is-selected" : "");
    btn.title = key;
    btn.setAttribute("aria-label", `아이콘 ${key}`);
    btn.setAttribute("aria-pressed", String(selected));
    btn.innerHTML = iconSvg(key, 15);
    btn.addEventListener("click", () => {
      p.icon = key;
      scheduleSave();
      const listMount = rootMount.querySelector("#cpromptList");
      if (listMount) renderList(listMount, rootMount);
      renderEditor(rootMount.querySelector("#cpromptEditorContainer"), rootMount);
    });
    iconGrid.append(btn);
  });

  iconField.append(iconLabel, iconGrid);

  // ---- Content field ----
  const contentField = document.createElement("div");
  contentField.className = "cprompt-field";

  const contentLabel = document.createElement("div");
  contentLabel.className = "cprompt-field-label";
  contentLabel.textContent = "프롬프트 내용";

  const contentArea = document.createElement("textarea");
  contentArea.className = "cprompt-textarea";
  contentArea.value = p.content || "";
  contentArea.placeholder = `예시 구조:\n당신은 [역할]입니다. 아래 [대상]을 다음 형식으로 처리해 주세요.\n\n[형식]\n- ...\n\n[규칙]\n- ...\n\n[입력]\n`;
  contentArea.spellcheck = false;

  const footer = document.createElement("div");
  footer.className = "cprompt-content-footer";

  const charCount = document.createElement("span");
  const updateCount = () => {
    const len = contentArea.value.length;
    charCount.textContent = `${len.toLocaleString()}자`;
  };
  updateCount();

  const hint = document.createElement("span");
  hint.textContent = "변경사항은 자동 저장됩니다";

  footer.append(charCount, hint);

  contentArea.addEventListener("input", () => {
    p.content = contentArea.value;
    updateCount();
    scheduleSave();
  });
  contentArea.addEventListener("blur", () => {
    const listMount = rootMount.querySelector("#cpromptList");
    if (listMount) renderList(listMount, rootMount);
  });

  contentField.append(contentLabel, contentArea, footer);

  // ---- Tips ----
  const tips = document.createElement("div");
  tips.className = "cprompt-tips";
  tips.innerHTML = `<b>좋은 프롬프트 팁</b> · <b>역할</b>(당신은 …입니다) → <b>지시</b>(이렇게 처리해 주세요) → <b>형식</b>(출력 구조) → <b>규칙</b>(금지·제한사항) → <b>입력</b>(대상 텍스트 자리) 순서로 구조화하면 일관된 결과를 얻기 쉽습니다.`;

  editorMount.append(header, iconField, contentField, tips);
}

export function renderCustomPromptPicker(pickerElement, onSelect) {
  if (!pickerElement) return;
  const prompts = ensureCustomPromptsState().personal;
  pickerElement.innerHTML = "";

  if (prompts.length === 0) {
    const empty = document.createElement("div");
    empty.className = "custom-prompt-picker-empty";
    empty.textContent = "정의된 프롬프트가 없습니다. 설정 > 개인 맞춤 설정 > 사용자 프롬프트에서 추가하세요.";
    pickerElement.append(empty);
    return;
  }

  prompts.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "custom-prompt-picker-item";
    btn.setAttribute("role", "menuitem");
    btn.title = p.content || "";

    const iconSpan = document.createElement("span");
    iconSpan.className = "custom-prompt-picker-icon";
    iconSpan.innerHTML = iconSvg(p.icon || "default");

    const label = document.createElement("span");
    label.className = "custom-prompt-picker-label";
    label.textContent = p.title || "제목 없음";

    btn.append(iconSpan, label);
    btn.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelect?.(p);
    });
    pickerElement.append(btn);
  });
}
