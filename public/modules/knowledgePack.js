/**
 * 지식팩 (Knowledge Pack) — myAI 주 메뉴 페이지
 *
 * 사용자가 권한에 따라 접근 가능한 지식팩 목록을 보여주고,
 * "이 지식팩으로 새 대화 시작" 흐름의 진입점이 된다.
 *
 * 내부 데이터 모델은 기존 notebook 그대로 사용한다 — notebookId,
 * /api/notebooks API, selectedNotebookId 필드를 모두 재사용한다.
 * 본 모듈은 사용자 노출 레이어만 담당한다.
 */

import { state, elements, accessAuthHeaders, createRoomFromKnowledgePack } from "./state.js";
import { scheduleSave } from "./persistence.js";
import { loadNotebooks, getCurrentAccessLabel } from "./notebook.js";
import { openSettingsAdminPanel } from "./settings.js";

let packSearchQuery = "";
let packEventsBound = false;
let packDetailMode = false;         // 상세 화면 표시 여부
let packDetailId = null;            // 현재 상세로 열린 지식팩 id
let packDetailLoadSeq = 0;          // 동시 클릭/취소 처리용 시퀀스
let packActiveTab = "list";         // 현재 활성 탭: list|manage|access|stats
let packStatsLoadSeq = 0;

function adminAuthHeader() {
  return state.admin?.token ? { Authorization: `Bearer ${state.admin.token}` } : {};
}

function isAdminAuthenticated() {
  return Boolean(state.admin?.authenticated && state.admin?.token);
}

function formatRelativeDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (!n) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function filterPacks(packs, query) {
  const q = (query || "").trim().toLowerCase();
  if (!q) return packs;
  return packs.filter((pack) => {
    const name = String(pack.name || "").toLowerCase();
    const desc = String(pack.description || "").toLowerCase();
    return name.includes(q) || desc.includes(q);
  });
}

function buildPackCard(pack) {
  const card = document.createElement("article");
  card.className = "pack-card";
  card.setAttribute("data-pack-id", pack.id);

  const header = document.createElement("header");
  header.className = "pack-card-header";

  const name = document.createElement("h3");
  name.className = "pack-card-name";
  name.textContent = pack.name || "이름 없는 지식팩";
  header.append(name);

  const desc = document.createElement("p");
  desc.className = "pack-card-description";
  desc.textContent = pack.description || "설명이 없습니다.";

  const meta = document.createElement("div");
  meta.className = "pack-card-meta";
  const docCount = Number(pack.documentCount || 0);
  const docSpan = document.createElement("span");
  docSpan.className = "pack-card-meta-item";
  docSpan.textContent = `문서 ${docCount}개`;
  meta.append(docSpan);
  const updatedAt = formatRelativeDate(pack.updatedAt);
  if (updatedAt) {
    const updatedSpan = document.createElement("span");
    updatedSpan.className = "pack-card-meta-item";
    updatedSpan.textContent = `업데이트 ${updatedAt}`;
    meta.append(updatedSpan);
  }

  const actions = document.createElement("div");
  actions.className = "pack-card-actions";

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "send-button pack-card-start";
  startButton.textContent = "이 지식팩으로 새 대화 시작";
  startButton.addEventListener("click", (event) => {
    event.stopPropagation();
    startRoomWithKnowledgePack(pack.id);
  });

  const detailButton = document.createElement("button");
  detailButton.type = "button";
  detailButton.className = "ghost-button pack-card-detail";
  detailButton.textContent = "문서 목록 보기";
  detailButton.addEventListener("click", (event) => {
    event.stopPropagation();
    openKnowledgePackDetail(pack.id);
  });

  actions.append(startButton, detailButton);

  // 카드 본체 클릭 시도 상세 진입.
  card.append(header, desc, meta, actions);
  card.addEventListener("click", () => openKnowledgePackDetail(pack.id));
  return card;
}

export function renderAccessSummary() {
  const label = getCurrentAccessLabel();
  if (elements.packAccessSummary) {
    elements.packAccessSummary.textContent = label;
  }
  if (elements.packSidebarAccess) {
    elements.packSidebarAccess.textContent = label;
  }
}

