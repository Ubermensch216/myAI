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

  // Master-Detail Layout
  mountElement.innerHTML = `
    <div class="doc-templates-layout" style="display: flex; gap: 20px; align-items: flex-start; margin-top: 8px; min-width: 0;">
      <aside class="doc-templates-sidebar" style="flex: 0 0 200px; display: flex; flex-direction: column; border-right: 1px solid var(--line); padding-right: 14px; min-width: 0;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h4 style="margin: 0; color: var(--text-color); font-size: 1.05em;">나의 템플릿</h4>
          <button type="button" class="icon-button" id="dtplNewBtn" title="새 템플릿 생성" aria-label="새 템플릿 생성">
            <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
        <div id="dtplList" style="display: flex; flex-direction: column; gap: 6px;"></div>
      </aside>
      <main id="dtplEditorContainer" class="doc-templates-main" style="flex: 1; min-width: 0; padding-left: 4px; display: flex; flex-direction: column;">
      </main>
    </div>
  `;

  const listMount = mountElement.querySelector("#dtplList");
  const editorMount = mountElement.querySelector("#dtplEditorContainer");

  mountElement.querySelector("#dtplNewBtn").addEventListener("click", () => {
    startEditing(createNewTemplate(), mountElement);
  });

  renderList(listMount, mountElement);
  renderEditor(editorMount, mountElement);
}

function renderList(listMount, rootMount) {
  listMount.innerHTML = "";

  const combinedTemplates = [];
  
  // Add personal templates
  state.documentTemplates.personal.forEach(tpl => {
    combinedTemplates.push({ ...tpl, isBuiltIn: false });
  });

  // Add built-in templates that aren't overridden in personal
  builtInTemplates.forEach(btpl => {
    if (!state.documentTemplates.personal.some(p => p.id === btpl.id)) {
      combinedTemplates.push({ ...btpl, isBuiltIn: true });
    }
  });

  if (combinedTemplates.length === 0) {
    listMount.innerHTML = `<div style="color: var(--text-color-light); font-size: 0.9em; text-align: center; margin-top: 20px;">생성된 템플릿이 없습니다.</div>`;
    return;
  }

  combinedTemplates.forEach(tpl => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "ghost-button";
    item.style.justifyContent = "flex-start";
    item.style.textAlign = "left";
    item.style.padding = "10px 12px";
    item.style.width = "100%";
    if (editingTemplateId === tpl.id) {
      item.style.background = "var(--input-bg)";
      item.style.fontWeight = "bold";
      item.style.color = "var(--accent)";
    }
    
    // Add an icon or label for built-in vs personal if desired, but here we just show name.
    const nameSpan = document.createElement("span");
    nameSpan.textContent = tpl.name || "제목 없음";
    nameSpan.style.flex = "1";
    
    if (tpl.isBuiltIn) {
      const badge = document.createElement("span");
      badge.textContent = "기본";
      badge.style.fontSize = "0.75em";
      badge.style.background = "var(--border-color)";
      badge.style.padding = "2px 6px";
      badge.style.borderRadius = "4px";
      badge.style.marginLeft = "8px";
      badge.style.color = "var(--text-color-light)";
      item.append(nameSpan, badge);
    } else {
      item.append(nameSpan);
    }

    item.addEventListener("click", () => {
      if (tpl.isBuiltIn) {
        // Clone into personal to make it editable
        const newTpl = JSON.parse(JSON.stringify(tpl));
        delete newTpl.isBuiltIn;
        state.documentTemplates.personal.push(newTpl);
        scheduleSave();
        startEditing(newTpl, rootMount);
      } else {
        startEditing(tpl, rootMount);
      }
    });
    listMount.append(item);
  });
}

function startEditing(tpl, rootMount) {
  editingTemplateId = tpl.id;
  renderDocumentTemplatesSettings(rootMount);
}

