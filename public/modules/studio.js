import { elements, ensureRoomStudio, getActiveRoom } from "./state.js";
import { scheduleSave, hydrateStoredDocuments } from "./persistence.js";
import { estimateDocumentBytes, estimateJsonBytes, formatBytes, getActiveDocuments } from "./chat.js";
import { bindStudioGraphEvents, showStudioGraphPanel, hideStudioGraphPanel } from "./graphStudio.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Tree layout constants
const NODE_W = 150;
const NODE_H = 42;
const ROOT_W = 174;
const GAP_H = 78;  // horizontal gap between parent right edge and child left edge
const GAP_V = 14;  // vertical gap between sibling subtrees
const REQUEST_TEXT_BUDGET_CHARS = 48000;
const REQUEST_MAX_BYTES = 8 * 1024 * 1024;

// Module-level interactive map state (preserved across redraws)
let _map = null;
let _evBound = false;
let _activeTool = "mindmap";
let _mindmapAbortController = null;
let _lawExplorerAbortController = null;

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
  elements.studioLawButton?.addEventListener("click", () => setActiveTool("law"));
  elements.studioLawRailButton?.addEventListener("click", () => setActiveTool("law"));
  elements.lawExplorerRunButton?.addEventListener("click", () => {
    if (_lawExplorerAbortController) {
      _lawExplorerAbortController.abort();
      return;
    }
    generateLawImpactMap();
  });
  bindStudioGraphEvents();
}

function setActiveTool(tool) {
  if (tool !== "mindmap" && tool !== "graph" && tool !== "law") return;
  _activeTool = tool;
  if (elements.studioContent) elements.studioContent.dataset.activeTool = tool;
  elements.studioMindmapButton?.classList.toggle("is-active", tool === "mindmap");
  elements.studioGraphButton?.classList.toggle("is-active", tool === "graph");
  elements.studioLawButton?.classList.toggle("is-active", tool === "law");
  if (elements.studioMindmapPanel) elements.studioMindmapPanel.hidden = tool !== "mindmap";
  if (elements.studioGraphPanel) elements.studioGraphPanel.hidden = tool !== "graph";
  if (elements.studioLawPanel) elements.studioLawPanel.hidden = tool !== "law";
  if (tool === "graph") {
    showStudioGraphPanel().catch(() => { /* errors logged inside module */ });
  } else {
    hideStudioGraphPanel();
    if (tool === "law") renderLawExplorer();
    else renderStudio();
  }
}

export function renderStudio() {
  if (!elements.studioPanel) return;
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const documents = getMindmapDocuments();
  const signature = buildDocumentSignature(documents);
  const cache = studio?.mindmap;
  const hasCurrentMap = cache?.data && cache.signature === signature;
  const hasStaleMap = cache?.data && cache.signature !== signature;

  if (!room) {
    renderEmpty("대화방을 선택하면 스튜디오를 사용할 수 있습니다.");
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
    const requestPayload = { model: elements.modelInput?.value?.trim() || "gemma3n:e2b", documents: requestDocuments };
    validateMindmapPayloadSize(requestPayload);
    _mindmapAbortController = new AbortController();
    setMindmapBusy(true);
    clearSvg();
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

function renderLawExplorer() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const data = studio?.lawExplorer?.data;
  if (!data?.impactMap) {
    if (elements.lawExplorerMap) {
      elements.lawExplorerMap.innerHTML = `<div class="law-explorer-empty">공식 법령 조문 기반 영향맵이 여기에 표시됩니다.</div>`;
    }
    if (elements.lawExplorerDetail) {
      elements.lawExplorerDetail.innerHTML = `<p class="law-explorer-empty">법령명과 조문을 입력하면 공식 조문 기반 영향맵을 보여줍니다.</p>`;
    }
    return;
  }
  renderLawImpactMap(data.impactMap, data.citation);
  setLawExplorerStatus(data.citation?.locator ? `확인된 조문: ${data.citation.locator}` : "영향맵 생성 완료", "done");
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
  const order = ["law_article", "review_subject", "obligation", "condition", "risk", "material_signal", "other"];
  for (const type of order) {
    const group = byType.get(type);
    if (!group?.length) continue;
    const section = document.createElement("section");
    section.className = "law-impact-section";
    const heading = document.createElement("h4");
    heading.textContent = lawImpactTypeLabel(type);
    section.append(heading);
    for (const node of group) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `law-impact-node law-impact-node-${type}`;
      button.textContent = node.label || node.id;
      button.addEventListener("click", () => renderLawImpactDetail(node, impactMap, citation));
      section.append(button);
    }
    target.append(section);
  }
  renderLawImpactDetail(nodes[0], impactMap, citation);
}

function renderLawImpactDetail(node, impactMap, citation) {
  const target = elements.lawExplorerDetail;
  if (!target || !node) return;
  target.innerHTML = "";
  const title = document.createElement("h3");
  title.textContent = node.label || "Impact node";
  const meta = document.createElement("div");
  meta.className = "law-explorer-detail-meta";
  meta.textContent = lawImpactTypeLabel(node.type);
  const summary = document.createElement("p");
  summary.textContent = node.summary || "";
  target.append(title, meta, summary);
  if (node.citationId && citation?.url) {
    const link = document.createElement("a");
    link.className = "law-explorer-link";
    link.href = citation.url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.textContent = `${node.citationId} law.go.kr 원문`;
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

// Collapse all nodes that have children, except root (so root's children are visible)
function buildInitialCollapsed(root, childrenMap) {
  const collapsed = new Set();
  function visit(node, depth) {
    if (depth > 0 && (childrenMap.get(node.id) || []).length > 0) collapsed.add(node.id);
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

  if (_map.panX === null) {
    const r = svg.getBoundingClientRect();
    _map.panX = 24;
    _map.panY = Math.max(20, ((r.height || 280) - totalH) / 2);
  }

  const vp = svgEl("g", { class: "map-vp" });
  vp.setAttribute("transform", `translate(${_map.panX},${_map.panY}) scale(${scale})`);
  svg.append(vp);

  const visible = collectVisible(root, childrenMap, collapsed);

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

function makeNode(node, isRoot, hasChildren, isCollapsed, isSelected) {
  const { x, y, w } = node._pos;
  const h = NODE_H;
  const lines = wrapLabel(node.label, isRoot ? 16 : 14).slice(0, 2);

  const g = svgEl("g", {
    class: `map-node${isRoot ? " is-root" : ""}${isSelected ? " is-selected" : ""}`,
    transform: `translate(${x} ${y - h / 2})`,
    "data-importance": String(Math.max(1, Math.min(5, Number(node.importance) || 3)))
  });

  g.append(svgEl("rect", { width: w, height: h, rx: 7, ry: 7 }));

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
    messages.push("기본 마인드맵을 표시 중입니다.");
  }
  if (warnings.some((warning) => warning.startsWith("model_fallback:"))) {
    messages.push("Ollama 생성에 실패해 문서 이름, 요약, 주제 기반 지도를 표시합니다.");
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