function applyListMode() {
  if (elements.packCardGrid) elements.packCardGrid.hidden = false;
  if (elements.packDetailPanel) {
    elements.packDetailPanel.hidden = true;
    elements.packDetailPanel.innerHTML = "";
  }
  // 빈 상태 표시는 renderKnowledgePackCards가 결정.
}

function applyDetailMode() {
  if (elements.packCardGrid) elements.packCardGrid.hidden = true;
  if (elements.packEmptyState) elements.packEmptyState.hidden = true;
  if (elements.packDetailPanel) elements.packDetailPanel.hidden = false;
}

export function renderKnowledgePackCards() {
  if (!elements.packCardGrid) return;
  if (packDetailMode) return; // 상세 화면 모드에서는 카드 렌더링 스킵.

  const packs = Array.isArray(state.notebooks) ? state.notebooks.slice() : [];
  const filtered = filterPacks(packs, packSearchQuery);

  elements.packCardGrid.innerHTML = "";

  if (filtered.length === 0) {
    if (elements.packEmptyState) {
      elements.packEmptyState.hidden = false;
      elements.packEmptyState.textContent = packs.length === 0
        ? "이용 가능한 지식팩이 없습니다. 권한을 확인하거나 관리자에게 문의하세요."
        : "검색 조건에 맞는 지식팩이 없습니다.";
    }
    return;
  }

  if (elements.packEmptyState) elements.packEmptyState.hidden = true;

  for (const pack of filtered) {
    elements.packCardGrid.append(buildPackCard(pack));
  }
}

export async function renderKnowledgePackPage() {
  renderAccessSummary();
  applyTabState();
  if (packActiveTab === "list") {
    if (packDetailMode && packDetailId) {
      renderDetailPanel(packDetailId);
    } else {
      applyListMode();
      renderKnowledgePackCards();
    }
  } else if (packActiveTab === "stats" && isAdminAuthenticated()) {
    renderInlineStats();
  }
  // 최신 목록 동기화 — 비동기, 백그라운드.
  try {
    await loadNotebooks();
    if (packActiveTab === "list" && !packDetailMode) renderKnowledgePackCards();
  } catch {
    /* loadNotebooks 자체가 내부에서 경고만 — 추가 처리 없음 */
  }
}

/* ===== 상세 화면 ===== */

function buildDetailHeader(pack, { onBack }) {
  const header = document.createElement("header");
  header.className = "pack-detail-header";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "ghost-button pack-detail-back";
  backButton.textContent = "← 목록";
  backButton.addEventListener("click", onBack);

  const titles = document.createElement("div");
  titles.className = "pack-detail-titles";
  const name = document.createElement("h3");
  name.className = "pack-detail-name";
  name.textContent = pack?.name || "지식팩";
  const desc = document.createElement("p");
  desc.className = "pack-detail-description";
  desc.textContent = pack?.description || "설명이 없습니다.";
  titles.append(name, desc);

  header.append(backButton, titles);
  return header;
}

function buildDetailMeta(pack) {
  const meta = document.createElement("div");
  meta.className = "pack-detail-meta";
  const docs = Array.isArray(pack?.documents) ? pack.documents : [];
  const docCount = docs.length || Number(pack?.documentCount || 0);
  const updatedAt = formatRelativeDate(pack?.updatedAt);
  const createdAt = formatRelativeDate(pack?.createdAt);

  const items = [
    docCount ? `문서 ${docCount}개` : "문서 없음",
    updatedAt ? `업데이트 ${updatedAt}` : null,
    createdAt ? `생성 ${createdAt}` : null
  ].filter(Boolean);

  for (const text of items) {
    const span = document.createElement("span");
    span.className = "pack-detail-meta-item";
    span.textContent = text;
    meta.append(span);
  }
  return meta;
}

