import { elements, ensureRoomStudio, getActiveRoom } from "./state.js";
import { hydrateStoredDocuments, scheduleSave } from "./persistence.js";
import { getActiveDocuments } from "./chat.js";
import { openWithPreparedDraft } from "./documentStudio.js";

const MATERIAL_TEXT_LIMIT = 10000;
const DEFAULT_TAB = "article";

let _activeTab = DEFAULT_TAB;
let _workbenchAbort = null;
let _termsAbort = null;

export function bindLawWorkbenchEvents() {
  elements.lawWorkbenchRunButton?.addEventListener("click", () => {
    if (_workbenchAbort) {
      _workbenchAbort.abort();
      return;
    }
    runLawWorkbench();
  });
  elements.lawWorkbenchReportButton?.addEventListener("click", () => {
    createLawWorkbenchReport().catch((error) => setStatus(error.message || "보고서 생성에 실패했습니다.", "error"));
  });
  elements.lawWorkbenchResetButton?.addEventListener("click", resetLawWorkbench);
  elements.lawWorkbenchTabs?.forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.lawWorkbenchTab || DEFAULT_TAB));
  });
  for (const input of [elements.lawWorkbenchQuery, elements.lawWorkbenchLawName, elements.lawWorkbenchArticle, elements.lawWorkbenchRegion]) {
    input?.addEventListener("change", syncInputs);
  }
  elements.lawWorkbenchQuery?.addEventListener("input", debounceTermsPreview);
}

export function renderLawWorkbench() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const state = ensureWorkbenchState(studio);
  hydrateInputs(state);
  renderTabs();
  renderTerms(state);
  renderBody(state);
  if (elements.lawWorkbenchReportButton) {
    elements.lawWorkbenchReportButton.disabled = !state.data;
  }
}

function ensureWorkbenchState(studio) {
  if (!studio) return { input: {}, data: null, terms: [], activeTab: DEFAULT_TAB };
  if (!studio.lawWorkbench || typeof studio.lawWorkbench !== "object") {
    studio.lawWorkbench = { input: {}, data: null, terms: [], activeTab: DEFAULT_TAB };
  }
  if (!studio.lawWorkbench.data && studio.lawExplorer?.data) {
    studio.lawWorkbench.data = {
      input: studio.lawExplorer.input || {},
      article: { ok: true, citation: studio.lawExplorer.data.citation, text: studio.lawExplorer.data.text || "" },
      internalImpact: { ok: true, impactMap: studio.lawExplorer.data.impactMap },
      citations: studio.lawExplorer.data.citation ? [studio.lawExplorer.data.citation] : [],
      warnings: []
    };
  }
  if (!studio.lawWorkbench.history && studio.lawHistory) {
    studio.lawWorkbench.history = studio.lawHistory;
  }
  studio.lawWorkbench.input = studio.lawWorkbench.input || {};
  studio.lawWorkbench.terms = Array.isArray(studio.lawWorkbench.terms) ? studio.lawWorkbench.terms : [];
  studio.lawWorkbench.activeTab = studio.lawWorkbench.activeTab || DEFAULT_TAB;
  _activeTab = studio.lawWorkbench.activeTab;
  return studio.lawWorkbench;
}

function hydrateInputs(state) {
  const input = state?.input || {};
  setValueIfFree(elements.lawWorkbenchQuery, input.query || "");
  setValueIfFree(elements.lawWorkbenchLawName, input.lawName || "");
  setValueIfFree(elements.lawWorkbenchArticle, input.article || "");
  setValueIfFree(elements.lawWorkbenchRegion, input.region || "");
}

function setValueIfFree(element, value) {
  if (!element || document.activeElement === element || element.value) return;
  element.value = value || "";
}

function syncInputs() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const state = ensureWorkbenchState(studio);
  state.input = readInputs();
  scheduleSave();
}

function readInputs() {
  return {
    query: elements.lawWorkbenchQuery?.value?.trim() || "",
    lawName: elements.lawWorkbenchLawName?.value?.trim() || "",
    article: elements.lawWorkbenchArticle?.value?.trim() || "",
    region: elements.lawWorkbenchRegion?.value?.trim() || ""
  };
}

