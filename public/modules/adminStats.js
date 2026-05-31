import { elements } from "./state.js";
import { escapeHtml } from "./html.js";
import { fetchAdminJson } from "./adminApi.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const PALETTE = ["#0f766e", "#2563eb", "#e11d48", "#f59e0b", "#7c3aed", "#0891b2", "#16a34a", "#ea580c"];

const statsState = {
  range: "7d",
  summary: null,
  groups: null,
  notebooks: null,
  sessions: null,
  sessionsPage: 1,
  sessionsTotal: 0,
  sessionsPageSize: 50,
  loading: false
};

async function adminStatsApi(path) {
  return fetchAdminJson(`/api/admin/stats${path}`);
}

function fmtNum(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toLocaleString();
}

function fmtMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString()} ms`;
}

function fmtPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function fmtDate(ts) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

// ── KPI Cards ───────────────────────────────────────────────────────────────

function renderKpiCards(summary) {
  const grid = elements.statsKpiGrid;
  if (!grid) return;
  const cards = [
    { label: "총 세션", value: fmtNum(summary.totalSessions) },
    { label: "총 쿼리", value: fmtNum(summary.totalQueries) },
    { label: "활성 그룹", value: fmtNum(summary.activeGroups) },
    { label: "평균 응답", value: fmtMs(summary.avgLatencyMs) }
  ];
  grid.innerHTML = "";
  for (const card of cards) {
    const el = document.createElement("div");
    el.className = "stats-kpi-card";
    el.innerHTML = `<div class="stats-kpi-label">${escapeHtml(card.label)}</div><div class="stats-kpi-value">${escapeHtml(card.value)}</div>`;
    grid.append(el);
  }
}

// ── Strategic KPIs ──────────────────────────────────────────────────────────

function renderStrategicKpis(summary) {
  const el = elements.statsStrategicKpis;
  if (!el) return;
  const rows = [
    { label: "Law 사용률", value: summary.lawUsageRatio },
    { label: "Compliance 사용률", value: summary.complianceUsageRatio },
    { label: "Studio 전환율", value: summary.studioConversionRate },
    { label: "오류율", value: summary.errorRate },
    { label: "재쿼리율", value: summary.reQueryRate }
  ];
  el.innerHTML = "";
  for (const row of rows) {
    const pct = typeof row.value === "number" && Number.isFinite(row.value) ? row.value : 0;
    const bar = document.createElement("div");
    bar.className = "stats-strategic-row";
    bar.innerHTML = `
      <span class="stats-strategic-label">${escapeHtml(row.label)}</span>
      <div class="stats-strategic-bar-track">
        <div class="stats-strategic-bar" style="width:${Math.min(pct * 100, 100).toFixed(2)}%"></div>
      </div>
      <span class="stats-strategic-value">${fmtPct(row.value)}</span>`;
    el.append(bar);
  }
}

// ── Feature Usage ────────────────────────────────────────────────────────────

function renderFeatureUsage(summary) {
  const el = elements.statsFeatureUsage;
  if (!el) return;
  const fu = summary.featureUsage || {};
  const total = summary.totalQueries || 1;
  const features = [
    { key: "rag", label: "RAG (지식팩 검색)" },
    { key: "law", label: "Law (법령 검색)" },
    { key: "compliance", label: "Compliance (검토)" },
    { key: "kg", label: "KG (지식 그래프)" },
    { key: "calendar", label: "Calendar" },
    { key: "documentStudio", label: "Studio (문서 편집)" }
  ];
  el.innerHTML = "";
  for (const f of features) {
    const count = fu[f.key] || 0;
    const ratio = count / total;
    const row = document.createElement("div");
    row.className = "stats-feature-row";
    row.innerHTML = `
      <span class="stats-feature-label">${escapeHtml(f.label)}</span>
      <div class="stats-feature-bar-track">
        <div class="stats-feature-bar" style="width:${Math.min(ratio * 100, 100).toFixed(2)}%"></div>
      </div>
      <span class="stats-feature-count">${fmtNum(count)}</span>`;
    el.append(row);
  }
}

// ── Image worker status ──────────────────────────────────────────────────────

async function renderImageStatus() {
  const el = elements.statsImageStatus;
  if (!el) return;
  let data;
  try {
    data = await fetchAdminJson("/api/admin/image/status");
  } catch (err) {
    el.innerHTML = `<div class="stats-error">이미지 상태 로드 실패: ${escapeHtml(err.message)}</div>`;
    return;
  }
  const worker = data.worker || {};
  const cap = data.capabilities || {};
  const queue = data.queue || {};
  const online = Boolean(worker.ok);
  const rows = [
    { label: "Provider", value: data.provider || "—" },
    { label: "워커 상태", value: online ? "온라인" : `오프라인${worker.error ? ` (${worker.error})` : ""}` },
    { label: "티어 / 모델", value: online ? `${worker.tier || "—"} / ${worker.model || "—"}` : "—" },
    { label: "디바이스", value: worker.device || "—" },
    { label: "최대 크기 / 배치", value: cap.max_width ? `${cap.max_width}×${cap.max_height} / ${cap.max_batch}` : "—" },
    { label: "큐(실행/대기)", value: `${queue.running ?? 0} / ${queue.queued ?? 0} (동시 ${queue.concurrency ?? "—"})` },
    { label: "일일 한도", value: fmtNum(data.dailyLimit) }
  ];
  el.innerHTML = `<div class="stats-image-dot ${online ? "is-online" : "is-offline"}"></div>`
    + `<table class="stats-table"><tbody>`
    + rows.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td>${escapeHtml(String(r.value))}</td></tr>`).join("")
    + `</tbody></table>`;
}