function buildDetailActions(packId) {
  const wrap = document.createElement("div");
  wrap.className = "pack-detail-actions";

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "send-button pack-detail-start";
  startButton.textContent = "이 지식팩으로 새 대화 시작";
  startButton.addEventListener("click", () => startRoomWithKnowledgePack(packId));

  wrap.append(startButton);
  return wrap;
}

function buildDocumentList(documents) {
  const section = document.createElement("section");
  section.className = "pack-detail-docs";

  const heading = document.createElement("h4");
  heading.className = "pack-detail-section-title";
  heading.textContent = "문서 목록";
  section.append(heading);

  if (!Array.isArray(documents) || documents.length === 0) {
    const empty = document.createElement("p");
    empty.className = "pack-detail-docs-empty";
    empty.textContent = "등록된 문서가 없습니다.";
    section.append(empty);
    return section;
  }

  const list = document.createElement("ul");
  list.className = "pack-doc-list";
  for (const doc of documents) {
    const item = document.createElement("li");
    item.className = "pack-doc-item";

    const name = document.createElement("span");
    name.className = "pack-doc-name";
    name.textContent = doc.name || "이름 없는 문서";

    const meta = document.createElement("span");
    meta.className = "pack-doc-meta";
    const parts = [
      doc.type ? String(doc.type).toUpperCase() : null,
      formatBytes(doc.sizeBytes),
      doc.chunkCount ? `청크 ${doc.chunkCount}` : null,
      formatRelativeDate(doc.addedAt)
    ].filter(Boolean);
    meta.textContent = parts.join(" · ");

    item.append(name, meta);
    if (doc.summary) {
      const summary = document.createElement("p");
      summary.className = "pack-doc-summary";
      summary.textContent = doc.summary;
      item.append(summary);
    }
    list.append(item);
  }
  section.append(list);
  return section;
}

function renderDetailLoadingState(packId) {
  if (!elements.packDetailPanel) return;
  const pack = (state.notebooks || []).find((nb) => nb.id === packId);

  elements.packDetailPanel.innerHTML = "";
  elements.packDetailPanel.append(buildDetailHeader(pack, { onBack: closeKnowledgePackDetail }));
  elements.packDetailPanel.append(buildDetailMeta(pack));
  elements.packDetailPanel.append(buildDetailActions(packId));

  const loading = document.createElement("div");
  loading.className = "pack-detail-loading";
  loading.textContent = "문서 목록을 불러오는 중...";
  elements.packDetailPanel.append(loading);
}

function renderDetailContent(pack) {
  if (!elements.packDetailPanel) return;
  elements.packDetailPanel.innerHTML = "";
  elements.packDetailPanel.append(buildDetailHeader(pack, { onBack: closeKnowledgePackDetail }));
  elements.packDetailPanel.append(buildDetailMeta(pack));
  elements.packDetailPanel.append(buildDetailActions(pack.id));
  elements.packDetailPanel.append(buildDocumentList(pack.documents));
}

function renderDetailError(packId, message) {
  if (!elements.packDetailPanel) return;
  const pack = (state.notebooks || []).find((nb) => nb.id === packId);
  elements.packDetailPanel.innerHTML = "";
  elements.packDetailPanel.append(buildDetailHeader(pack, { onBack: closeKnowledgePackDetail }));

  const err = document.createElement("div");
  err.className = "pack-detail-error";
  err.textContent = message || "지식팩 상세 정보를 불러오지 못했습니다.";
  elements.packDetailPanel.append(err);
}

async function renderDetailPanel(packId) {
  if (!elements.packDetailPanel) return;
  applyDetailMode();
  renderDetailLoadingState(packId);

  const seq = ++packDetailLoadSeq;
  try {
    const response = await fetch(`/api/notebooks/${encodeURIComponent(packId)}`, {
      headers: accessAuthHeaders()
    });
    if (seq !== packDetailLoadSeq) return; // 다른 요청에 의해 취소됨
    if (response.status === 401 || response.status === 403) {
      renderDetailError(packId, "이 지식팩을 볼 권한이 없습니다.");
      return;
    }
    if (response.status === 404) {
      renderDetailError(packId, "지식팩을 찾을 수 없습니다.");
      return;
    }
    if (!response.ok) {
      renderDetailError(packId, "지식팩 정보를 불러오지 못했습니다.");
      return;
    }
    const result = await response.json().catch(() => ({}));
    const pack = result?.notebook;
    if (!pack) {
      renderDetailError(packId);
      return;
    }
    renderDetailContent(pack);
  } catch (error) {
    if (seq !== packDetailLoadSeq) return;
    renderDetailError(packId, `지식팩 정보를 불러오지 못했습니다: ${error.message}`);
  }
}

