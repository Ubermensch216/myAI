import { state, elements, getActiveRoom, showConfirmDialog } from "./state.js";
import { scheduleSave } from "./persistence.js";

const ADMIN_TOKEN_SESSION_KEY = "myai_admin_token";

let adminDetailSaveTimer = null;
const ADMIN_INGEST_POLL_MS = 1200;
const ADMIN_INGEST_MAX_POLLS = 900;

export const adminUiState = {
  notebooks: [],
  selectedId: null,
  selectedNotebook: null,
  mobileView: "list"
};

// ===== Notebook selector =====

export async function loadNotebooks() {
  try {
    const response = await fetch("/api/notebooks");
    if (!response.ok) return;
    const result = await response.json();
    state.notebooks = Array.isArray(result.notebooks) ? result.notebooks : [];
    renderActiveNotebookUi();
  } catch (error) {
    console.warn("노트북 목록을 불러오지 못했습니다:", error.message);
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

export function findNotebookSummary(notebookId) {
  if (!notebookId) return null;
  return state.notebooks.find((nb) => nb.id === notebookId) ?? null;
}

export function getActiveNotebookId() {
  return getActiveRoom()?.selectedNotebookId ?? null;
}

export function renderActiveNotebookUi() {
  const id = getActiveNotebookId();
  const notebook = findNotebookSummary(id);
  if (!elements.notebookBadge) return;
  if (notebook) {
    elements.notebookBadge.hidden = false;
    elements.notebookBadgeName.textContent = notebook.name;
    elements.notebookBadge.title = `부서노트북: ${notebook.name}`;
  } else {
    elements.notebookBadge.hidden = true;
  }
}

export async function openNotebookSelector() {
  if (!elements.notebookSelectorDialog) return;
  // Close attach menu via custom event
  window.dispatchEvent(new CustomEvent("myai:closeattachmenu"));
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
    empty.textContent = "등록된 부서노트북이 없습니다.";
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
}

// ===== Admin panel =====

function adminAuthHeader() {
  return state.admin.token ? { Authorization: `Bearer ${state.admin.token}` } : {};
}

export function renderAdminEntry() {
  if (!elements.openAdminNotebookButton) return;
  elements.openAdminNotebookButton.hidden = !state.admin.configured;
  const status = state.admin.authenticated && state.admin.token
    ? "active"
    : state.admin.configured ? "locked" : "unavailable";
  elements.openAdminNotebookButton.dataset.status = status;
  elements.openAdminNotebookButton.title = state.admin.authenticated
    ? "부서노트북 관리"
    : "부서노트북 관리 (관리자 인증 필요)";
}

export function isAdminDialogOpen() {
  return Boolean(elements.adminNotebookDialog?.open);
}

export function resetAdminFileInput() {
  if (elements.adminFileInput) elements.adminFileInput.value = "";
}

export function requestAdminFileSelection() {
  if (!isAdminDialogOpen() || !adminUiState.selectedId || !elements.adminFileInput) return;
  resetAdminFileInput();
  elements.adminFileInput.click();
}

export async function openAdminNotebookDialog() {
  if (!elements.adminNotebookDialog) return;
  window.dispatchEvent(new CustomEvent("myai:closesettings"));
  await loadAdminStatus();
  await renderAdminDialogState();
  if (!elements.adminNotebookDialog.open) elements.adminNotebookDialog.showModal();
}

export async function renderAdminDialogState() {
  if (!state.admin.configured) { showAdminUnconfigured(); return; }
  if (state.admin.authenticated && state.admin.token) {
    showAdminContent();
    await refreshAdminNotebooks();
    return;
  }
  showAdminLogin();
}

export function closeAdminNotebookDialog() {
  resetAdminFileInput();
  if (elements.adminNotebookDialog?.open) elements.adminNotebookDialog.close();
}

function showAdminUnconfigured() {
  clearAdminDetailSaveTimer();
  if (elements.adminUnconfiguredSection) elements.adminUnconfiguredSection.hidden = false;
  if (elements.adminAuthSection) elements.adminAuthSection.hidden = true;
  if (elements.adminWorkspace) elements.adminWorkspace.hidden = true;
  if (elements.adminLogoutButton) elements.adminLogoutButton.hidden = true;
  if (elements.adminDialogSubtitle) elements.adminDialogSubtitle.textContent = "서버 설정 필요";
  if (elements.adminTokenError) elements.adminTokenError.hidden = true;
}

function showAdminLogin() {
  clearAdminDetailSaveTimer();
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
  if (elements.adminUnconfiguredSection) elements.adminUnconfiguredSection.hidden = true;
  if (elements.adminAuthSection) elements.adminAuthSection.hidden = true;
  if (elements.adminWorkspace) elements.adminWorkspace.hidden = false;
  if (elements.adminLogoutButton) elements.adminLogoutButton.hidden = false;
  if (elements.adminDialogSubtitle) elements.adminDialogSubtitle.textContent = "공유 지식 자료";
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
  adminUiState.selectedId = null;
  adminUiState.selectedNotebook = null;
  adminUiState.mobileView = "detail";
  renderAdminList();
  if (elements.adminStatusPanel) elements.adminStatusPanel.hidden = true;
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
  if (!name) { alert("노트북 이름을 입력하세요."); return; }
  try {
    const response = await fetch("/api/notebooks", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...adminAuthHeader() },
      body: JSON.stringify({ name, description })
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || "노트북 생성 실패");
    }
    const result = await response.json().catch(() => ({}));
    adminUiState.selectedId = result.notebook?.id || null;
    adminUiState.mobileView = "detail";
    hideAdminNewNotebookForm();
    await refreshAdminNotebooks();
    await loadNotebooks();
  } catch (error) {
    alert(`노트북 생성 실패: ${error.message}`);
  }
}

