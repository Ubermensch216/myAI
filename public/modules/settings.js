import {
  state, elements, normalizeColorTheme, normalizeCustomColorTheme,
  DEFAULT_BANNER_SRC, DEFAULT_FAVICON_HREF
} from "./state.js";
import { scheduleSave } from "./persistence.js";

let activeSettingsTab = "personal";
let adminConsoleMounted = false;

export function renderBrand() {
  const appName = state.settings.appName || "myAI";
  const banner = state.settings.appBannerDataUrl || DEFAULT_BANNER_SRC;
  state.settings.aiName = appName;
  document.title = appName;
  document.documentElement.dataset.theme = state.settings.theme || "light";
  applyColorTheme();
  renderThemeToggle();
  renderColorThemeToggle();
  elements.appNameText.textContent = appName;
  elements.appBannerImg.src = banner;
  elements.appBannerImg.alt = appName;
  if (elements.promptInput) {
    elements.promptInput.placeholder = `${appName}에게 물어보세요 [⇧+I]`;
  }
  elements.faviconLink.href = DEFAULT_FAVICON_HREF;
}

export function closeSettings() {
  elements.settingsDialog.close();
}

function openSettings() {
  elements.userTitleInput.value = state.settings.userTitle;
  elements.appNameInput.value = state.settings.appName || "myAI";
  renderThemeToggle();
  renderColorThemeToggle();
  elements.customPromptInput.value = state.settings.customPrompt || "";
  renderBannerPreview();
  renderSystemAvatarPreview();
  renderAvatarPreview();
  switchSettingsTab("personal");
  elements.settingsDialog.showModal();
  elements.appBannerTrigger.focus();
}

function mountAdminConsole() {
  if (adminConsoleMounted || !elements.settingsAdminMount || !elements.adminNotebookDialog) return;
  while (elements.adminNotebookDialog.firstChild) {
    elements.settingsAdminMount.append(elements.adminNotebookDialog.firstChild);
  }
  elements.adminNotebookDialog.remove();
  adminConsoleMounted = true;
}

function switchSettingsTab(tab) {
  activeSettingsTab = tab === "admin" ? "admin" : "personal";
  const adminActive = activeSettingsTab === "admin";
  elements.settingsPersonalPanel.hidden = adminActive;
  elements.settingsAdminPanel.hidden = !adminActive;
  elements.settingsPersonalTab.classList.toggle("active", !adminActive);
  elements.settingsAdminTab.classList.toggle("active", adminActive);
  elements.settingsPersonalTab.setAttribute("aria-selected", String(!adminActive));
  elements.settingsAdminTab.setAttribute("aria-selected", String(adminActive));
  elements.settingsDialog.classList.toggle("admin-mode", adminActive);
  if (adminActive) {
    mountAdminConsole();
    window.dispatchEvent(new CustomEvent("myai:settingsadminopen"));
  }
}

function setTheme(theme) {
  state.settings.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.settings.theme;
  applyColorTheme();
  renderThemeToggle();
}

function renderThemeToggle() {
  const theme = state.settings.theme === "dark" ? "dark" : "light";
  for (const option of elements.themeOptions) {
    const selected = option.dataset.themeValue === theme;
    option.classList.toggle("active", selected);
    option.setAttribute("aria-pressed", String(selected));
  }
}

function setColorTheme(colorTheme) {
  state.settings.colorTheme = normalizeColorTheme(colorTheme);
  applyColorTheme();
  renderColorThemeToggle();
  scheduleSave();
}

function applyColorTheme() {
  const root = document.documentElement;
  const colorTheme = normalizeColorTheme(state.settings.colorTheme);
  state.settings.colorTheme = colorTheme;
  root.dataset.colorTheme = colorTheme;
  if (colorTheme !== "custom") {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-dark");
    root.style.removeProperty("--accent-aux");
    return;
  }
  const palette = normalizeCustomColorTheme(state.settings.customColorTheme);
  state.settings.customColorTheme = palette;
  root.style.setProperty("--accent", palette.accent);
  root.style.setProperty("--accent-dark", palette.accentDark);
  root.style.setProperty("--accent-aux", palette.accentAux);
}

function renderColorThemeToggle() {
  const colorTheme = normalizeColorTheme(state.settings.colorTheme);
  for (const option of elements.colorThemeOptions) {
    const selected = option.dataset.colorThemeValue === colorTheme;
    option.classList.toggle("active", selected);
    option.setAttribute("aria-pressed", String(selected));
  }
  renderCustomColorControls();
}

function renderCustomColorControls() {
  const palette = normalizeCustomColorTheme(state.settings.customColorTheme);
  state.settings.customColorTheme = palette;
  if (elements.customColorPanel) elements.customColorPanel.hidden = normalizeColorTheme(state.settings.colorTheme) !== "custom";
  for (const input of elements.customColorInputs) {
    const key = input.dataset.customColorKey;
    if (key && palette[key]) input.value = palette[key];
  }
  if (elements.customColorThemeThumb) {
    elements.customColorThemeThumb.style.background = `linear-gradient(135deg, ${palette.accentAux} 0%, ${palette.accentDark} 48%, ${palette.accent} 100%)`;
  }
}

