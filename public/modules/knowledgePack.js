/**
 * 지식팩 (Knowledge Pack) — myAI 주 메뉴 페이지
 *
 * 사용자가 권한에 따라 접근 가능한 지식팩 목록을 보여주고,
 * "이 지식팩으로 새 대화 시작" 흐름의 진입점이 된다.
 *
 * 관리자용 메뉴(지식팩 관리/권한 관리/사용 통계)는 이 화면에서 제외되어
 * 설정 → 관리자 콘솔에서만 노출된다. 권한 인증 UI는 좌측 보조 패널에 위치한다.
 *
 * 내부 데이터 모델은 기존 notebook 그대로 사용한다 — notebookId,
 * /api/notebooks API, selectedNotebookId 필드를 모두 재사용한다.
 * 본 모듈은 사용자 노출 레이어만 담당한다.
 */

import { state, elements, accessAuthHeaders, createRoomFromKnowledgePack } from "./state.js";
import { scheduleSave } from "./persistence.js";
import { loadNotebooks, getCurrentAccessLabel, openNotebookSelector } from "./notebook.js";
import { escapeHtml } from "./html.js";
import { renderStudio } from "./studio.js";

let packSearchQuery = "";
let packEventsBound = false;
let packDetailMode = false;
let packDetailId = null;
let packDetailLoadSeq = 0;

function reportUsageEvent(eventType, notebookId) {
  try {
    fetch("/api/usage/event", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...accessAuthHeaders() },
      body: JSON.stringify({ eventType, notebookId: notebookId || null }),
      keepalive: true
    }).catch(() => {});
  } catch { /* swallow */ }
}

let lastPageViewReportedAt = 0;
const PAGE_VIEW_THROTTLE_MS = 30_000;

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

const PACK_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"></path><path d="M5 17a3 3 0 0 1 3-3h11" fill="none" stroke="currentColor" stroke-width="1.6"></path></svg>`;
const CHEVRON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>`;
const CHAT_PLUS_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.5 8.5 0 0 1-12.3 7.6L3 21l1.9-5.7A8.5 8.5 0 1 1 21 11.5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"></path><path d="M12 8v7M8.5 11.5h7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"></path></svg>`;
const DOC_ICON_SVG = `<svg class="pack-card-doc-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>`;

