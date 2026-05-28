import { elements, ensureRoomStudio, getActiveRoom, getActiveStudio, state } from "./state.js";
import { scheduleSave, hydrateStoredDocuments } from "./persistence.js";
import { estimateDocumentBytes, estimateJsonBytes, formatBytes, getActiveDocuments } from "./chat.js";
import { bindStudioGraphEvents, showStudioGraphPanel, hideStudioGraphPanel } from "./graphStudio.js";
import { bindDocumentStudioEvents, registerDocumentStudioActivator, renderDocumentStudio } from "./documentStudio.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Tree layout constants
const NODE_W = 168;
const NODE_H = 42;
const ROOT_W = 218;
const GAP_H = 76;  // horizontal gap between parent right edge and child left edge
const GAP_V = 18;  // vertical gap between sibling subtrees
const INITIAL_COLLAPSE_DEPTH = 1;
const REQUEST_TEXT_BUDGET_CHARS = 48000;
const REQUEST_MAX_BYTES = 8 * 1024 * 1024;

// Module-level interactive map state (preserved across redraws)
let _map = null;
let _evBound = false;
let _activeTool = "document";
let _mindmapAbortController = null;
let _lawExplorerAbortController = null;
let _lawHistoryAbortController = null;
let _lawSnapshotAbortController = null;
let _lawDiffAbortController = null;

// ── Public API ────────────────────────────────────────────────────

export function bindStudioEvents() {
  elements.studioMindmapButton?.addEventListener("click", () => {
    if (_mindmapAbortController) {
      _mindmapAbortController.abort();
      return;
    }
    if (_activeTool !== "mindmap") setActiveTool("mindmap");
    else generateMindmap();
  });
  elements.studioMindmapRailButton?.addEventListener("click", () => setActiveTool("mindmap"));
  elements.studioGraphButton?.addEventListener("click", () => setActiveTool("graph"));
  elements.studioGraphRailButton?.addEventListener("click", () => setActiveTool("graph"));
  elements.studioDocumentButton?.addEventListener("click", () => setActiveTool("document"));
  elements.studioDocumentRailButton?.addEventListener("click", () => setActiveTool("document"));
  document.getElementById("studioDocToolButton")?.addEventListener("click", () => setActiveTool("doctool"));
  document.getElementById("studioDocToolRailButton")?.addEventListener("click", () => setActiveTool("doctool"));
  elements.lawExplorerRunButton?.addEventListener("click", () => {
    if (_lawExplorerAbortController) {
      _lawExplorerAbortController.abort();
      return;
    }
    generateLawImpactMap();
  });
  elements.lawExplorerResetButton?.addEventListener("click", resetLawExplorer);
  elements.lawModeImpactButton?.addEventListener("click", () => setLawSubMode("impact"));
  elements.lawModeHistoryButton?.addEventListener("click", () => setLawSubMode("history"));
  elements.lawHistoryFetchButton?.addEventListener("click", () => {
    if (_lawHistoryAbortController) {
      _lawHistoryAbortController.abort();
      return;
    }
    fetchLawHistory();
  });
  elements.lawHistoryResetButton?.addEventListener("click", resetLawHistory);
  // Keep history-mode state in sync with live input edits so the selection-bar
  // action button reflects the *current* lawName/article — not the snapshot
  // taken at "이력 조회" time. Listen to multiple events so IME composition,
  // paste, and Enter-commit are all covered: pure `input` can miss the final
  // commit on some Korean IMEs, especially during composition.
  for (const evt of ["input", "change", "compositionend", "blur"]) {
    elements.lawHistoryLawName?.addEventListener(evt, () => syncLawHistoryInput("lawName"));
    elements.lawHistoryArticle?.addEventListener(evt, () => syncLawHistoryInput("article"));
  }
  bindStudioGraphEvents();
  bindDocumentStudioEvents();
  registerDocumentStudioActivator(() => setActiveTool("document"));
}

function syncLawHistoryInput(field) {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!studio) return;
  const history = ensureLawHistoryState(studio);
  if (field === "lawName") history.input.lawName = elements.lawHistoryLawName?.value?.trim() || "";
  if (field === "article") history.input.article = elements.lawHistoryArticle?.value?.trim() || "";
  scheduleSave();
  // Refresh just the selection bar so the action button enables/disables in
  // real time. Do NOT call renderLawHistory() here — that would overwrite the
  // input the user is actively editing.
  renderLawHistorySelection(history);
}

function setActiveTool(tool) {
  if (tool !== "mindmap" && tool !== "graph" && tool !== "document" && tool !== "doctool") return;
  _activeTool = tool;
  if (elements.studioContent) elements.studioContent.dataset.activeTool = tool;
  elements.studioMindmapButton?.classList.toggle("is-active", tool === "mindmap");
  elements.studioGraphButton?.classList.toggle("is-active", tool === "graph");
  elements.studioDocumentButton?.classList.toggle("is-active", tool === "document");
  document.getElementById("studioDocToolButton")?.classList.toggle("is-active", tool === "doctool");
  
  if (elements.studioMindmapPanel) elements.studioMindmapPanel.hidden = tool !== "mindmap";
  if (elements.studioGraphPanel) elements.studioGraphPanel.hidden = tool !== "graph";
  if (elements.studioDocumentPanel) elements.studioDocumentPanel.hidden = tool !== "document";
  const docToolPanel = document.getElementById("studioDocToolPanel");
  if (docToolPanel) docToolPanel.hidden = tool !== "doctool";

  if (tool === "graph") {
    showStudioGraphPanel().catch(() => { /* errors logged inside module */ });
  } else {
    hideStudioGraphPanel();
    if (tool === "document") renderDocumentStudio();
    else if (tool === "doctool") { /* initialized via app.js, nothing to render */ }
    else renderStudio();
  }
}

export function renderStudio() {
  if (!elements.studioPanel) return;
  if (_activeTool === "document") {
    renderDocumentStudio();
    return;
  }
  if (_activeTool === "graph") {
    showStudioGraphPanel().catch(() => {});
    return;
  }
  if (_activeTool === "doctool") {
    return;
  }
  if (state.activeView === "calendar" || state.activeView === "knowledge") {
    clearSvg();
    _map = null;
    const msg = state.activeView === "calendar"
      ? "일정 메뉴에서는 아직 마인드맵이 생성되지 않았습니다."
      : "지식팩 메뉴에서는 마인드맵이 지원되지 않습니다.";
    renderEmpty(msg);
    renderDetails(null);
    return;
  }
  const studio = getActiveStudio();
  const room = (state.activeView === "law" || state.activeView === "grc") ? null : getActiveRoom();
  const documents = getMindmapDocuments();
  const signature = buildDocumentSignature(documents);
  const cache = studio?.mindmap;
  const hasCurrentMap = cache?.data && cache.signature === signature;
  const hasStaleMap = cache?.data && cache.signature !== signature;

  if (!studio) {
    clearSvg();
    _map = null;
    const msg = state.activeView === "law" ? "법령검토 항목을 선택하면 스튜디오를 사용할 수 있습니다."
      : state.activeView === "grc" ? "내부검토 항목을 선택하면 스튜디오를 사용할 수 있습니다."
      : "대화방을 선택하면 스튜디오를 사용할 수 있습니다.";
    renderEmpty(msg);
    renderDetails(null);
    return;
  }

  if (hasCurrentMap) {
    renderMindmap(cache.data, cache.selectedNodeId);
    return;
  }

  if (hasStaleMap) {
    renderEmpty(documents.length
      ? "첨부 자료가 변경되었습니다. 마인드맵 버튼을 눌러 다시 생성하세요."
      : "첨부 자료가 없어져 이전 마인드맵을 표시하지 않습니다.");
    renderDetails(null);
    return;
  }

  if (!documents.length) {
    renderEmpty("문서를 업로드하면 마인드맵을 생성할 수 있습니다.");
  } else {
    renderEmpty("마인드맵 버튼을 눌러 시작하세요.");
  }
  renderDetails(null);
}