function updateCustomColor(key, value) {
  const current = normalizeCustomColorTheme(state.settings.customColorTheme);
  state.settings.customColorTheme = normalizeCustomColorTheme({ ...current, [key]: value });
  state.settings.colorTheme = "custom";
  applyColorTheme();
  renderColorThemeToggle();
  scheduleSave();
}

function renderBannerPreview() {
  const banner = state.settings.appBannerDataUrl || DEFAULT_BANNER_SRC;
  const hasCustom = Boolean(state.settings.appBannerDataUrl);
  elements.appBannerPreview.src = banner;
  elements.appBannerPreview.hidden = false;
  elements.appBannerPicker.dataset.state = hasCustom ? "filled" : "default";
  elements.removeBannerButton.disabled = !hasCustom;
}

function renderAvatarPreview() {
  renderLogoPickerPreview({
    dataUrl: state.settings.userAvatarDataUrl,
    preview: elements.userAvatarPreview,
    picker: elements.userAvatarPicker
  });
}

function renderSystemAvatarPreview() {
  renderLogoPickerPreview({
    dataUrl: state.settings.systemAvatarDataUrl,
    preview: elements.systemAvatarPreview,
    picker: elements.systemAvatarPicker
  });
}

function renderLogoPickerPreview({ dataUrl, preview, picker }) {
  if (dataUrl) {
    preview.src = dataUrl;
    preview.hidden = false;
    picker.dataset.state = "filled";
  } else {
    preview.hidden = true;
    preview.removeAttribute("src");
    picker.dataset.state = "empty";
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function bindSettingsEvents() {
  elements.settingsButton.addEventListener("click", openSettings);
  elements.closeSettingsButton.addEventListener("click", closeSettings);
  elements.cancelSettingsButton.addEventListener("click", closeSettings);
  elements.settingsPersonalTab.addEventListener("click", () => switchSettingsTab("personal"));
  elements.settingsAdminTab.addEventListener("click", () => switchSettingsTab("admin"));
  window.addEventListener("myai:opensettingsadmin", () => {
    openSettings();
    switchSettingsTab("admin");
  });

  const openBannerPicker = () => { if (!state.busy) elements.appBannerInput.click(); };
  const openAvatarPicker = () => { if (!state.busy) elements.userAvatarInput.click(); };
  const openSystemAvatarPicker = () => { if (!state.busy) elements.systemAvatarInput.click(); };

  elements.appBannerTrigger.addEventListener("click", openBannerPicker);
  elements.changeBannerButton.addEventListener("click", openBannerPicker);
  elements.systemAvatarTrigger.addEventListener("click", () => {
    if (elements.systemAvatarPicker.dataset.state === "empty") openSystemAvatarPicker();
  });
  elements.changeSystemAvatarButton.addEventListener("click", openSystemAvatarPicker);
  elements.userAvatarTrigger.addEventListener("click", () => {
    if (elements.userAvatarPicker.dataset.state === "empty") openAvatarPicker();
  });
  elements.changeAvatarButton.addEventListener("click", openAvatarPicker);

  elements.removeBannerButton.addEventListener("click", () => {
    state.settings.appBannerDataUrl = "";
    renderBannerPreview();
  });
  elements.removeSystemAvatarButton.addEventListener("click", () => {
    state.settings.systemAvatarDataUrl = "";
    renderSystemAvatarPreview();
  });
  elements.removeAvatarButton.addEventListener("click", () => {
    state.settings.userAvatarDataUrl = "";
    renderAvatarPreview();
  });

  elements.appBannerInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.settings.appBannerDataUrl = await readFileAsDataUrl(file);
    renderBannerPreview();
    elements.appBannerInput.value = "";
  });
  elements.systemAvatarInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.settings.systemAvatarDataUrl = await readFileAsDataUrl(file);
    renderSystemAvatarPreview();
    elements.systemAvatarInput.value = "";
  });
  elements.userAvatarInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    state.settings.userAvatarDataUrl = await readFileAsDataUrl(file);
    renderAvatarPreview();
    elements.userAvatarInput.value = "";
  });

  elements.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings.userTitle = elements.userTitleInput.value.trim() || "사용자님";
    state.settings.appName = elements.appNameInput.value.trim() || "myAI";
    state.settings.aiName = state.settings.appName || "myAI";
    state.settings.customPrompt = elements.customPromptInput.value.trim();
    scheduleSave();
    closeSettings();
    window.dispatchEvent(new CustomEvent("myai:renderall"));
  });

  for (const themeOption of elements.themeOptions) {
    themeOption.addEventListener("click", () => setTheme(themeOption.dataset.themeValue === "dark" ? "dark" : "light"));
  }
  for (const colorOption of elements.colorThemeOptions) {
    colorOption.addEventListener("click", () => setColorTheme(colorOption.dataset.colorThemeValue));
  }
  for (const input of elements.customColorInputs) {
    input.addEventListener("input", () => updateCustomColor(input.dataset.customColorKey, input.value));
    input.addEventListener("change", () => updateCustomColor(input.dataset.customColorKey, input.value));
  }
}
