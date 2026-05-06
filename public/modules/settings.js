import { state, elements, normalizeColorTheme, DEFAULT_BANNER_SRC, DEFAULT_FAVICON_HREF } from "./state.js";
import { scheduleSave } from "./persistence.js";

export function renderBrand() {
  const appName = state.settings.appName || "Ollama Chatter";
  const banner = state.settings.appBannerDataUrl || DEFAULT_BANNER_SRC;
  state.settings.aiName = appName;
  document.title = appName;
  document.documentElement.dataset.theme = state.settings.theme || "light";
  document.documentElement.dataset.colorTheme = normalizeColorTheme(state.settings.colorTheme);
  renderThemeToggle();
  renderColorThemeToggle();
  elements.appNameText.textContent = appName;
  elements.appBannerImg.src = banner;
  elements.appBannerImg.alt = appName;
  elements.faviconLink.href = DEFAULT_FAVICON_HREF;
}

export function closeSettings() {
  elements.settingsDialog.close();
}

function openSettings() {
  elements.userTitleInput.value = state.settings.userTitle;
  elements.appNameInput.value = state.settings.appName || "Ollama Chatter";
  renderThemeToggle();
  renderColorThemeToggle();
  elements.customPromptInput.value = state.settings.customPrompt || "";
  renderBannerPreview();
  renderSystemAvatarPreview();
  renderAvatarPreview();
  elements.settingsDialog.showModal();
  elements.appBannerTrigger.focus();
}

function setTheme(theme) {
  state.settings.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.settings.theme;
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
  document.documentElement.dataset.colorTheme = state.settings.colorTheme;
  renderColorThemeToggle();
  scheduleSave();
}

function renderColorThemeToggle() {
  const colorTheme = normalizeColorTheme(state.settings.colorTheme);
  for (const option of elements.colorThemeOptions) {
    const selected = option.dataset.colorThemeValue === colorTheme;
    option.classList.toggle("active", selected);
    option.setAttribute("aria-pressed", String(selected));
  }
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
    state.settings.appName = elements.appNameInput.value.trim() || "Ollama Chatter";
    state.settings.aiName = state.settings.appName || "Ollama Chatter";
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
}