async function generateMindmap() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!room || !studio) return;

  if (await hydrateStoredDocuments()) window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  const documents = getMindmapDocuments();
  const signature = buildDocumentSignature(documents);
  if (!documents.length) { renderStudio(); return; }

  try {
    const requestDocuments = buildMindmapRequestDocuments(documents);
    const requestPayload = { model: elements.modelInput?.value?.trim() || "gemma4:e2b", documents: requestDocuments };
    validateMindmapPayloadSize(requestPayload);
    _mindmapAbortController = new AbortController();
    setMindmapBusy(true);
    clearSvg();
    _map = null;
    setMindmapDetailsMessage("마인드맵을 새로 생성하는 중입니다.");
    if (elements.studioMindmapEmpty) elements.studioMindmapEmpty.hidden = true;
    elements.studioMindmapCanvas?.classList.add("is-loading");
    const response = await fetch("/api/studio/mindmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: _mindmapAbortController.signal,
      body: JSON.stringify(requestPayload)
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "마인드맵 생성에 실패했습니다.");
    _map = null; // reset so new mindmap gets fresh layout
    studio.mindmap = {
      signature,
      data: payload.mindmap,
      selectedNodeId: payload.mindmap?.nodes?.[0]?.id || "",
      generatedAt: new Date().toISOString()
    };
    room.updatedAt = new Date().toISOString();
    scheduleSave();
    renderStudio();
  } catch (error) {
    renderEmpty(error?.name === "AbortError"
      ? "마인드맵 생성을 중지했습니다."
      : (error.message || "마인드맵 생성에 실패했습니다. 잠시 후 다시 시도하세요."));
  } finally {
    _mindmapAbortController = null;
    elements.studioMindmapCanvas?.classList.remove("is-loading");
    setMindmapBusy(false);
  }
}

function getMindmapDocuments() {
  return getActiveDocuments().filter((doc) => {
    if (doc.kind !== "document") return false;
    return Boolean(doc.text || doc.pages?.some((p) => p.text) || doc.sheets?.some((s) => s.text));
  });
}

function buildDocumentSignature(documents) {
  return documents
    .map((d) => [d.id || "", d.fileName || "", d.fileType || "", d.textLength || d.text?.length || 0, estimateDocumentBytes(d)].join(":"))
    .join("|");
}

function buildMindmapRequestDocuments(documents) {
  const perDocBudget = Math.max(480, Math.floor(REQUEST_TEXT_BUDGET_CHARS / Math.max(1, documents.length)));
  return documents.map((doc, index) => ({
    kind: "document",
    id: doc.id || `doc-${index + 1}`,
    fileName: doc.fileName || `document-${index + 1}`,
    fileType: doc.fileType || "",
    textLength: doc.textLength || doc.text?.length || 0,
    summary: doc.summary || "",
    topics: Array.isArray(doc.topics) ? doc.topics.slice(0, 12) : [],
    text: sampleDocumentText(doc, perDocBudget)
  }));
}

function sampleDocumentText(doc, budget) {
  const sections = collectDocumentSections(doc);
  if (!sections.length) return "";
  const perSection = Math.max(400, Math.floor(budget / Math.min(sections.length, 8)));
  return sampleEvenly(sections, 8)
    .map((section) => {
      const label = section.label ? `[${section.label}]` : "";
      return `${label}\n${section.text.slice(0, perSection)}`.trim();
    })
    .join("\n\n")
    .slice(0, budget);
}

function collectDocumentSections(doc) {
  if (Array.isArray(doc.pages) && doc.pages.some((page) => page?.text)) {
    return doc.pages
      .map((page, index) => ({ label: page.label || `page ${page.page || index + 1}`, text: String(page.text || "").trim() }))
      .filter((section) => section.text);
  }
  if (Array.isArray(doc.sheets) && doc.sheets.some((sheet) => sheet?.text)) {
    return doc.sheets
      .map((sheet, index) => ({ label: sheet.name || `sheet ${index + 1}`, text: String(sheet.text || "").trim() }))
      .filter((section) => section.text);
  }
  return String(doc.text || "")
    .split(/\n{2,}/)
    .map((text, index) => ({ label: `section ${index + 1}`, text: text.trim() }))
    .filter((section) => section.text);
}

function sampleEvenly(array, maxCount) {
  if (array.length <= maxCount) return array;
  return Array.from({ length: maxCount }, (_, index) =>
    array[Math.round(index * (array.length - 1) / (maxCount - 1))]
  );
}

function validateMindmapPayloadSize(payload) {
  const bytes = estimateJsonBytes(payload);
  if (bytes > REQUEST_MAX_BYTES) {
    throw new Error(`마인드맵 요청 용량이 ${formatBytes(bytes)}입니다. 첨부를 줄인 뒤 다시 시도해주세요.`);
  }
}

async function generateLawImpactMap() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!room || !studio) return;
  const lawName = elements.lawExplorerLawName?.value?.trim() || "";
  const article = elements.lawExplorerArticle?.value?.trim() || "";
  const subject = elements.lawExplorerSubject?.value?.trim() || room.title || "";
  if (!lawName || !article) {
    setLawExplorerStatus("법령명과 조문을 입력하세요.", "error");
    return;
  }

  try {
    if (await hydrateStoredDocuments()) window.dispatchEvent(new CustomEvent("myai:renderrooms"));
    const materialText = collectLawExplorerMaterialText();
    _lawExplorerAbortController = new AbortController();
    setLawExplorerBusy(true);
    setLawExplorerStatus("공식 법령 조문을 확인하고 영향맵을 구성하는 중입니다.", "running");
    const response = await fetch("/api/law/impact-map", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: _lawExplorerAbortController.signal,
      body: JSON.stringify({ lawName, article, subject, materialText })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "영향맵 생성에 실패했습니다.");
    studio.lawExplorer = {
      input: { lawName, article, subject },
      data: payload,
      generatedAt: new Date().toISOString()
    };
    room.updatedAt = new Date().toISOString();
    scheduleSave();
    renderLawExplorer();
  } catch (error) {
    if (error?.name === "AbortError") setLawExplorerStatus("영향맵 생성을 중지했습니다.", "idle");
    else setLawExplorerStatus(error.message || "영향맵 생성에 실패했습니다.", "error");
  } finally {
    _lawExplorerAbortController = null;
    setLawExplorerBusy(false);
  }
}

function resetLawExplorer() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!studio) return;
  delete studio.lawExplorer;
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  setLawExplorerStatus("", "idle");
  renderLawExplorer();
}

