import { state, elements, accessAuthHeaders, getActiveRoom, showConfirmDialog } from "./state.js";
import { scheduleSave } from "./persistence.js";
import { bindRagEvalEvents, showAdminRagEvalPanel as activateRagEvalPanel } from "./ragEval.js";
import { bindStatsEvents, showAdminStatsPanel as activateStatsPanel, hideAdminStatsPanel } from "./adminStats.js";

const ADMIN_TOKEN_SESSION_KEY = "myai_admin_token";
const ACCESS_TOKEN_SESSION_KEY = "myai_access_token";

let adminDetailSaveTimer = null;
const ADMIN_INGEST_POLL_MS = 1200;
const ADMIN_INGEST_MAX_POLLS = 900;

export const adminUiState = {
  notebooks: [],
  selectedId: null,
  selectedNotebook: null,
  mobileView: "list",
  activePanel: "notebooks",
  accessConfig: null,
  accessActiveTab: "groups",
  selectedAccessGroupId: null,
  accessGroupSearch: ""
};

// ===== Notebook selector =====

export async function loadNotebooks() {
  try {
    const response = await fetch("/api/notebooks", { headers: accessAuthHeaders() });
    if (!response.ok) return;
    const result = await response.json();
    state.notebooks = Array.isArray(result.notebooks) ? result.notebooks : [];
    const room = getActiveRoom();
    if (room?.selectedNotebookId && !state.notebooks.some((nb) => nb.id === room.selectedNotebookId)) {
      room.selectedNotebookId = null;
      room.updatedAt = new Date().toISOString();
      scheduleSave();
    }
    renderActiveNotebookUi();
    window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  } catch (error) {
    console.warn("프로젝트 목록을 불러오지 못했습니다:", error.message);
  }
}

export async function loadAdminStatus() {
  try {
    const response = await fetch("/api/admin/status");
    if (!response.ok) return;
    const result = await response.json();
    state.admin.configured = Boolean(result.configured);
  } catch {
    state.admin.configured = false;
  }
  renderAdminEntry();
}

export function restoreAdminTokenSession() {
  try {
    const stored = sessionStorage.getItem(ADMIN_TOKEN_SESSION_KEY);
    if (stored) {
      state.admin.token = stored;
      state.admin.authenticated = true;
    }
  } catch { /* sessionStorage may be blocked */ }
  renderAdminEntry();
}

export function restoreAccessSession() {
  try {
    const stored = sessionStorage.getItem(ACCESS_TOKEN_SESSION_KEY);
    if (stored) {
      state.access.token = stored;
      state.access.authenticated = true;
    }
  } catch { /* sessionStorage may be blocked */ }
  refreshAccessStatus().then(() => loadNotebooks()).catch(() => {});
}

async function refreshAccessStatus() {
  try {
    const response = await fetch("/api/access/status", { headers: accessAuthHeaders() });
    if (!response.ok) return;
    const result = await response.json();
    state.access.configured = Boolean(result.configured);
    state.access.authenticated = Boolean(result.authenticated && result.access);
    state.access.user = result.access || null;
    if (!state.access.authenticated) {
      state.access.token = null;
      try { sessionStorage.removeItem(ACCESS_TOKEN_SESSION_KEY); } catch { /* ignore */ }
    }
  } catch {
    state.access.configured = false;
  }
  renderAccessPanel();
  renderActiveNotebookUi();
}

async function loadAccessOptions() {
  try {
    const response = await fetch("/api/access/options");
    if (!response.ok) return;
    const result = await response.json();
    state.access.options = {
      groups: Array.isArray(result.groups) ? result.groups : [],
      super: result.super || { enabled: false }
    };
  } catch {
    state.access.options = { groups: [], super: { enabled: false } };
  }
  renderAccessPanel();
}

function currentAccessLabel() {
  const user = state.access.user;
  if (!state.access.configured) return "권한 인증 비활성";
  if (!user) return "권한 없음";
  if (user.super) return "현재 권한: Super";
  return `현재 권한: ${user.groupName || user.groupId} / Level ${user.level}`;
}

function renderAccessPanel() {
  if (!elements.notebookAccessPanel) return;
  elements.notebookAccessPanel.hidden = !state.access.configured;
  if (!state.access.configured) return;

  if (elements.notebookAccessCurrent) elements.notebookAccessCurrent.textContent = currentAccessLabel();
  if (elements.accessLogoutButton) elements.accessLogoutButton.hidden = !state.access.authenticated;
  if (elements.accessLoginButton) elements.accessLoginButton.hidden = state.access.authenticated;
  if (elements.accessPasswordInput) elements.accessPasswordInput.hidden = state.access.authenticated;
  if (elements.accessGroupSelect) elements.accessGroupSelect.hidden = state.access.authenticated;
  if (elements.accessLevelSelect) elements.accessLevelSelect.hidden = state.access.authenticated;
  if (elements.accessSuperInput) elements.accessSuperInput.closest("label").hidden = state.access.authenticated || !state.access.options?.super?.enabled;
  renderAccessOptions();
}

function renderAccessOptions() {
  if (!elements.accessGroupSelect || !elements.accessLevelSelect) return;
  const groups = state.access.options?.groups || [];
  const previousGroup = elements.accessGroupSelect.value;
  elements.accessGroupSelect.innerHTML = "";
  for (const group of groups) {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.name || group.id;
    elements.accessGroupSelect.append(option);
  }
  if (previousGroup && groups.some((group) => group.id === previousGroup)) {
    elements.accessGroupSelect.value = previousGroup;
  }
  renderAccessLevelOptions();
}

function renderAccessLevelOptions() {
  if (!elements.accessGroupSelect || !elements.accessLevelSelect) return;
  const selectedGroup = state.access.options?.groups?.find((group) => group.id === elements.accessGroupSelect.value);
  const levels = selectedGroup?.levels?.length ? selectedGroup.levels : [1, 2, 3];
  const previousLevel = elements.accessLevelSelect.value;
  elements.accessLevelSelect.innerHTML = "";
  for (const level of levels) {
    const option = document.createElement("option");
    option.value = String(level);
    option.textContent = `Level ${level}`;
    elements.accessLevelSelect.append(option);
  }
  if (previousLevel && levels.includes(Number(previousLevel))) {
    elements.accessLevelSelect.value = previousLevel;
  }
}

