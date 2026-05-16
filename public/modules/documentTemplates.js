import { state } from "./state.js";
import { scheduleSave } from "./persistence.js";

let builtInTemplates = [];
let editingTemplateId = null;

function makeTemplateId() {
  return `personal_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

function ensureTemplatesState() {
  if (!state.documentTemplates) state.documentTemplates = { personal: [] };
  if (!Array.isArray(state.documentTemplates.personal)) state.documentTemplates.personal = [];
  return state.documentTemplates;
}

function summarizeBlocks(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return "단락 없음";
  const sections = blocks.filter((b) => b.type !== "table").length;
  const tables = blocks.filter((b) => b.type === "table").length;
  const parts = [];
  if (sections > 0) parts.push(`단락 ${sections}`);
  if (tables > 0) parts.push(`표 ${tables}`);
  return parts.join(" · ") + ` (총 ${blocks.length})`;
}

function createNewTemplate() {
  const tpl = {
    id: makeTemplateId(),
    name: "새 템플릿",
    description: "",
    blocks: [
      { type: "section", title: "개요", instruction: "이 문서의 목적과 핵심 내용을 3줄 이내로 요약해 주세요." }
    ]
  };
  ensureTemplatesState().personal.push(tpl);
  scheduleSave();
  return tpl;
}

export async function renderDocumentTemplatesSettings(mountElement) {
  if (!mountElement) return;
  ensureTemplatesState();

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

  mountElement.innerHTML = `
    <div class="dtpl-layout">
      <aside class="dtpl-sidebar">
        <div class="dtpl-sidebar-header">
          <div class="dtpl-sidebar-title-group">
            <h4 class="dtpl-sidebar-title">나의 템플릿</h4>
            <span class="dtpl-count-badge" id="dtplCount">0</span>
          </div>
          <button type="button" class="dtpl-add-btn" id="dtplNewBtn" title="새 템플릿 생성" aria-label="새 템플릿 생성">
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
              <path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
            </svg>
          </button>
        </div>
        <div id="dtplList" class="dtpl-list"></div>
      </aside>
      <section id="dtplEditorContainer" class="dtpl-editor"></section>
    </div>
  `;

  const listMount = mountElement.querySelector("#dtplList");
  const editorMount = mountElement.querySelector("#dtplEditorContainer");

  mountElement.querySelector("#dtplNewBtn").addEventListener("click", () => {
    const tpl = createNewTemplate();
    editingTemplateId = tpl.id;
    renderDocumentTemplatesSettings(mountElement);
  });

  renderList(listMount, mountElement);
  renderEditor(editorMount, mountElement);
}

function renderList(listMount, rootMount) {
  listMount.innerHTML = "";

  const personal = ensureTemplatesState().personal;
  const combined = [];

  personal.forEach((tpl) => combined.push({ ...tpl, isBuiltIn: false }));
  builtInTemplates.forEach((btpl) => {
    if (!personal.some((p) => p.id === btpl.id)) {
      combined.push({ ...btpl, isBuiltIn: true });
    }
  });

  const countEl = rootMount.querySelector("#dtplCount");
  if (countEl) countEl.textContent = String(combined.length);

  if (combined.length === 0) {
    const empty = document.createElement("div");
    empty.className = "dtpl-list-empty";
    empty.textContent = "템플릿이 없습니다.\n우측 상단 + 버튼으로 추가하세요.";
    listMount.append(empty);
    return;
  }

  combined.forEach((tpl) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "dtpl-list-item" + (editingTemplateId === tpl.id ? " is-active" : "");

    const iconSpan = document.createElement("span");
    iconSpan.className = "dtpl-list-item-icon";
    iconSpan.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 14h6 M9 17h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;

    const body = document.createElement("span");
    body.className = "dtpl-list-item-body";

    const titleRow = document.createElement("span");
    titleRow.className = "dtpl-list-item-title";
    titleRow.textContent = tpl.name || "제목 없음";

    body.append(titleRow);

    item.append(iconSpan, body);

    if (tpl.isBuiltIn) {
      const badge = document.createElement("span");
      badge.className = "dtpl-list-builtin-badge";
      badge.textContent = "기본";
      item.append(badge);
    }

    item.addEventListener("click", () => {
      if (tpl.isBuiltIn) {
        const cloned = JSON.parse(JSON.stringify(tpl));
        delete cloned.isBuiltIn;
        ensureTemplatesState().personal.push(cloned);
        scheduleSave();
        editingTemplateId = cloned.id;
      } else {
        editingTemplateId = tpl.id;
      }
      renderDocumentTemplatesSettings(rootMount);
    });
    listMount.append(item);
  });
}

function renderEditor(editorMount, rootMount) {
  editorMount.innerHTML = "";

  if (!editingTemplateId) {
    const empty = document.createElement("div");
    empty.className = "dtpl-editor-empty";
    empty.innerHTML = `
      <svg class="dtpl-editor-empty-icon" viewBox="0 0 24 24" width="56" height="56" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5 M9 14h6 M9 17h4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>
      <div class="dtpl-editor-empty-title">템플릿을 선택하세요</div>
      <div class="dtpl-editor-empty-desc">AI가 문서를 작성할 때 사용할 목차와 단락별 작성 지침을 설계할 수 있습니다. 좌측에서 기존 템플릿을 선택하거나 + 버튼으로 새로 만드세요.</div>
    `;
    editorMount.append(empty);
    return;
  }

  const tpl = ensureTemplatesState().personal.find((t) => t.id === editingTemplateId);
  if (!tpl) {
    editingTemplateId = null;
    renderEditor(editorMount, rootMount);
    return;
  }

  if (!Array.isArray(tpl.blocks)) tpl.blocks = [];

  // ---- Header ----
  const header = document.createElement("div");
  header.className = "dtpl-header";

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "dtpl-title-input";
  titleInput.value = tpl.name || "";
  titleInput.placeholder = "템플릿 이름";
  titleInput.maxLength = 80;
  titleInput.addEventListener("input", () => {
    tpl.name = titleInput.value;
    scheduleSave();
    const listMount = rootMount.querySelector("#dtplList");
    if (listMount) renderList(listMount, rootMount);
  });

  const dupBtn = document.createElement("button");
  dupBtn.type = "button";
  dupBtn.className = "dtpl-action-btn";
  dupBtn.title = "복제";
  dupBtn.setAttribute("aria-label", "템플릿 복제");
  dupBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
  dupBtn.addEventListener("click", () => {
    const copy = JSON.parse(JSON.stringify(tpl));
    copy.id = makeTemplateId();
    copy.name = (tpl.name || "제목 없음") + " (복사)";
    ensureTemplatesState().personal.push(copy);
    editingTemplateId = copy.id;
    scheduleSave();
    renderDocumentTemplatesSettings(rootMount);
  });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "dtpl-action-btn is-danger";
  delBtn.title = "삭제";
  delBtn.setAttribute("aria-label", "템플릿 삭제");
  delBtn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  delBtn.addEventListener("click", () => {
    if (confirm(`'${tpl.name || "제목 없음"}' 템플릿을 삭제하시겠습니까?`)) {
      state.documentTemplates.personal = state.documentTemplates.personal.filter((t) => t.id !== tpl.id);
      editingTemplateId = null;
      scheduleSave();
      renderDocumentTemplatesSettings(rootMount);
    }
  });

  header.append(titleInput, dupBtn, delBtn);

  // ---- Description ----
  const descField = document.createElement("div");
  descField.className = "dtpl-field";

  const descLabel = document.createElement("div");
  descLabel.className = "dtpl-field-label";
  descLabel.innerHTML = `설명<span class="dtpl-field-label-aux">선택사항 — 용도·범위 메모</span>`;

  const descInput = document.createElement("textarea");
  descInput.className = "dtpl-textarea";
  descInput.rows = 2;
  descInput.value = tpl.description || "";
  descInput.placeholder = "예: 분기 사업보고서용. 추진경과·성과·향후계획 순으로 구성.";
  descInput.addEventListener("input", () => {
    tpl.description = descInput.value;
    scheduleSave();
  });

  descField.append(descLabel, descInput);

  // ---- Blocks section ----
  const blocksSection = document.createElement("div");
  blocksSection.className = "dtpl-blocks-section";

  const blocksHeader = document.createElement("div");
  blocksHeader.className = "dtpl-blocks-header";

  const blocksHeading = document.createElement("div");
  blocksHeading.className = "dtpl-blocks-heading";
  blocksHeading.innerHTML = `<span class="dtpl-blocks-heading-label">구성 단락</span><span class="dtpl-blocks-heading-count">${tpl.blocks.length}개</span>`;

  blocksHeader.append(blocksHeading);

  const blocksList = document.createElement("div");
  blocksList.className = "dtpl-blocks-list";

  tpl.blocks.forEach((block, index) => {
    blocksList.append(renderBlockCard(block, index, tpl, editorMount, rootMount));
  });

  const addBlockBtn = document.createElement("button");
  addBlockBtn.type = "button";
  addBlockBtn.className = "dtpl-add-block-btn";
  addBlockBtn.textContent = "+ 단락 추가";
  addBlockBtn.addEventListener("click", () => {
    tpl.blocks.push({ type: "section", title: "", instruction: "" });
    scheduleSave();
    renderEditor(editorMount, rootMount);
    setTimeout(() => editorMount.scrollTo({ top: editorMount.scrollHeight, behavior: "smooth" }), 30);
  });

  blocksSection.append(blocksHeader, blocksList, addBlockBtn);

  // ---- Tips ----
  const tips = document.createElement("div");
  tips.className = "dtpl-tips";
  tips.innerHTML = `<b>템플릿 작성 팁</b> · 각 단락의 <b>제목</b>은 사용자가 보는 목차, <b>AI 작성 지침</b>은 모델에 전달되는 내부 지시문입니다. 지침에는 <b>분량·톤·포함할 항목</b>을 구체적으로 명시하면 일관된 결과를 얻습니다. 표 블록은 <b>열 이름</b>까지 정의해야 정렬된 표가 생성됩니다.`;

  editorMount.append(header, descField, blocksSection, tips);
}

function renderBlockCard(block, index, tpl, editorMount, rootMount) {
  const card = document.createElement("div");
  card.className = "dtpl-block";

  // ---- Block header ----
  const head = document.createElement("div");
  head.className = "dtpl-block-header";

  const idx = document.createElement("span");
  idx.className = "dtpl-block-index";
  idx.textContent = String(index + 1);

  const typeSelect = document.createElement("select");
  typeSelect.className = "dtpl-block-type";
  typeSelect.setAttribute("aria-label", "단락 유형");
  typeSelect.innerHTML = `<option value="section">단락</option><option value="table">표</option>`;
  typeSelect.value = block.type || "section";
  typeSelect.addEventListener("change", () => {
    block.type = typeSelect.value;
    if (block.type === "table" && !Array.isArray(block.columns)) block.columns = ["항목", "내용"];
    scheduleSave();
    renderEditor(editorMount, rootMount);
  });

  const titleInput = document.createElement("input");
  titleInput.type = "text";
  titleInput.className = "dtpl-block-title-input";
  titleInput.value = block.title || "";
  titleInput.placeholder = "단락 제목 (예: 1. 추진 배경)";
  titleInput.addEventListener("input", () => {
    block.title = titleInput.value;
    scheduleSave();
  });

  const actions = document.createElement("div");
  actions.className = "dtpl-block-actions";

  const upBtn = document.createElement("button");
  upBtn.type = "button";
  upBtn.className = "dtpl-block-action-btn";
  upBtn.title = "위로 이동";
  upBtn.setAttribute("aria-label", "위로 이동");
  upBtn.disabled = index === 0;
  upBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  upBtn.addEventListener("click", () => {
    if (index === 0) return;
    [tpl.blocks[index - 1], tpl.blocks[index]] = [tpl.blocks[index], tpl.blocks[index - 1]];
    scheduleSave();
    renderEditor(editorMount, rootMount);
  });

  const downBtn = document.createElement("button");
  downBtn.type = "button";
  downBtn.className = "dtpl-block-action-btn";
  downBtn.title = "아래로 이동";
  downBtn.setAttribute("aria-label", "아래로 이동");
  downBtn.disabled = index === tpl.blocks.length - 1;
  downBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M12 5v14M19 12l-7 7-7-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  downBtn.addEventListener("click", () => {
    if (index === tpl.blocks.length - 1) return;
    [tpl.blocks[index], tpl.blocks[index + 1]] = [tpl.blocks[index + 1], tpl.blocks[index]];
    scheduleSave();
    renderEditor(editorMount, rootMount);
  });

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "dtpl-block-action-btn is-danger";
  removeBtn.title = "삭제";
  removeBtn.setAttribute("aria-label", "단락 삭제");
  removeBtn.innerHTML = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  removeBtn.addEventListener("click", () => {
    tpl.blocks.splice(index, 1);
    scheduleSave();
    renderEditor(editorMount, rootMount);
  });

  actions.append(upBtn, downBtn, removeBtn);
  head.append(idx, typeSelect, titleInput, actions);

  // ---- Block body ----
  const body = document.createElement("div");
  body.className = "dtpl-block-body";

  const instrField = document.createElement("div");
  instrField.className = "dtpl-field";

  const instrLabel = document.createElement("div");
  instrLabel.className = "dtpl-field-label";
  instrLabel.innerHTML = `AI 작성 지침<span class="dtpl-field-label-aux">이 단락에 무엇을 담을지 모델에 지시</span>`;

  const instrInput = document.createElement("textarea");
  instrInput.className = "dtpl-textarea";
  instrInput.rows = 3;
  instrInput.value = block.instruction || "";
  instrInput.placeholder = block.type === "table"
    ? "예: 표의 각 행에 추진 항목·담당부서·기한·진척률을 채워라. 수치는 출처가 명확한 것만 기재."
    : "예: 제공된 자료에서 핵심 쟁점 3가지를 서술형으로 8~12줄로 작성하라. 추측·일반론 금지.";
  instrInput.addEventListener("input", () => {
    block.instruction = instrInput.value;
    scheduleSave();
  });

  instrField.append(instrLabel, instrInput);
  body.append(instrField);

  if (block.type === "table") {
    const colField = document.createElement("div");
    colField.className = "dtpl-field";

    const colLabel = document.createElement("div");
    colLabel.className = "dtpl-field-label";
    colLabel.innerHTML = `표 열 이름<span class="dtpl-field-label-aux">쉼표로 구분</span>`;

    const colInput = document.createElement("input");
    colInput.type = "text";
    colInput.className = "dtpl-text-input";
    colInput.value = (block.columns || []).join(", ");
    colInput.placeholder = "예: 연번, 구분, 추진내용, 비고";
    colInput.addEventListener("change", () => {
      block.columns = colInput.value.split(",").map((s) => s.trim()).filter(Boolean);
      scheduleSave();
    });

    colField.append(colLabel, colInput);
    body.append(colField);
  }

  card.append(head, body);
  return card;
}