function renderLawExplorer() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const data = studio?.lawExplorer?.data;
  if (!data?.impactMap) {
    if (elements.lawExplorerSummary) elements.lawExplorerSummary.hidden = true;
    if (elements.lawExplorerMap) {
      elements.lawExplorerMap.innerHTML = `<div class="law-explorer-empty">법령명과 조문을 입력하면 공식 조문 기반 영향맵을 보여줍니다.</div>`;
    }
    if (elements.lawExplorerDetail) {
      elements.lawExplorerDetail.innerHTML = `<p class="law-explorer-empty">분석 항목을 클릭하면 상세 내용이 표시됩니다.</p>`;
    }
    return;
  }
  renderLawExplorerSummary(data.impactMap, data.citation, studio.lawExplorer?.input);
  renderLawImpactMap(data.impactMap, data.citation);
  setLawExplorerStatus("", "idle");
}

function renderLawExplorerSummary(impactMap, citation, input) {
  const target = elements.lawExplorerSummary;
  if (!target) return;
  target.innerHTML = "";

  const articleNode = (impactMap.nodes || []).find((n) => n.type === "law_article");
  const subjectNode = (impactMap.nodes || []).find((n) => n.type === "review_subject");

  const articleSection = document.createElement("div");
  articleSection.className = "law-explorer-summary-article";

  const info = document.createElement("div");
  info.className = "law-explorer-summary-article-info";

  const badge = document.createElement("span");
  badge.className = "law-explorer-summary-badge";
  badge.textContent = "법령 조문";

  const locator = document.createElement("div");
  locator.className = "law-explorer-summary-locator";
  locator.textContent = articleNode?.label || citation?.locator || "법령 조문";

  const title = document.createElement("div");
  title.className = "law-explorer-summary-title";
  title.textContent = citation?.title || articleNode?.summary || "";

  info.append(badge, locator);
  if (title.textContent) info.append(title);
  articleSection.append(info);

  if (citation?.url) {
    const link = document.createElement("a");
    link.className = "law-explorer-summary-link";
    link.href = citation.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${citation.citationId || "L1"} 원문 ↗`;
    articleSection.append(link);
  }

  target.append(articleSection);

  const subjectText = input?.subject || subjectNode?.label || "";
  if (subjectText) {
    const divider = document.createElement("div");
    divider.className = "law-explorer-summary-divider";

    const subjectSection = document.createElement("div");
    subjectSection.className = "law-explorer-summary-subject";

    const label = document.createElement("span");
    label.className = "law-explorer-summary-subject-label";
    label.textContent = "검토 대상";

    const text = document.createElement("span");
    text.className = "law-explorer-summary-subject-text";
    text.textContent = subjectText;

    subjectSection.append(label, text);
    target.append(divider, subjectSection);
  }

  target.hidden = false;
}

function renderLawImpactMap(impactMap, citation) {
  const target = elements.lawExplorerMap;
  if (!target) return;
  target.innerHTML = "";
  const nodes = Array.isArray(impactMap.nodes) ? impactMap.nodes : [];
  const byType = new Map();
  nodes.forEach((node) => {
    const type = node.type || "other";
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(node);
  });
  const order = ["obligation", "condition", "risk", "material_signal", "other"];
  let firstNode = null;
  for (const type of order) {
    const group = byType.get(type);
    if (!group?.length) continue;
    const section = document.createElement("section");
    section.className = "law-impact-section";
    const heading = document.createElement("h4");
    heading.textContent = lawImpactTypeLabel(type);
    section.append(heading);
    for (const node of group) {
      if (!firstNode) firstNode = node;
      const button = document.createElement("button");
      button.type = "button";
      button.className = `law-impact-node law-impact-node-${type}`;
      button.textContent = node.label || node.id;
      button.addEventListener("click", () => {
        target.querySelectorAll(".law-impact-node").forEach((b) => b.classList.remove("is-active"));
        button.classList.add("is-active");
        renderLawImpactDetail(node, impactMap, citation);
      });
      section.append(button);
    }
    target.append(section);
  }
  if (firstNode) {
    target.querySelector(".law-impact-node")?.classList.add("is-active");
    renderLawImpactDetail(firstNode, impactMap, citation);
  }
}

function renderLawImpactDetail(node, impactMap, citation) {
  const target = elements.lawExplorerDetail;
  if (!target || !node) return;
  target.innerHTML = "";

  const header = document.createElement("div");
  header.className = "law-explorer-detail-header";

  const meta = document.createElement("div");
  meta.className = "law-explorer-detail-meta";
  meta.textContent = lawImpactTypeLabel(node.type);

  const title = document.createElement("h3");
  title.textContent = node.label || "";

  header.append(meta, title);
  target.append(header);

  const body = document.createElement("p");
  body.textContent = node.summary || "";
  target.append(body);

  if (node.citationId && citation?.url) {
    const link = document.createElement("a");
    link.className = "law-explorer-link";
    link.href = citation.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${node.citationId} law.go.kr 원문 ↗`;
    target.append(link);
  }

  const related = (impactMap.edges || []).filter((edge) => edge.from === node.id || edge.to === node.id);
  if (related.length) {
    const list = document.createElement("div");
    list.className = "law-explorer-related";
    related.slice(0, 8).forEach((edge) => {
      const item = document.createElement("span");
      item.textContent = edge.label || "related";
      list.append(item);
    });
    target.append(list);
  }
}

function collectLawExplorerMaterialText() {
  const docs = getActiveDocuments();
  const chunks = [];
  for (const doc of docs) {
    if (doc.kind !== "document") continue;
    chunks.push(sampleDocumentText(doc, 3000));
    if (chunks.join("\n").length > 9000) break;
  }
  return chunks.join("\n\n").slice(0, 10000);
}

function setLawExplorerBusy(isBusy) {
  const button = elements.lawExplorerRunButton;
  if (!button) return;
  button.textContent = isBusy ? "중지" : "영향맵";
  button.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function setLawExplorerStatus(message, mode = "idle") {
  if (!elements.lawExplorerStatus) return;
  elements.lawExplorerStatus.textContent = message || "";
  elements.lawExplorerStatus.dataset.mode = mode;
}

function lawImpactTypeLabel(type) {
  return ({
    law_article: "법령 조문",
    review_subject: "검토 대상",
    obligation: "의무/금지",
    condition: "적용 요건",
    risk: "리스크",
    material_signal: "자료 신호"
  })[type] || "기타";
}

function setMindmapBusy(isBusy) {
  const button = elements.studioMindmapButton;
  if (!button) return;
  button.classList.toggle("is-busy", isBusy);
  button.setAttribute("aria-busy", isBusy ? "true" : "false");
  button.title = isBusy ? "마인드맵 생성 중지" : "마인드맵 생성";
  button.setAttribute("aria-label", isBusy ? "마인드맵 생성 중지" : "마인드맵 생성");
  const label = button.querySelector(".studio-tool-label");
  if (label) label.textContent = isBusy ? "중지" : "마인드맵";
}

// ── Mindmap entry point ───────────────────────────────────────────

function renderMindmap(mindmap, selectedNodeId = "") {
  const svg = elements.studioMindmapSvg;
  if (!svg || !Array.isArray(mindmap?.nodes) || !mindmap.nodes.length) {
    renderEmpty("표시할 마인드맵이 없습니다.");
    return;
  }
  if (elements.studioMindmapEmpty) elements.studioMindmapEmpty.hidden = true;

  const { root, childrenMap } = buildTreeStructure(mindmap);
  const isSame = _map?.mindmap === mindmap;

  _map = {
    mindmap,
    root,
    childrenMap,
    collapsed: isSame ? _map.collapsed : buildInitialCollapsed(root, childrenMap),
    selectedId: selectedNodeId || mindmap.nodes[0].id,
    scale: isSame ? _map.scale : 1,
    panX: isSame ? _map.panX : null,
    panY: isSame ? _map.panY : null,
    _dragging: false
  };

  ensureFullscreenButton();
  if (!_evBound) { bindMapInteractions(); _evBound = true; }
  drawMap();
  renderDetails(mindmap.nodes.find((n) => n.id === _map.selectedId) || mindmap.nodes[0]);
}

// ── Tree structure ────────────────────────────────────────────────

function buildTreeStructure(mindmap) {
  const nodeMap = new Map(mindmap.nodes.map((n) => [n.id, { ...n, _pos: null }]));
  const childrenMap = new Map(mindmap.nodes.map((n) => [n.id, []]));
  const root = nodeMap.get(mindmap.nodes[0].id);
  const visited = new Set([root.id]);
  const outgoing = new Map(mindmap.nodes.map((n) => [n.id, []]));

  for (const edge of Array.isArray(mindmap.edges) ? mindmap.edges : []) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to) || edge.from === edge.to) continue;
    outgoing.get(edge.from).push(edge);
  }

  function attach(parent) {
    for (const edge of outgoing.get(parent.id) || []) {
      if (visited.has(edge.to)) continue;
      const child = nodeMap.get(edge.to);
      child._treeEdge = edge;
      childrenMap.get(parent.id).push(child);
      visited.add(child.id);
      attach(child);
    }
  }
  attach(root);

  for (const node of nodeMap.values()) {
    if (visited.has(node.id)) continue;
    node._treeEdge = { from: root.id, to: node.id, label: "", strength: 1 };
    childrenMap.get(root.id).push(node);
    visited.add(node.id);
  }

  return { root, childrenMap };
}

