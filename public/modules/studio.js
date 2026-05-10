import { elements, ensureRoomStudio, getActiveRoom } from "./state.js";
import { scheduleSave, hydrateStoredDocuments } from "./persistence.js";
import { estimateDocumentBytes, getActiveDocuments } from "./chat.js";
import { bindStudioGraphEvents, showStudioGraphPanel, hideStudioGraphPanel } from "./graphStudio.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// Tree layout constants
const NODE_W = 150;
const NODE_H = 42;
const ROOT_W = 174;
const GAP_H = 78;  // horizontal gap between parent right edge and child left edge
const GAP_V = 14;  // vertical gap between sibling subtrees

// Module-level interactive map state (preserved across redraws)
let _map = null;
let _evBound = false;
let _activeTool = "mindmap";

// ── Public API ────────────────────────────────────────────────────

export function bindStudioEvents() {
  elements.studioMindmapButton?.addEventListener("click", () => {
    if (_activeTool !== "mindmap") setActiveTool("mindmap");
    else generateMindmap();
  });
  elements.studioMindmapRailButton?.addEventListener("click", () => setActiveTool("mindmap"));
  elements.studioGraphButton?.addEventListener("click", () => setActiveTool("graph"));
  elements.studioGraphRailButton?.addEventListener("click", () => setActiveTool("graph"));
  bindStudioGraphEvents();
}

function setActiveTool(tool) {
  if (tool !== "mindmap" && tool !== "graph") return;
  _activeTool = tool;
  if (elements.studioContent) elements.studioContent.dataset.activeTool = tool;
  elements.studioMindmapButton?.classList.toggle("is-active", tool === "mindmap");
  elements.studioGraphButton?.classList.toggle("is-active", tool === "graph");
  if (elements.studioMindmapPanel) elements.studioMindmapPanel.hidden = tool !== "mindmap";
  if (elements.studioGraphPanel) elements.studioGraphPanel.hidden = tool !== "graph";
  if (tool === "graph") {
    showStudioGraphPanel().catch(() => { /* errors logged inside module */ });
  } else {
    hideStudioGraphPanel();
    renderStudio();
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

  if (hasCurrentMap || hasStaleMap) {
    renderMindmap(cache.data, cache.selectedNodeId);
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

  if (elements.studioMindmapButton) {
    elements.studioMindmapButton.disabled = true;
    elements.studioMindmapButton.classList.add("is-busy");
  }
  clearSvg();
  if (elements.studioMindmapEmpty) elements.studioMindmapEmpty.hidden = true;
  elements.studioMindmapCanvas?.classList.add("is-loading");

  try {
    const response = await fetch("/api/studio/mindmap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: elements.modelInput?.value?.trim() || "gemma3n:e2b", documents })
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
    renderEmpty(error.message || "마인드맵 생성에 실패했습니다. 잠시 후 다시 시도하세요.");
  } finally {
    elements.studioMindmapCanvas?.classList.remove("is-loading");
    if (elements.studioMindmapButton) {
      elements.studioMindmapButton.disabled = false;
      elements.studioMindmapButton.classList.remove("is-busy");
    }
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
  const hasParent = new Set();

  for (const edge of Array.isArray(mindmap.edges) ? mindmap.edges : []) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to) || hasParent.has(edge.to)) continue;
    childrenMap.get(edge.from).push(nodeMap.get(edge.to));
    hasParent.add(edge.to);
  }

  return { root: nodeMap.get(mindmap.nodes[0].id), childrenMap };
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
      if (node._pos && child._pos) edgeG.append(makeEdge(node._pos, child._pos));
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

function makeEdge(from, to) {
  const x1 = from.x + from.w;
  const y1 = from.y;
  const x2 = to.x;
  const y2 = to.y;
  const cx = (x1 + x2) / 2;
  return svgEl("path", {
    class: "map-edge",
    d: `M ${x1} ${y1} C ${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`,
    fill: "none"
  });
}

function makeNode(node, isRoot, hasChildren, isCollapsed, isSelected) {
  const { x, y, w } = node._pos;
  const h = NODE_H;
  const lines = wrapLabel(node.label, isRoot ? 16 : 14).slice(0, 2);

  const g = svgEl("g", {
    class: `map-node${isRoot ? " is-root" : ""}${isSelected ? " is-selected" : ""}`,
    transform: `translate(${x} ${y - h / 2})`
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
  if (!node) {
    target.textContent = "노드를 선택하면 요약이 표시됩니다.";
    return;
  }
  const title = document.createElement("h3");
  title.textContent = node.label || "Node";
  const summary = document.createElement("p");
  summary.textContent = node.summary || "요약이 없습니다.";
  target.append(title, summary);
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
}

// ── Helpers ───────────────────────────────────────────────────────

function renderEmpty(message) {
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