export async function adminDeleteNotebook(notebookId, notebookName) {
  const confirmed = await showConfirmDialog({
    title: "노트북 삭제",
    body: `부서노트북 "${notebookName}"을(를) 삭제할까요? 등록된 모든 문서가 사라집니다.`,
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
    const listResponse = await fetch("/api/notebooks");
    if (!listResponse.ok) throw new Error("노트북 목록 요청 실패");
    const listResult = await listResponse.json();
    const summaries = Array.isArray(listResult.notebooks) ? listResult.notebooks : [];
    const detailed = await Promise.all(
      summaries.map(async (summary) => {
        try {
          const res = await fetch(`/api/notebooks/${encodeURIComponent(summary.id)}`);
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
    empty.textContent = "등록된 노트북이 없습니다.";
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
  name.textContent = notebook.name || "이름 없는 노트북";
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
  adminUiState.selectedId = notebookId;
  adminUiState.selectedNotebook = adminUiState.notebooks.find((nb) => nb.id === notebookId) ?? null;
  adminUiState.mobileView = "detail";
  renderAdminList();
  renderAdminDetail();
  applyAdminMobileView();
}

export function renderAdminDetail() {
  if (!elements.adminDetailEmpty || !elements.adminDetailContent) return;
  if (elements.adminStatusPanel) elements.adminStatusPanel.hidden = true;
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

// ===== System status panel =====

export function showAdminStatus() {
  if (elements.adminDetailEmpty) elements.adminDetailEmpty.hidden = true;
  if (elements.adminDetailContent) elements.adminDetailContent.hidden = true;
  if (elements.adminNewNotebookForm) elements.adminNewNotebookForm.hidden = true;
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
    makeStatusBadge("리랭커", data.reranker?.enabled ? "활성" : "비활성")
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

function makeStatusBadge(label, value) {
  const badge = document.createElement("div");
  badge.className = "admin-status-badge";
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
  if (elements.openAdminNotebookButton) {
    elements.openAdminNotebookButton.addEventListener("click", openAdminNotebookDialog);
  }
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
  if (elements.adminStatusButton) elements.adminStatusButton.addEventListener("click", showAdminStatus);
  if (elements.adminRefreshStatusButton) elements.adminRefreshStatusButton.addEventListener("click", renderAdminRagStatus);
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