function buildPackCard(pack) {
  const card = document.createElement("article");
  card.className = "pack-card";
  card.setAttribute("data-pack-id", pack.id);
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${pack.name || "지식팩"} 상세 보기`);

  // 우상단 hover 시 나타나는 셰브론 — 카드 클릭으로 상세가 열림을 암시.
  const arrow = document.createElement("span");
  arrow.className = "pack-card-arrow";
  arrow.setAttribute("aria-hidden", "true");
  arrow.innerHTML = CHEVRON_SVG;

  const top = document.createElement("div");
  top.className = "pack-card-top";

  const icon = document.createElement("span");
  icon.className = "pack-card-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.innerHTML = PACK_ICON_SVG;

  const headings = document.createElement("div");
  headings.className = "pack-card-headings";

  const name = document.createElement("h3");
  name.className = "pack-card-name";
  name.textContent = pack.name || "이름 없는 지식팩";

  const desc = document.createElement("p");
  desc.className = "pack-card-description";
  desc.textContent = pack.description || "설명이 없습니다.";

  headings.append(name, desc);
  top.append(icon, headings);

  const footer = document.createElement("div");
  footer.className = "pack-card-footer";

  const docCount = Number(pack.documentCount || 0);
  const docSpan = document.createElement("span");
  docSpan.className = "pack-card-doc-count";
  docSpan.innerHTML = `${DOC_ICON_SVG}<span>${docCount}</span>`;

  const startButton = document.createElement("button");
  startButton.type = "button";
  startButton.className = "pack-card-start";
  startButton.innerHTML = `${CHAT_PLUS_SVG}<span>새 대화 시작</span>`;
  startButton.addEventListener("click", (event) => {
    event.stopPropagation();
    startRoomWithKnowledgePack(pack.id);
  });

  footer.append(docSpan, startButton);

  card.append(arrow, top, footer);

  const open = () => openKnowledgePackDetail(pack.id);
  card.addEventListener("click", open);
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  });
  return card;
}

/**
 * 좌측 사이드바의 권한 인증 카드를 렌더링한다.
 * 현재 권한 라벨 + (필요 시) 권한 인증/변경 버튼을 노출한다.
 */
export function renderAccessSummary() {
  const container = elements.packSidebarAccess;
  if (!container) return;

  container.innerHTML = "";

  const label = getCurrentAccessLabel();
  const statusLine = document.createElement("div");
  statusLine.className = "pack-access-card-status";

  const dot = document.createElement("span");
  dot.className = "pack-access-card-dot";
  if (state.access.authenticated) dot.classList.add("on");
  else if (state.access.configured) dot.classList.add("warn");
  else dot.classList.add("off");
  statusLine.append(dot);

  const labelText = document.createElement("span");
  labelText.className = "pack-access-card-label";
  
  if (state.access.authenticated && state.access.user) {
    const user = state.access.user;
    const GROUP_ICON_SVG = `<svg class="pack-access-icon" viewBox="0 0 24 24" aria-hidden="true" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 4px; display: inline-block;"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><path d="M23 21v-2a4 4 0 0 0-3-3.87"></path><path d="M16 3.13a4 4 0 0 1 0 7.75"></path></svg>`;
    const LEVEL_ICON_SVG = `<svg class="pack-access-icon" viewBox="0 0 24 24" aria-hidden="true" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-left: 16px; margin-right: 4px; display: inline-block;"><circle cx="12" cy="8" r="7"></circle><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"></polyline></svg>`;
    
    const groupText = user.super ? "Super" : (user.groupName || user.groupId);
    const levelTextStr = `Level ${user.level}`;
    
    labelText.innerHTML = `${GROUP_ICON_SVG}<span>${escapeHtml(groupText)}</span>${LEVEL_ICON_SVG}<span>${levelTextStr}</span>`;
  } else {
    labelText.textContent = label;
  }
  
  statusLine.append(labelText);
  container.append(statusLine);

  if (state.access.configured) {
    if (!state.access.authenticated) {
      const hint = document.createElement("p");
      hint.className = "pack-access-card-hint";
      hint.textContent = "지식팩을 사용하려면 등급을 선택하고 로그인하세요.";
      container.append(hint);
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = state.access.authenticated ? "ghost-button pack-access-card-btn" : "send-button pack-access-card-btn";
    if (state.access.authenticated) {
      const KEY_ICON_SVG = `<svg class="pack-access-btn-icon" viewBox="0 0 24 24" aria-hidden="true" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 6px; display: inline-block; vertical-align: middle;"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path></svg>`;
      btn.innerHTML = `${KEY_ICON_SVG}<span>권한 변경</span>`;
    } else {
      btn.textContent = "권한 인증";
    }
    btn.addEventListener("click", () => {
      openNotebookSelector({ hideList: true });
    });
    container.append(btn);
  } else {
    const hint = document.createElement("p");
    hint.className = "pack-access-card-hint";
    hint.textContent = "권한 인증이 비활성화되어 모든 지식팩에 접근할 수 있습니다.";
    container.append(hint);
  }
}

export function renderPackSummary() {
  const summaryEl = document.getElementById("packSummary");
  if (!summaryEl) return;

  const count = Array.isArray(state.notebooks) ? state.notebooks.length : 0;
  const FOLDER_ICON_SVG = `<svg class="pack-summary-icon" viewBox="0 0 24 24" aria-hidden="true" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align: middle; margin-right: 6px; display: inline-block; color: var(--accent);"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>`;

  summaryEl.innerHTML = `${FOLDER_ICON_SVG}<span style="font-size: 13.5px; font-weight: 500; color: var(--ink); vertical-align: middle;">열람 가능한 지식팩 <strong style="color: var(--accent); font-weight: 600;">${count}</strong>건</span>`;
}