export function openKnowledgePackDetail(packId) {
  if (!packId) return;
  packDetailMode = true;
  packDetailId = packId;
  renderDetailPanel(packId);
}

export function closeKnowledgePackDetail() {
  packDetailMode = false;
  packDetailId = null;
  packDetailLoadSeq += 1; // 진행 중 요청 무효화
  applyListMode();
  renderKnowledgePackCards();
}

/**
 * 카드의 "이 지식팩으로 새 대화 시작" 핸들러.
 * 새 room을 생성하고 selectedNotebookId를 자동 연결, 대화 뷰로 전환한다.
 */
export function startRoomWithKnowledgePack(packId) {
  const pack = (state.notebooks || []).find((nb) => nb.id === packId);
  if (!pack) {
    // 목록이 stale일 수 있으므로 한 번 더 새로고침 후 안내.
    loadNotebooks().finally(() => {
      const retry = (state.notebooks || []).find((nb) => nb.id === packId);
      if (retry) startRoomWithKnowledgePack(packId);
    });
    return;
  }

  // 상세 화면이 열려 있더라도 새 대화로 전환하므로 상세 상태 정리.
  packDetailMode = false;
  packDetailId = null;

  const room = createRoomFromKnowledgePack(pack);
  state.rooms.unshift(room);
  state.activeRoomId = room.id;
  state.activeView = "chat";

  scheduleSave();
  window.dispatchEvent(new CustomEvent("myai:viewchange", { detail: { view: "chat" } }));
  window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  window.dispatchEvent(new CustomEvent("myai:renderall"));
  window.dispatchEvent(new CustomEvent("myai:roomchange", { detail: { roomId: room.id } }));
}

/* ===== 탭 (목록 / 관리 / 권한 / 통계) ===== */

function applyTabState() {
  const tabs = elements.packTabs || [];
  for (const tab of tabs) {
    const key = tab.dataset.packTab;
    const isActive = key === packActiveTab;
    tab.classList.toggle("active", isActive);
    tab.setAttribute("aria-selected", isActive ? "true" : "false");
    // 관리자 전용 탭: 인증 여부에 따라 잠금 표시.
    if (tab.dataset.adminOnly === "true") {
      tab.classList.toggle("locked", !isAdminAuthenticated());
    }
  }
  const panels = elements.packTabPanels || [];
  for (const panel of panels) {
    panel.hidden = panel.dataset.packTabPanel !== packActiveTab;
  }
  if (elements.packManageAuthHint) {
    elements.packManageAuthHint.hidden = isAdminAuthenticated();
  }
}

export function switchKnowledgePackTab(tabKey) {
  const allowed = new Set(["list", "manage", "access", "stats"]);
  packActiveTab = allowed.has(tabKey) ? tabKey : "list";
  applyTabState();
  if (packActiveTab === "list") {
    if (packDetailMode && packDetailId) renderDetailPanel(packDetailId);
    else { applyListMode(); renderKnowledgePackCards(); }
  } else if (packActiveTab === "stats" && isAdminAuthenticated()) {
    renderInlineStats();
  }
}

