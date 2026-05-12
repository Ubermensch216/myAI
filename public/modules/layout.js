import { state, elements, ensureLayoutState } from "./state.js";
import { scheduleSave } from "./persistence.js";

const LEFT_MIN = 260;
const LEFT_MAX = 520;
const RIGHT_MIN = 300;
const RIGHT_MAX = 640;
const RIGHT_COLLAPSED = 58;
const KEYBOARD_STEP = 24;

export function bindLayoutEvents() {
  applyLayoutState();
  bindResizer(elements.leftPanelResizer, "left");
  bindResizer(elements.rightPanelResizer, "right");
  elements.studioToggleButton?.addEventListener("click", () => {
    const layout = ensureLayoutState();
    setStudioCollapsed(!layout.rightPanelCollapsed);
  });
  elements.studioMindmapRailButton?.addEventListener("click", () => setStudioCollapsed(false));
  elements.studioLawRailButton?.addEventListener("click", () => setStudioCollapsed(false));
  elements.studioGraphRailButton?.addEventListener("click", () => setStudioCollapsed(false));
  document.getElementById("studioDocToolRailButton")?.addEventListener("click", () => setStudioCollapsed(false));
  window.addEventListener("resize", applyLayoutState);
}

export function applyLayoutState() {
  const layout = ensureLayoutState();
  if (!elements.appShell) return;
  elements.appShell.style.setProperty("--left-panel-width", `${layout.leftPanelWidth}px`);
  elements.appShell.style.setProperty(
    "--right-panel-width",
    `${layout.rightPanelCollapsed ? RIGHT_COLLAPSED : layout.rightPanelWidth}px`
  );
  elements.appShell.dataset.studioCollapsed = layout.rightPanelCollapsed ? "true" : "false";
  elements.studioPanel?.classList.toggle("collapsed", layout.rightPanelCollapsed);
  if (elements.studioToggleButton) {
    elements.studioToggleButton.setAttribute("aria-expanded", layout.rightPanelCollapsed ? "false" : "true");
  }
}

export function setStudioCollapsed(collapsed) {
  const layout = ensureLayoutState();
  layout.rightPanelCollapsed = Boolean(collapsed);
  applyLayoutState();
  scheduleSave();
}

function bindResizer(resizer, side) {
  if (!resizer) return;
  resizer.addEventListener("pointerdown", (event) => beginResize(event, side));
  resizer.addEventListener("keydown", (event) => handleResizerKey(event, side));
}

function beginResize(event, side) {
  if (event.button !== 0) return;
  const shell = elements.appShell;
  if (!shell) return;
  event.preventDefault();
  if (side === "right" && ensureLayoutState().rightPanelCollapsed) setStudioCollapsed(false);
  const rect = shell.getBoundingClientRect();
  const move = (moveEvent) => updatePanelWidth(side, moveEvent.clientX, rect);
  const stop = () => {
    document.body.classList.remove("panel-resizing");
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", stop);
    scheduleSave();
  };
  document.body.classList.add("panel-resizing");
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", stop, { once: true });
}

function handleResizerKey(event, side) {
  if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
  event.preventDefault();
  const direction = event.key === "ArrowRight" ? 1 : -1;
  const layout = ensureLayoutState();
  if (side === "left") {
    layout.leftPanelWidth = clamp(layout.leftPanelWidth + direction * KEYBOARD_STEP, LEFT_MIN, LEFT_MAX);
  } else {
    if (layout.rightPanelCollapsed) layout.rightPanelCollapsed = false;
    layout.rightPanelWidth = clamp(layout.rightPanelWidth - direction * KEYBOARD_STEP, RIGHT_MIN, RIGHT_MAX);
  }
  applyLayoutState();
  scheduleSave();
}

function updatePanelWidth(side, clientX, shellRect) {
  const layout = ensureLayoutState();
  if (side === "left") {
    layout.leftPanelWidth = clamp(clientX - shellRect.left, LEFT_MIN, LEFT_MAX);
  } else {
    layout.rightPanelCollapsed = false;
    layout.rightPanelWidth = clamp(shellRect.right - clientX, RIGHT_MIN, RIGHT_MAX);
  }
  applyLayoutState();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