function applyListMode() {
  if (elements.packCardGrid) {
    elements.packCardGrid.hidden = false;
    elements.packCardGrid.classList.remove("fade-in-up");
    void elements.packCardGrid.offsetWidth; // trigger reflow
    elements.packCardGrid.classList.add("fade-in-up");
  }
  if (elements.packDetailPanel) {
    elements.packDetailPanel.hidden = true;
    elements.packDetailPanel.innerHTML = "";
    elements.packDetailPanel.classList.remove("fade-in-up");
  }
}

function applyDetailMode() {
  if (elements.packCardGrid) {
    elements.packCardGrid.hidden = true;
    elements.packCardGrid.classList.remove("fade-in-up");
  }
  if (elements.packEmptyState) elements.packEmptyState.hidden = true;
  if (elements.packDetailPanel) {
    elements.packDetailPanel.hidden = false;
    elements.packDetailPanel.classList.remove("fade-in-up");
    void elements.packDetailPanel.offsetWidth; // trigger reflow
    elements.packDetailPanel.classList.add("fade-in-up");
  }
}

export function renderKnowledgePackCards() {
  if (!elements.packCardGrid) return;
  if (packDetailMode) return;

  const packs = Array.isArray(state.notebooks) ? state.notebooks.slice() : [];
  const filtered = filterPacks(packs, packSearchQuery);

  elements.packCardGrid.innerHTML = "";

  if (filtered.length === 0) {
    if (elements.packEmptyState) {
      elements.packEmptyState.hidden = false;
      elements.packEmptyState.innerHTML = "";

      const p = document.createElement("p");
      p.className = "pack-empty-text";
      p.textContent = packs.length === 0
        ? "이용 가능한 지식팩이 없습니다. 좌측 권한 패널에서 인증하거나 관리자에게 문의하세요."
        : "검색 조건에 맞는 지식팩이 없습니다.";
      elements.packEmptyState.append(p);

      if (packs.length === 0 && state.access.configured && !state.access.authenticated) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "send-button pack-empty-login-btn";
        btn.style.marginTop = "12px";
        btn.textContent = "권한 인증하기";
        btn.addEventListener("click", () => {
          openNotebookSelector({ hideList: true });
        });
        elements.packEmptyState.append(btn);
      }
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
  renderPackSummary();
  const now = Date.now();
  if (now - lastPageViewReportedAt > PAGE_VIEW_THROTTLE_MS) {
    lastPageViewReportedAt = now;
    reportUsageEvent("pack_page_view", null);
  }
  if (packDetailMode && packDetailId) {
    renderDetailPanel(packDetailId);
  } else {
    applyListMode();
    renderKnowledgePackCards();
  }
  try {
    await loadNotebooks();
    renderPackSummary();
    if (!packDetailMode) renderKnowledgePackCards();
  } catch {
    /* loadNotebooks 내부에서 경고 — 추가 처리 없음 */
  }
}

/* ===== 상세 화면 ===== */

function buildDetailHeader(pack, { onBack }) {
  const header = document.createElement("header");
  header.className = "pack-detail-header";

  const backButton = document.createElement("button");
  backButton.type = "button";
  backButton.className = "ghost-button pack-detail-back";
  backButton.textContent = "< 목록";
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
  startButton.className = "pack-card-start pack-detail-start";
  startButton.innerHTML = `${CHAT_PLUS_SVG}<span>새 대화 시작</span>`;
  startButton.addEventListener("click", () => startRoomWithKnowledgePack(packId));

  wrap.append(startButton);
  return wrap;
}

function getFileIconSvg(type) {
  const t = String(type || "").toLowerCase();
  if (t === "pdf") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 15h6M9 12h6"/></svg>`;
  }
  if (t === "xlsx" || t === "xls" || t === "csv") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M8 13h8v4H8z"/></svg>`;
  }
  if (t === "docx" || t === "doc") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><path d="M9 14h6M9 17h4"/></svg>`;
  }
  if (t === "hwpx" || t === "hwp") {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><circle cx="12" cy="14" r="2"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`;
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

    const docType = String(doc.type || "").toLowerCase();
    const validFmts = ["pdf", "docx", "xlsx", "csv", "hwpx"];
    const fmtClass = validFmts.includes(docType) ? docType : "other";

    const iconContainer = document.createElement("span");
    iconContainer.className = `pack-doc-icon-container fmt-${fmtClass}`;
    iconContainer.innerHTML = getFileIconSvg(docType);
    iconContainer.setAttribute("aria-hidden", "true");
    item.append(iconContainer);

    const details = document.createElement("div");
    details.className = "pack-doc-details";

    const name = document.createElement("span");
    name.className = "pack-doc-name";
    name.textContent = doc.name || "이름 없는 문서";
    details.append(name);

    const meta = document.createElement("span");
    meta.className = "pack-doc-meta";
    const parts = [
      doc.type ? String(doc.type).toUpperCase() : null,
      formatBytes(doc.sizeBytes),
      doc.chunkCount ? `청크 ${doc.chunkCount}` : null,
      formatRelativeDate(doc.addedAt)
    ].filter(Boolean);
    meta.textContent = parts.join(" · ");
    details.append(meta);

    if (doc.summary) {
      const summary = document.createElement("p");
      summary.className = "pack-doc-summary";
      summary.textContent = doc.summary;
      details.append(summary);
    }

    item.append(details);
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
    if (seq !== packDetailLoadSeq) return;
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
  state.activeKnowledgePackId = packId;
  renderDetailPanel(packId);
  renderStudio();
}

