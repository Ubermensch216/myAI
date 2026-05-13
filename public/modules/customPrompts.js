import { state, ensureCustomPromptsState } from "./state.js";
import { scheduleSave } from "./persistence.js";

let editingPromptId = null;

const ICON_KEYS = ["summary", "translate", "code", "meeting", "email", "default"];

function iconSvg(key) {
  switch (key) {
    case "summary":
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
    case "translate":
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 5h9M8.5 5v2M4 9c1.5 4 4.5 6 8 6M11 7c-1 4-4 7-7 8M13 20l4-9 4 9M14.5 17h5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "code":
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="m9 8-4 4 4 4M15 8l4 4-4 4M13 6l-2 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    case "meeting":
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="8" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="16" cy="9" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M3 19c0-2.8 2.2-5 5-5s5 2.2 5 5M13 19c0-2.8 2.2-5 5-5s3 1 3 1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;
    case "email":
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m4 7 8 6 8-6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    default:
      return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3l2.5 5.5L20 9.5l-4 4 1 5.5-5-2.6L7 19l1-5.5-4-4 5.5-1L12 3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
  }
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

export function renderCustomPromptsSettings(mountElement) {
  if (!mountElement) return;
  ensureCustomPromptsState();

  mountElement.innerHTML = `
    <div class="doc-templates-layout" style="display: flex; gap: 20px; align-items: flex-start; margin-top: 8px; min-width: 0;">
      <aside class="doc-templates-sidebar" style="flex: 0 0 200px; display: flex; flex-direction: column; border-right: 1px solid var(--line); padding-right: 14px; min-width: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h4 style="margin: 0; color: var(--text-color); font-size: 1.05em;">나의 프롬프트</h4>
          <button type="button" class="icon-button" id="cpromptNewBtn" title="새 프롬프트 생성" aria-label="새 프롬프트 생성">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
        <div id="cpromptList" style="display: flex; flex-direction: column; gap: 6px;"></div>
      </aside>
      <main id="cpromptEditorContainer" class="doc-templates-main" style="flex: 1; min-width: 0; padding-left: 4px; display: flex; flex-direction: column;"></main>
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

  if (prompts.length === 0) {
    listMount.innerHTML = `<div style="color: var(--text-color-light); font-size: 0.9em; text-align: center; margin-top: 20px;">생성된 프롬프트가 없습니다.</div>`;
    return;
  }

  prompts.forEach((p) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ghost-button";
    item.style.justifyContent = "flex-start";
    item.style.textAlign = "left";
    item.style.padding = "10px 12px";
    item.style.width = "100%";
    item.style.display = "flex";
    item.style.alignItems = "center";
    item.style.gap = "8px";
    if (editingPromptId === p.id) {
      item.style.background = "var(--input-bg)";
      item.style.fontWeight = "bold";
      item.style.color = "var(--accent)";
    }

    const iconSpan = document.createElement("span");
    iconSpan.style.display = "inline-flex";
    iconSpan.style.alignItems = "center";
    iconSpan.innerHTML = iconSvg(p.icon || "default");

    const nameSpan = document.createElement("span");
    nameSpan.textContent = p.title || "제목 없음";
    nameSpan.style.flex = "1";
    nameSpan.style.overflow = "hidden";
    nameSpan.style.textOverflow = "ellipsis";
    nameSpan.style.whiteSpace = "nowrap";

    item.append(iconSpan, nameSpan);
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
    editorMount.innerHTML = `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-color-light); padding: 40px 0;">
        <svg viewBox="0 0 24 24" width="64" height="64" style="opacity: 0.3; margin-bottom: 20px;"><path d="M12 3l2.5 5.5L20 9.5l-4 4 1 5.5-5-2.6L7 19l1-5.5-4-4 5.5-1L12 3z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
        <p style="font-size: 1.05em; font-weight: 500;">왼쪽에서 프롬프트를 선택하거나 새로 만드세요.</p>
        <p style="font-size: 0.9em; margin-top: 8px;">자주 쓰는 지시문을 저장해두고 '+' 메뉴에서 1-클릭으로 불러올 수 있습니다.</p>
      </div>
    `;
    return;
  }

  const prompts = ensureCustomPromptsState().personal;
  const p = prompts.find((x) => x.id === editingPromptId);
  if (!p) {
    editingPromptId = null;
    renderEditor(editorMount, rootMount);
    return;
  }

  const headerDiv = document.createElement("div");
  headerDiv.style.display = "flex";
  headerDiv.style.gap = "12px";
  headerDiv.style.marginBottom = "16px";
  headerDiv.style.alignItems = "flex-start";

  const titleInput = document.createElement("input");
  titleInput.className = "text-input";
  titleInput.style.flex = "1";
  titleInput.style.minWidth = "0";
  titleInput.style.fontSize = "1.2em";
  titleInput.style.fontWeight = "bold";
  titleInput.style.padding = "12px 16px";
  titleInput.style.borderColor = "transparent";
  titleInput.style.background = "var(--input-bg)";
  titleInput.value = p.title || "";
  titleInput.placeholder = "프롬프트 이름";
  titleInput.addEventListener("input", () => {
    p.title = titleInput.value;
    scheduleSave();
    const listMount = rootMount.querySelector("#cpromptList");
    if (listMount) renderList(listMount, rootMount);
  });
  titleInput.addEventListener("focus", () => { titleInput.style.borderColor = "var(--accent)"; });
  titleInput.addEventListener("blur", () => { titleInput.style.borderColor = "transparent"; });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "icon-button admin-danger-button";
  delBtn.title = "프롬프트 삭제";
  delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  delBtn.style.padding = "12px";
  delBtn.addEventListener("click", () => {
    if (confirm(`'${p.title || "제목 없음"}' 프롬프트를 삭제하시겠습니까?`)) {
      state.customPrompts.personal = state.customPrompts.personal.filter((x) => x.id !== p.id);
      editingPromptId = null;
      scheduleSave();
      renderCustomPromptsSettings(rootMount);
    }
  });

  headerDiv.append(titleInput, delBtn);

  const iconLabel = document.createElement("div");
  iconLabel.className = "field-label";
  iconLabel.textContent = "아이콘";
  iconLabel.style.marginBottom = "6px";

  const iconRow = document.createElement("div");
  iconRow.style.display = "flex";
  iconRow.style.flexWrap = "wrap";
  iconRow.style.gap = "8px";
  iconRow.style.marginBottom = "16px";

  ICON_KEYS.forEach((key) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "icon-button";
    btn.title = key;
    btn.innerHTML = iconSvg(key);
    btn.style.padding = "8px";
    btn.style.border = `1px solid ${ (p.icon || "default") === key ? "var(--accent)" : "var(--border-color)" }`;
    btn.style.borderRadius = "6px";
    btn.addEventListener("click", () => {
      p.icon = key;
      scheduleSave();
      const listMount = rootMount.querySelector("#cpromptList");
      if (listMount) renderList(listMount, rootMount);
      renderEditor(rootMount.querySelector("#cpromptEditorContainer"), rootMount);
    });
    iconRow.append(btn);
  });

  const contentLabel = document.createElement("div");
  contentLabel.className = "field-label";
  contentLabel.textContent = "프롬프트 내용";
  contentLabel.style.marginBottom = "6px";

  const contentArea = document.createElement("textarea");
  contentArea.className = "text-input";
  contentArea.rows = 10;
  contentArea.value = p.content || "";
  contentArea.placeholder = "예: 다음 내용을 핵심만 3줄로 요약해줘:\\n\\n";
  contentArea.style.width = "100%";
  contentArea.style.resize = "vertical";
  contentArea.addEventListener("input", () => {
    p.content = contentArea.value;
    scheduleSave();
  });

  editorMount.append(headerDiv, iconLabel, iconRow, contentLabel, contentArea);
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
