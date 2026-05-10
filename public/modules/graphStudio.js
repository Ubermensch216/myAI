import { elements, accessAuthHeaders, state } from "./state.js";
import { getActiveNotebookId, findNotebookSummary } from "./notebook.js";

const REBUILD_POLL_MS = 3000;

const TYPE_COLORS = {
  Document: "#0f766e",
  Concept: "#2563eb",
  Department: "#9333ea",
  Role: "#db2777",
  Procedure: "#d97706",
  Rule: "#dc2626",
  Form: "#0891b2",
  System: "#475569"
};
const FALLBACK_COLOR = "#64748b";
const RELATION_LABELS = {
  RELATES_TO: "관련",
  BASED_ON: "근거",
  OWNED_BY: "담당",
  REQUIRES: "요구",
  PART_OF: "소속",
  CONTRASTS_WITH: "대비"
};

const kgState = {
  activeNotebookId: "",
  ontology: null,
  stats: null,
  filterType: "",
  searchTerm: "",
  limit: 80,
  cy: null,
  loading: false,
  selectedNodeId: null,
  selectedEdgeId: null,
  initialized: false,
  panelVisible: false,
  rebuilding: false,
  rebuildPollTimer: null
};

async function api(pathname, init = {}) {
  const headers = { ...accessAuthHeaders(), ...(init.headers || {}) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api/studio/graph${pathname}`, { ...init, headers });
  if (!response.ok) {
    let body = "";
    try { body = (await response.json()).error || ""; } catch { /* ignore */ }
    throw new Error(body || `HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function adminAuthHeaders() {
  return state.admin?.token ? { Authorization: `Bearer ${state.admin.token}` } : {};
}

async function adminGraphApi(pathname, init = {}) {
  const headers = { ...adminAuthHeaders(), ...(init.headers || {}) };
  if (init.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
  const response = await fetch(`/api/admin/graph${pathname}`, { ...init, headers });
  if (!response.ok) {
    let body = "";
    try { body = (await response.json()).error || ""; } catch { /* ignore */ }
    throw new Error(body || `HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function colorFor(type) {
  return TYPE_COLORS[type] || FALLBACK_COLOR;
}

export async function showStudioGraphPanel() {
  kgState.panelVisible = true;
  await ensureOntology();
  await syncWithActiveRoom({ force: true });
  if (kgState.cy) kgState.cy.resize();
  updateRebuildVisibility();
  pollRebuildStatus().catch(() => {});
}

export function hideStudioGraphPanel() {
  kgState.panelVisible = false;
  toggleGraphFullscreen(false);
  stopRebuildPolling();
}

export function bindStudioGraphEvents() {
  if (kgState.initialized) return;
  kgState.initialized = true;

  elements.kgRefreshButton?.addEventListener("click", () => {
    syncWithActiveRoom({ force: true }).catch(reportError);
  });
  elements.kgRebuildButton?.addEventListener("click", () => {
    startRebuild().catch(reportError);
  });
  elements.kgRelayoutButton?.addEventListener("click", () => runLayout());
  elements.kgFullscreenButton?.addEventListener("click", () => toggleGraphFullscreen());
  elements.kgTypeFilter?.addEventListener("change", (event) => {
    kgState.filterType = event.target.value || "";
    if (kgState.activeNotebookId) refreshSubgraph().catch(reportError);
  });
  elements.kgLimitSelect?.addEventListener("change", (event) => {
    kgState.limit = Math.max(10, parseInt(event.target.value, 10) || 80);
    if (kgState.activeNotebookId) refreshSubgraph().catch(reportError);
  });

  let searchTimer = null;
  elements.kgSearchInput?.addEventListener("input", (event) => {
    if (searchTimer) clearTimeout(searchTimer);
    const term = event.target.value || "";
    searchTimer = setTimeout(() => {
      kgState.searchTerm = term;
      if (kgState.activeNotebookId) handleSearch(term).catch(reportError);
    }, 250);
  });

  window.addEventListener("myai:renderrooms", () => {
    if (kgState.panelVisible) syncWithActiveRoom({ force: false }).catch(reportError);
  });

  window.addEventListener("myai:roomchange", () => {
    if (kgState.panelVisible) {
      syncWithActiveRoom({ force: false }).catch(reportError);
    }
  });
}

async function syncWithActiveRoom({ force = false } = {}) {
  const roomNotebookId = getActiveNotebookId() || "";
  const changed = roomNotebookId !== kgState.activeNotebookId;
  if (!force && !changed) return;
  kgState.activeNotebookId = roomNotebookId;
  renderActiveNotebookLabel();
  if (changed) {
    stopRebuildPolling();
    setRebuildStatus("");
    kgState.rebuilding = false;
  }
  updateRebuildVisibility();
  if (!roomNotebookId) {
    if (elements.kgSearchInput) elements.kgSearchInput.value = "";
    kgState.searchTerm = "";
    renderStats(null);
    clearCanvas("대화방에서 부서노트북을 선택하면 지식 그래프가 표시됩니다.");
    clearSelection();
    return;
  }
  await refreshAll();
  if (changed) pollRebuildStatus().catch(() => {});
}

function renderActiveNotebookLabel() {
  const label = elements.kgActiveNotebookLabel;
  if (!label) return;
  const id = kgState.activeNotebookId;
  if (!id) {
    label.dataset.state = "empty";
    label.textContent = "대화방에서 부서노트북을 선택하세요.";
    label.title = "";
    return;
  }
  const nb = findNotebookSummary(id);
  label.dataset.state = "active";
  label.textContent = nb?.name || id;
  label.title = nb?.description ? `${nb.name} — ${nb.description}` : (nb?.name || id);
}

async function ensureOntology() {
  if (kgState.ontology) {
    populateTypeFilter();
    return;
  }
  try {
    kgState.ontology = await api("/ontology");
    populateTypeFilter();
  } catch (error) {
    reportError(error);
  }
}

function populateTypeFilter() {
  const select = elements.kgTypeFilter;
  if (!select || !kgState.ontology) return;
  const current = kgState.filterType;
  const opts = [`<option value="">모든 타입</option>`];
  for (const t of kgState.ontology.entityTypes || []) {
    opts.push(`<option value="${escapeHtml(t.id)}">${escapeHtml(t.id)}</option>`);
  }
  select.innerHTML = opts.join("");
  if (current && kgState.ontology.entityTypes.some((t) => t.id === current)) {
    select.value = current;
  }
}

async function refreshAll() {
  if (!kgState.activeNotebookId) return;
  await Promise.all([refreshStats(), refreshSubgraph()]);
}

async function refreshStats() {
  if (!kgState.activeNotebookId) { renderStats(null); return; }
  try {
    const data = await api(`/${kgState.activeNotebookId}/stats`);
    kgState.stats = data;
    renderStats(data);
  } catch (error) {
    if (/no_graph/.test(error.message)) {
      renderStats({ noGraph: true });
    } else {
      reportError(error);
      renderStats(null);
    }
  }
}

async function refreshSubgraph() {
  if (!kgState.activeNotebookId) return;
  if (kgState.loading) return;
  kgState.loading = true;
  setEmpty("");
  try {
    const params = new URLSearchParams();
    params.set("mode", "top");
    params.set("limit", String(kgState.limit));
    if (kgState.filterType) params.set("type", kgState.filterType);
    const data = await api(`/${kgState.activeNotebookId}/subgraph?${params.toString()}`);
    renderGraph(data);
  } catch (error) {
    if (/no_graph/.test(error.message)) {
      clearCanvas("이 노트북에는 지식 그래프가 없습니다.");
    } else {
      reportError(error);
      clearCanvas("그래프를 불러오지 못했습니다.");
    }
  } finally {
    kgState.loading = false;
  }
}

async function handleSearch(term) {
  const trimmed = String(term || "").trim();
  if (!trimmed) {
    await refreshSubgraph();
    return;
  }
  if (!kgState.activeNotebookId) return;
  try {
    const data = await api(`/${kgState.activeNotebookId}/search?q=${encodeURIComponent(trimmed)}&limit=20`);
    if (!Array.isArray(data.nodes) || data.nodes.length === 0) {
      clearCanvas(`"${trimmed}"과 일치하는 노드가 없습니다.`);
      return;
    }
    const seedId = data.nodes[0].id;
    await renderAroundNode(seedId);
  } catch (error) {
    reportError(error);
  }
}

async function renderAroundNode(nodeId) {
  if (!nodeId || !kgState.activeNotebookId) return;
  try {
    const data = await api(`/${kgState.activeNotebookId}/subgraph?mode=around&nodeId=${encodeURIComponent(nodeId)}&hops=1&limit=80`);
    renderGraph(data, { focusNodeId: nodeId });
  } catch (error) {
    reportError(error);
  }
}

function renderStats(data) {
  const bar = elements.kgStatsBar;
  if (!bar) return;
  if (!data) {
    bar.innerHTML = `<span class="kg-chip">노트북을 선택하세요.</span>`;
    return;
  }
  if (data.noGraph) {
    bar.innerHTML = `<span class="kg-chip" style="border-color:#dc2626;color:#dc2626;">지식 그래프가 빌드되지 않았습니다</span>`;
    return;
  }
  const parts = [];
  parts.push(`<span><strong>${data.enabledNodes ?? 0}</strong> 노드</span>`);
  parts.push(`<span><strong>${data.enabledEdges ?? 0}</strong> 엣지</span>`);
  parts.push(`<span><strong>${data.refCount ?? 0}</strong> 출처 참조</span>`);
  if (Array.isArray(data.nodeTypeCounts)) {
    for (const nt of data.nodeTypeCounts) {
      parts.push(`<span class="kg-chip"><span class="kg-chip-dot" style="background:${colorFor(nt.type)}"></span>${escapeHtml(nt.type)} <strong>${nt.c}</strong></span>`);
    }
  }
  bar.innerHTML = parts.join("");
}

function setEmpty(text) {
  if (!elements.kgCanvasEmpty) return;
  if (!text) {
    elements.kgCanvasEmpty.hidden = true;
    elements.kgCanvasEmpty.textContent = "";
  } else {
    elements.kgCanvasEmpty.hidden = false;
    elements.kgCanvasEmpty.textContent = text;
  }
}

function clearCanvas(message) {
  if (kgState.cy) kgState.cy.elements().remove();
  setEmpty(message || "");
  renderLegend();
}

function ensureCytoscape() {
  if (kgState.cy) return kgState.cy;
  const container = elements.kgCanvas;
  if (!container) return null;
  if (typeof window.cytoscape !== "function") {
    setEmpty("cytoscape 라이브러리를 불러오지 못했습니다.");
    return null;
  }
  kgState.cy = window.cytoscape({
    container,
    minZoom: 0.2,
    maxZoom: 2.5,
    wheelSensitivity: 0.2,
    style: [
      {
        selector: "node",
        style: {
          "background-color": "data(color)",
          "label": "data(label)",
          "color": "#0f172a",
          "font-size": 10,
          "text-wrap": "wrap",
          "text-max-width": 100,
          "text-valign": "bottom",
          "text-margin-y": 4,
          "border-width": 1,
          "border-color": "#1f2937",
          "width": "mapData(degree, 0, 20, 18, 56)",
          "height": "mapData(degree, 0, 20, 18, 56)",
          "text-outline-color": "#ffffff",
          "text-outline-width": 2
        }
      },
      { selector: "node.selected", style: { "border-width": 3, "border-color": "#f59e0b" } },
      { selector: "node.dim", style: { "opacity": 0.25 } },
      {
        selector: "edge",
        style: {
          "width": "mapData(confidence, 0.5, 1, 1, 3)",
          "line-color": "#94a3b8",
          "target-arrow-color": "#94a3b8",
          "target-arrow-shape": "triangle",
          "curve-style": "bezier",
          "label": "data(relLabel)",
          "font-size": 9,
          "color": "#475569",
          "text-rotation": "autorotate",
          "text-background-color": "#f8fafc",
          "text-background-opacity": 0.9,
          "text-background-padding": 1
        }
      },
      { selector: "edge.selected", style: { "line-color": "#f59e0b", "target-arrow-color": "#f59e0b", "width": 3 } },
      { selector: "edge.dim", style: { "opacity": 0.15 } }
    ]
  });

  kgState.cy.on("tap", "node", (e) => onNodeClick(e.target.id()));
  kgState.cy.on("tap", "edge", (e) => onEdgeClick(e.target.id()));
  kgState.cy.on("tap", (e) => { if (e.target === kgState.cy) clearSelection(); });
  return kgState.cy;
}

function renderGraph(payload, opts = {}) {
  const cy = ensureCytoscape();
  if (!cy) return;
  const nodes = Array.isArray(payload?.nodes) ? payload.nodes : [];
  const edges = Array.isArray(payload?.edges) ? payload.edges : [];

  if (!nodes.length) {
    cy.elements().remove();
    setEmpty("표시할 노드가 없습니다.");
    renderLegend();
    return;
  }
  setEmpty("");

  const elementsList = [];
  const degreeMap = new Map();
  for (const e of edges) {
    degreeMap.set(e.srcId, (degreeMap.get(e.srcId) || 0) + 1);
    degreeMap.set(e.dstId, (degreeMap.get(e.dstId) || 0) + 1);
  }
  for (const n of nodes) {
    elementsList.push({
      group: "nodes",
      data: {
        id: n.id,
        label: n.label,
        type: n.type,
        color: colorFor(n.type),
        confidence: n.confidence ?? 1,
        degree: typeof n.degree === "number" ? n.degree : (degreeMap.get(n.id) || 0)
      }
    });
  }
  const nodeIds = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!nodeIds.has(e.srcId) || !nodeIds.has(e.dstId)) continue;
    elementsList.push({
      group: "edges",
      data: {
        id: e.id,
        source: e.srcId,
        target: e.dstId,
        relType: e.type,
        relLabel: RELATION_LABELS[e.type] || e.type,
        confidence: e.confidence ?? 1
      }
    });
  }

  cy.batch(() => {
    cy.elements().remove();
    cy.add(elementsList);
  });
  cy.resize();
  runLayout();
  renderLegend(payload?.counts);
  if (opts.focusNodeId) {
    const target = cy.getElementById(opts.focusNodeId);
    if (target && target.length) {
      cy.animate({ center: { eles: target }, zoom: 1.1 }, { duration: 400 });
      setTimeout(() => onNodeClick(opts.focusNodeId), 50);
    }
  }
}

function runLayout() {
  if (!kgState.cy) return;
  if (kgState.cy.nodes().length === 0) return;
  kgState.cy.layout({
    name: "cose",
    animate: false,
    fit: true,
    padding: 30,
    nodeRepulsion: 8000,
    idealEdgeLength: 90,
    nodeOverlap: 12,
    randomize: true
  }).run();
}

function toggleGraphFullscreen(force) {
  const wrap = elements.kgCanvasWrap;
  const button = elements.kgFullscreenButton;
  if (!wrap) return;
  const shouldFullscreen = typeof force === "boolean" ? force : !wrap.classList.contains("is-fullscreen");
  wrap.classList.toggle("is-fullscreen", shouldFullscreen);
  if (button) {
    button.title = shouldFullscreen ? "\uC6D0\uB798 \uD06C\uAE30\uB85C" : "\uC804\uCCB4\uD654\uBA74";
    button.setAttribute("aria-label", shouldFullscreen ? "\uC6D0\uB798 \uD06C\uAE30\uB85C \uBCF5\uC6D0" : "\uC804\uCCB4\uD654\uBA74 \uC804\uD658");
    button.setAttribute("aria-pressed", shouldFullscreen ? "true" : "false");
  }
  requestAnimationFrame(() => {
    if (!kgState.cy) return;
    kgState.cy.resize();
    if (kgState.cy.elements().length) kgState.cy.fit(undefined, shouldFullscreen ? 48 : 30);
  });
}

function renderLegend(counts) {
  const legend = elements.kgLegend;
  if (!legend) return;
  const types = (kgState.ontology?.entityTypes || []).map((t) => t.id);
  const items = types.map((t) => `<span class="kg-legend-item"><span class="kg-legend-dot" style="background:${colorFor(t)}"></span>${escapeHtml(t)}</span>`);
  if (counts) items.push(`<span class="kg-legend-item">노드 ${counts.nodes ?? 0} · 엣지 ${counts.edges ?? 0}</span>`);
  legend.innerHTML = items.join("");
}

function clearSelection() {
  kgState.selectedNodeId = null;
  kgState.selectedEdgeId = null;
  if (kgState.cy) kgState.cy.elements().removeClass("selected dim");
  if (elements.kgDetailEmpty) elements.kgDetailEmpty.hidden = false;
  if (elements.kgDetailBody) {
    elements.kgDetailBody.hidden = true;
    elements.kgDetailBody.innerHTML = "";
  }
}

function highlightNode(nodeId) {
  if (!kgState.cy) return;
  kgState.cy.batch(() => {
    kgState.cy.elements().removeClass("selected dim");
    const node = kgState.cy.getElementById(nodeId);
    if (!node || !node.length) return;
    const neighborhood = node.closedNeighborhood();
    kgState.cy.elements().not(neighborhood).addClass("dim");
    node.addClass("selected");
  });
}

function highlightEdge(edgeId) {
  if (!kgState.cy) return;
  kgState.cy.batch(() => {
    kgState.cy.elements().removeClass("selected dim");
    const edge = kgState.cy.getElementById(edgeId);
    if (!edge || !edge.length) return;
    const conn = edge.connectedNodes().union(edge);
    kgState.cy.elements().not(conn).addClass("dim");
    edge.addClass("selected");
  });
}

async function onNodeClick(nodeId) {
  if (!nodeId || !kgState.activeNotebookId) return;
  kgState.selectedNodeId = nodeId;
  kgState.selectedEdgeId = null;
  highlightNode(nodeId);
  try {
    const data = await api(`/${kgState.activeNotebookId}/node/${encodeURIComponent(nodeId)}`);
    renderNodeDetail(data);
  } catch (error) {
    reportError(error);
  }
}

async function onEdgeClick(edgeId) {
  if (!edgeId || !kgState.activeNotebookId) return;
  kgState.selectedNodeId = null;
  kgState.selectedEdgeId = edgeId;
  highlightEdge(edgeId);
  try {
    const data = await api(`/${kgState.activeNotebookId}/edge/${encodeURIComponent(edgeId)}`);
    renderEdgeDetail(data);
  } catch (error) {
    reportError(error);
  }
}

function renderNodeDetail(data) {
  const body = elements.kgDetailBody;
  if (!body) return;
  if (elements.kgDetailEmpty) elements.kgDetailEmpty.hidden = true;
  body.hidden = false;

  const node = data?.node || {};
  const neighbors = Array.isArray(data?.neighbors) ? data.neighbors : [];
  const refs = Array.isArray(data?.refs) ? data.refs : [];

  const aliasesHtml = (node.aliases || []).map((a) => `<span class="kg-alias-chip">${escapeHtml(a)}</span>`).join("");
  const summaryHtml = node.summary
    ? `<div class="kg-detail-summary">${escapeHtml(node.summary)}</div>`
    : `<div class="kg-detail-empty">요약 없음</div>`;

  const neighborHtml = neighbors.length
    ? neighbors.map((n) => `
        <div class="kg-neighbor-item" data-neighbor-id="${escapeHtml(n.neighborId)}">
          <div class="kg-neighbor-rel">${escapeHtml(RELATION_LABELS[n.relType] || n.relType)} · ${escapeHtml(n.direction === "out" ? "→" : "←")} · ${escapeHtml(n.neighborType)}</div>
          <div class="kg-neighbor-label">${escapeHtml(n.neighborLabel)}</div>
        </div>
      `).join("")
    : `<div class="kg-detail-empty">이웃 없음</div>`;

  const refsHtml = refs.length
    ? refs.map((r) => `
        <div class="kg-ref-item">
          <div class="kg-ref-meta">${escapeHtml(r.documentId)} · chunk ${escapeHtml(String(r.chunkIndex))}</div>
          ${r.quote ? `<div class="kg-ref-quote">${escapeHtml(r.quote)}</div>` : ""}
        </div>
      `).join("")
    : `<div class="kg-detail-empty">출처 참조 없음</div>`;

  body.innerHTML = `
    <h4>${escapeHtml(node.label || "")}</h4>
    <div class="kg-detail-meta">
      <span class="kg-chip"><span class="kg-chip-dot" style="background:${colorFor(node.type)}"></span>${escapeHtml(node.type || "")}</span>
      conf ${(Number(node.confidence) || 0).toFixed(2)}
    </div>
    <div class="kg-detail-section">
      <div class="kg-detail-section-title">요약</div>
      ${summaryHtml}
    </div>
    ${aliasesHtml ? `<div class="kg-detail-section"><div class="kg-detail-section-title">별칭</div><div class="kg-aliases">${aliasesHtml}</div></div>` : ""}
    <div class="kg-detail-section">
      <div class="kg-detail-section-title">이웃 (${neighbors.length})</div>
      <div class="kg-neighbor-list">${neighborHtml}</div>
    </div>
    <div class="kg-detail-section">
      <div class="kg-detail-section-title">출처 청크 (${refs.length})</div>
      <div class="kg-ref-list">${refsHtml}</div>
    </div>
  `;

  body.querySelectorAll("[data-neighbor-id]").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-neighbor-id");
      if (!id) return;
      const cyNode = kgState.cy?.getElementById(id);
      if (cyNode && cyNode.length) {
        onNodeClick(id);
        kgState.cy.animate({ center: { eles: cyNode }, zoom: 1.1 }, { duration: 300 });
      } else {
        renderAroundNode(id);
      }
    });
  });
}

function renderEdgeDetail(data) {
  const body = elements.kgDetailBody;
  if (!body) return;
  if (elements.kgDetailEmpty) elements.kgDetailEmpty.hidden = true;
  body.hidden = false;

  const edge = data?.edge || {};
  const refs = Array.isArray(data?.refs) ? data.refs : [];
  const refsHtml = refs.length
    ? refs.map((r) => `
        <div class="kg-ref-item">
          <div class="kg-ref-meta">${escapeHtml(r.documentId)} · chunk ${escapeHtml(String(r.chunkIndex))}</div>
          ${r.quote ? `<div class="kg-ref-quote">${escapeHtml(r.quote)}</div>` : ""}
        </div>
      `).join("")
    : `<div class="kg-detail-empty">출처 참조 없음</div>`;

  body.innerHTML = `
    <h4>관계 · ${escapeHtml(RELATION_LABELS[edge.type] || edge.type || "")}</h4>
    <div class="kg-detail-meta">
      ${escapeHtml(edge.type || "")} · conf ${(Number(edge.confidence) || 0).toFixed(2)}
    </div>
    ${edge.label ? `<div class="kg-detail-section"><div class="kg-detail-section-title">설명</div><div class="kg-detail-summary">${escapeHtml(edge.label)}</div></div>` : ""}
    <div class="kg-detail-section">
      <div class="kg-detail-section-title">출처 청크 (${refs.length})</div>
      <div class="kg-ref-list">${refsHtml}</div>
    </div>
  `;
}

function reportError(error) {
  const message = error?.message || String(error || "unknown");
  console.warn("[graphStudio]", message);
}

function updateRebuildVisibility() {
  const btn = elements.kgRebuildButton;
  if (!btn) return;
  const isAdmin = Boolean(state.admin?.authenticated && state.admin?.token);
  const hasNotebook = Boolean(kgState.activeNotebookId);
  btn.hidden = !(isAdmin && hasNotebook);
  btn.disabled = !!kgState.rebuilding;
  btn.textContent = kgState.rebuilding ? "리빌드 중..." : "리빌드";
}

function setRebuildStatus(text, mode = "info") {
  const el = elements.kgRebuildStatus;
  if (!el) return;
  if (!text) {
    el.hidden = true;
    el.textContent = "";
    el.dataset.mode = "";
    return;
  }
  el.hidden = false;
  el.textContent = text;
  el.dataset.mode = mode;
}

function startRebuildPolling() {
  if (kgState.rebuildPollTimer) return;
  kgState.rebuildPollTimer = setInterval(() => {
    pollRebuildStatus().catch(() => {});
  }, REBUILD_POLL_MS);
}

function stopRebuildPolling() {
  if (kgState.rebuildPollTimer) {
    clearInterval(kgState.rebuildPollTimer);
    kgState.rebuildPollTimer = null;
  }
}

async function pollRebuildStatus() {
  if (!kgState.activeNotebookId) { stopRebuildPolling(); return; }
  if (!state.admin?.token) { stopRebuildPolling(); return; }
  let data;
  try {
    data = await adminGraphApi(`/${encodeURIComponent(kgState.activeNotebookId)}/rebuild/status`);
  } catch {
    return;
  }
  const job = data?.job;
  if (!job) {
    stopRebuildPolling();
    kgState.rebuilding = false;
    setRebuildStatus("");
    updateRebuildVisibility();
    return;
  }
  if (job.status === "running") {
    kgState.rebuilding = true;
    const pct = job.total > 0 ? Math.floor((job.processed / job.total) * 100) : 0;
    const totalText = job.total > 0 ? `${job.processed}/${job.total} (${pct}%)` : `${job.processed}`;
    setRebuildStatus(`리빌드 중 · ${totalText}`, "running");
    startRebuildPolling();
    updateRebuildVisibility();
    return;
  }
  stopRebuildPolling();
  kgState.rebuilding = false;
  if (job.status === "done") {
    const elapsed = Math.round((job.elapsedMs || 0) / 1000);
    setRebuildStatus(
      `완료 · ${job.processed}/${job.total} 청크 · ${job.nodesCreated} 노드 · ${job.edgesCreated} 엣지 · ${elapsed}s`,
      "done"
    );
    await refreshAll();
    setTimeout(() => {
      if (!kgState.rebuilding) setRebuildStatus("");
    }, 8000);
  } else if (job.status === "failed") {
    setRebuildStatus(`실패: ${job.error || "unknown"}`, "error");
  } else {
    setRebuildStatus("");
  }
  updateRebuildVisibility();
}

async function startRebuild() {
  if (!kgState.activeNotebookId) return;
  if (!state.admin?.token) {
    setRebuildStatus("관리자 인증이 필요합니다.", "error");
    return;
  }
  if (kgState.rebuilding) return;
  const ok = window.confirm(
    "지식 그래프를 다시 만듭니다.\n기존 그래프는 모두 지워지고 처음부터 추출합니다.\n시간이 오래 걸릴 수 있습니다. 계속할까요?"
  );
  if (!ok) return;
  try {
    setRebuildStatus("시작 중...", "running");
    kgState.rebuilding = true;
    updateRebuildVisibility();
    await adminGraphApi(`/${encodeURIComponent(kgState.activeNotebookId)}/rebuild`, {
      method: "POST",
      body: JSON.stringify({})
    });
    startRebuildPolling();
    pollRebuildStatus().catch(() => {});
  } catch (error) {
    kgState.rebuilding = false;
    setRebuildStatus(`시작 실패: ${error.message}`, "error");
    updateRebuildVisibility();
  }
}