async function submitAccessLogin() {
  if (elements.accessError) elements.accessError.hidden = true;
  const superLogin = Boolean(elements.accessSuperInput?.checked);
  const payload = superLogin
    ? { super: true, password: elements.accessPasswordInput?.value || "" }
    : {
        groupId: elements.accessGroupSelect?.value || "",
        level: Number(elements.accessLevelSelect?.value || 1),
        password: elements.accessPasswordInput?.value || ""
      };
  try {
    const response = await fetch("/api/access/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.token) throw new Error(result.error || "권한 인증에 실패했습니다.");
    state.access.token = result.token;
    state.access.authenticated = true;
    state.access.user = result.access || null;
    try { sessionStorage.setItem(ACCESS_TOKEN_SESSION_KEY, result.token); } catch { /* ignore */ }
    if (elements.accessPasswordInput) elements.accessPasswordInput.value = "";
    await refreshAccessStatus();
    await loadNotebooks();
    renderNotebookSelectorList();
  } catch (error) {
    if (elements.accessError) {
      elements.accessError.textContent = error.message;
      elements.accessError.hidden = false;
    }
  }
}

async function logoutAccess() {
  state.access.token = null;
  state.access.authenticated = false;
  state.access.user = null;
  try { sessionStorage.removeItem(ACCESS_TOKEN_SESSION_KEY); } catch { /* ignore */ }
  await fetch("/api/access/logout", { method: "POST" }).catch(() => {});
  await refreshAccessStatus();
  await loadNotebooks();
  renderNotebookSelectorList();
}

export function findNotebookSummary(notebookId) {
  if (!notebookId) return null;
  return state.notebooks.find((nb) => nb.id === notebookId) ?? null;
}

export function getActiveNotebookId() {
  return getActiveRoom()?.selectedNotebookId ?? null;
}

export function renderActiveNotebookUi() {
  // Active notebook state is rendered in the composer material panel.
}

export async function openNotebookSelector() {
  if (!elements.notebookSelectorDialog) return;
  // Close attach menu via custom event
  window.dispatchEvent(new CustomEvent("myai:closeattachmenu"));
  await refreshAccessStatus();
  await loadAccessOptions();
  await loadNotebooks();
  renderNotebookSelectorList();
  if (!elements.notebookSelectorDialog.open) elements.notebookSelectorDialog.showModal();
}

export function closeNotebookSelector() {
  if (elements.notebookSelectorDialog?.open) elements.notebookSelectorDialog.close();
}

function renderNotebookSelectorList() {
  if (!elements.notebookList) return;
  elements.notebookList.innerHTML = "";
  const activeId = getActiveNotebookId();

  elements.notebookList.append(buildNotebookListItem({
    id: null,
    name: "사용 안 함",
    description: "일반 대화 모드",
    isOff: true,
    isActive: !activeId
  }, () => { selectNotebook(null); closeNotebookSelector(); }));

  if (state.notebooks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "notebook-list-empty";
    empty.textContent = "등록된 프로젝트이 없습니다.";
    elements.notebookList.append(empty);
    return;
  }

  for (const notebook of state.notebooks) {
    elements.notebookList.append(buildNotebookListItem({
      id: notebook.id,
      name: notebook.name,
      description: notebook.description,
      meta: `문서 ${notebook.documentCount ?? 0}`,
      isActive: notebook.id === activeId
    }, () => { selectNotebook(notebook.id); closeNotebookSelector(); }));
  }
}

function buildNotebookListItem(item, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "notebook-list-item";
  if (item.isOff) button.classList.add("notebook-list-item-off");
  if (item.isActive) button.classList.add("active");

  const content = document.createElement("div");
  content.className = "notebook-list-content";
  const name = document.createElement("span");
  name.className = "notebook-list-name";
  name.textContent = item.name;
  content.append(name);
  if (item.description) {
    const desc = document.createElement("span");
    desc.className = "notebook-list-description";
    desc.textContent = item.description;
    content.append(desc);
  }

  const trailing = document.createElement("span");
  trailing.className = "notebook-list-trailing";
  if (item.meta) {
    const meta = document.createElement("span");
    meta.className = "notebook-list-meta";
    meta.textContent = item.meta;
    trailing.append(meta);
  }
  const check = document.createElement("span");
  check.className = "notebook-list-check";
  check.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7"/></svg>`;
  trailing.append(check);
  button.append(content, trailing);
  button.addEventListener("click", onSelect);
  return button;
}

export function selectNotebook(notebookId) {
  const room = getActiveRoom();
  if (!room) return;
  const next = notebookId ? String(notebookId) : null;
  if (room.selectedNotebookId === next) { renderActiveNotebookUi(); return; }
  room.selectedNotebookId = next;
  room.updatedAt = new Date().toISOString();
  renderActiveNotebookUi();
  scheduleSave();
  window.dispatchEvent(new CustomEvent("myai:renderrooms"));
}

// ===== Admin panel =====

function adminAuthHeader() {
  return state.admin.token ? { Authorization: `Bearer ${state.admin.token}` } : {};
}

export function renderAdminEntry() {
  const status = state.admin.authenticated && state.admin.token
    ? "active"
    : state.admin.configured ? "locked" : "unavailable";
  if (elements.settingsAdminStatus) {
    elements.settingsAdminStatus.dataset.status = status;
  }
}

export function isAdminDialogOpen() {
  const adminPanel = document.getElementById("settingsPanelAdmin");
  return Boolean(elements.settingsDialog?.open && adminPanel && !adminPanel.hidden);
}

export function resetAdminFileInput() {
  if (elements.adminFileInput) elements.adminFileInput.value = "";
}

function setAdminHeaderMode(mode) {
  const contentMode = mode === "content";
  if (elements.adminNotebookDialog) elements.adminNotebookDialog.dataset.adminState = mode;
  if (elements.adminDialogTitleGroup) elements.adminDialogTitleGroup.hidden = contentMode;
  if (elements.adminConsoleNav) elements.adminConsoleNav.hidden = !contentMode;
  if (!contentMode) {
    if (elements.adminRefreshStatusButton) elements.adminRefreshStatusButton.hidden = true;
    if (elements.adminAccessRefreshButton) elements.adminAccessRefreshButton.hidden = true;
  }
}

export function requestAdminFileSelection() {
  if (!isAdminDialogOpen() || !adminUiState.selectedId || !elements.adminFileInput) return;
  resetAdminFileInput();
  elements.adminFileInput.click();
}

export async function renderAdminDialogState() {
  if (!state.admin.configured) { showAdminUnconfigured(); return; }
  if (state.admin.authenticated && state.admin.token) {
    showAdminContent();
    await refreshAdminAccessConfig();
    await refreshAdminNotebooks();
    return;
  }
  showAdminLogin();
}

export function closeAdminNotebookDialog() {
  resetAdminFileInput();
  if (elements.settingsDialog?.open) elements.settingsDialog.close();
}

function showAdminUnconfigured() {
  clearAdminDetailSaveTimer();
  setAdminHeaderMode("unconfigured");
  if (elements.adminUnconfiguredSection) elements.adminUnconfiguredSection.hidden = false;
  if (elements.adminAuthSection) elements.adminAuthSection.hidden = true;
  if (elements.adminWorkspace) elements.adminWorkspace.hidden = true;
  if (elements.adminLogoutButton) elements.adminLogoutButton.hidden = true;
  if (elements.adminDialogSubtitle) elements.adminDialogSubtitle.textContent = "서버 설정 필요";
  if (elements.adminTokenError) elements.adminTokenError.hidden = true;
}

function showAdminLogin() {
  clearAdminDetailSaveTimer();
  setAdminHeaderMode("login");
  if (elements.adminUnconfiguredSection) elements.adminUnconfiguredSection.hidden = true;
  if (elements.adminAuthSection) elements.adminAuthSection.hidden = false;
  if (elements.adminWorkspace) elements.adminWorkspace.hidden = true;
  if (elements.adminLogoutButton) elements.adminLogoutButton.hidden = true;
  if (elements.adminDialogSubtitle) elements.adminDialogSubtitle.textContent = "인증 필요";
  if (elements.adminTokenInput) { elements.adminTokenInput.value = ""; elements.adminTokenInput.disabled = false; }
  if (elements.adminTokenSubmitButton) elements.adminTokenSubmitButton.disabled = false;
  if (elements.adminTokenError) elements.adminTokenError.hidden = true;
  queueMicrotask(() => elements.adminTokenInput?.focus());
}

function showAdminContent() {
  setAdminHeaderMode("content");
  if (elements.adminUnconfiguredSection) elements.adminUnconfiguredSection.hidden = true;
  if (elements.adminAuthSection) elements.adminAuthSection.hidden = true;
  if (elements.adminWorkspace) elements.adminWorkspace.hidden = false;
  if (elements.adminLogoutButton) elements.adminLogoutButton.hidden = false;
  if (elements.adminDialogSubtitle) elements.adminDialogSubtitle.textContent = "";
  if (!adminUiState.activePanel) adminUiState.activePanel = "notebooks";
  renderAdminConsoleNav();
  applyAdminMobileView();
  renderAdminList();
  renderAdminDetail();
}

export async function submitAdminToken() {
  const token = (elements.adminTokenInput?.value ?? "").trim();
  if (!token) { showAdminTokenError("토큰을 입력하세요."); return; }
  try {
    const response = await fetch("/api/admin/verify", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok) { showAdminTokenError("인증 실패. 토큰을 확인하세요."); return; }
    state.admin.token = token;
    state.admin.authenticated = true;
    try { sessionStorage.setItem(ADMIN_TOKEN_SESSION_KEY, token); } catch { /* ignore */ }
    renderAdminEntry();
    showAdminContent();
    await refreshAdminAccessConfig();
    await refreshAdminNotebooks();
  } catch (error) {
    showAdminTokenError(`인증 요청 실패: ${error.message}`);
  }
}

function showAdminTokenError(message) {
  if (!elements.adminTokenError) return;
  elements.adminTokenError.textContent = message;
  elements.adminTokenError.hidden = false;
}

export function adminLogout() {
  state.admin.token = null;
  state.admin.authenticated = false;
  adminUiState.selectedId = null;
  adminUiState.selectedNotebook = null;
  try { sessionStorage.removeItem(ADMIN_TOKEN_SESSION_KEY); } catch { /* ignore */ }
  renderAdminEntry();
  showAdminLogin();
}

export function showAdminNewNotebookForm() {
  clearAdminDetailSaveTimer();
  adminUiState.activePanel = "notebooks";
  adminUiState.selectedId = null;
  adminUiState.selectedNotebook = null;
  adminUiState.mobileView = "detail";
  renderAdminConsoleNav();
  renderAdminList();
  if (elements.adminStatusPanel) elements.adminStatusPanel.hidden = true;
  if (elements.adminAccessPanel) elements.adminAccessPanel.hidden = true;
  if (elements.adminRagEvalPanel) elements.adminRagEvalPanel.hidden = true;
  hideAdminStatsPanel();
  if (elements.adminDetailEmpty) elements.adminDetailEmpty.hidden = true;
  if (elements.adminDetailContent) elements.adminDetailContent.hidden = true;
  if (elements.adminNewNotebookForm) elements.adminNewNotebookForm.hidden = false;
  if (elements.adminDetailSaveStatus) elements.adminDetailSaveStatus.textContent = "";
  applyAdminMobileView();
  if (elements.adminNewNotebookName) elements.adminNewNotebookName.value = "";
  if (elements.adminNewNotebookDescription) elements.adminNewNotebookDescription.value = "";
  queueMicrotask(() => elements.adminNewNotebookName?.focus());
}

function hideAdminNewNotebookForm() {
  if (elements.adminNewNotebookForm) elements.adminNewNotebookForm.hidden = true;
}

export async function adminCreateNotebook() {
  const name = (elements.adminNewNotebookName?.value ?? "").trim();
  const description = (elements.adminNewNotebookDescription?.value ?? "").trim();
  if (!name) { alert("프로젝트 이름을 입력하세요."); return; }
  try {
    const response = await fetch("/api/notebooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeader() },
      body: JSON.stringify({ name, description })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "프로젝트 생성 실패");
    }
    const result = await response.json().catch(() => ({}));
    adminUiState.selectedId = result.notebook?.id || null;
    adminUiState.mobileView = "detail";
    hideAdminNewNotebookForm();
    await refreshAdminNotebooks();
    await loadNotebooks();
  } catch (error) {
    alert(`프로젝트 생성 실패: ${error.message}`);
  }
}