export function closeKnowledgePackDetail() {
  packDetailMode = false;
  packDetailId = null;
  state.activeKnowledgePackId = null;
  packDetailLoadSeq += 1;
  applyListMode();
  renderKnowledgePackCards();
  renderStudio();
}

export function startRoomWithKnowledgePack(packId) {
  const pack = (state.notebooks || []).find((nb) => nb.id === packId);
  if (!pack) {
    loadNotebooks().finally(() => {
      const retry = (state.notebooks || []).find((nb) => nb.id === packId);
      if (retry) startRoomWithKnowledgePack(packId);
    });
    return;
  }

  packDetailMode = false;
  packDetailId = null;
  state.activeKnowledgePackId = null;

  const room = createRoomFromKnowledgePack(pack);
  state.rooms.unshift(room);
  state.activeRoomId = room.id;
  state.activeView = "chat";

  reportUsageEvent("pack_room_started", pack.id);

  scheduleSave();
  window.dispatchEvent(new CustomEvent("myai:viewchange", { detail: { view: "chat" } }));
  window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  window.dispatchEvent(new CustomEvent("myai:renderall"));
  window.dispatchEvent(new CustomEvent("myai:roomchange", { detail: { roomId: room.id } }));
}

export function bindKnowledgePackEvents() {
  if (packEventsBound) return;
  packEventsBound = true;

  if (elements.packSearchInput) {
    elements.packSearchInput.addEventListener("input", (event) => {
      packSearchQuery = event.target.value || "";
      if (packDetailMode) closeKnowledgePackDetail();
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

  window.addEventListener("myai:viewchange", (event) => {
    if (event?.detail?.view === "knowledge") {
      renderAccessSummary();
    }
  });

  window.addEventListener("myai:notebooksloaded", () => {
    if (state.activeView === "knowledge") {
      renderAccessSummary();
      renderPackSummary();
      if (!packDetailMode) renderKnowledgePackCards();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && packDetailMode && state.activeView === "knowledge") {
      event.preventDefault();
      closeKnowledgePackDetail();
    }
  });
}
