import { state, elements } from "./state.js";

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
  notebooks: [],
  selectedNotebookId: "",
  ontology: null,
  stats: null,
  filterType: "",
  searchTerm: "",
  limit: 80,
  cy: null,
  loading: false,
  selectedNodeId: null,
  selectedEdgeId: null
};

function authHeaders() {
  return state.admin?.token ? { Authorization: `Bearer ${state.admin.token}` } : {};
}

async function api(pathname) {
  const response = await fetch(`/api/admin/graph${pathname}`, { headers: authHeaders() });
  if (!response.ok) {
    let body = "";
    try { body = (await response.json()).error || ""; } catch { /* ignore */ }
    throw new Error(body || `HTTP ${response.status}`);
  }
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

// ===== Public entry points =====

export async function showAdminGraphPanel() {
  if (elements.adminGraphPanel) elements.adminGraphPanel.hidden = false;
  await ensureNotebookList();
  await ensureOntology();
  if (kgState.selectedNotebookId) {
    await refreshAll();
  } else {
    renderStats(null);
    clearCanvas("노트북을 선택하세요.");
  }
}

export function hideAdminGraphPanel() {
  if (elements.adminGraphPanel) elements.adminGraphPanel.hidden = true;
}

export function bindGraphAdminEvents() {
  elements.kgNotebookSelect?.addEventListener("change", async (event) => {
    kgState.selectedNotebookId = event.target.value;
    await refreshAll();
  });
  elements.kgRefreshButton?.addEventListener("click", () => refreshAll().catch(reportError));
  elements.kgRelayoutButton?.addEventListener("click", () => runLayout());
  elements.kgTypeFilter?.addEventListener("change", (event) => {
    kgState.filterType = event.target.value || "";
    refreshSubgraph().catch(reportError);
  });
  elements.kgLimitSelect?.addEventListener("change", (event) => {
    kgState.limit = Math.max(10, parseInt(event.target.value, 10) || 80);
    refreshSubgraph().catch(reportError);
  });

  let searchTimer = null;
  elements.kgSearchInput?.addEventListener("input", (event) => {
    if (searchTimer) clearTimeout(searchTimer);
    const term = event.target.value || "";
    searchTimer = setTimeout(() => {
      kgState.searchTerm = term;
      handleSearch(term).catch(reportError);
    }, 250);
  });
}

// ===== Data loading =====

async function ensureNotebookList() {
  if (kgState.notebooks.length) {
    populateNotebookSelect();
    return;
  }
  try {
    const response = await fetch("/api/notebooks", { headers: authHeaders() });
    if (!response.ok) return;
    const result = await response.json();
    kgState.notebooks = Array.isArray(result.notebooks) ? result.notebooks : [];
    if (!kgState.selectedNotebookId && kgState.notebooks.length) {
      kgState.selectedNotebookId = kgState.notebooks[0].id;
    }
    populateNotebookSelect();
  } catch (error) {
    reportError(error);
  }
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

function populateNotebookSelect() {
  const select = elements.kgNotebookSelect;
  if (!select) return;
  const previous = kgState.selectedNotebookId;
  select.innerHTML = "";
  if (!kgState.notebooks.length) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "노트북 없음";
    select.appendChild(opt);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const nb of kgState.notebooks) {
    const opt = document.createElement("option");
    opt.value = nb.id;
    opt.textContent = `${nb.name || nb.id}`;
    select.appendChild(opt);
  }
  if (previous && kgState.notebooks.some((n) => n.id === previous)) {
    select.value = previous;
  } else {
    kgState.selectedNotebookId = select.value;
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
  if (!kgState.selectedNotebookId) return;
  await Promise.all([refreshStats(), refreshSubgraph()]);
}

async function refreshStats() {
  if (!kgState.selectedNotebookId) { renderStats(null); return; }
  try {
    const data = await api(`/${kgState.selectedNotebookId}/stats`);
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
  if (!kgState.selectedNotebookId) return;
  if (kgState.loading) return;
  kgState.loading = true;
  setEmpty("");
  try {
    const params = new URLSearchParams();
    params.set("mode", "top");
    params.set("limit", String(kgState.limit));
    if (kgState.filterType) params.set("type", kgState.filterType);
    const data = await api(`/${kgState.selectedNotebookId}/subgraph?${params.toString()}`);
    renderGraph(data);
  } catch (error) {
    if (/no_graph/.test(error.message)) {
      clearCanvas("이 노트북에는 KG가 없습니다. 먼저 KG를 빌드하세요.");
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
  if (!kgState.selectedNotebookId) return;
  try {
    const data = await api(`/${kgState.selectedNotebookId}/search?q=${encodeURIComponent(trimmed)}&limit=20`);
    if (!Array.isArray(data.nodes) || data.nodes.length === 0) {
      clearCanvas(`"${trimmed}"과 일치하는 노드가 없습니다.`);
      return;
    }
    // Center subgraph around the first hit
    const seedId = data.nodes[0].id;
    await renderAroundNode(seedId);
  } catch (error) {
    reportError(error);
  }
}

async function renderAroundNode(nodeId) {
  if (!nodeId || !kgState.selectedNotebookId) return;
  try {
    const data = await api(`/${kgState.selectedNotebookId}/subgraph?mode=around&nodeId=${encodeURIComponent(nodeId)}&hops=1&limit=80`);
    renderGraph(data, { focusNodeId: nodeId });
  } catch (error) {
    reportError(error);
  }
}

// ===== Rendering =====

function renderStats(data) {
  const bar = elements.kgStatsBar;
  if (!bar) return;
  if (!data) {
    bar.innerHTML = `<span class="kg-chip">노트북을 선택하세요.</span>`;
    return;
  }
  if (data.noGraph) {
    bar.innerHTML = `<span class="kg-chip" style="border-color:#dc2626;color:#dc2626;">KG 없음 — 빌드 필요</span>`;
    return;
  }
  const parts = [];
  parts.push(`<span><strong>${data.enabledNodes ?? 0}</strong>/${data.nodeCount ?? 0} 노드</span>`);
  parts.push(`<span><strong>${data.enabledEdges ?? 0}</strong>/${data.edgeCount ?? 0} 엣지</span>`);
  parts.push(`<span><strong>${data.refCount ?? 0}</strong> 출처 참조</span>`);
  if (data.ontologyVersion) parts.push(`<span>온톨로지 v${data.ontologyVersion}</span>`);
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
  if (kgState.cy) {
    kgState.cy.elements().remove();
  }
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
      {
        selector: "node.selected",
        style: {
          "border-width": 3,
          "border-color": "#f59e0b"
        }
      },
      {
        selector: "node.dim",
        style: {
          "opacity": 0.25
        }
      },
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
      {
        selector: "edge.selected",
        style: {
          "line-color": "#f59e0b",
          "target-arrow-color": "#f59e0b",
          "width": 3
        }
      },
      {
        selector: "edge.dim",
        style: {
          "opacity": 0.15
        }
      }
    ]
  });

  kgState.cy.on("tap", "node", (event) => {
    const id = event.target.id();
    onNodeClick(id);
  });
  kgState.cy.on("tap", "edge", (event) => {
    const id = event.target.id();
    onEdgeClick(id);
  });
  kgState.cy.on("tap", (event) => {
    if (event.target === kgState.cy) {
      clearSelection();
    }
  });
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
  const n = kgState.cy.nodes().length;
  if (n === 0) return;
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

function renderLegend(counts) {
  const legend = elements.kgLegend;
  if (!legend) return;
  const types = (kgState.ontology?.entityTypes || []).map((t) => t.id);
  const items = types.map((t) => `<span class="kg-legend-item"><span class="kg-legend-dot" style="background:${colorFor(t)}"></span>${escapeHtml(t)}</span>`);
  if (counts) {
    items.push(`<span class="kg-legend-item">노드 ${counts.nodes ?? 0} · 엣지 ${counts.edges ?? 0}</span>`);
  }
  legend.innerHTML = items.join("");
}

// ===== Detail pane =====

function clearSelection() {
  kgState.selectedNodeId = null;
  kgState.selectedEdgeId = null;
  if (kgState.cy) {
    kgState.cy.elements().removeClass("selected dim");
  }
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
  if (!nodeId || !kgState.selectedNotebookId) return;
  kgState.selectedNodeId = nodeId;
  kgState.selectedEdgeId = null;
  highlightNode(nodeId);
  try {
    const data = await api(`/${kgState.selectedNotebookId}/node/${encodeURIComponent(nodeId)}`);
    renderNodeDetail(data);
  } catch (error) {
    reportError(error);
  }
}

async function onEdgeClick(edgeId) {
  if (!edgeId || !kgState.selectedNotebookId) return;
  kgState.selectedNodeId = null;
  kgState.selectedEdgeId = edgeId;
  highlightEdge(edgeId);
  try {
    const data = await api(`/${kgState.selectedNotebookId}/edge/${encodeURIComponent(edgeId)}`);
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
  const summaryHtml = node.summary ? `<div class="kg-detail-summary">${escapeHtml(node.summary)}</div>` : `<div class="kg-detail-empty">요약 없음</div>`;

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
      conf ${(Number(node.confidence) || 0).toFixed(2)} · ${node.enabled ? "enabled" : "disabled"}
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
      ${escapeHtml(edge.type || "")} · conf ${(Number(edge.confidence) || 0).toFixed(2)} · ${edge.enabled ? "enabled" : "disabled"}
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
  console.warn("[graphAdmin]", message);
}