// Start with root and first-level branches visible; users expand deeper nodes.
function buildInitialCollapsed(root, childrenMap) {
  const collapsed = new Set();
  function visit(node, depth) {
    if (depth >= INITIAL_COLLAPSE_DEPTH && (childrenMap.get(node.id) || []).length > 0) collapsed.add(node.id);
    for (const child of childrenMap.get(node.id) || []) visit(child, depth + 1);
  }
  visit(root, 0);
  return collapsed;
}

// ── Layout (left-to-right tree) ───────────────────────────────────

function subtreeH(node, childrenMap, collapsed) {
  const children = collapsed.has(node.id) ? [] : (childrenMap.get(node.id) || []);
  if (!children.length) return NODE_H;
  let h = -GAP_V;
  for (const child of children) h += subtreeH(child, childrenMap, collapsed) + GAP_V;
  return Math.max(h, NODE_H);
}

function assignPos(node, depth, startY, childrenMap, collapsed) {
  const w = depth === 0 ? ROOT_W : NODE_W;
  const x = 20 + depth * (NODE_W + GAP_H);
  const children = collapsed.has(node.id) ? [] : (childrenMap.get(node.id) || []);

  if (!children.length) {
    node._pos = { x, y: startY + NODE_H / 2, w };
    return startY + NODE_H;
  }

  let cy = startY;
  for (const child of children) {
    cy = assignPos(child, depth + 1, cy, childrenMap, collapsed);
    cy += GAP_V;
  }
  cy -= GAP_V;

  const firstY = children[0]._pos.y;
  const lastY = children[children.length - 1]._pos.y;
  node._pos = { x, y: (firstY + lastY) / 2, w };
  return cy + GAP_V;
}

function collectVisible(node, childrenMap, collapsed, out = []) {
  out.push(node);
  if (!collapsed.has(node.id)) {
    for (const child of childrenMap.get(node.id) || []) collectVisible(child, childrenMap, collapsed, out);
  }
  return out;
}

// ── Draw ──────────────────────────────────────────────────────────

function drawMap() {
  if (!_map) return;
  const { root, childrenMap, collapsed, selectedId, scale } = _map;
  const svg = elements.studioMindmapSvg;
  if (!svg) return;

  clearSvg();
  svg.removeAttribute("viewBox");

  const totalH = subtreeH(root, childrenMap, collapsed);
  assignPos(root, 0, 0, childrenMap, collapsed);

  const visible = collectVisible(root, childrenMap, collapsed);

  if (_map.panX === null) {
    fitMindmapToViewport(visible, totalH);
  }

  const vp = svgEl("g", { class: "map-vp" });
  vp.setAttribute("transform", `translate(${_map.panX},${_map.panY}) scale(${_map.scale})`);
  svg.append(vp);

  // Edges first (behind nodes)
  const edgeG = svgEl("g");
  vp.append(edgeG);
  for (const node of visible) {
    if (collapsed.has(node.id)) continue;
    for (const child of childrenMap.get(node.id) || []) {
      if (node._pos && child._pos) edgeG.append(makeEdge(node._pos, child._pos, child._treeEdge));
    }
  }

  // Nodes
  const nodeG = svgEl("g");
  vp.append(nodeG);
  for (const node of visible) {
    if (!node._pos) continue;
    const children = childrenMap.get(node.id) || [];
    nodeG.append(makeNode(node, node === root, children.length > 0, collapsed.has(node.id), node.id === selectedId));
  }
}

function makeEdge(from, to, edge = {}) {
  const x1 = from.x + from.w;
  const y1 = from.y;
  const x2 = to.x;
  const y2 = to.y;
  const cx = (x1 + x2) / 2;
  const group = svgEl("g", { class: "map-edge-group" });
  group.append(svgEl("path", {
    class: `map-edge strength-${Math.max(1, Math.min(5, Number(edge.strength) || 1))}`,
    d: `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`,
    fill: "none"
  }));
  const label = String(edge.label || "").trim();
  if (label) {
    const text = svgEl("text", {
      class: "map-edge-label",
      x: cx,
      y: (y1 + y2) / 2 - 4,
      "text-anchor": "middle"
    });
    text.textContent = label.slice(0, 18);
    group.append(text);
  }
  return group;
}

function fitMindmapToViewport(visible, totalH = 0) {
  const svg = elements.studioMindmapSvg;
  if (!_map || !svg) return;
  const rect = svg.getBoundingClientRect();
  const width = rect.width || 760;
  const height = rect.height || 520;
  const bounds = getVisibleBounds(visible);
  const mapW = Math.max(1, bounds.maxX - bounds.minX);
  const mapH = Math.max(1, bounds.maxY - bounds.minY, totalH);
  const fitScale = Math.min(1, (width - 64) / mapW, (height - 48) / mapH);
  _map.scale = Math.max(0.42, Math.min(1.05, fitScale));
  _map.panX = 24 - bounds.minX * _map.scale;
  _map.panY = Math.max(18, (height - mapH * _map.scale) / 2 - bounds.minY * _map.scale);
}

function getVisibleBounds(visible) {
  const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const node of visible) {
    if (!node._pos) continue;
    bounds.minX = Math.min(bounds.minX, node._pos.x);
    bounds.minY = Math.min(bounds.minY, node._pos.y - NODE_H / 2);
    bounds.maxX = Math.max(bounds.maxX, node._pos.x + node._pos.w + 28);
    bounds.maxY = Math.max(bounds.maxY, node._pos.y + NODE_H / 2);
  }
  if (!Number.isFinite(bounds.minX)) return { minX: 0, minY: 0, maxX: ROOT_W, maxY: NODE_H };
  return bounds;
}