export async function adminDeleteNotebook(notebookId, notebookName) {
  const confirmed = await showConfirmDialog({
    title: "프로젝트 삭제",
    body: `프로젝트 "${notebookName}"을(를) 삭제할까요? 등록된 모든 문서가 사라집니다.`,
    okText: "삭제",
    danger: true
  });
  if (!confirmed) return;
  try {
    const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, {
      method: "DELETE",
      headers: adminAuthHeader()
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "삭제 실패");
    }
    if (adminUiState.selectedId === notebookId) {
      adminUiState.selectedId = null;
      adminUiState.selectedNotebook = null;
      adminUiState.mobileView = "list";
    }
    await refreshAdminNotebooks();
    await loadNotebooks();
    for (const room of state.rooms) {
      if (room.selectedNotebookId === notebookId) room.selectedNotebookId = null;
    }
    renderActiveNotebookUi();
    scheduleSave();
  } catch (error) {
    alert(`삭제 실패: ${error.message}`);
  }
}

async function adminUploadDocument(notebookId, file) {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/ingest-jobs`, {
    method: "POST",
    headers: adminAuthHeader(),
    body: formData
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "업로드 실패");
  }
  const result = await response.json().catch(() => ({}));
  if (!result.job?.id) throw new Error("작업 ID를 받지 못했습니다.");
  return result.job;
}

export async function uploadAdminDocuments(notebookId, files) {
  const uploadFiles = Array.from(files || []).filter(Boolean);
  if (!notebookId || !uploadFiles.length) return;
  adminUiState.selectedId = notebookId;
  adminUiState.mobileView = "detail";
  if (elements.adminUploadProgress) elements.adminUploadProgress.innerHTML = "";

  let completed = 0;
  for (const file of uploadFiles) {
    const row = buildAdminUploadProgressRow(file.name);
    elements.adminUploadProgress?.append(row.element);
    try {
      const job = await adminUploadDocument(notebookId, file);
      row.jobId = job.id;
      row.status.textContent = "대기 중...";
      await pollAdminIngestJob(notebookId, job.id, row);
      completed += 1;
      row.element.classList.add("done");
      row.status.textContent = "완료";
    } catch (error) {
      row.element.classList.add("error");
      row.status.textContent = error.message;
      if (row.jobId && row.retryButton) {
        row.retryButton.hidden = false;
        row.retryButton.onclick = async () => {
          row.retryButton.hidden = true;
          row.element.classList.remove("error", "done");
          try {
            const retryJob = await retryAdminIngestJob(notebookId, row.jobId);
            row.status.textContent = "재시도 대기 중...";
            await pollAdminIngestJob(notebookId, retryJob.id, row);
            row.element.classList.add("done");
            row.status.textContent = "완료";
            await refreshAdminNotebooks();
            await loadNotebooks();
          } catch (retryError) {
            row.element.classList.add("error");
            row.status.textContent = retryError.message;
            row.retryButton.hidden = false;
          }
        };
      }
    }
  }
  await refreshAdminNotebooks();
  await loadNotebooks();
  resetAdminFileInput();
}

async function pollAdminIngestJob(notebookId, jobId, row) {
  for (let attempt = 0; attempt < ADMIN_INGEST_MAX_POLLS; attempt += 1) {
    const job = await fetchAdminIngestJob(notebookId, jobId);
    updateAdminUploadProgressRow(row, job);
    if (job.status === "completed") return job;
    if (job.status === "failed") throw new Error(job.error || "인덱싱 실패");
    await wait(ADMIN_INGEST_POLL_MS);
  }
  throw new Error("인덱싱 작업 시간이 초과되었습니다.");
}

async function fetchAdminIngestJob(notebookId, jobId) {
  const response = await fetch(
    `/api/notebooks/${encodeURIComponent(notebookId)}/ingest-jobs/${encodeURIComponent(jobId)}`,
    { headers: adminAuthHeader() }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "작업 상태 조회 실패");
  }
  const result = await response.json().catch(() => ({}));
  if (!result.job) throw new Error("작업 상태가 비어 있습니다.");
  return result.job;
}

async function retryAdminIngestJob(notebookId, jobId) {
  const response = await fetch(
    `/api/notebooks/${encodeURIComponent(notebookId)}/ingest-jobs/${encodeURIComponent(jobId)}/retry`,
    { method: "POST", headers: adminAuthHeader() }
  );
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "작업 재시도 실패");
  }
  const result = await response.json().catch(() => ({}));
  if (!result.job) throw new Error("재시도 작업 상태가 비어 있습니다.");
  return result.job;
}

function updateAdminUploadProgressRow(row, job) {
  const progress = Number(job.progress || 0);
  const stageLabel = formatIngestStage(job.stage, job.status);
  row.status.textContent = `${stageLabel} ${progress}%`;
  if (row.bar) row.bar.style.width = `${Math.max(0, Math.min(100, progress))}%`;
}

function formatIngestStage(stage, status) {
  if (status === "completed") return "완료";
  if (status === "failed") return "실패";
  if (stage === "queued") return "대기";
  if (stage === "parsing") return "파싱";
  if (stage === "indexing") return "임베딩/인덱싱";
  if (stage === "running") return "처리";
  return "처리";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildAdminUploadProgressRow(fileName) {
  const element = document.createElement("div");
  element.className = "admin-upload-progress-row";
  const name = document.createElement("span");
  name.className = "admin-upload-progress-name";
  name.textContent = fileName || "파일";
  const status = document.createElement("span");
  status.className = "admin-upload-progress-status";
  status.textContent = "업로드 요청 중...";
  const barTrack = document.createElement("span");
  barTrack.className = "admin-upload-progress-track";
  const bar = document.createElement("span");
  bar.className = "admin-upload-progress-bar";
  barTrack.append(bar);
  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "admin-upload-retry-button";
  retryButton.textContent = "재시도";
  retryButton.hidden = true;
  element.append(name, status, retryButton, barTrack);
  return { element, status, bar, retryButton, jobId: null };
}

export async function adminDeleteDocument(notebookId, documentId, documentName) {
  const confirmed = await showConfirmDialog({
    title: "문서 삭제",
    body: `문서 "${documentName}"을(를) 삭제할까요?`,
    okText: "삭제",
    danger: true
  });
  if (!confirmed) return;
  try {
    const response = await fetch(
      `/api/notebooks/${encodeURIComponent(notebookId)}/documents/${encodeURIComponent(documentId)}`,
      { method: "DELETE", headers: adminAuthHeader() }
    );
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "삭제 실패");
    }
    adminUiState.selectedId = notebookId;
    await refreshAdminNotebooks();
    await loadNotebooks();
  } catch (error) {
    alert(`삭제 실패: ${error.message}`);
  }
}

export async function refreshAdminNotebooks() {
  if (!elements.adminNotebookList) return;
  elements.adminNotebookList.innerHTML = "<div class='admin-list-empty'>불러오는 중...</div>";
  try {
    const listResponse = await fetch("/api/notebooks", { headers: adminAuthHeader() });
    if (!listResponse.ok) throw new Error("프로젝트 목록 요청 실패");
    const listResult = await listResponse.json();
    const summaries = Array.isArray(listResult.notebooks) ? listResult.notebooks : [];
    const detailed = await Promise.all(
      summaries.map(async (summary) => {
        try {
          const res = await fetch(`/api/notebooks/${encodeURIComponent(summary.id)}`, { headers: adminAuthHeader() });
          if (!res.ok) return summary;
          const data = await res.json();
          return data.notebook ?? summary;
        } catch { return summary; }
      })
    );
    adminUiState.notebooks = detailed;
    adminUiState.selectedNotebook = adminUiState.notebooks.find((n) => n.id === adminUiState.selectedId) ?? null;
    if (adminUiState.selectedId && !adminUiState.selectedNotebook) adminUiState.selectedId = null;
    renderAdminList();
    renderAdminDetail();
    applyAdminMobileView();
  } catch (error) {
    elements.adminNotebookList.innerHTML = "";
    const errorBox = document.createElement("div");
    errorBox.className = "admin-list-empty";
    errorBox.textContent = `목록을 불러오지 못했습니다: ${error.message}`;
    elements.adminNotebookList.append(errorBox);
  }
}

function renderAdminList() {
  if (!elements.adminNotebookList) return;
  elements.adminNotebookList.innerHTML = "";
  if (!adminUiState.notebooks.length) {
    const empty = document.createElement("div");
    empty.className = "admin-list-empty";
    empty.textContent = "등록된 프로젝트가 없습니다.";
    elements.adminNotebookList.append(empty);
    return;
  }
  for (const notebook of adminUiState.notebooks) elements.adminNotebookList.append(buildAdminListItem(notebook));
}

function buildAdminListItem(notebook) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "admin-list-item";
  if (notebook.id === adminUiState.selectedId) button.classList.add("active");

  const content = document.createElement("span");
  content.className = "admin-list-item-content";
  const name = document.createElement("span");
  name.className = "admin-list-item-name";
  name.textContent = notebook.name || "이름 없는 프로젝트";
  content.append(name);
  if (notebook.description) {
    const description = document.createElement("span");
    description.className = "admin-list-item-description";
    description.textContent = notebook.description;
    content.append(description);
  }
  const meta = document.createElement("span");
  meta.className = "admin-list-item-meta";
  meta.textContent = `문서 ${notebook.documentCount ?? notebook.documents?.length ?? 0}`;
  button.append(content, meta);
  button.addEventListener("click", () => selectAdminNotebook(notebook.id));
  return button;
}

function selectAdminNotebook(notebookId) {
  clearAdminDetailSaveTimer();
  hideAdminNewNotebookForm();
  adminUiState.activePanel = "notebooks";
  adminUiState.selectedId = notebookId;
  adminUiState.selectedNotebook = adminUiState.notebooks.find((nb) => nb.id === notebookId) ?? null;
  adminUiState.mobileView = "detail";
  renderAdminConsoleNav();
  renderAdminList();
  renderAdminDetail();
  applyAdminMobileView();
}

export function renderAdminDetail() {
  if (!elements.adminDetailEmpty || !elements.adminDetailContent) return;
  adminUiState.activePanel = "notebooks";
  renderAdminConsoleNav();
  if (elements.adminStatusPanel) elements.adminStatusPanel.hidden = true;
  if (elements.adminAccessPanel) elements.adminAccessPanel.hidden = true;
  if (elements.adminRagEvalPanel) elements.adminRagEvalPanel.hidden = true;
  hideAdminStatsPanel();
  const notebook = adminUiState.selectedNotebook;
  const creating = elements.adminNewNotebookForm && !elements.adminNewNotebookForm.hidden;
  if (creating) return;

  if (!notebook) {
    elements.adminDetailEmpty.hidden = false;
    elements.adminDetailContent.hidden = true;
    if (elements.adminDocsTableBody) elements.adminDocsTableBody.innerHTML = "";
    if (elements.adminDocsEmpty) elements.adminDocsEmpty.hidden = true;
    if (elements.adminDocsCount) elements.adminDocsCount.textContent = "0";
    if (elements.adminDetailSaveStatus) elements.adminDetailSaveStatus.textContent = "";
    return;
  }
  elements.adminDetailEmpty.hidden = true;
  elements.adminDetailContent.hidden = false;
  if (elements.adminDetailNameInput) elements.adminDetailNameInput.value = notebook.name || "";
  if (elements.adminDetailDescriptionInput) elements.adminDetailDescriptionInput.value = notebook.description || "";
  if (elements.adminDetailSaveStatus) {
    elements.adminDetailSaveStatus.textContent = "";
    elements.adminDetailSaveStatus.className = "admin-save-status";
  }
  renderAdminNotebookAccessPolicy(notebook);
  renderAdminDocuments(notebook);
}

function renderAdminDocuments(notebook) {
  const documents = Array.isArray(notebook?.documents) ? notebook.documents : [];
  if (elements.adminDocsCount) elements.adminDocsCount.textContent = String(documents.length);
  if (elements.adminDocsEmpty) elements.adminDocsEmpty.hidden = documents.length > 0;
  if (!elements.adminDocsTableBody) return;
  elements.adminDocsTableBody.innerHTML = "";
  for (const doc of documents) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.className = "admin-docs-name-cell";
    nameCell.textContent = doc.name || "문서";
    const typeCell = document.createElement("td");
    typeCell.className = "admin-docs-col-type";
    typeCell.textContent = String(doc.type || "").toUpperCase();
    const sizeCell = document.createElement("td");
    sizeCell.className = "admin-docs-col-size";
    sizeCell.textContent = formatFileSize(doc.sizeBytes);
    const chunkCell = document.createElement("td");
    chunkCell.className = "admin-docs-col-chunks";
    chunkCell.textContent = String(doc.chunkCount ?? 0);
    const dateCell = document.createElement("td");
    dateCell.className = "admin-docs-col-date";
    dateCell.textContent = formatAdminDate(doc.addedAt);
    const actionCell = document.createElement("td");
    actionCell.className = "admin-docs-col-actions";
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "admin-docs-doc-remove";
    removeButton.textContent = "삭제";
    removeButton.addEventListener("click", () => adminDeleteDocument(notebook.id, doc.id, doc.name));
    actionCell.append(removeButton);
    row.append(nameCell, typeCell, sizeCell, chunkCell, dateCell, actionCell);
    elements.adminDocsTableBody.append(row);
  }
}

export function scheduleAdminDetailSave() {
  clearTimeout(adminDetailSaveTimer);
  setAdminSaveStatus("저장 중...", "saving");
  adminDetailSaveTimer = setTimeout(() => commitAdminDetailSave(), 650);
}

export async function commitAdminDetailSave() {
  clearAdminDetailSaveTimer();
  const notebook = adminUiState.selectedNotebook;
  if (!notebook) return;
  const name = (elements.adminDetailNameInput?.value ?? "").trim();
  const description = (elements.adminDetailDescriptionInput?.value ?? "").trim();
  if (!name) { setAdminSaveStatus("이름 필요", "error"); return; }
  if (name === (notebook.name || "") && description === (notebook.description || "")) {
    setAdminSaveStatus("", "");
    return;
  }
  setAdminSaveStatus("저장 중...", "saving");
  try {
    const response = await fetch(`/api/notebooks/${encodeURIComponent(notebook.id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminAuthHeader() },
      body: JSON.stringify({ name, description })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "저장 실패");
    }
    const result = await response.json().catch(() => ({}));
    const updated = result.notebook || { id: notebook.id, name, description };
    const nextNotebook = { ...notebook, ...updated, documents: notebook.documents || [] };
    adminUiState.notebooks = adminUiState.notebooks.map((n) => n.id === notebook.id ? nextNotebook : n);
    adminUiState.selectedNotebook = nextNotebook;
    renderAdminList();
    await loadNotebooks();
    setAdminSaveStatus("저장됨", "saved");
  } catch (error) {
    setAdminSaveStatus(error.message, "error");
  }
}

