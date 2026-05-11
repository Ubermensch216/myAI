import { state } from "./state.js";
import { scheduleSave } from "./persistence.js";

let builtInTemplates = [];
let editingTemplateId = null;

export async function renderDocumentTemplatesSettings(mountElement) {
  if (!mountElement) return;

  if (!state.documentTemplates) {
    state.documentTemplates = { personal: [] };
  }
  if (!Array.isArray(state.documentTemplates.personal)) {
    state.documentTemplates.personal = [];
  }

  if (!builtInTemplates.length) {
    try {
      const response = await fetch("/api/studio/document/templates");
      const data = await response.json();
      if (data.ok && Array.isArray(data.templates)) {
        builtInTemplates = data.templates;
      }
    } catch (e) {
      console.error("Failed to load built-in templates", e);
    }
  }

  mountElement.innerHTML = "";

  const container = document.createElement("div");
  container.className = "document-templates-manager";

  const listSection = document.createElement("div");
  listSection.className = "template-list-section";

  const listHeader = document.createElement("div");
  listHeader.className = "template-list-header";
  listHeader.style.display = "flex";
  listHeader.style.justifyContent = "space-between";
  listHeader.style.alignItems = "center";
  listHeader.style.marginBottom = "12px";

  const listTitle = document.createElement("h4");
  listTitle.textContent = "내 템플릿";
  listTitle.style.margin = "0";

  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "send-button";
  newBtn.textContent = "+ 새 템플릿";
  newBtn.addEventListener("click", () => startEditing(createNewTemplate()));

  listHeader.append(listTitle, newBtn);

  const listBody = document.createElement("ul");
  listBody.className = "template-list";
  listBody.style.listStyle = "none";
  listBody.style.padding = "0";
  listBody.style.margin = "0";

  for (const tpl of state.documentTemplates.personal) {
    const item = document.createElement("li");
    item.className = "template-list-item";
    item.style.display = "flex";
    item.style.justifyContent = "space-between";
    item.style.alignItems = "center";
    item.style.padding = "8px";
    item.style.borderBottom = "1px solid var(--border-color)";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = tpl.name || "제목 없음";

    const actions = document.createElement("div");
    actions.style.display = "flex";
    actions.style.gap = "8px";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "ghost-button";
    editBtn.textContent = "편집";
    editBtn.addEventListener("click", () => startEditing(tpl));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "ghost-button admin-danger-button";
    delBtn.textContent = "삭제";
    delBtn.addEventListener("click", () => {
      if (confirm(`'${tpl.name}' 템플릿을 삭제하시겠습니까?`)) {
        state.documentTemplates.personal = state.documentTemplates.personal.filter(t => t.id !== tpl.id);
        scheduleSave();
        renderDocumentTemplatesSettings(mountElement);
      }
    });

    actions.append(editBtn, delBtn);
    item.append(nameSpan, actions);
    listBody.append(item);
  }

  if (state.documentTemplates.personal.length === 0) {
    const empty = document.createElement("li");
    empty.style.padding = "8px";
    empty.style.color = "var(--text-color-light)";
    empty.textContent = "저장된 개인 템플릿이 없습니다.";
    listBody.append(empty);
  }

  listSection.append(listHeader, listBody);
  container.append(listSection);

  if (editingTemplateId) {
    const tpl = state.documentTemplates.personal.find(t => t.id === editingTemplateId);
    if (tpl) {
      container.append(renderEditor(tpl, mountElement));
    } else {
      editingTemplateId = null;
    }
  }

  mountElement.append(container);
}