// ── Group Bar Chart (SVG) ───────────────────────────────────────────────────

function renderGroupChart(groups) {
  const el = elements.statsGroupChart;
  if (!el) return;
  el.innerHTML = "";
  if (!groups || groups.length === 0) {
    el.textContent = "데이터 없음";
    return;
  }

  const rows = groups.slice(0, 12);
  const maxVal = Math.max(...rows.map((g) => g.queryCount), 1);
  const BAR_H = 28;
  const GAP = 8;
  const LABEL_W = 130;
  const W = 560;
  const H = rows.length * (BAR_H + GAP) + 24;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.style.width = "100%";
  svg.style.height = "auto";

  const CHART_W = W - LABEL_W - 60;

  rows.forEach((g, i) => {
    const y = i * (BAR_H + GAP) + 12;
    const barW = Math.max(2, (g.queryCount / maxVal) * CHART_W);

    const label = document.createElementNS(SVG_NS, "text");
    label.setAttribute("x", LABEL_W - 8);
    label.setAttribute("y", y + BAR_H / 2 + 4);
    label.setAttribute("text-anchor", "end");
    label.setAttribute("font-size", "12");
    label.setAttribute("fill", "var(--muted, #6b7280)");
    label.textContent = g.groupId === "anon" ? "(미인증)" : g.groupId;
    svg.append(label);

    const rect = document.createElementNS(SVG_NS, "rect");
    rect.setAttribute("x", LABEL_W);
    rect.setAttribute("y", y);
    rect.setAttribute("width", barW);
    rect.setAttribute("height", BAR_H);
    rect.setAttribute("rx", "4");
    rect.setAttribute("fill", PALETTE[i % PALETTE.length]);
    svg.append(rect);

    const valLabel = document.createElementNS(SVG_NS, "text");
    valLabel.setAttribute("x", LABEL_W + barW + 6);
    valLabel.setAttribute("y", y + BAR_H / 2 + 4);
    valLabel.setAttribute("font-size", "12");
    valLabel.setAttribute("fill", "var(--ink, #111827)");
    valLabel.textContent = g.queryCount;
    svg.append(valLabel);
  });

  el.append(svg);
}

// ── Notebook List ────────────────────────────────────────────────────────────

function renderNotebookList(notebooks) {
  const el = elements.statsNotebookList;
  if (!el) return;
  if (!notebooks || notebooks.length === 0) {
    el.textContent = "데이터 없음";
    return;
  }
  const table = document.createElement("table");
  table.className = "stats-table";
  table.innerHTML = `<thead><tr><th>#</th><th>지식팩 ID</th><th>쿼리</th><th>세션</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  notebooks.slice(0, 10).forEach((nb, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i + 1}</td><td>${escapeHtml(nb.notebookId)}</td><td>${fmtNum(nb.queryCount)}</td><td>${fmtNum(nb.uniqueSessions)}</td>`;
    tbody.append(tr);
  });
  table.append(tbody);
  el.innerHTML = "";
  el.append(table);
}

// ── Session List ─────────────────────────────────────────────────────────────