function clearAdminDetailSaveTimer() {
  clearTimeout(adminDetailSaveTimer);
  adminDetailSaveTimer = null;
}

function setAdminSaveStatus(text, kind) {
  if (!elements.adminDetailSaveStatus) return;
  elements.adminDetailSaveStatus.className = "admin-save-status";
  if (kind) elements.adminDetailSaveStatus.classList.add(kind);
  elements.adminDetailSaveStatus.textContent = text;
}

function applyAdminMobileView() {
  if (!elements.adminWorkspace) return;
  const view = adminUiState.mobileView === "detail" ? "detail" : "list";
  elements.adminWorkspace.dataset.mobileView = view;
  const isMobile = window.matchMedia?.("(max-width: 720px)")?.matches ?? false;
  if (elements.adminBackToListButton) {
    elements.adminBackToListButton.hidden = !(isMobile && view === "detail");
  }
}

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "-";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.max(1, Math.round(value / 1024))} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatAdminDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function renderAdminConsoleNav() {
  const active = adminUiState.activePanel || "notebooks";
  if (elements.adminWorkspace) elements.adminWorkspace.dataset.panel = active;
  elements.adminNotebookMenuButton?.classList.toggle("active", active === "notebooks");
  elements.adminStatusButton?.classList.toggle("active", active === "status");
  elements.adminAccessButton?.classList.toggle("active", active === "access");
  elements.adminRagEvalButton?.classList.toggle("active", active === "ragEval");
  elements.adminStatsButton?.classList.toggle("active", active === "stats");
  if (elements.adminRefreshStatusButton) elements.adminRefreshStatusButton.hidden = active !== "status";
  if (elements.adminAccessRefreshButton) elements.adminAccessRefreshButton.hidden = active !== "access";
  if (elements.adminListPane) elements.adminListPane.hidden = active !== "notebooks";
  if (elements.adminNotebookNavSection) elements.adminNotebookNavSection.hidden = active !== "notebooks";
}

function showAdminNotebooksPanel() {
  adminUiState.activePanel = "notebooks";
  adminUiState.mobileView = adminUiState.selectedNotebook ? "detail" : "list";
  hideAdminNewNotebookForm();
  renderAdminConsoleNav();
  renderAdminList();
  renderAdminDetail();
  applyAdminMobileView();
}

// ===== Access policy admin =====