async function renderInlineStats() {
  const container = elements.packStatsInline;
  if (!container) return;
  container.innerHTML = "<div class='pack-stats-loading'>통계를 불러오는 중...</div>";
  const seq = ++packStatsLoadSeq;
  try {
    const response = await fetch("/api/admin/stats/notebooks?range=30d", { headers: adminAuthHeader() });
    if (seq !== packStatsLoadSeq) return;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json().catch(() => ({}));
    if (seq !== packStatsLoadSeq) return;
    const rows = Array.isArray(result?.notebooks) ? result.notebooks : [];
    if (!rows.length) {
      container.innerHTML = "<div class='pack-stats-empty'>최근 30일 사용 기록이 없습니다.</div>";
      return;
    }
    const top = rows.slice(0, 10);
    container.innerHTML = "";
    const heading = document.createElement("h4");
    heading.className = "pack-stats-heading";
    heading.textContent = "지식팩별 사용량 (최근 30일, Top 10)";
    container.append(heading);
    const table = document.createElement("table");
    table.className = "pack-stats-table";
    table.innerHTML = "<thead><tr><th>#</th><th>지식팩</th><th>쿼리</th><th>세션</th></tr></thead>";
    const tbody = document.createElement("tbody");
    top.forEach((row, idx) => {
      const tr = document.createElement("tr");
      const nb = (state.notebooks || []).find((n) => n.id === row.notebookId);
      const name = nb?.name || row.notebookId;
      tr.innerHTML = `<td>${idx + 1}</td><td>${escapeHtml(name)}</td><td>${row.queryCount || 0}</td><td>${row.uniqueSessions || 0}</td>`;
      tbody.append(tr);
    });
    table.append(tbody);
    container.append(table);
  } catch (error) {
    if (seq !== packStatsLoadSeq) return;
    container.innerHTML = `<div class='pack-stats-error'>통계 로드 실패: ${escapeHtml(error.message)}</div>`;
  }
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch]));
}

export function bindKnowledgePackEvents() {
  if (packEventsBound) return;
  packEventsBound = true;

  if (elements.packSearchInput) {
    elements.packSearchInput.addEventListener("input", (event) => {
      packSearchQuery = event.target.value || "";
      // 검색 시 자연스럽게 목록 탭/화면으로 복귀.
      if (packActiveTab !== "list") {
        switchKnowledgePackTab("list");
      } else if (packDetailMode) closeKnowledgePackDetail();
      else renderKnowledgePackCards();
    });
  }

  if (elements.packRefreshButton) {
    elements.packRefreshButton.addEventListener("click", async () => {
      elements.packRefreshButton.disabled = true;
      try {
        await loadNotebooks();
        if (packDetailMode && packDetailId) renderDetailPanel(packDetailId);
        else renderKnowledgePackCards();
      } finally {
        elements.packRefreshButton.disabled = false;
      }
    });
  }

  // 탭 클릭
  for (const tab of elements.packTabs || []) {
    tab.addEventListener("click", () => {
      const key = tab.dataset.packTab;
      if (key === "list") {
        switchKnowledgePackTab("list");
        return;
      }
      // 관리자 탭은 클릭 시 settings admin 콘솔로 진입.
      switchKnowledgePackTab(key);
      const panelMap = { manage: "notebooks", access: "access", stats: "stats" };
      const adminPanel = panelMap[key];
      if (adminPanel) openSettingsAdminPanel(adminPanel);
    });
  }

  if (elements.packOpenAdminNotebooksButton) {
    elements.packOpenAdminNotebooksButton.addEventListener("click", () => openSettingsAdminPanel("notebooks"));
  }
  if (elements.packOpenAdminAccessButton) {
    elements.packOpenAdminAccessButton.addEventListener("click", () => openSettingsAdminPanel("access"));
  }
  if (elements.packOpenAdminStatsButton) {
    elements.packOpenAdminStatsButton.addEventListener("click", () => openSettingsAdminPanel("stats"));
  }

  // 접근 상태가 바뀌면 권한 라벨도 갱신.
  window.addEventListener("myai:viewchange", (event) => {
    if (event?.detail?.view === "knowledge") {
      renderAccessSummary();
      applyTabState();
    }
  });

  // ESC로 상세 닫기.
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && packDetailMode && state.activeView === "knowledge") {
      event.preventDefault();
      closeKnowledgePackDetail();
    }
  });

  // 초기 탭 상태 적용.
  applyTabState();
}