async function runLawWorkbench() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const state = ensureWorkbenchState(studio);
  const input = readInputs();
  if (!input.query && !input.lawName) {
    setStatus("질문 또는 법령명을 입력하세요.", "error");
    return;
  }
  if (await hydrateStoredDocuments()) window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  _workbenchAbort = new AbortController();
  setBusy(true);
  setStatus("공식 법령 근거를 탭별로 조회하는 중입니다.", "running");
  try {
    const response = await fetch("/api/law/workbench", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: _workbenchAbort.signal,
      body: JSON.stringify({
        ...input,
        materialText: collectMaterialText(),
        includeInternalImpact: true
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `status ${response.status}`);
    state.input = input;
    state.data = payload;
    state.terms = Array.isArray(payload.termMatches) ? payload.termMatches : state.terms;
    state.activeTab = _activeTab;
    room.updatedAt = new Date().toISOString();
    scheduleSave();
    setStatus("", "idle");
    renderLawWorkbench();
  } catch (error) {
    if (error?.name === "AbortError") setStatus("작업대 조회를 중단했습니다.", "idle");
    else setStatus(error.message || "작업대 조회에 실패했습니다.", "error");
  } finally {
    _workbenchAbort = null;
    setBusy(false);
  }
}

async function createLawWorkbenchReport() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const state = ensureWorkbenchState(studio);
  if (!state.data) throw new Error("먼저 작업대 조회를 실행하세요.");
  setStatus("검토 보고서 초안을 생성하는 중입니다.", "running");
  const templateId = elements.lawWorkbenchReportTemplate?.value || "law_review_opinion";
  const response = await fetch("/api/law/workbench/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workbench: state.data, templateId })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `status ${response.status}`);
  await openWithPreparedDraft({
    title: "법령 검토 보고서",
    markdown: payload.markdown,
    templateId: payload.recommendedTemplateId || templateId,
    metadata: payload.metadata || { lawWorkbench: true },
    citations: payload.citations || [],
    source: { sourceType: "law_workbench_report" }
  });
  setStatus("검토 보고서 초안을 문서 편집기에 생성했습니다.", "idle");
}

function resetLawWorkbench() {
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  if (!studio) return;
  studio.lawWorkbench = { input: {}, data: null, terms: [], activeTab: DEFAULT_TAB };
  _activeTab = DEFAULT_TAB;
  for (const input of [elements.lawWorkbenchQuery, elements.lawWorkbenchLawName, elements.lawWorkbenchArticle, elements.lawWorkbenchRegion]) {
    if (input) input.value = "";
  }
  scheduleSave();
  setStatus("", "idle");
  renderLawWorkbench();
}

function setActiveTab(tab) {
  _activeTab = tab || DEFAULT_TAB;
  const room = getActiveRoom();
  const studio = ensureRoomStudio(room);
  const state = ensureWorkbenchState(studio);
  state.activeTab = _activeTab;
  scheduleSave();
  renderLawWorkbench();
}

function renderTabs() {
  elements.lawWorkbenchTabs?.forEach((button) => {
    const active = button.dataset.lawWorkbenchTab === _activeTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function renderTerms(state) {
  const target = elements.lawWorkbenchTerms;
  if (!target) return;
  target.innerHTML = "";
  const terms = Array.isArray(state?.terms) ? state.terms : [];
  if (!terms.length) return;
  for (const term of terms.slice(0, 4)) {
    const chip = document.createElement("span");
    chip.className = "law-term-chip";
    chip.textContent = `${term.naturalTerms?.[0] || term.scenario} → ${(term.canonicalTerms || []).join(", ")}`;
    target.append(chip);
  }
}

function renderBody(state) {
  const target = elements.lawWorkbenchBody;
  if (!target) return;
  target.innerHTML = "";
  const data = state?.data;
  if (!data) {
    target.innerHTML = `<div class="law-explorer-empty">질문이나 법령명을 입력하고 작업대 조회를 누르면 공식 근거 묶음을 탭별로 확인할 수 있습니다.</div>`;
    return;
  }
  if (_activeTab === "article") renderArticle(target, data.article);
  else if (_activeTab === "annexes") renderListPanel(target, data.annexes?.items, "별표/서식");
  else if (_activeTab === "history") renderHistory(target, data.history);
  else if (_activeTab === "structure") renderStructure(target, data.structure);
  else if (_activeTab === "delegated") renderListPanel(target, data.delegated?.items, "위임/하위법령");
  else if (_activeTab === "ordinances") renderListPanel(target, data.ordinances?.items, "자치법규");
  else if (_activeTab === "decisions") renderDecisions(target, data.decisions);
  else if (_activeTab === "impact") renderImpact(target, data.internalImpact);
  renderWarnings(target, data.warnings);
}

function renderArticle(target, article) {
  if (!article?.ok) return renderEmpty(target, "조문 본문을 확인하지 못했습니다.");
  const header = document.createElement("div");
  header.className = "law-workbench-section-head";
  header.textContent = article.citation?.locator || "조문 본문";
  const body = document.createElement("pre");
  body.className = "law-snapshot-body";
  body.textContent = article.text || "(본문 없음)";
  target.append(header, body);
}

function renderHistory(target, history) {
  const revisions = Array.isArray(history?.revisions) ? history.revisions : [];
  if (!revisions.length) return renderEmpty(target, "개정 이력을 확인하지 못했습니다.");
  renderListPanel(target, revisions, "개정 이력", (item) => [
    item.effectiveDate ? `시행 ${item.effectiveDate}` : "시행일 미상",
    item.promulgationDate ? `공포 ${item.promulgationDate}` : "",
    item.revisionType || ""
  ].filter(Boolean).join(" / "));
}

function renderStructure(target, structure) {
  const tiers = structure?.tiers;
  if (!tiers) return renderEmpty(target, "법체계 정보를 확인하지 못했습니다.");
  if (Array.isArray(tiers)) return renderListPanel(target, tiers, "법체계");
  const rows = Object.entries(tiers).map(([level, value]) => ({ title: `${level}: ${value?.lawName || "확인 안 됨"}` }));
  renderListPanel(target, rows, "법체계");
}

function renderDecisions(target, decisions = {}) {
  const groups = [
    ["판례", decisions.precedents?.items],
    ["해석례", decisions.interpretations?.items],
    ["행정규칙", decisions.adminRules?.items]
  ];
  for (const [label, items] of groups) {
    const section = document.createElement("section");
    section.className = "law-workbench-result-section";
    const title = document.createElement("h4");
    title.textContent = label;
    section.append(title);
    appendItems(section, items || []);
    target.append(section);
  }
}

function renderImpact(target, impact) {
  if (!impact?.ok && !impact?.impactMap) return renderEmpty(target, impact?.summary || "내부자료 영향 분석 결과가 없습니다.");
  const summary = document.createElement("p");
  summary.className = "law-workbench-summary";
  summary.textContent = impact.summary || "내부자료 영향 분석을 완료했습니다.";
  target.append(summary);
  const nodes = (impact.impactMap?.nodes || []).filter((node) => node.type !== "law_article" && node.type !== "review_subject");
  renderListPanel(target, nodes, "영향 항목", (node) => `${node.label || node.id} - ${node.summary || ""}`);
}

function renderListPanel(target, items, title, labelFn = itemLabel) {
  const section = document.createElement("section");
  section.className = "law-workbench-result-section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  section.append(heading);
  appendItems(section, items || [], labelFn);
  target.append(section);
}

function appendItems(target, items, labelFn = itemLabel) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "law-explorer-empty";
    empty.textContent = "확인된 항목이 없습니다.";
    target.append(empty);
    return;
  }
  for (const item of list.slice(0, 20)) {
    const row = document.createElement("div");
    row.className = "law-workbench-result-row";
    row.textContent = labelFn(item);
    target.append(row);
  }
}

function renderWarnings(target, warnings = []) {
  if (!Array.isArray(warnings) || !warnings.length) return;
  const box = document.createElement("div");
  box.className = "law-workbench-warnings";
  box.textContent = warnings.map((item) => `${item.source || "source"}: ${item.message || item.marker || "확인 필요"}`).join(" / ");
  target.append(box);
}

function renderEmpty(target, message) {
  target.innerHTML = "";
  const empty = document.createElement("div");
  empty.className = "law-explorer-empty";
  empty.textContent = message;
  target.append(empty);
}

function itemLabel(item = {}) {
  return item.title || item.lawName || item.name || item.caseNumber || item.locator || item.effectiveDate || JSON.stringify(item).slice(0, 160);
}

function collectMaterialText() {
  const chunks = [];
  for (const doc of getActiveDocuments()) {
    if (doc.kind !== "document") continue;
    chunks.push(sampleDocumentText(doc, 2500));
    if (chunks.join("\n\n").length >= MATERIAL_TEXT_LIMIT) break;
  }
  return chunks.join("\n\n").slice(0, MATERIAL_TEXT_LIMIT);
}

function sampleDocumentText(doc, budget) {
  const text = doc.text || (doc.pages || []).map((p) => p.text || "").join("\n\n") || (doc.sheets || []).map((s) => s.text || "").join("\n\n");
  return String(text || "").slice(0, budget);
}

let _termsTimer = null;
function debounceTermsPreview() {
  clearTimeout(_termsTimer);
  _termsTimer = setTimeout(fetchTermsPreview, 250);
}

async function fetchTermsPreview() {
  const query = elements.lawWorkbenchQuery?.value?.trim() || "";
  if (!query) return;
  if (_termsAbort) _termsAbort.abort();
  _termsAbort = new AbortController();
  try {
    const response = await fetch(`/api/law/terms?q=${encodeURIComponent(query)}`, { signal: _termsAbort.signal });
    const payload = await response.json().catch(() => ({}));
    const room = getActiveRoom();
    const studio = ensureRoomStudio(room);
    const state = ensureWorkbenchState(studio);
    state.terms = Array.isArray(payload.terms) ? payload.terms : [];
    scheduleSave();
    renderTerms(state);
  } catch {
    // Preview is opportunistic.
  } finally {
    _termsAbort = null;
  }
}

function setBusy(isBusy) {
  const button = elements.lawWorkbenchRunButton;
  if (!button) return;
  button.textContent = isBusy ? "중단" : "작업대 조회";
  button.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function setStatus(message, mode = "idle") {
  if (!elements.lawWorkbenchStatus) return;
  elements.lawWorkbenchStatus.textContent = message || "";
  elements.lawWorkbenchStatus.dataset.mode = mode;
}