async function refreshAdminAccessConfig() {
  try {
    const response = await fetch("/api/admin/access/groups", { headers: adminAuthHeader() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    adminUiState.accessConfig = await response.json();
  } catch (error) {
    adminUiState.accessConfig = { groups: [], super: { enabled: false, passwordSet: false }, error: error.message };
  }
  if (!elements.adminAccessPanel?.hidden) renderAdminAccessPanel();
  if (adminUiState.selectedNotebook) renderAdminNotebookAccessPolicy(adminUiState.selectedNotebook);
}

export async function showAdminAccessPanel() {
  adminUiState.activePanel = "access";
  clearAdminDetailSaveTimer();
  hideAdminNewNotebookForm();
  renderAdminConsoleNav();
  if (elements.adminDetailEmpty) elements.adminDetailEmpty.hidden = true;
  if (elements.adminDetailContent) elements.adminDetailContent.hidden = true;
  if (elements.adminStatusPanel) elements.adminStatusPanel.hidden = true;
  if (elements.adminRagEvalPanel) elements.adminRagEvalPanel.hidden = true;
  hideAdminStatsPanel();
  if (elements.adminAccessPanel) elements.adminAccessPanel.hidden = false;
  adminUiState.selectedId = null;
  adminUiState.selectedNotebook = null;
  adminUiState.mobileView = "detail";
  renderAdminList();
  applyAdminMobileView();
  await refreshAdminAccessConfig();
  renderAdminAccessPanel();
}

function renderAdminAccessPanel() {
  const body = elements.adminAccessBody;
  if (!body) return;
  const config = adminUiState.accessConfig || { groups: [], super: {} };
  body.innerHTML = "";
  const activeTab = adminUiState.accessActiveTab === "super" ? "super" : "groups";
  body.className = `admin-access-body admin-access-body-${activeTab}`;
  renderAdminAccessTabs(activeTab);
  if (config.error) {
    const error = document.createElement("div");
    error.className = "admin-status-error";
    error.textContent = `접근 권한 정보를 불러오지 못했습니다: ${config.error}`;
    body.append(error);
    return;
  }
  if (activeTab === "super") {
    body.append(buildSuperAccessPanel(config.super || {}));
    return;
  }
  body.append(buildAccessGroupsWorkspace(Array.isArray(config.groups) ? config.groups : []));
}

function renderAdminAccessTabs(activeTab = adminUiState.accessActiveTab) {
  const groupsActive = activeTab !== "super";
  elements.adminAccessGroupsTab?.classList.toggle("active", groupsActive);
  elements.adminAccessSuperTab?.classList.toggle("active", !groupsActive);
  elements.adminAccessGroupsTab?.setAttribute("aria-selected", String(groupsActive));
  elements.adminAccessSuperTab?.setAttribute("aria-selected", String(!groupsActive));
}

function switchAdminAccessTab(tab) {
  adminUiState.accessActiveTab = tab === "super" ? "super" : "groups";
  renderAdminAccessPanel();
}

function buildAccessGroupsWorkspace(groups) {
  const filtered = filterAccessGroups(groups);
  const selected = ensureSelectedAccessGroup((adminUiState.accessGroupSearch || "").trim() ? filtered : groups);
  const workspace = document.createElement("div");
  workspace.className = "admin-access-groups-workspace";
  workspace.append(buildAccessGroupSidebar(groups, selected?.id || null));
  workspace.append(buildAccessGroupDetail(selected));
  return workspace;
}

function ensureSelectedAccessGroup(groups) {
  if (!groups.length) {
    adminUiState.selectedAccessGroupId = null;
    return null;
  }
  const selected = groups.find((group) => group.id === adminUiState.selectedAccessGroupId);
  if (selected) return selected;
  adminUiState.selectedAccessGroupId = groups[0].id;
  return groups[0];
}

function filterAccessGroups(groups) {
  const needle = (adminUiState.accessGroupSearch || "").trim().toLowerCase();
  if (!needle) return groups;
  return groups.filter((group) => {
    const text = `${group.id || ""} ${group.name || ""} ${group.description || ""}`.toLowerCase();
    return text.includes(needle);
  });
}

function buildAccessGroupSidebar(groups, selectedId) {
  const sidebar = document.createElement("aside");
  sidebar.className = "admin-access-group-sidebar";

  const total = groups.length;
  const active = groups.filter((group) => group.enabled).length;
  const stats = document.createElement("div");
  stats.className = "admin-access-group-stats";
  stats.innerHTML = `<span>그룹 ${total}</span><span>활성 ${active}</span>`;

  const createBox = document.createElement("div");
  createBox.className = "admin-access-create-box";
  const createName = document.createElement("input");
  createName.className = "text-input";
  createName.maxLength = 80;
  createName.placeholder = "새 그룹명";
  const createDesc = document.createElement("input");
  createDesc.className = "text-input";
  createDesc.maxLength = 400;
  createDesc.placeholder = "설명";
  const createButton = document.createElement("button");
  createButton.type = "button";
  createButton.className = "send-button";
  createButton.textContent = "그룹 추가";
  const submitCreate = () => addAdminAccessGroup(createName.value, createDesc.value).catch((error) => alert(error.message));
  createButton.addEventListener("click", submitCreate);
  createName.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); submitCreate(); } });
  createDesc.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); submitCreate(); } });
  createBox.append(createName, createDesc, createButton);

  const search = document.createElement("input");
  search.className = "text-input admin-access-search";
  search.type = "search";
  search.placeholder = "그룹 검색";
  search.value = adminUiState.accessGroupSearch || "";
  search.addEventListener("input", () => {
    adminUiState.accessGroupSearch = search.value;
    renderAdminAccessPanel();
  });

  const list = document.createElement("div");
  list.className = "admin-access-group-list";
  const filtered = filterAccessGroups(groups);
  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "admin-access-empty";
    empty.textContent = groups.length ? "검색 결과가 없습니다." : "등록된 접근 그룹이 없습니다.";
    list.append(empty);
  } else {
    for (const group of filtered) list.append(buildAccessGroupListItem(group, selectedId));
  }

  sidebar.append(stats, createBox, search, list);
  return sidebar;
}

function buildAccessGroupListItem(group, selectedId) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "admin-access-group-list-item";
  button.classList.toggle("active", group.id === selectedId);
  button.addEventListener("click", () => {
    adminUiState.selectedAccessGroupId = group.id;
    renderAdminAccessPanel();
  });

  const lamp = document.createElement("span");
  lamp.className = `admin-access-group-lamp ${group.enabled ? "is-active" : "is-inactive"}`;
  lamp.title = group.enabled ? "활성 그룹" : "비활성 그룹";
  const text = document.createElement("span");
  text.className = "admin-access-group-list-text";
  const name = document.createElement("span");
  name.className = "admin-access-group-list-name";
  name.textContent = group.name || group.id;
  const desc = document.createElement("span");
  desc.className = "admin-access-group-list-desc";
  desc.textContent = group.description || group.id;
  text.append(name, desc);

  const indicators = document.createElement("span");
  indicators.className = "admin-access-level-indicators";
  for (const level of [1, 2, 3]) indicators.append(buildAccessLevelIndicator(group, level));

  button.append(lamp, text, indicators);
  return button;
}

function buildAccessLevelIndicator(group, level) {
  const record = group.levels?.[String(level)] || {};
  const indicator = document.createElement("span");
  indicator.className = `admin-access-level-indicator level-${level}`;
  indicator.classList.toggle("is-enabled", Boolean(record.enabled));
  indicator.classList.toggle("is-set", Boolean(record.passwordSet));
  indicator.textContent = `L${level}`;
  indicator.title = `Level ${level}: ${record.enabled ? "활성" : "비활성"} / ${record.passwordSet ? "비밀번호 설정됨" : "비밀번호 미설정"}`;
  return indicator;
}

function buildAccessGroupDetail(group) {
  const detail = document.createElement("section");
  detail.className = "admin-access-group-detail";
  if (!group) {
    detail.classList.add("is-empty");
    detail.textContent = "왼쪽에서 그룹을 선택하거나 새 그룹을 만드세요.";
    return detail;
  }

  const header = document.createElement("div");
  header.className = "admin-access-detail-header";
  const title = document.createElement("h4");
  title.textContent = group.name || group.id;
  const actions = document.createElement("div");
  actions.className = "admin-access-detail-actions";
  actions.append(buildGroupEnabledToggle(group), buildGroupDeleteButton(group));
  header.append(title, actions);

  const info = document.createElement("div");
  info.className = "admin-access-detail-info";
  const nameField = document.createElement("label");
  nameField.className = "admin-access-field";
  const nameInput = document.createElement("input");
  nameInput.className = "text-input";
  nameInput.value = group.name || "";
  nameInput.placeholder = "그룹명";
  nameField.append(document.createTextNode("그룹 정보"), nameInput);
  const descField = document.createElement("label");
  descField.className = "admin-access-field";
  const descInput = document.createElement("input");
  descInput.className = "text-input";
  descInput.value = group.description || "";
  descInput.placeholder = "설명";
  descField.append(document.createTextNode("설명"), descInput);
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "ghost-button";
  saveButton.textContent = "저장";
  saveButton.addEventListener("click", () => runAdminAccessTask(async () => {
    await patchAdminAccess(`/api/admin/access/groups/${encodeURIComponent(group.id)}`, {
      name: nameInput.value,
      description: descInput.value
    });
    await refreshAdminAccessConfig();
  }));
  info.append(nameField, descField, saveButton);

  const levels = document.createElement("div");
  levels.className = "admin-access-level-detail-list";
  for (const level of [1, 2, 3]) levels.append(buildAccessLevelDetailRow(group, level));

  detail.append(header, info, levels);
  return detail;
}

function buildGroupEnabledToggle(group) {
  const label = document.createElement("label");
  label.className = "admin-access-toggle";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = Boolean(group.enabled);
  enabled.addEventListener("change", () => runAdminAccessTask(async () => {
    await patchAdminAccess(`/api/admin/access/groups/${encodeURIComponent(group.id)}`, { enabled: enabled.checked });
    await refreshAdminAccessConfig();
  }));
  label.append(enabled, document.createTextNode(" 활성"));
  return label;
}

function buildGroupDeleteButton(group) {
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.className = "ghost-button admin-danger-button";
  deleteButton.textContent = "삭제";
  deleteButton.addEventListener("click", () => runAdminAccessTask(async () => {
    const confirmed = await showConfirmDialog({
      title: "접근 그룹 삭제",
      body: `"${group.name || group.id}" 그룹을 삭제할까요? 프로젝트 정책에서 같은 그룹 ID도 제거해야 합니다.`,
      okText: "삭제",
      danger: true
    });
    if (!confirmed) return;
    await deleteAdminAccess(`/api/admin/access/groups/${encodeURIComponent(group.id)}`);
    if (adminUiState.selectedAccessGroupId === group.id) adminUiState.selectedAccessGroupId = null;
    await refreshAdminAccessConfig();
  }));
  return deleteButton;
}