function createNewTemplate() {
  const id = `personal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const tpl = {
    id,
    name: "새 템플릿",
    description: "",
    blocks: [
      { type: "section", title: "1. 개요", instruction: "개요를 입력하세요." }
    ]
  };
  state.documentTemplates.personal.push(tpl);
  scheduleSave();
  return tpl;
}

function startEditing(tpl) {
  editingTemplateId = tpl.id;
  renderDocumentTemplatesSettings(document.getElementById("settingsDocumentTemplatesMount"));
}

function renderEditor(tpl, mountElement) {
  const editor = document.createElement("div");
  editor.className = "template-editor";
  editor.style.marginTop = "24px";
  editor.style.paddingTop = "24px";
  editor.style.borderTop = "2px solid var(--border-color)";

  const header = document.createElement("h4");
  header.textContent = "템플릿 편집";
  header.style.marginBottom = "16px";

  const titleField = document.createElement("div");
  titleField.className = "field";
  const titleLabel = document.createElement("label");
  titleLabel.className = "field-label";
  titleLabel.textContent = "템플릿 이름";
  const titleInput = document.createElement("input");
  titleInput.className = "text-input";
  titleInput.type = "text";
  titleInput.value = tpl.name || "";
  titleInput.addEventListener("input", () => {
    tpl.name = titleInput.value;
    scheduleSave();
  });
  titleField.append(titleLabel, titleInput);

  const copyField = document.createElement("div");
  copyField.className = "field";
  const copyLabel = document.createElement("label");
  copyLabel.className = "field-label";
  copyLabel.textContent = "기본 템플릿 구조 복사";
  const copySelect = document.createElement("select");
  copySelect.className = "text-input";
  copySelect.innerHTML = `<option value="">-- 복사할 템플릿 선택 --</option>` + builtInTemplates.map(t => `<option value="${t.id}">${t.name}</option>`).join("");
  copySelect.addEventListener("change", () => {
    const selected = builtInTemplates.find(t => t.id === copySelect.value);
    if (selected && confirm(`'${selected.name}' 템플릿의 섹션 구조를 복사하시겠습니까? 기존 섹션은 덮어씁니다.`)) {
      tpl.blocks = JSON.parse(JSON.stringify(selected.blocks));
      tpl.name = selected.name + " (복사본)";
      scheduleSave();
      renderDocumentTemplatesSettings(mountElement);
    }
    copySelect.value = "";
  });
  copyField.append(copyLabel, copySelect);

  const blocksContainer = document.createElement("div");
  blocksContainer.className = "template-blocks-editor";
  blocksContainer.style.marginTop = "16px";

  const blocksHeader = document.createElement("div");
  blocksHeader.style.display = "flex";
  blocksHeader.style.justifyContent = "space-between";
  blocksHeader.style.alignItems = "center";
  blocksHeader.style.marginBottom = "12px";

  const blocksTitle = document.createElement("h5");
  blocksTitle.textContent = "섹션 구성";
  blocksTitle.style.margin = "0";

  const addBlockBtn = document.createElement("button");
  addBlockBtn.type = "button";
  addBlockBtn.className = "ghost-button";
  addBlockBtn.textContent = "+ 섹션 추가";
  addBlockBtn.addEventListener("click", () => {
    if (!Array.isArray(tpl.blocks)) tpl.blocks = [];
    tpl.blocks.push({ type: "section", title: "새 섹션", instruction: "" });
    scheduleSave();
    renderDocumentTemplatesSettings(mountElement);
  });
  blocksHeader.append(blocksTitle, addBlockBtn);
  blocksContainer.append(blocksHeader);

  const blocksList = document.createElement("div");
  blocksList.className = "template-blocks-list";
  blocksList.style.display = "flex";
  blocksList.style.flexDirection = "column";
  blocksList.style.gap = "8px";

  if (!Array.isArray(tpl.blocks)) tpl.blocks = [];

  tpl.blocks.forEach((block, index) => {
    const blockRow = document.createElement("div");
    blockRow.className = "template-block-row";
    blockRow.style.display = "flex";
    blockRow.style.gap = "8px";
    blockRow.style.alignItems = "center";
    blockRow.style.background = "var(--input-bg)";
    blockRow.style.padding = "8px";
    blockRow.style.borderRadius = "4px";

    const typeSelect = document.createElement("select");
    typeSelect.className = "text-input";
    typeSelect.style.width = "auto";
    typeSelect.innerHTML = `<option value="section">단락</option><option value="table">표</option>`;
    typeSelect.value = block.type || "section";
    typeSelect.addEventListener("change", () => {
      block.type = typeSelect.value;
      if (block.type === "table" && !block.columns) block.columns = ["항목", "내용"];
      scheduleSave();
      renderDocumentTemplatesSettings(mountElement);
    });

    const titleInput = document.createElement("input");
    titleInput.className = "text-input";
    titleInput.type = "text";
    titleInput.value = block.title || "";
    titleInput.placeholder = "제목";
    titleInput.style.flex = "1";
    titleInput.addEventListener("input", () => {
      block.title = titleInput.value;
      scheduleSave();
    });

    const moveUpBtn = document.createElement("button");
    moveUpBtn.type = "button";
    moveUpBtn.className = "icon-button";
    moveUpBtn.textContent = "↑";
    moveUpBtn.disabled = index === 0;
    moveUpBtn.style.opacity = index === 0 ? "0.3" : "1";
    moveUpBtn.addEventListener("click", () => {
      [tpl.blocks[index - 1], tpl.blocks[index]] = [tpl.blocks[index], tpl.blocks[index - 1]];
      scheduleSave();
      renderDocumentTemplatesSettings(mountElement);
    });

    const moveDownBtn = document.createElement("button");
    moveDownBtn.type = "button";
    moveDownBtn.className = "icon-button";
    moveDownBtn.textContent = "↓";
    moveDownBtn.disabled = index === tpl.blocks.length - 1;
    moveDownBtn.style.opacity = index === tpl.blocks.length - 1 ? "0.3" : "1";
    moveDownBtn.addEventListener("click", () => {
      [tpl.blocks[index], tpl.blocks[index + 1]] = [tpl.blocks[index + 1], tpl.blocks[index]];
      scheduleSave();
      renderDocumentTemplatesSettings(mountElement);
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "icon-button admin-danger-button";
    delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      tpl.blocks.splice(index, 1);
      scheduleSave();
      renderDocumentTemplatesSettings(mountElement);
    });

    blockRow.append(moveUpBtn, moveDownBtn, typeSelect, titleInput, delBtn);
    blocksList.append(blockRow);

    if (block.type === "table") {
      const colsRow = document.createElement("div");
      colsRow.style.display = "flex";
      colsRow.style.gap = "8px";
      colsRow.style.alignItems = "center";
      colsRow.style.background = "var(--input-bg)";
      colsRow.style.padding = "0 8px 8px 8px";
      colsRow.style.borderRadius = "0 0 4px 4px";
      colsRow.style.marginTop = "-8px";

      const colsLabel = document.createElement("span");
      colsLabel.textContent = "열 이름:";
      colsLabel.style.fontSize = "0.85em";
      colsLabel.style.color = "var(--text-color-light)";

      const colsInput = document.createElement("input");
      colsInput.className = "text-input";
      colsInput.type = "text";
      colsInput.value = (block.columns || []).join(", ");
      colsInput.placeholder = "열 이름 (쉼표로 구분)";
      colsInput.addEventListener("change", () => {
        block.columns = colsInput.value.split(",").map(s => s.trim()).filter(Boolean);
        scheduleSave();
      });

      colsRow.append(colsLabel, colsInput);
      blocksList.append(colsRow);
    }
  });

  blocksContainer.append(blocksList);

  const actionsRow = document.createElement("div");
  actionsRow.className = "dialog-actions";
  actionsRow.style.marginTop = "24px";

  const closeEditorBtn = document.createElement("button");
  closeEditorBtn.type = "button";
  closeEditorBtn.className = "ghost-button";
  closeEditorBtn.textContent = "닫기";
  closeEditorBtn.addEventListener("click", () => {
    editingTemplateId = null;
    renderDocumentTemplatesSettings(mountElement);
  });

  actionsRow.append(closeEditorBtn);

  editor.append(header, titleField, copyField, blocksContainer, actionsRow);
  return editor;
}