function createNewTemplate() {
  const id = `personal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  const tpl = {
    id,
    name: "새 템플릿",
    description: "",
    blocks: [
      { type: "section", title: "개요", instruction: "이 문서의 목적과 핵심 내용을 3줄 이내로 요약해 주세요." }
    ]
  };
  state.documentTemplates.personal.push(tpl);
  scheduleSave();
  return tpl;
}

function renderEditor(editorMount, rootMount) {
  editorMount.innerHTML = "";
  if (!editingTemplateId) {
    editorMount.innerHTML = `
      <div style="flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; color: var(--text-color-light);">
        <svg viewBox="0 0 24 24" width="64" height="64" style="opacity: 0.3; margin-bottom: 20px;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><polyline points="14 2 14 8 20 8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><polyline points="10 9 9 9 8 9" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        <p style="font-size: 1.05em; font-weight: 500;">왼쪽에서 템플릿을 선택하거나 새로 만드세요.</p>
        <p style="font-size: 0.9em; margin-top: 8px;">AI가 문서를 작성할 때 사용할 기본 목차와 지시사항을 디자인할 수 있습니다.</p>
      </div>
    `;
    return;
  }

  const tpl = state.documentTemplates.personal.find(t => t.id === editingTemplateId);
  if (!tpl) {
    editingTemplateId = null;
    renderEditor(editorMount, rootMount);
    return;
  }

  // Header / Title
  const headerDiv = document.createElement("div");
  headerDiv.style.display = "flex";
  headerDiv.style.gap = "12px";
  headerDiv.style.marginBottom = "20px";
  headerDiv.style.alignItems = "flex-start";

  const titleInput = document.createElement("input");
  titleInput.className = "text-input";
  titleInput.style.flex = "1";
  titleInput.style.minWidth = "0";
  titleInput.style.fontSize = "1.25em";
  titleInput.style.fontWeight = "bold";
  titleInput.style.padding = "12px 16px";
  titleInput.style.borderColor = "transparent";
  titleInput.style.background = "var(--input-bg)";
  titleInput.value = tpl.name || "";
  titleInput.placeholder = "템플릿 이름을 입력하세요";
  titleInput.addEventListener("input", () => {
    tpl.name = titleInput.value;
    scheduleSave();
    const listMount = rootMount.querySelector("#dtplList");
    if (listMount) renderList(listMount, rootMount);
  });
  titleInput.addEventListener("focus", () => {
    titleInput.style.borderColor = "var(--accent)";
  });
  titleInput.addEventListener("blur", () => {
    titleInput.style.borderColor = "transparent";
  });

  const delBtn = document.createElement("button");
  delBtn.className = "icon-button admin-danger-button";
  delBtn.title = "템플릿 삭제";
  delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  delBtn.style.padding = "12px";
  delBtn.addEventListener("click", () => {
    if (confirm(`'${tpl.name}' 템플릿을 정말 삭제하시겠습니까?`)) {
      state.documentTemplates.personal = state.documentTemplates.personal.filter(t => t.id !== tpl.id);
      editingTemplateId = null;
      scheduleSave();
      renderDocumentTemplatesSettings(rootMount);
    }
  });

  headerDiv.append(titleInput, delBtn);

  // Blocks Container
  const blocksWrapper = document.createElement("div");
  blocksWrapper.style.display = "flex";
  blocksWrapper.style.flexDirection = "column";
  blocksWrapper.style.gap = "16px";

  if (!Array.isArray(tpl.blocks)) tpl.blocks = [];

  tpl.blocks.forEach((block, index) => {
    const card = document.createElement("div");
    card.className = "template-block-card";
    card.style.background = "var(--panel-bg)";
    card.style.border = "1px solid var(--border-color)";
    card.style.borderRadius = "8px";
    card.style.padding = "16px";
    card.style.boxShadow = "0 2px 4px rgba(0,0,0,0.02)";

    // Card Header: Type, Title, Actions
    const cardHeader = document.createElement("div");
    cardHeader.style.display = "flex";
    cardHeader.style.gap = "8px";
    cardHeader.style.alignItems = "center";
    cardHeader.style.marginBottom = "12px";

    const typeSelect = document.createElement("select");
    typeSelect.className = "text-input";
    typeSelect.style.width = "85px";
    typeSelect.style.padding = "6px 8px";
    typeSelect.innerHTML = `<option value="section">단락 📝</option><option value="table">표 📊</option>`;
    typeSelect.value = block.type || "section";
    typeSelect.addEventListener("change", () => {
      block.type = typeSelect.value;
      if (block.type === "table" && !block.columns) block.columns = ["항목", "내용"];
      scheduleSave();
      renderEditor(editorMount, rootMount);
    });

    const bTitleInput = document.createElement("input");
    bTitleInput.className = "text-input";
    bTitleInput.style.flex = "1";
    bTitleInput.style.minWidth = "0";
    bTitleInput.style.fontWeight = "bold";
    bTitleInput.value = block.title || "";
    bTitleInput.placeholder = "목차 제목 (예: 1. 추진 배경)";
    bTitleInput.addEventListener("input", () => {
      block.title = bTitleInput.value;
      scheduleSave();
    });

    const moveUp = document.createElement("button");
    moveUp.className = "icon-button";
    moveUp.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    moveUp.title = "위로 이동";
    moveUp.disabled = index === 0;
    if (index === 0) moveUp.style.opacity = "0.3";
    moveUp.addEventListener("click", () => {
      [tpl.blocks[index - 1], tpl.blocks[index]] = [tpl.blocks[index], tpl.blocks[index - 1]];
      scheduleSave();
      renderEditor(editorMount, rootMount);
    });

    const moveDown = document.createElement("button");
    moveDown.className = "icon-button";
    moveDown.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 5v14M19 12l-7 7-7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    moveDown.title = "아래로 이동";
    moveDown.disabled = index === tpl.blocks.length - 1;
    if (index === tpl.blocks.length - 1) moveDown.style.opacity = "0.3";
    moveDown.addEventListener("click", () => {
      [tpl.blocks[index], tpl.blocks[index + 1]] = [tpl.blocks[index + 1], tpl.blocks[index]];
      scheduleSave();
      renderEditor(editorMount, rootMount);
    });

    const bDel = document.createElement("button");
    bDel.className = "icon-button admin-danger-button";
    bDel.title = "단락 삭제";
    bDel.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    bDel.addEventListener("click", () => {
      tpl.blocks.splice(index, 1);
      scheduleSave();
      renderEditor(editorMount, rootMount);
    });

    cardHeader.append(typeSelect, bTitleInput, moveUp, moveDown, bDel);
    card.append(cardHeader);

    // Card Body: Instruction
    const instrDiv = document.createElement("div");
    instrDiv.style.marginBottom = block.type === "table" ? "12px" : "0";
    
    const instrLabel = document.createElement("label");
    instrLabel.className = "field-label";
    instrLabel.innerHTML = `AI 작성 지침 <span style="font-weight: normal; color: var(--text-color-light);">(어떤 내용을 담을지 AI에게 지시)</span>`;
    instrLabel.style.fontSize = "0.85em";
    instrLabel.style.display = "block";
    instrLabel.style.marginBottom = "6px";
    
    const instrInput = document.createElement("textarea");
    instrInput.className = "text-input custom-prompt-input";
    instrInput.style.minHeight = "60px";
    instrInput.style.resize = "vertical";
    instrInput.placeholder = "예: 이 단락에서는 제공된 참고자료를 바탕으로 가장 중요한 3가지 쟁점을 서술형으로 작성해줘.";
    instrInput.value = block.instruction || "";
    instrInput.addEventListener("input", () => {
      block.instruction = instrInput.value;
      scheduleSave();
    });
    
    instrDiv.append(instrLabel, instrInput);
    card.append(instrDiv);

    // Card Footer: Table Columns
    if (block.type === "table") {
      const colDiv = document.createElement("div");
      colDiv.style.background = "var(--input-bg)";
      colDiv.style.padding = "12px";
      colDiv.style.borderRadius = "6px";
      
      const colLabel = document.createElement("label");
      colLabel.className = "field-label";
      colLabel.innerHTML = `표 열(Column) 이름 <span style="font-weight: normal; color: var(--text-color-light);">(쉼표로 구분)</span>`;
      colLabel.style.fontSize = "0.85em";
      colLabel.style.display = "block";
      colLabel.style.marginBottom = "6px";
      
      const colInput = document.createElement("input");
      colInput.className = "text-input";
      colInput.value = (block.columns || []).join(", ");
      colInput.placeholder = "예: 연번, 구분, 추진내용, 비고";
      colInput.addEventListener("change", () => {
        block.columns = colInput.value.split(",").map(s => s.trim()).filter(Boolean);
        scheduleSave();
      });
      
      colDiv.append(colLabel, colInput);
      card.append(colDiv);
    }

    blocksWrapper.append(card);
  });

  const addBlockBtn = document.createElement("button");
  addBlockBtn.className = "ghost-button";
  addBlockBtn.style.alignSelf = "center";
  addBlockBtn.style.marginTop = "8px";
  addBlockBtn.style.padding = "10px 24px";
  addBlockBtn.style.borderStyle = "dashed";
  addBlockBtn.style.borderWidth = "2px";
  addBlockBtn.style.borderColor = "var(--border-color)";
  addBlockBtn.style.color = "var(--text-color)";
  addBlockBtn.innerHTML = `<strong>+ 단락 추가</strong>`;
  addBlockBtn.addEventListener("click", () => {
    tpl.blocks.push({ type: "section", title: "", instruction: "" });
    scheduleSave();
    renderEditor(editorMount, rootMount);
    setTimeout(() => editorMount.scrollTo({ top: editorMount.scrollHeight, behavior: 'smooth' }), 50);
  });
  addBlockBtn.addEventListener("mouseover", () => {
    addBlockBtn.style.borderColor = "var(--accent)";
    addBlockBtn.style.color = "var(--accent)";
  });
  addBlockBtn.addEventListener("mouseout", () => {
    addBlockBtn.style.borderColor = "var(--border-color)";
    addBlockBtn.style.color = "var(--text-color)";
  });

  blocksWrapper.append(addBlockBtn);
  editorMount.append(headerDiv, blocksWrapper);
}