function buildAccessLevelDetailRow(group, level) {
  const record = group.levels?.[String(level)] || {};
  const row = document.createElement("div");
  row.className = `admin-access-level-detail-row level-${level}`;

  const label = document.createElement("label");
  label.className = "admin-access-level-name";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = Boolean(record.enabled);
  enabled.addEventListener("change", () => runAdminAccessTask(async () => {
    await patchAdminAccess(`/api/admin/access/groups/${encodeURIComponent(group.id)}/levels/${level}`, { enabled: enabled.checked });
    await refreshAdminAccessConfig();
  }));
  const labelText = document.createElement("span");
  labelText.textContent = `Level ${level}`;
  label.append(enabled, labelText);
  if (level === 1) {
    const warning = document.createElement("span");
    warning.className = "admin-access-level-warning";
    warning.textContent = "그룹 내 모든 프로젝트 접근";
    label.append(warning);
  }

  const status = buildAccessPasswordStatus(record.passwordSet);
  const input = document.createElement("input");
  input.type = "password";
  input.className = "text-input";
  input.placeholder = "새 비밀번호";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button";
  button.textContent = record.passwordSet ? "변경" : "설정";
  button.addEventListener("click", () => runAdminAccessTask(async () => {
    await postAdminAccess(`/api/admin/access/groups/${encodeURIComponent(group.id)}/levels/${level}/password`, { password: input.value });
    input.value = "";
    await refreshAdminAccessConfig();
  }));
  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "ghost-button admin-danger-button";
  clearButton.textContent = "삭제";
  clearButton.disabled = !record.passwordSet;
  clearButton.title = record.passwordSet ? "비밀번호 삭제" : "삭제할 비밀번호가 없습니다";
  clearButton.addEventListener("click", () => runAdminAccessTask(async () => {
    const confirmed = await showConfirmDialog({
      title: `Level ${level} 비밀번호 삭제`,
      body: `${group.name || group.id} 그룹의 Level ${level} 비밀번호를 삭제할까요? 삭제하면 해당 레벨은 미설정 상태가 됩니다.`,
      okText: "삭제",
      danger: true
    });
    if (!confirmed) return;
    await deleteAdminAccess(`/api/admin/access/groups/${encodeURIComponent(group.id)}/levels/${level}/password`);
    await refreshAdminAccessConfig();
  }));
  row.append(label, status, input, button, clearButton);
  return row;
}

function buildSuperAccessPanel(superState) {
  const panel = document.createElement("section");
  panel.className = "admin-access-super-panel";

  const warning = document.createElement("div");
  warning.className = "admin-access-super-warning";
  warning.innerHTML = "<strong>Super 권한 주의</strong><span>Super 비밀번호는 그룹과 등급을 우회해 모든 프로젝트에 접근할 수 있습니다. 운영자 비상 접근이나 점검 용도로만 제한해서 사용하세요.</span>";

  const card = document.createElement("div");
  card.className = "admin-access-super-settings";
  const enabledRow = document.createElement("div");
  enabledRow.className = "admin-access-super-row";
  const enabledLabel = document.createElement("span");
  enabledLabel.textContent = "권한 사용";
  const enabledToggle = document.createElement("label");
  enabledToggle.className = "admin-access-toggle";
  const enabled = document.createElement("input");
  enabled.type = "checkbox";
  enabled.checked = Boolean(superState.enabled);
  enabled.addEventListener("change", () => runAdminAccessTask(async () => {
    await patchAdminAccess("/api/admin/access/super", { enabled: enabled.checked });
    await refreshAdminAccessConfig();
  }));
  enabledToggle.append(enabled, document.createTextNode(" 활성"));
  enabledRow.append(enabledLabel, enabledToggle);

  const currentRow = document.createElement("div");
  currentRow.className = "admin-access-super-row";
  const currentLabel = document.createElement("span");
  currentLabel.textContent = "기존 비밀번호 확인";
  const currentInput = document.createElement("input");
  currentInput.type = "password";
  currentInput.className = "text-input";
  currentInput.placeholder = superState.passwordSet ? "기존 Super 비밀번호" : "최초 설정 시 생략";
  currentInput.disabled = !superState.passwordSet;
  const currentStatus = buildAccessPasswordStatus(superState.passwordSet, true);
  currentRow.append(currentLabel, currentInput, currentStatus);

  const passwordRow = document.createElement("div");
  passwordRow.className = "admin-access-super-row admin-access-super-password-row";
  const passwordLabel = document.createElement("span");
  passwordLabel.textContent = "새 비밀번호";
  const input = document.createElement("input");
  input.type = "password";
  input.className = "text-input";
  input.placeholder = "새 Super 비밀번호";
  passwordRow.append(passwordLabel, input);

  const confirmRow = document.createElement("div");
  confirmRow.className = "admin-access-super-row admin-access-super-password-row";
  const confirmLabel = document.createElement("span");
  confirmLabel.textContent = "새 비밀번호 확인";
  const confirmInput = document.createElement("input");
  confirmInput.type = "password";
  confirmInput.className = "text-input";
  confirmInput.placeholder = "새 Super 비밀번호 재입력";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ghost-button";
  button.textContent = superState.passwordSet ? "변경" : "설정";
  button.addEventListener("click", () => runAdminAccessTask(async () => {
    const password = input.value;
    const confirmation = confirmInput.value;
    if (superState.passwordSet && !currentInput.value) {
      alert("기존 Super 비밀번호를 입력하세요.");
      currentInput.focus();
      return;
    }
    if (password !== confirmation) {
      alert("새 비밀번호와 확인 값이 일치하지 않습니다.");
      confirmInput.focus();
      return;
    }
    await postAdminAccess("/api/admin/access/super/password", {
      currentPassword: currentInput.value,
      password,
      confirmPassword: confirmation
    });
    currentInput.value = "";
    input.value = "";
    confirmInput.value = "";
    await refreshAdminAccessConfig();
  }));
  confirmRow.append(confirmLabel, confirmInput, button);

  card.append(enabledRow, currentRow, passwordRow, confirmRow);
  panel.append(warning, card);
  return panel;
}

function buildAccessPasswordStatus(passwordSet, verbose = false) {
  const status = document.createElement("span");
  status.className = "admin-access-password-status";
  status.classList.toggle("is-set", Boolean(passwordSet));
  status.textContent = passwordSet
    ? (verbose ? "설정됨" : "설정됨")
    : (verbose ? "미설정" : "미설정");
  return status;
}

async function addAdminAccessGroup(nameValue, descriptionValue) {
  const name = ((nameValue ?? elements.adminAccessGroupNameInput?.value) || "").trim();
  const description = ((descriptionValue ?? elements.adminAccessGroupDescriptionInput?.value) || "").trim();
  if (!name) return;
  const result = await postAdminAccess("/api/admin/access/groups", { name, description });
  if (result.group?.id) adminUiState.selectedAccessGroupId = result.group.id;
  if (elements.adminAccessGroupNameInput) elements.adminAccessGroupNameInput.value = "";
  if (elements.adminAccessGroupDescriptionInput) elements.adminAccessGroupDescriptionInput.value = "";
  await refreshAdminAccessConfig();
}

async function postAdminAccess(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...adminAuthHeader() },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

async function patchAdminAccess(path, body) {
  const response = await fetch(path, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...adminAuthHeader() },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

async function deleteAdminAccess(path) {
  const response = await fetch(path, { method: "DELETE", headers: adminAuthHeader() });
  if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
  return response.json().catch(() => ({}));
}

function runAdminAccessTask(task) {
  Promise.resolve()
    .then(task)
    .catch((error) => alert(error.message || "접근 권한 작업에 실패했습니다."));
}

function renderAdminNotebookAccessPolicy(notebook) {
  if (!elements.adminNotebookAccessSection) return;
  elements.adminNotebookAccessSection.hidden = false;
  const policy = normalizeClientPolicy(notebook?.access);
  renderAdminNotebookAccessGroups(policy);
  renderAdminNotebookAccessLevels(policy);
  if (elements.adminNotebookAccessStatus) elements.adminNotebookAccessStatus.textContent = "";
}

function renderAdminNotebookAccessGroups(policy) {
  const container = elements.adminNotebookAccessGroups;
  if (!container) return;
  container.innerHTML = "";
  const groups = adminUiState.accessConfig?.groups || [];
  const wildcard = buildPolicyGroupCheckbox("*", "모든 그룹", policy.groups.includes("*"));
  container.append(wildcard);
  for (const group of groups) {
    container.append(buildPolicyGroupCheckbox(group.id, group.name || group.id, policy.groups.includes(group.id)));
  }
}

function buildPolicyGroupCheckbox(value, labelText, checked) {
  const label = document.createElement("label");
  label.className = "admin-policy-check";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.value = value;
  input.checked = checked;
  label.append(input, document.createTextNode(labelText));
  return label;
}

function renderAdminNotebookAccessLevels(policy) {
  const container = elements.adminNotebookAccessLevels;
  if (!container) return;
  container.innerHTML = "";
  for (const level of [1, 2, 3]) {
    const label = document.createElement("label");
    label.className = "admin-policy-check";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "adminNotebookMinLevel";
    input.value = String(level);
    input.checked = Number(policy.minLevel) === level;
    label.append(input, document.createTextNode(`Level ${level}`));
    container.append(label);
  }
}

async function saveAdminNotebookAccessPolicy() {
  const notebook = adminUiState.selectedNotebook;
  if (!notebook) return;
  const groups = Array.from(elements.adminNotebookAccessGroups?.querySelectorAll("input[type='checkbox']:checked") || [])
    .map((input) => input.value)
    .filter(Boolean);
  const minLevel = Number(elements.adminNotebookAccessLevels?.querySelector("input[type='radio']:checked")?.value || 1);
  const access = { groups: groups.length ? groups : ["*"], minLevel };
  setAdminNotebookAccessStatus("저장 중...", "saving");
  try {
    const response = await fetch(`/api/notebooks/${encodeURIComponent(notebook.id)}/access`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...adminAuthHeader() },
      body: JSON.stringify({ access })
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || "저장 실패");
    const result = await response.json().catch(() => ({}));
    const updated = result.notebook || { ...notebook, access };
    adminUiState.notebooks = adminUiState.notebooks.map((item) => item.id === notebook.id ? { ...item, ...updated } : item);
    adminUiState.selectedNotebook = adminUiState.notebooks.find((item) => item.id === notebook.id) || updated;
    setAdminNotebookAccessStatus("저장됨", "saved");
    await loadNotebooks();
  } catch (error) {
    setAdminNotebookAccessStatus(error.message, "error");
  }
}