function makeNode(node, isRoot, hasChildren, isCollapsed, isSelected) {
  const { x, y, w } = node._pos;
  const h = NODE_H;
  const lines = wrapLabel(node.label, isRoot ? 16 : 14).slice(0, 2);

  const g = svgEl("g", {
    class: `map-node${isRoot ? " is-root" : ""}${isSelected ? " is-selected" : ""}`,
    transform: `translate(${x} ${y - h / 2})`,
    "data-importance": String(Math.max(1, Math.min(5, Number(node.importance) || 3)))
  });

  g.append(svgEl("rect", { width: w, height: h, rx: 8, ry: 8 }));

  const lineH = 15;
  const textMid = h / 2 - ((lines.length - 1) * lineH) / 2 + 5;
  for (const [i, line] of lines.entries()) {
    const t = svgEl("text", { x: w / 2, y: textMid + i * lineH, "text-anchor": "middle" });
    t.textContent = line;
    g.append(t);
  }

  // Click → select node
  g.addEventListener("click", () => {
    if (_map?._dragging) return;
    selectMindmapNode(node.id);
  });
  g.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); selectMindmapNode(node.id); }
  });
  g.setAttribute("tabindex", "0");
  g.setAttribute("role", "button");
  g.setAttribute("aria-label", node.label || "Mind map node");

  // Expand/collapse toggle badge
  if (hasChildren) {
    const BW = 20, BH = 20;
    const tog = svgEl("g", {
      class: "map-toggle",
      transform: `translate(${w + 5} ${(h - BH) / 2})`,
      tabindex: "0",
      role: "button",
      "aria-label": isCollapsed ? "확장" : "축소"
    });
    tog.append(svgEl("rect", { width: BW, height: BH, rx: 5, ry: 5 }));
    const arrow = svgEl("text", { x: BW / 2, y: BH / 2 + 5, "text-anchor": "middle", "font-size": "13" });
    arrow.textContent = isCollapsed ? "›" : "‹";
    tog.append(arrow);
    tog.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!_map) return;
      _map.collapsed.has(node.id) ? _map.collapsed.delete(node.id) : _map.collapsed.add(node.id);
      drawMap();
    });
    tog.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tog.dispatchEvent(new MouseEvent("click")); }
    });
    g.append(tog);
  }

  return g;
}

// ── Interactions (zoom / pan) ─────────────────────────────────────

function bindMapInteractions() {
  const svg = elements.studioMindmapSvg;
  const canvas = elements.studioMindmapCanvas;
  if (!svg) return;

  let isPan = false, lastX = 0, lastY = 0;

  // Zoom centered on cursor
  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (!_map) return;
    const r = svg.getBoundingClientRect();
    const mx = e.clientX - r.left;
    const my = e.clientY - r.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.min(4, Math.max(0.15, _map.scale * factor));
    _map.panX = mx - (mx - _map.panX) * (newScale / _map.scale);
    _map.panY = my - (my - _map.panY) * (newScale / _map.scale);
    _map.scale = newScale;
    const vp = svg.querySelector(".map-vp");
    if (vp) vp.setAttribute("transform", `translate(${_map.panX},${_map.panY}) scale(${_map.scale})`);
  }, { passive: false });

  // Pan start
  svg.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    isPan = true;
    lastX = e.clientX;
    lastY = e.clientY;
    if (_map) _map._dragging = false;
    canvas?.classList.add("is-panning");
  });

  // Pan move (on window to handle fast drags outside SVG)
  window.addEventListener("mousemove", (e) => {
    if (!isPan || !_map) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    if (Math.abs(dx) + Math.abs(dy) > 3) _map._dragging = true;
    _map.panX += dx;
    _map.panY += dy;
    lastX = e.clientX;
    lastY = e.clientY;
    const vp = svg.querySelector(".map-vp");
    if (vp) vp.setAttribute("transform", `translate(${_map.panX},${_map.panY}) scale(${_map.scale})`);
  });

  window.addEventListener("mouseup", () => {
    isPan = false;
    canvas?.classList.remove("is-panning");
  });

  // Touch pan support
  let lastTouchX = 0, lastTouchY = 0, lastTouchDist = 0;

  svg.addEventListener("touchstart", (e) => {
    if (e.touches.length === 1) {
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
    } else if (e.touches.length === 2) {
      lastTouchDist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
    }
  }, { passive: true });

  svg.addEventListener("touchmove", (e) => {
    e.preventDefault();
    if (!_map) return;
    if (e.touches.length === 1) {
      const dx = e.touches[0].clientX - lastTouchX;
      const dy = e.touches[0].clientY - lastTouchY;
      _map.panX += dx;
      _map.panY += dy;
      lastTouchX = e.touches[0].clientX;
      lastTouchY = e.touches[0].clientY;
      const vp = svg.querySelector(".map-vp");
      if (vp) vp.setAttribute("transform", `translate(${_map.panX},${_map.panY}) scale(${_map.scale})`);
    } else if (e.touches.length === 2) {
      const dist = Math.hypot(
        e.touches[1].clientX - e.touches[0].clientX,
        e.touches[1].clientY - e.touches[0].clientY
      );
      const factor = dist / (lastTouchDist || dist);
      _map.scale = Math.min(4, Math.max(0.15, _map.scale * factor));
      lastTouchDist = dist;
      const vp = svg.querySelector(".map-vp");
      if (vp) vp.setAttribute("transform", `translate(${_map.panX},${_map.panY}) scale(${_map.scale})`);
    }
  }, { passive: false });
}

// ── Fullscreen button ─────────────────────────────────────────────

