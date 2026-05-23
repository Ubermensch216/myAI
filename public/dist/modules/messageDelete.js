import { state, elements, getActiveRoom, showConfirmDialog } from "./state.js";
import { scheduleSave } from "./persistence.js";

let selectionMode = false;
const selectedIndices = new Set();

export function getSelectionMode() {
  return selectionMode;
}

export function isSelected(index) {
  return selectedIndices.has(index);
}

export function getSelectedCount() {
  return selectedIndices.size;
}

export function toggleSelection(index) {
  if (selectedIndices.has(index)) selectedIndices.delete(index);
  else selectedIndices.add(index);
  updateBulkBar();
}

export function toggleSelectionMode() {
  selectionMode = !selectionMode;
  selectedIndices.clear();
  if (elements.messages) elements.messages.classList.toggle("messages-selection-mode", selectionMode);
  if (elements.selectionModeToggle) {
    elements.selectionModeToggle.classList.toggle("active", selectionMode);
    elements.selectionModeToggle.setAttribute("aria-pressed", selectionMode ? "true" : "false");
  }
  if (elements.bulkDeleteBar) elements.bulkDeleteBar.hidden = !selectionMode;
  window.dispatchEvent(new CustomEvent("myai:rendermessages"));
  updateBulkBar();
}

export function exitSelectionMode() {
  if (!selectionMode) return;
  toggleSelectionMode();
}

export async function requestDeleteMessages(indices) {
  if (state.abortController) return;
  const room = getActiveRoom();
  if (!room || !Array.isArray(room.messages) || !room.messages.length) return;

  const unique = [...new Set(indices.filter((value) => Number.isInteger(value) && value >= 0 && value < room.messages.length))];
  if (!unique.length) return;

  const warning = wouldBreakAlternation(room.messages, unique)
    ? "삭제 후 같은 역할이 연속됩니다. 다음 요청이 모델에 의해 거부될 수 있습니다."
    : "";

  const lines = [
    `${unique.length}개 메시지를 삭제합니다. 되돌릴 수 없습니다.`
  ];
  if (warning) lines.push(warning);

  const ok = await showConfirmDialog({
    title: "메시지 삭제",
    body: lines,
    okText: "삭제",
    cancelText: "취소",
    danger: true
  });
  if (!ok) return;

  unique.sort((a, b) => b - a).forEach((index) => room.messages.splice(index, 1));
  selectedIndices.clear();
  room.updatedAt = new Date().toISOString();
  scheduleSave();
  window.dispatchEvent(new CustomEvent("myai:rendermessages"));
  window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  updateBulkBar();
}

export function createDeleteButton(article) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action-button delete-message-button";
  button.title = "메시지 삭제";
  button.setAttribute("aria-label", "메시지 삭제");
  button.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 6h18"></path>
      <path d="M8 6V4h8v2"></path>
      <path d="m19 6-1 14H6L5 6"></path>
      <path d="M10 11v5"></path>
      <path d="M14 11v5"></path>
    </svg>
  `;
  button.addEventListener("click", () => {
    const idx = Number(article.dataset.messageIndex);
    if (!Number.isInteger(idx)) return;
    requestDeleteMessages([idx]);
  });
  return button;
}

function updateBulkBar() {
  if (!elements.bulkDeleteBar) return;
  const count = selectedIndices.size;
  if (elements.bulkCount) elements.bulkCount.textContent = `${count}개 선택됨`;
  if (elements.bulkDeleteButton) {
    elements.bulkDeleteButton.disabled = count === 0 || !!state.abortController;
    elements.bulkDeleteButton.textContent = count > 0 ? `선택 삭제 (${count})` : "선택 삭제";
  }
}

export function refreshBulkBar() {
  updateBulkBar();
}

export function getSelectedIndicesSnapshot() {
  return [...selectedIndices];
}

function wouldBreakAlternation(messages, indicesToDelete) {
  const drop = new Set(indicesToDelete);
  const remaining = messages.filter((_value, index) => !drop.has(index));
  for (let i = 1; i < remaining.length; i += 1) {
    if (remaining[i].role === remaining[i - 1].role) return true;
  }
  return false;
}