function setAdminNotebookAccessStatus(text, kind) {
  if (!elements.adminNotebookAccessStatus) return;
  elements.adminNotebookAccessStatus.className = "admin-save-status";
  if (kind) elements.adminNotebookAccessStatus.classList.add(kind);
  elements.adminNotebookAccessStatus.textContent = text;
}

function normalizeClientPolicy(policy) {
  const groups = Array.isArray(policy?.groups) && policy.groups.length ? policy.groups : ["*"];
  const minLevel = [1, 2, 3].includes(Number(policy?.minLevel)) ? Number(policy.minLevel) : 1;
  return { groups, minLevel };
}

// ===== RAG eval panel =====

export function showAdminRagEval() {
  adminUiState.activePanel = "ragEval";
  renderAdminConsoleNav();
  if (elements.adminDetailEmpty) elements.adminDetailEmpty.hidden = true;
  if (elements.adminDetailContent) elements.adminDetailContent.hidden = true;
  if (elements.adminNewNotebookForm) elements.adminNewNotebookForm.hidden = true;
  if (elements.adminAccessPanel) elements.adminAccessPanel.hidden = true;
  if (elements.adminStatusPanel) elements.adminStatusPanel.hidden = true;
  hideAdminStatsPanel();
  adminUiState.selectedId = null;
  adminUiState.selectedNotebook = null;
  adminUiState.mobileView = "detail";
  renderAdminList();
  applyAdminMobileView();
  activateRagEvalPanel().catch((err) => alert(`RAG 품질 패널 로드 실패: ${err.message}`));
}

// ===== Stats panel =====

export function showAdminStats() {
  adminUiState.activePanel = "stats";
  renderAdminConsoleNav();
  if (elements.adminDetailEmpty) elements.adminDetailEmpty.hidden = true;
  if (elements.adminDetailContent) elements.adminDetailContent.hidden = true;
  if (elements.adminNewNotebookForm) elements.adminNewNotebookForm.hidden = true;
  if (elements.adminAccessPanel) elements.adminAccessPanel.hidden = true;
  if (elements.adminStatusPanel) elements.adminStatusPanel.hidden = true;
  if (elements.adminRagEvalPanel) elements.adminRagEvalPanel.hidden = true;
  adminUiState.selectedId = null;
  adminUiState.selectedNotebook = null;
  adminUiState.mobileView = "detail";
  renderAdminList();
  applyAdminMobileView();
  activateStatsPanel().catch((err) => alert(`통계 패널 로드 실패: ${err.message}`));
}

// ===== System status panel =====

export function showAdminStatus() {
  adminUiState.activePanel = "status";
  renderAdminConsoleNav();
  if (elements.adminDetailEmpty) elements.adminDetailEmpty.hidden = true;
  if (elements.adminDetailContent) elements.adminDetailContent.hidden = true;
  if (elements.adminNewNotebookForm) elements.adminNewNotebookForm.hidden = true;
  if (elements.adminAccessPanel) elements.adminAccessPanel.hidden = true;
  if (elements.adminRagEvalPanel) elements.adminRagEvalPanel.hidden = true;
  hideAdminStatsPanel();
  if (elements.adminStatusPanel) elements.adminStatusPanel.hidden = false;
  adminUiState.selectedId = null;
  adminUiState.selectedNotebook = null;
  adminUiState.mobileView = "detail";
  renderAdminList();
  applyAdminMobileView();
  renderAdminRagStatus();
}