function renderSessionList(sessions, page, total, pageSize) {
  const el = elements.statsSessionList;
  const pager = elements.statsSessionPager;
  if (!el) return;

  if (!sessions || sessions.length === 0) {
    el.textContent = "데이터 없음";
    if (pager) pager.innerHTML = "";
    return;
  }

  const table = document.createElement("table");
  table.className = "stats-table";
  table.innerHTML = `<thead><tr><th>세션 ID</th><th>그룹</th><th>레벨</th><th>이벤트</th><th>최초</th><th>최후</th></tr></thead>`;
  const tbody = document.createElement("tbody");
  for (const s of sessions) {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="stats-session-id">${escapeHtml(s.sessionId)}</td>
      <td>${escapeHtml(s.groupId)}</td>
      <td>${escapeHtml(s.level)}</td>
      <td>${fmtNum(s.eventCount)}</td>
      <td>${fmtDate(s.firstSeen)}</td>
      <td>${fmtDate(s.lastSeen)}</td>`;
    tbody.append(tr);
  }
  table.append(tbody);
  el.innerHTML = "";
  el.append(table);

  if (pager) {
    const totalPages = Math.ceil(total / pageSize);
    pager.innerHTML = "";
    if (totalPages <= 1) return;

    const prev = document.createElement("button");
    prev.className = "ghost-button";
    prev.textContent = "◀ 이전";
    prev.disabled = page <= 1;
    prev.addEventListener("click", () => loadSessionsPage(page - 1));

    const info = document.createElement("span");
    info.className = "stats-pager-info";
    info.textContent = `${page} / ${totalPages}`;

    const next = document.createElement("button");
    next.className = "ghost-button";
    next.textContent = "다음 ▶";
    next.disabled = page >= totalPages;
    next.addEventListener("click", () => loadSessionsPage(page + 1));

    pager.append(prev, info, next);
  }
}

// ── Data Loading ─────────────────────────────────────────────────────────────

async function loadSessionsPage(page) {
  statsState.sessionsPage = page;
  const range = statsState.range;
  try {
    const data = await adminStatsApi(`/sessions?range=${range}&page=${page}&pageSize=${statsState.sessionsPageSize}`);
    statsState.sessions = data.sessions;
    statsState.sessionsTotal = data.total;
    renderSessionList(data.sessions, data.page, data.total, data.pageSize);
  } catch (err) {
    if (elements.statsSessionList) elements.statsSessionList.textContent = `세션 로드 실패: ${err.message}`;
  }
}

function showLoading() {
  const body = elements.statsBody;
  if (!body) return;
  [elements.statsKpiGrid, elements.statsStrategicKpis, elements.statsGroupChart,
   elements.statsFeatureUsage, elements.statsNotebookList, elements.statsSessionList,
   elements.statsSessionPager].forEach((el) => {
    if (el) el.innerHTML = "";
  });
  if (elements.statsKpiGrid) {
    elements.statsKpiGrid.innerHTML = '<div class="stats-loading">불러오는 중…</div>';
  }
}

async function loadStatsSummary() {
  if (statsState.loading) return;
  statsState.loading = true;
  showLoading();
  const range = statsState.range;
  try {
    const [sumData, groupData, nbData, sessData] = await Promise.all([
      adminStatsApi(`/summary?range=${range}`),
      adminStatsApi(`/groups?range=${range}`),
      adminStatsApi(`/notebooks?range=${range}`),
      adminStatsApi(`/sessions?range=${range}&page=1&pageSize=${statsState.sessionsPageSize}`)
    ]);
    statsState.summary = sumData.kpi;
    statsState.groups = groupData.groups;
    statsState.notebooks = nbData.notebooks;
    statsState.sessions = sessData.sessions;
    statsState.sessionsTotal = sessData.total;
    statsState.sessionsPage = 1;

    renderKpiCards(sumData.kpi);
    renderImageStatus().catch(() => {});
    renderStrategicKpis(sumData.kpi);
    renderFeatureUsage(sumData.kpi);
    renderGroupChart(groupData.groups);
    renderNotebookList(nbData.notebooks);
    renderSessionList(sessData.sessions, sessData.page, sessData.total, sessData.pageSize);
  } catch (err) {
    if (elements.statsKpiGrid) {
      elements.statsKpiGrid.innerHTML = `<div class="stats-error">통계 로드 실패: ${escapeHtml(err.message)}</div>`;
    }
  } finally {
    statsState.loading = false;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function showAdminStatsPanel() {
  if (elements.adminStatsPanel) elements.adminStatsPanel.hidden = false;
  await loadStatsSummary();
}

export function hideAdminStatsPanel() {
  if (elements.adminStatsPanel) elements.adminStatsPanel.hidden = true;
}

export function bindStatsEvents() {
  elements.statsRangeSelect?.addEventListener("change", (e) => {
    statsState.range = e.target.value;
    loadStatsSummary();
  });
  elements.statsRefreshButton?.addEventListener("click", () => {
    loadStatsSummary();
  });
}