function ensureFullscreenButton() {
  const canvas = elements.studioMindmapCanvas;
  if (!canvas || canvas.querySelector(".map-fs-btn")) return;

  const btn = document.createElement("button");
  btn.className = "map-fs-btn";
  btn.type = "button";
  btn.title = "전체화면";
  btn.setAttribute("aria-label", "전체화면 전환");
  btn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path class="fs-expand" d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
    <path class="fs-shrink" d="M4 14h6v6M20 14h-6v6M4 10h6V4M20 10h-6V4"/>
  </svg>`;

  btn.addEventListener("click", () => {
    const isFs = canvas.classList.toggle("is-fullscreen");
    btn.title = isFs ? "원래 크기로" : "전체화면";
    btn.setAttribute("aria-label", isFs ? "원래 크기로 복원" : "전체화면 전환");
    if (_map) { _map.panX = null; _map.panY = null; }
    requestAnimationFrame(() => { if (_map) drawMap(); });
  });

  canvas.append(btn);
}

// ── Node selection & details ──────────────────────────────────────

function selectMindmapNode(nodeId) {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!studio?.mindmap?.data || !_map) return;
  _map.selectedId = nodeId;
  studio.mindmap.selectedNodeId = nodeId;
  scheduleSave();
  drawMap();
  renderDetails(_map.mindmap.nodes.find((n) => n.id === nodeId) || _map.mindmap.nodes[0]);
}

function renderDetails(node) {
  const target = elements.studioMindmapDetails;
  if (!target) return;
  target.innerHTML = "";
  appendMindmapWarnings(target);
  if (!node) {
    const empty = document.createElement("p");
    empty.textContent = "노드를 선택하면 요약이 표시됩니다.";
    target.append(empty);
    return;
  }
  const title = document.createElement("h3");
  title.textContent = node.label || "Node";
  const summary = document.createElement("p");
  summary.textContent = node.summary || "요약이 없습니다.";
  target.append(title, summary);
  const meta = document.createElement("div");
  meta.className = "studio-detail-meta";
  const groupLabel = getGroupLabel(node.group);
  meta.textContent = `${groupLabel} · 중요도 ${Math.max(1, Math.min(5, Number(node.importance) || 3))}`;
  target.append(meta);
  const refs = Array.isArray(node.sourceRefs) ? node.sourceRefs.filter(Boolean) : [];
  if (refs.length) {
    const wrap = document.createElement("div");
    wrap.className = "studio-detail-sources";
    for (const ref of refs.slice(0, 5)) {
      const item = document.createElement("span");
      item.className = "studio-detail-source";
      item.textContent = ref;
      wrap.append(item);
    }
    target.append(wrap);
  }
  appendRelatedEdges(target, node);
}

function setMindmapDetailsMessage(message) {
  const target = elements.studioMindmapDetails;
  if (!target) return;
  target.innerHTML = "";
  const empty = document.createElement("p");
  empty.textContent = message || "";
  target.append(empty);
}

function getGroupLabel(groupId) {
  const groups = Array.isArray(_map?.mindmap?.groups) ? _map.mindmap.groups : [];
  return groups.find((group) => group.id === groupId)?.label || groupId || "group";
}

function appendRelatedEdges(target, node) {
  const edges = Array.isArray(_map?.mindmap?.edges)
    ? _map.mindmap.edges.filter((edge) => edge.from === node.id || edge.to === node.id)
    : [];
  if (!edges.length) return;
  const nodeById = new Map((_map?.mindmap?.nodes || []).map((item) => [item.id, item]));
  const wrap = document.createElement("div");
  wrap.className = "studio-detail-relations";
  for (const edge of edges.slice(0, 6)) {
    const otherId = edge.from === node.id ? edge.to : edge.from;
    const other = nodeById.get(otherId);
    const item = document.createElement("div");
    item.className = "studio-detail-relation";
    item.textContent = `${edge.from === node.id ? "→" : "←"} ${other?.label || otherId}${edge.label ? ` · ${edge.label}` : ""}`;
    wrap.append(item);
  }
  target.append(wrap);
}

function appendMindmapWarnings(target) {
  const warnings = Array.isArray(_map?.mindmap?.warnings)
    ? _map.mindmap.warnings.map((warning) => String(warning || "")).filter(Boolean)
    : [];
  if (!warnings.length) return;

  const messages = [];
  if (warnings.some((warning) => warning === "fallback_mindmap")) {
    messages.push("Ollama 생성 시간이 초과되어 문서 구조 기반 임시 마인드맵을 표시합니다.");
  }
  if (warnings.some((warning) => warning.startsWith("model_fallback:"))) {
    messages.push("문서 제목, 목차, 주요 항목을 기반으로 대체 지도를 구성했습니다.");
  }
  if (!messages.length) messages.push("마인드맵 생성 중 확인할 항목이 있습니다.");

  const box = document.createElement("div");
  box.className = "studio-mindmap-warning";
  box.setAttribute("role", "status");
  box.textContent = [...new Set(messages)].join(" ");
  target.append(box);
}

// ── Helpers ───────────────────────────────────────────────────────

function renderEmpty(message) {
  _map = null;
  clearSvg();
  if (elements.studioMindmapEmpty) {
    elements.studioMindmapEmpty.hidden = false;
    elements.studioMindmapEmpty.textContent = message;
  }
}

function clearSvg() {
  const svg = elements.studioMindmapSvg;
  if (!svg) return;
  while (svg.firstChild) svg.firstChild.remove();
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function wrapLabel(value, size) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return ["Node"];
  const words = text.includes(" ") ? text.split(" ") : text.match(new RegExp(`.{1,${size}}`, "g")) || [text];
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > size && current) { lines.push(current); current = word; }
    else current = next;
  }
  if (current) lines.push(current);
  return lines.length ? lines : [text.slice(0, size)];
}

// ── Law history / time-travel ──────────────────────────────────────

function ensureLawHistoryState(studio) {
  if (!studio) return null;
  if (!studio.lawHistory || typeof studio.lawHistory !== "object") {
    studio.lawHistory = {
      input: { lawName: "", article: "" },
      revisions: null,
      selectedDates: [],
      view: null
    };
  }
  studio.lawHistory.input = studio.lawHistory.input || { lawName: "", article: "" };
  studio.lawHistory.selectedDates = Array.isArray(studio.lawHistory.selectedDates)
    ? studio.lawHistory.selectedDates
    : [];
  return studio.lawHistory;
}

function setLawSubMode(mode) {
  if (mode !== "impact" && mode !== "history") return;
  if (elements.lawModeImpactButton) {
    const active = mode === "impact";
    elements.lawModeImpactButton.classList.toggle("is-active", active);
    elements.lawModeImpactButton.setAttribute("aria-selected", active ? "true" : "false");
  }
  if (elements.lawModeHistoryButton) {
    const active = mode === "history";
    elements.lawModeHistoryButton.classList.toggle("is-active", active);
    elements.lawModeHistoryButton.setAttribute("aria-selected", active ? "true" : "false");
  }
  if (elements.lawImpactSection) elements.lawImpactSection.hidden = mode !== "impact";
  if (elements.lawHistorySection) elements.lawHistorySection.hidden = mode !== "history";
  if (mode === "history") renderLawHistory();
}

async function fetchLawHistory() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!room || !studio) return;
  const history = ensureLawHistoryState(studio);
  const lawName = elements.lawHistoryLawName?.value?.trim() || "";
  const article = elements.lawHistoryArticle?.value?.trim() || "";
  if (!lawName) {
    setLawHistoryStatus("법령명을 입력하세요.", "error");
    return;
  }
  history.input = { lawName, article };
  try {
    _lawHistoryAbortController = new AbortController();
    setLawHistoryBusy(true);
    setLawHistoryStatus("개정 이력을 조회하는 중입니다.", "running");
    const response = await fetch("/api/law/history", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: _lawHistoryAbortController.signal,
      body: JSON.stringify({ lawName })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "이력 조회에 실패했습니다.");
    history.revisions = Array.isArray(payload.revisions) ? payload.revisions : [];
    history.selectedDates = [];
    history.view = null;
    room.updatedAt = new Date().toISOString();
    scheduleSave();
    if (!history.revisions.length) {
      setLawHistoryStatus("이력이 없습니다.", "idle");
    } else {
      setLawHistoryStatus(`${history.revisions.length}건의 시행일별 이력을 불러왔습니다.`, "idle");
    }
    renderLawHistory();
  } catch (error) {
    if (error?.name === "AbortError") setLawHistoryStatus("이력 조회를 중지했습니다.", "idle");
    else setLawHistoryStatus(error.message || "이력 조회에 실패했습니다.", "error");
  } finally {
    _lawHistoryAbortController = null;
    setLawHistoryBusy(false);
  }
}

function resetLawHistory() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!studio) return;
  delete studio.lawHistory;
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  setLawHistoryStatus("", "idle");
  renderLawHistory();
}

function renderLawHistory() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const history = ensureLawHistoryState(studio);
  // Only hydrate inputs from persisted state when they are empty — never
  // clobber whatever the user is currently typing. The `input` event handlers
  // keep state in sync with edits, so this branch only runs on tab-switch /
  // page-reload restoration.
  if (elements.lawHistoryLawName
      && !elements.lawHistoryLawName.value
      && document.activeElement !== elements.lawHistoryLawName) {
    elements.lawHistoryLawName.value = history?.input?.lawName || "";
  }
  if (elements.lawHistoryArticle
      && !elements.lawHistoryArticle.value
      && document.activeElement !== elements.lawHistoryArticle) {
    elements.lawHistoryArticle.value = history?.input?.article || "";
  }
  renderLawHistoryList(history);
  renderLawHistorySelection(history);
  renderLawHistoryViewer(history);
}

function renderLawHistoryList(history) {
  const target = elements.lawHistoryList;
  if (!target) return;
  target.innerHTML = "";
  if (!history || !Array.isArray(history.revisions)) {
    target.innerHTML = `<div class="law-explorer-empty">법령명을 입력하고 "이력 조회"를 누르면 시행일별 개정 이력이 표시됩니다.</div>`;
    return;
  }
  if (!history.revisions.length) {
    target.innerHTML = `<div class="law-explorer-empty">이력 데이터가 없습니다.</div>`;
    return;
  }
  const selected = new Set(history.selectedDates || []);
  for (const rev of history.revisions) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "law-history-row";
    if (selected.has(rev.effectiveDate)) row.classList.add("is-selected");
    row.dataset.effectiveDate = rev.effectiveDate || "";
    row.addEventListener("click", () => toggleLawHistorySelection(rev.effectiveDate));

    const dateBox = document.createElement("div");
    dateBox.className = "law-history-row-date";
    const eff = document.createElement("span");
    eff.className = "law-history-row-effective";
    eff.textContent = rev.effectiveDate ? `시행 ${rev.effectiveDate}` : "시행일 미상";
    dateBox.append(eff);
    if (rev.promulgationDate) {
      const promu = document.createElement("span");
      promu.className = "law-history-row-promu";
      promu.textContent = `공포 ${rev.promulgationDate}`;
      dateBox.append(promu);
    }
    row.append(dateBox);

    const metaBox = document.createElement("div");
    metaBox.className = "law-history-row-meta";
    const type = document.createElement("span");
    type.className = "law-history-row-type";
    type.textContent = rev.revisionType || "개정";
    metaBox.append(type);
    if (rev.promulgationNumber) {
      const num = document.createElement("span");
      num.className = "law-history-row-num";
      num.textContent = `${rev.promulgationNumber}호`;
      metaBox.append(num);
    }
    row.append(metaBox);

    target.append(row);
  }
}

function renderLawHistorySelection(history) {
  const target = elements.lawHistorySelection;
  if (!target) return;
  const selected = Array.isArray(history?.selectedDates) ? history.selectedDates : [];
  if (!selected.length) {
    target.hidden = true;
    target.innerHTML = "";
    return;
  }
  target.hidden = false;
  target.innerHTML = "";

  const label = document.createElement("span");
  label.className = "law-history-selection-label";
  label.textContent = selected.length === 1 ? "선택 1건" : "선택 2건";
  target.append(label);

  for (const date of selected) {
    const chip = document.createElement("span");
    chip.className = "law-history-selection-chip";
    chip.textContent = date;
    target.append(chip);
  }

  // Read live from the DOM as the source of truth — state is kept in sync via
  // the input/change/compositionend handlers but the live read guards against
  // any code path that re-renders the selection bar before state has caught up.
  const article = elements.lawHistoryArticle?.value?.trim() || history?.input?.article || "";
  const lawName = elements.lawHistoryLawName?.value?.trim() || history?.input?.lawName || "";
  const missingArticle = !article;

  // Inline hint that's impossible to miss when article is required but empty.
  if (missingArticle) {
    const hint = document.createElement("span");
    hint.className = "law-history-selection-hint";
    hint.textContent = "← 위쪽 \"조문\" 칸을 먼저 입력하세요";
    target.append(hint);
    elements.lawHistoryArticle?.classList.add("is-required-empty");
  } else {
    elements.lawHistoryArticle?.classList.remove("is-required-empty");
  }

  if (selected.length === 1) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "send-button law-history-selection-action";
    button.textContent = "이 시점 조문 보기";
    button.disabled = missingArticle;
    if (missingArticle) button.title = "조문을 입력해야 시점 조회가 가능합니다.";
    button.addEventListener("click", () => {
      const liveArticle = elements.lawHistoryArticle?.value?.trim() || "";
      const liveLawName = elements.lawHistoryLawName?.value?.trim() || lawName;
      runLawSnapshot(liveLawName, liveArticle, selected[0]);
    });
    target.append(button);
  } else if (selected.length === 2) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "send-button law-history-selection-action";
    button.textContent = "두 시점 비교";
    button.disabled = missingArticle;
    if (missingArticle) button.title = "조문을 입력해야 시점 비교가 가능합니다.";
    button.addEventListener("click", () => {
      const liveArticle = elements.lawHistoryArticle?.value?.trim() || "";
      const liveLawName = elements.lawHistoryLawName?.value?.trim() || lawName;
      const [a, b] = [...selected].sort();
      runLawDiff(liveLawName, liveArticle, a, b);
    });
    target.append(button);
  }
}

function renderLawHistoryViewer(history) {
  const target = elements.lawHistoryViewer;
  if (!target) return;
  target.innerHTML = "";
  const view = history?.view;
  if (!view) {
    target.innerHTML = `<p class="law-explorer-empty">시행일을 1개 선택하면 그 시점의 조문, 2개 선택하면 두 시점 차이를 보여줍니다.</p>`;
    return;
  }
  if (view.kind === "snapshot") renderLawSnapshotView(target, view.data);
  else if (view.kind === "diff") renderLawDiffView(target, view.data);
}

function toggleLawHistorySelection(date) {
  if (!date) return;
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const history = ensureLawHistoryState(studio);
  const selected = Array.isArray(history.selectedDates) ? [...history.selectedDates] : [];
  const idx = selected.indexOf(date);
  if (idx >= 0) {
    selected.splice(idx, 1);
  } else {
    if (selected.length >= 2) selected.shift();
    selected.push(date);
  }
  history.selectedDates = selected;
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  renderLawHistory();
  // If the action button is unlocked only by an article and the user hasn't
  // typed one yet, jump focus to the article input so they can finish the
  // requirement without hunting for it.
  if (selected.length >= 1) {
    const liveArticle = elements.lawHistoryArticle?.value?.trim() || "";
    if (!liveArticle && elements.lawHistoryArticle && document.activeElement !== elements.lawHistoryArticle) {
      elements.lawHistoryArticle.focus();
    }
  }
}

async function runLawSnapshot(lawName, article, effectiveDate) {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!room || !studio) return;
  const history = ensureLawHistoryState(studio);
  if (!lawName || !article || !effectiveDate) {
    setLawHistoryStatus("법령명, 조문, 시행일이 모두 필요합니다.", "error");
    return;
  }
  try {
    if (_lawSnapshotAbortController) _lawSnapshotAbortController.abort();
    _lawSnapshotAbortController = new AbortController();
    setLawHistoryStatus(`${effectiveDate} 시점 조문을 가져오는 중입니다.`, "running");
    const response = await fetch("/api/law/article/at", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: _lawSnapshotAbortController.signal,
      body: JSON.stringify({ lawName, article, effectiveDate })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "시점 조회에 실패했습니다.");
    history.view = { kind: "snapshot", data: payload };
    room.updatedAt = new Date().toISOString();
    scheduleSave();
    setLawHistoryStatus("", "idle");
    renderLawHistoryViewer(history);
  } catch (error) {
    if (error?.name === "AbortError") setLawHistoryStatus("시점 조회를 중지했습니다.", "idle");
    else setLawHistoryStatus(error.message || "시점 조회에 실패했습니다.", "error");
  } finally {
    _lawSnapshotAbortController = null;
  }
}

async function runLawDiff(lawName, article, fromDate, toDate) {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!room || !studio) return;
  const history = ensureLawHistoryState(studio);
  if (!lawName || !article || !fromDate || !toDate) {
    setLawHistoryStatus("법령명, 조문, 두 시행일이 모두 필요합니다.", "error");
    return;
  }
  if (fromDate === toDate) {
    setLawHistoryStatus("두 시점이 같습니다.", "error");
    return;
  }
  try {
    if (_lawDiffAbortController) _lawDiffAbortController.abort();
    _lawDiffAbortController = new AbortController();
    setLawHistoryStatus(`${fromDate} → ${toDate} 변경 사항을 비교하는 중입니다.`, "running");
    const response = await fetch("/api/law/article/diff", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: _lawDiffAbortController.signal,
      body: JSON.stringify({ lawName, article, fromDate, toDate })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "시점 비교에 실패했습니다.");
    history.view = { kind: "diff", data: payload };
    room.updatedAt = new Date().toISOString();
    scheduleSave();
    setLawHistoryStatus("", "idle");
    renderLawHistoryViewer(history);
  } catch (error) {
    if (error?.name === "AbortError") setLawHistoryStatus("시점 비교를 중지했습니다.", "idle");
    else setLawHistoryStatus(error.message || "시점 비교에 실패했습니다.", "error");
  } finally {
    _lawDiffAbortController = null;
  }
}

function renderLawSnapshotView(target, data) {
  if (!data) {
    target.innerHTML = `<p class="law-explorer-empty">시점 조회 결과가 없습니다.</p>`;
    return;
  }
  const header = document.createElement("div");
  header.className = "law-snapshot-header";
  const badge = document.createElement("span");
  badge.className = "law-snapshot-badge";
  badge.textContent = "시점 조회";
  const eff = document.createElement("span");
  eff.className = "law-snapshot-effective";
  eff.textContent = `요청 ${data.effectiveDate || "-"}`;
  header.append(badge, eff);
  if (data.snapshotEffectiveDate && data.snapshotEffectiveDate !== data.effectiveDate) {
    const snap = document.createElement("span");
    snap.className = "law-snapshot-effective is-muted";
    snap.textContent = `실제 스냅샷 ${data.snapshotEffectiveDate}`;
    header.append(snap);
  }
  target.append(header);

  const citation = data.citation || {};
  if (citation.locator || citation.title) {
    const meta = document.createElement("div");
    meta.className = "law-snapshot-meta";
    meta.textContent = [citation.locator, citation.title].filter(Boolean).join(" · ");
    target.append(meta);
  }

  const body = document.createElement("pre");
  body.className = "law-snapshot-body";
  body.textContent = data.text || "(조문 본문이 비어 있습니다)";
  target.append(body);

  if (citation.url) {
    const link = document.createElement("a");
    link.className = "law-explorer-link";
    link.href = citation.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${citation.citationId || "L1"} law.go.kr 원문 ↗`;
    target.append(link);
  }
}

