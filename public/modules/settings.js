import {
  state, elements, normalizeColorTheme, normalizeCustomColorTheme,
  normalizeResponseStyle, DEFAULT_BANNER_SRC, DEFAULT_FAVICON_HREF
} from "./state.js";
import { scheduleSave } from "./persistence.js";
import { renderDocumentTemplatesSettings } from "./documentTemplates.js";

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
  if (elements.customPromptInput) {
    elements.customPromptInput.value = state.settings.customPrompt || "";
  }
  if (elements.responseStyleSelect) {
    elements.responseStyleSelect.value = normalizeResponseStyle(state.settings.responseStyle);
  }
  if (elements.customInstructionInput) {
    elements.customInstructionInput.value = state.settings.customInstruction || "";
  }
  renderBannerPreview();
  renderSystemAvatarPreview();
  renderAvatarPreview();
  renderDocumentTemplatesSettings(document.getElementById("settingsDocumentTemplatesMount"));
  switchSettingsTab("personal");
  switchSettingsSubTab("profileTheme");
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

function switchSettingsTab(tabId) {
  activeSettingsTab = tabId;
  const adminActive = tabId === "admin";

  // Update sidebar tab active states
  const tabs = document.querySelectorAll(".settings-sidebar .settings-tab");
  tabs.forEach(tab => {
    const isTarget = tab.dataset.tabTarget === tabId;
    tab.classList.toggle("active", isTarget);
    tab.setAttribute("aria-selected", String(isTarget));
  });

  const form = document.getElementById("settingsForm");
  const adminPanel = document.getElementById("settingsPanelAdmin");
  const formFooter = document.getElementById("settingsFormFooter");

  if (adminActive) {
    if (form) form.hidden = true;
    if (adminPanel) adminPanel.hidden = false;
    if (formFooter) formFooter.hidden = true;
  } else {
    if (form) form.hidden = false;
    if (adminPanel) adminPanel.hidden = true;
    if (formFooter) formFooter.hidden = false;
  }

  elements.settingsDialog.classList.toggle("admin-mode", adminActive);
  if (adminActive) {
    mountAdminConsole();
    window.dispatchEvent(new CustomEvent("myai:settingsadminopen"));
  }
}

function switchSettingsSubTab(subTabId) {
  const form = document.getElementById("settingsForm");
  if (!form) return;

  // Update sub-tab buttons
  const subTabs = form.querySelectorAll(".personal-console-nav .admin-console-nav-item");
  subTabs.forEach(btn => {
    const isActive = btn.dataset.subtab === subTabId;
    btn.classList.toggle("active", isActive);
  });

  // Update panels inside the form
  const panels = form.querySelectorAll(".settings-tab-panel");
  const targetId = "settingsPanel" + subTabId.charAt(0).toUpperCase() + subTabId.slice(1);
  panels.forEach(panel => {
    panel.hidden = panel.id !== targetId;
  });
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
  
  // Top-level sidebar tabs
  document.querySelectorAll(".settings-sidebar .settings-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tabTarget;
      if (target) switchSettingsTab(target);
    });
  });

  // Personal Console Sub-tabs
  const subNav = document.getElementById("personalConsoleNav");
  if (subNav) {
    subNav.querySelectorAll(".admin-console-nav-item").forEach(btn => {
      btn.addEventListener("click", () => {
        const subTabId = btn.dataset.subtab;
        if (subTabId) switchSettingsSubTab(subTabId);
      });
    });
  }

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
    if (elements.customPromptInput) {
      state.settings.customPrompt = elements.customPromptInput.value.trim();
    }
    if (elements.responseStyleSelect) {
      state.settings.responseStyle = normalizeResponseStyle(elements.responseStyleSelect.value);
    }
    if (elements.customInstructionInput) {
      state.settings.customInstruction = elements.customInstructionInput.value.trim();
    }
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

  // 예시 프롬프트 버튼 클릭 이벤트
  document.querySelectorAll(".prompt-example-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const promptText = btn.dataset.prompt;
      if (promptText && elements.customPromptInput) {
        elements.customPromptInput.value = promptText;
        elements.customPromptInput.focus();
        elements.customPromptInput.setSelectionRange(promptText.length, promptText.length);
      }
    });
  });
}