export async function renderAdminRagStatus() {
  const body = elements.adminStatusBody;
  if (!body) return;
  body.innerHTML = '<div class="admin-status-loading">불러오는 중…</div>';
  try {
    const response = await fetch("/api/admin/rag/status", {
      headers: { Authorization: `Bearer ${state.admin.token}` }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = await response.json();
    body.innerHTML = "";
    body.append(buildRagStatusFragment(data));
  } catch (error) {
    body.innerHTML = "";
    const msg = document.createElement("div");
    msg.className = "admin-status-error";
    msg.textContent = `상태 조회 실패: ${error.message}`;
    body.append(msg);
  }
}

function buildRagStatusFragment(data) {
  const frag = document.createDocumentFragment();

  // --- Backend config ---
  const backendSection = makeStatusSection("RAG 백엔드");
  const backendGrid = document.createElement("div");
  backendGrid.className = "admin-status-badges";
  backendGrid.append(
    makeStatusBadge("벡터", data.backend?.vector ?? "—"),
    makeStatusBadge("어휘", data.backend?.lexical ?? "—"),
    makeStatusBadge(
      "리랭커",
      data.reranker?.enabled ? "활성" : "비활성",
      data.reranker?.enabled
        ? null
        : "별도 리랭커 서버 미도입으로 의도된 비활성. 하이브리드 RRF 결과를 그대로 사용합니다."
    )
  );
  backendSection.append(backendGrid);
  frag.append(backendSection);

  // --- Index health ---
  const indexSection = makeStatusSection("인덱스 상태");
  const cards = document.createElement("div");
  cards.className = "admin-status-cards";
  cards.append(buildQdrantCard(data.qdrant), buildSqliteCard(data.sqlite));
  indexSection.append(cards);

  // drift warning
  const qPts = Number(data.qdrant?.pointsCount ?? -1);
  const sChunks = Number(data.sqlite?.chunks ?? -1);
  if (data.qdrant?.configured && data.sqlite?.configured && qPts >= 0 && sChunks >= 0 && qPts !== sChunks) {
    const drift = document.createElement("div");
    drift.className = "admin-status-drift";
    const diff = Math.abs(qPts - sChunks);
    drift.textContent = `인덱스 불일치: Qdrant ${qPts.toLocaleString()}청크 / SQLite ${sChunks.toLocaleString()}청크 (차이 ${diff.toLocaleString()}). 재구축이 필요할 수 있습니다.`;
    indexSection.append(drift);
  }
  frag.append(indexSection);

  // --- Queues ---
  const queueSection = makeStatusSection("모델 큐");
  const queueGrid = document.createElement("div");
  queueGrid.className = "admin-status-queue-grid";
  const queues = data.queues ?? {};
  for (const [key, label] of [["embedding", "임베딩"], ["analysis", "분석"], ["mapReduce", "맵리듀스"]]) {
    const q = queues[key] ?? {};
    const row = document.createElement("div");
    row.className = "admin-status-queue-row";
    const name = document.createElement("span");
    name.className = "admin-status-queue-name";
    name.textContent = label;
    const stats = document.createElement("span");
    stats.className = "admin-status-queue-stats";
    const running = Number(q.running ?? 0);
    const queued = Number(q.queued ?? 0);
    const completed = Number(q.completed ?? 0);
    const rejected = Number(q.rejected ?? 0);
    stats.textContent = `실행 ${running} · 대기 ${queued} · 완료 ${completed.toLocaleString()}${rejected ? ` · 거절 ${rejected}` : ""}`;
    if (running > 0) stats.classList.add("admin-status-queue-active");
    row.append(name, stats);
    queueGrid.append(row);
  }
  queueSection.append(queueGrid);
  frag.append(queueSection);

  // rebuild hint if any index is unhealthy
  const anyBad = data.qdrant?.configured && !data.qdrant?.ok || data.sqlite?.configured && !data.sqlite?.ok;
  const hasDrift = data.qdrant?.configured && data.sqlite?.configured &&
    Number(data.qdrant?.pointsCount ?? -1) >= 0 && Number(data.sqlite?.chunks ?? -1) >= 0 &&
    data.qdrant.pointsCount !== data.sqlite.chunks;
  if (anyBad || hasDrift) {
    const hint = makeStatusSection("재구축 안내");
    const code = document.createElement("code");
    code.className = "admin-status-rebuild-cmd";
    code.textContent = "npm run rag:rebuild";
    hint.append(code);
    frag.append(hint);
  }

  return frag;
}

function makeStatusSection(title) {
  const section = document.createElement("div");
  section.className = "admin-status-section";
  const heading = document.createElement("h4");
  heading.className = "admin-status-section-title";
  heading.textContent = title;
  section.append(heading);
  return section;
}

function makeStatusBadge(label, value, title) {
  const badge = document.createElement("div");
  badge.className = "admin-status-badge";
  if (title) badge.title = title;
  const lbl = document.createElement("span");
  lbl.className = "admin-status-badge-label";
  lbl.textContent = label;
  const val = document.createElement("span");
  val.className = "admin-status-badge-value";
  val.textContent = value;
  badge.append(lbl, val);
  return badge;
}

function buildQdrantCard(qdrant) {
  return buildIndexCard("Qdrant (벡터)", qdrant, (card, q) => {
    if (q.configured && q.ok) {
      addCardStat(card, "컬렉션", q.collection ?? "—");
      addCardStat(card, "청크", (Number(q.pointsCount ?? 0)).toLocaleString());
    }
  });
}

function buildSqliteCard(sqlite) {
  return buildIndexCard("SQLite FTS5 (어휘)", sqlite, (card, s) => {
    if (s.configured && s.ok) {
      addCardStat(card, "청크", (Number(s.chunks ?? 0)).toLocaleString());
    }
  });
}

function buildIndexCard(title, index, addDetails) {
  const card = document.createElement("div");
  card.className = "admin-status-index-card";
  const header = document.createElement("div");
  header.className = "admin-status-index-card-header";
  const name = document.createElement("span");
  name.className = "admin-status-index-name";
  name.textContent = title;
  const pill = document.createElement("span");
  pill.className = "admin-status-pill";
  if (!index?.configured) {
    pill.classList.add("admin-status-pill-off");
    pill.textContent = "미설정";
  } else if (index.ok) {
    pill.classList.add("admin-status-pill-ok");
    pill.textContent = "정상";
  } else {
    pill.classList.add("admin-status-pill-fail");
    pill.textContent = "오류";
  }
  header.append(name, pill);
  card.append(header);
  if (index?.configured) addDetails(card, index);
  if (index?.error) {
    const err = document.createElement("div");
    err.className = "admin-status-index-error";
    err.textContent = index.error;
    card.append(err);
  }
  if (index?.hint) {
    const hint = document.createElement("div");
    hint.className = "admin-status-index-error";
    hint.textContent = index.hint;
    card.append(hint);
  }
  return card;
}

function addCardStat(card, label, value) {
  const row = document.createElement("div");
  row.className = "admin-status-stat-row";
  const lbl = document.createElement("span");
  lbl.className = "admin-status-stat-label";
  lbl.textContent = label;
  const val = document.createElement("span");
  val.className = "admin-status-stat-value";
  val.textContent = value;
  row.append(lbl, val);
  card.append(row);
}

// ===== App event binding =====

export function bindAdminEvents({ hideDropOverlay, resetDragDepth }) {
  window.addEventListener("myai:settingsadminopen", async () => {
    await loadAdminStatus();
    await renderAdminDialogState();
  });
  if (elements.closeAdminNotebookButton) {
    elements.closeAdminNotebookButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      closeAdminNotebookDialog();
    });
  }
  if (elements.adminNotebookDialog) {
    elements.adminNotebookDialog.addEventListener("click", (event) => {
      if (event.target === elements.adminNotebookDialog) {
        event.preventDefault();
        event.stopPropagation();
        closeAdminNotebookDialog();
      }
    });
    elements.adminNotebookDialog.addEventListener("close", () => {
      resetAdminFileInput();
      adminUiState.selectedId = null;
      resetDragDepth();
      hideDropOverlay();
    });
  }
  if (elements.settingsDialog) {
    elements.settingsDialog.addEventListener("close", () => {
      resetAdminFileInput();
      adminUiState.selectedId = null;
      resetDragDepth();
      hideDropOverlay();
    });
  }
  if (elements.adminRecheckButton) {
    elements.adminRecheckButton.addEventListener("click", async () => {
      await loadAdminStatus();
      await renderAdminDialogState();
    });
  }
  if (elements.adminTokenSubmitButton) elements.adminTokenSubmitButton.addEventListener("click", submitAdminToken);
  if (elements.adminTokenInput) {
    elements.adminTokenInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); submitAdminToken(); }
    });
  }
  if (elements.adminTokenToggleButton) {
    elements.adminTokenToggleButton.addEventListener("click", () => {
      const input = elements.adminTokenInput;
      if (!input) return;
      input.type = input.type === "password" ? "text" : "password";
      elements.adminTokenToggleButton.setAttribute("aria-label", input.type === "password" ? "입력값 표시" : "입력값 숨김");
    });
  }
  if (elements.adminLogoutButton) elements.adminLogoutButton.addEventListener("click", adminLogout);
  if (elements.adminNotebookMenuButton) elements.adminNotebookMenuButton.addEventListener("click", showAdminNotebooksPanel);
  if (elements.adminStatusButton) elements.adminStatusButton.addEventListener("click", showAdminStatus);
  if (elements.adminAccessButton) elements.adminAccessButton.addEventListener("click", () => showAdminAccessPanel().catch((error) => alert(error.message)));
  if (elements.adminRagEvalButton) elements.adminRagEvalButton.addEventListener("click", showAdminRagEval);
  if (elements.adminStatsButton) elements.adminStatsButton.addEventListener("click", showAdminStats);
  bindRagEvalEvents();
  bindStatsEvents();
  if (elements.adminRefreshStatusButton) elements.adminRefreshStatusButton.addEventListener("click", renderAdminRagStatus);
  if (elements.adminAccessRefreshButton) elements.adminAccessRefreshButton.addEventListener("click", () => refreshAdminAccessConfig().catch((error) => alert(error.message)));
  if (elements.adminAccessGroupsTab) elements.adminAccessGroupsTab.addEventListener("click", () => switchAdminAccessTab("groups"));
  if (elements.adminAccessSuperTab) elements.adminAccessSuperTab.addEventListener("click", () => switchAdminAccessTab("super"));
  if (elements.adminAccessAddGroupButton) elements.adminAccessAddGroupButton.addEventListener("click", () => addAdminAccessGroup().catch((error) => alert(error.message)));
  if (elements.adminNotebookAccessSaveButton) elements.adminNotebookAccessSaveButton.addEventListener("click", () => saveAdminNotebookAccessPolicy());
  if (elements.accessGroupSelect) elements.accessGroupSelect.addEventListener("change", renderAccessLevelOptions);
  if (elements.accessLoginButton) elements.accessLoginButton.addEventListener("click", submitAccessLogin);
  if (elements.accessLogoutButton) elements.accessLogoutButton.addEventListener("click", logoutAccess);
  if (elements.accessPasswordInput) {
    elements.accessPasswordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") { event.preventDefault(); submitAccessLogin(); }
    });
  }
  if (elements.accessSuperInput) {
    elements.accessSuperInput.addEventListener("change", () => {
      const superMode = Boolean(elements.accessSuperInput?.checked);
      if (elements.accessGroupSelect) elements.accessGroupSelect.disabled = superMode;
      if (elements.accessLevelSelect) elements.accessLevelSelect.disabled = superMode;
    });
  }
  if (elements.adminNewNotebookButton) elements.adminNewNotebookButton.addEventListener("click", showAdminNewNotebookForm);
  if (elements.adminCancelNewNotebookButton) {
    elements.adminCancelNewNotebookButton.addEventListener("click", () => {
      if (elements.adminNewNotebookForm) elements.adminNewNotebookForm.hidden = true;
      renderAdminDetail();
    });
  }
  if (elements.adminNewNotebookForm) {
    elements.adminNewNotebookForm.addEventListener("submit", (event) => { event.preventDefault(); adminCreateNotebook(); });
  }
  if (elements.adminBackToListButton) {
    elements.adminBackToListButton.addEventListener("click", () => {
      adminUiState.mobileView = "list";
      if (elements.adminWorkspace) {
        elements.adminWorkspace.dataset.mobileView = "list";
        const isMobile = window.matchMedia?.("(max-width: 720px)")?.matches ?? false;
        if (elements.adminBackToListButton) elements.adminBackToListButton.hidden = !isMobile;
      }
    });
  }
  if (elements.adminDetailNameInput) {
    elements.adminDetailNameInput.addEventListener("input", () => scheduleAdminDetailSave());
    elements.adminDetailNameInput.addEventListener("blur", () => commitAdminDetailSave());
  }
  if (elements.adminDetailDescriptionInput) {
    elements.adminDetailDescriptionInput.addEventListener("input", () => scheduleAdminDetailSave());
    elements.adminDetailDescriptionInput.addEventListener("blur", () => commitAdminDetailSave());
  }
  if (elements.adminDeleteNotebookButton) {
    elements.adminDeleteNotebookButton.addEventListener("click", () => {
      const notebook = adminUiState.selectedNotebook;
      if (notebook) adminDeleteNotebook(notebook.id, notebook.name);
    });
  }
  if (elements.adminDropZone) {
    elements.adminDropZone.addEventListener("click", (event) => {
      if (!isAdminDialogOpen() || !adminUiState.selectedId) return;
      event.preventDefault();
      event.stopPropagation();
      requestAdminFileSelection();
    });
    elements.adminDropZone.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      if (!isAdminDialogOpen() || !adminUiState.selectedId) return;
      event.preventDefault();
      event.stopPropagation();
      requestAdminFileSelection();
    });
    elements.adminDropZone.addEventListener("dragover", (event) => {
      if (!isAdminDialogOpen() || !adminUiState.selectedId) return;
      event.preventDefault();
      event.stopPropagation();
      elements.adminDropZone.classList.add("dragover");
    });
    elements.adminDropZone.addEventListener("dragleave", (event) => {
      event.stopPropagation();
      elements.adminDropZone.classList.remove("dragover");
    });
    elements.adminDropZone.addEventListener("drop", (event) => {
      event.preventDefault();
      event.stopPropagation();
      elements.adminDropZone.classList.remove("dragover");
      resetDragDepth();
      hideDropOverlay();
      if (!isAdminDialogOpen() || !adminUiState.selectedId) return;
      const files = Array.from(event.dataTransfer?.files || []);
      if (files.length) uploadAdminDocuments(adminUiState.selectedId, files);
    });
  }
  if (elements.adminFileInput) {
    elements.adminFileInput.addEventListener("click", (event) => event.stopPropagation());
    elements.adminFileInput.addEventListener("change", (event) => {
      const files = Array.from(event.target.files || []);
      const notebookId = adminUiState.selectedId;
      event.target.value = "";
      if (!isAdminDialogOpen() || !notebookId || !files.length) return;
      uploadAdminDocuments(notebookId, files);
    });
  }

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && target.classList.contains("admin-copy-button")) {
      const text = target.dataset.copy ?? "";
      if (!text) return;
      navigator.clipboard?.writeText(text).then(() => {
        target.classList.add("copied");
        const original = target.textContent;
        target.textContent = "복사됨";
        setTimeout(() => { target.classList.remove("copied"); target.textContent = original; }, 1200);
      }).catch(() => {});
    }
  });
}