function renderLawDiffView(target, data) {
  if (!data || !data.diff) {
    target.innerHTML = `<p class="law-explorer-empty">시점 비교 결과가 없습니다.</p>`;
    return;
  }
  const { from, to, diff } = data;
  const header = document.createElement("div");
  header.className = "law-diff-header";

  const fromBadge = document.createElement("span");
  fromBadge.className = "law-diff-badge is-from";
  fromBadge.textContent = `이전 ${from?.effectiveDate || "-"}`;
  const arrow = document.createElement("span");
  arrow.className = "law-diff-arrow";
  arrow.textContent = "→";
  const toBadge = document.createElement("span");
  toBadge.className = "law-diff-badge is-to";
  toBadge.textContent = `이후 ${to?.effectiveDate || "-"}`;
  header.append(fromBadge, arrow, toBadge);
  target.append(header);

  const stats = document.createElement("div");
  stats.className = "law-diff-stats";
  const s = diff.stats || {};
  if (diff.identical) {
    stats.textContent = "두 시점 사이에 문구 변경이 없습니다.";
  } else {
    const parts = [];
    if (s.added) parts.push(`추가 ${s.added}`);
    if (s.removed) parts.push(`삭제 ${s.removed}`);
    if (s.modified) parts.push(`수정 ${s.modified}`);
    if (s.unchanged) parts.push(`유지 ${s.unchanged}`);
    stats.textContent = parts.join(" · ");
  }
  target.append(stats);

  const hunkList = document.createElement("div");
  hunkList.className = "law-diff-hunks";
  for (const hunk of diff.hunks || []) {
    const row = document.createElement("div");
    row.className = `law-diff-hunk law-diff-hunk-${hunk.type}`;
    if (hunk.type === "modified") {
      const oldLine = document.createElement("div");
      oldLine.className = "law-diff-line law-diff-line-old";
      oldLine.textContent = `− ${hunk.oldText}`;
      const newLine = document.createElement("div");
      newLine.className = "law-diff-line law-diff-line-new";
      newLine.textContent = `+ ${hunk.newText}`;
      const tag = document.createElement("span");
      tag.className = "law-diff-tag";
      tag.textContent = `수정 ${hunk.similarity != null ? `· 유사도 ${Math.round(hunk.similarity * 100)}%` : ""}`.trim();
      row.append(tag, oldLine, newLine);
    } else {
      const line = document.createElement("div");
      line.className = "law-diff-line";
      const prefix = hunk.type === "added" ? "+ " : hunk.type === "removed" ? "− " : "  ";
      line.textContent = `${prefix}${hunk.text || ""}`;
      const tag = document.createElement("span");
      tag.className = "law-diff-tag";
      tag.textContent = hunk.type === "added" ? "추가" : hunk.type === "removed" ? "삭제" : "유지";
      row.append(tag, line);
    }
    hunkList.append(row);
  }
  target.append(hunkList);

  const links = document.createElement("div");
  links.className = "law-diff-links";
  for (const side of [from, to]) {
    const cite = side?.citation;
    if (!cite?.url) continue;
    const link = document.createElement("a");
    link.className = "law-explorer-link";
    link.href = cite.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${side === from ? "이전" : "이후"} ${cite.citationId || "L"} 원문 ↗`;
    links.append(link);
  }
  if (links.childNodes.length) target.append(links);
}

function setLawHistoryBusy(isBusy) {
  const button = elements.lawHistoryFetchButton;
  if (!button) return;
  button.textContent = isBusy ? "중지" : "이력 조회";
  button.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function setLawHistoryStatus(message, mode = "idle") {
  if (!elements.lawHistoryStatus) return;
  elements.lawHistoryStatus.textContent = message || "";
  elements.lawHistoryStatus.dataset.mode = mode;
}
