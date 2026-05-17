import { elements, getActiveLawReview } from "./state.js";
import { hydrateStoredDocuments, scheduleSave } from "./persistence.js";
import { getActiveDocuments } from "./chat.js";
import { openWithPreparedDraft } from "./documentStudio.js";

const MATERIAL_TEXT_LIMIT = 10000;
const DEFAULT_TAB = "main";
const VALID_TABS = new Set(["main", "system", "decisions", "history"]);

// Legacy tab → new grouped tab. Keeps room state migration painless.
const LEGACY_TAB_MAP = {
  article: "main",
  annexes: "main",
  structure: "system",
  delegated: "system",
  ordinances: "system",
  decisions: "decisions",
  history: "history",
  impact: "history"
};

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
  elements.lawWorkbenchQuery?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (_workbenchAbort) return;
      runLawWorkbench();
    }
  });
  // Example chips: fill the search input and run.
  for (const chip of elements.lawExampleChips || []) {
    chip.addEventListener("click", () => {
      const text = chip.dataset.lawExample || chip.textContent || "";
      if (!elements.lawWorkbenchQuery) return;
      elements.lawWorkbenchQuery.value = text;
      elements.lawWorkbenchQuery.focus();
      syncInputs();
      debounceTermsPreview();
    });
  }
}

export function renderLawWorkbench() {
  const state = ensureWorkbenchState(getActiveLawReview());
  hydrateInputs(state);
  syncAdvancedOpen(state);
  renderTabs();
  renderTerms(state);
  renderBody(state);
  syncReportBar(state);
}

function ensureWorkbenchState(studio) {
  if (!studio) return { input: {}, data: null, terms: [], activeTab: DEFAULT_TAB };
  studio.input = studio.input && typeof studio.input === "object" ? studio.input : {};
  studio.terms = Array.isArray(studio.terms) ? studio.terms : [];
  const storedTab = studio.activeTab;
  const normalized = VALID_TABS.has(storedTab) ? storedTab : (LEGACY_TAB_MAP[storedTab] || DEFAULT_TAB);
  studio.activeTab = normalized;
  _activeTab = normalized;
  return studio;
}

function hydrateInputs(state) {
  const input = state?.input || {};
  setValueIfFree(elements.lawWorkbenchQuery, input.query || "");
  setValueIfFree(elements.lawWorkbenchLawName, input.lawName || "");
  setValueIfFree(elements.lawWorkbenchArticle, input.article || "");
  setValueIfFree(elements.lawWorkbenchRegion, input.region || "");
}

function setValueIfFree(element, value) {
  if (!element || document.activeElement === element) return;
  element.value = value || "";
}

function syncAdvancedOpen(state) {
  const advanced = elements.lawWorkbenchAdvanced;
  if (!advanced) return;
  const input = state?.input || {};
  if (input.lawName || input.article || input.region) {
    advanced.open = true;
  }
}

function syncInputs() {
  const state = ensureWorkbenchState(getActiveLawReview());
  state.input = readInputs();
  touchReviewState(state);
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
  const state = ensureWorkbenchState(getActiveLawReview());
  const input = readInputs();
  if (!input.query && !input.lawName) {
    setStatus("질문 또는 법령명을 입력하세요.", "error");
    elements.lawWorkbenchQuery?.focus();
    return;
  }
  if (await hydrateStoredDocuments()) window.dispatchEvent(new CustomEvent("myai:renderrooms"));
  _workbenchAbort = new AbortController();
  setBusy(true);
  setStatus("공식 법령 근거를 검토하는 중입니다.", "running");
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
    state.title = deriveReviewTitle(input);
    touchReviewState(state);
    scheduleSave();
    window.dispatchEvent(new CustomEvent("myai:renderlawreviews"));
    setStatus("", "idle");
    renderLawWorkbench();
  } catch (error) {
    if (error?.name === "AbortError") setStatus("검토를 중단했습니다.", "idle");
    else setStatus(error.message || "검토에 실패했습니다.", "error");
  } finally {
    _workbenchAbort = null;
    setBusy(false);
  }
}

async function createLawWorkbenchReport() {
  const state = ensureWorkbenchState(getActiveLawReview());
  if (!state.data) throw new Error("먼저 검토를 실행하세요.");
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
    source: { sourceType: "law_workbench_report", sourceLawReviewId: state.id || "" }
  });
  setStatus("검토 보고서 초안을 문서 편집기에 생성했습니다.", "idle");
}

function resetLawWorkbench() {
  const state = ensureWorkbenchState(getActiveLawReview());
  if (!state) return;
  state.input = {};
  state.data = null;
  state.terms = [];
  state.activeTab = DEFAULT_TAB;
  state.title = "새 법령검토";
  touchReviewState(state);
  _activeTab = DEFAULT_TAB;
  for (const input of [elements.lawWorkbenchQuery, elements.lawWorkbenchLawName, elements.lawWorkbenchArticle, elements.lawWorkbenchRegion]) {
    if (input) input.value = "";
  }
  if (elements.lawWorkbenchAdvanced) elements.lawWorkbenchAdvanced.open = false;
  scheduleSave();
  window.dispatchEvent(new CustomEvent("myai:renderlawreviews"));
  setStatus("", "idle");
  renderLawWorkbench();
}

function setActiveTab(tab) {
  const next = VALID_TABS.has(tab) ? tab : (LEGACY_TAB_MAP[tab] || DEFAULT_TAB);
  _activeTab = next;
  const state = ensureWorkbenchState(getActiveLawReview());
  state.activeTab = next;
  touchReviewState(state);
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

function syncReportBar(state) {
  const bar = elements.lawReportBar;
  if (bar) bar.hidden = !state?.data;
  if (elements.lawWorkbenchReportButton) {
    elements.lawWorkbenchReportButton.disabled = !state?.data;
  }
}

function renderBody(state) {
  const target = elements.lawWorkbenchBody;
  if (!target) return;
  target.innerHTML = "";
  const data = state?.data;
  if (!data) {
    target.innerHTML = `
      <div class="law-explorer-empty law-empty-hero">
        <h3>법령검토</h3>
        <p>자연어 질문 한 줄이면 공식 법령·판례·자치법규·내부자료 영향까지 한 번에 정리합니다.</p>
        <ul class="law-empty-features">
          <li><strong>본문·서식</strong> 조문 원문과 별표·서식 자동 매칭</li>
          <li><strong>법체계</strong> 상위법 / 하위법령 / 자치법규 연계</li>
          <li><strong>판례·해석</strong> 판례 · 해석례 · 행정규칙</li>
          <li><strong>개정·영향</strong> 개정 이력과 내부자료 영향 분석</li>
        </ul>
      </div>`;
    return;
  }
  if (_activeTab === "main") {
    renderArticle(target, data.article);
    renderAiCandidates(target, data.aiCandidates);
    renderListPanel(target, data.annexes?.items, "별표 · 서식");
    renderTabHints(target, data);
  } else if (_activeTab === "system") {
    renderStructure(target, data.structure);
    renderListPanel(target, data.delegated?.items, "위임 / 하위법령");
    renderListPanel(target, data.ordinances?.items, "자치법규");
  } else if (_activeTab === "decisions") {
    renderDecisions(target, data.decisions);
  } else if (_activeTab === "history") {
    renderHistory(target, data.history);
    renderImpact(target, data.internalImpact);
  }
  renderWarnings(target, data.warnings);
}

function renderAiCandidates(target, aiCandidates) {
  const items = Array.isArray(aiCandidates?.items) ? aiCandidates.items : [];
  if (!items.length) return;
  const section = document.createElement("section");
  section.className = "law-workbench-result-section";
  const heading = document.createElement("h4");
  heading.className = "law-workbench-section-head";
  heading.textContent = "관련 조문 후보";
  section.append(heading);
  const hint = document.createElement("p");
  hint.className = "law-explorer-empty";
  hint.textContent = "후보를 선택하면 해당 조문 본문으로 다시 검토합니다.";
  section.append(hint);
  for (const item of items.slice(0, 5)) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "law-workbench-result-row law-candidate-row";
    const articleLabel = item.articleNo ? formatArticleLabel(item.articleNo) : "";
    const heads = [item.lawName, articleLabel, item.articleTitle].filter(Boolean).join(" · ");
    row.textContent = item.snippet ? `${heads}\n${item.snippet}` : heads;
    row.addEventListener("click", () => fillAndRun(item.lawName, articleLabel));
    section.append(row);
  }
  target.append(section);
}

function formatArticleLabel(articleNo) {
  const raw = String(articleNo || "").trim();
  if (!raw) return "";
  if (/^제.*조/.test(raw)) return raw;
  const numMatch = raw.match(/^0*(\d+)(?:[\s_-]*의[\s_-]*0*(\d+))?$/);
  if (numMatch) {
    return `제${Number(numMatch[1])}조${numMatch[2] ? `의${Number(numMatch[2])}` : ""}`;
  }
  return raw;
}

function fillAndRun(lawName, articleLabel) {
  if (elements.lawWorkbenchLawName) elements.lawWorkbenchLawName.value = lawName || "";
  if (elements.lawWorkbenchArticle) elements.lawWorkbenchArticle.value = articleLabel || "";
  if (elements.lawWorkbenchAdvanced) elements.lawWorkbenchAdvanced.open = true;
  syncInputs();
  if (_workbenchAbort) return;
  runLawWorkbench();
}

function renderTabHints(target, data) {
  if (data?.article?.ok) return;
  const aiCount = Array.isArray(data?.aiCandidates?.items) ? data.aiCandidates.items.length : 0;
  if (aiCount) return;
  const summary = countOtherTabResults(data);
  const hints = [];
  if (summary.decisions) hints.push({ tab: "decisions", label: `판례·해석례 ${summary.decisions}건` });
  if (summary.system) hints.push({ tab: "system", label: `법체계·자치법규 ${summary.system}건` });
  if (summary.history) hints.push({ tab: "history", label: `개정 이력 ${summary.history}건` });
  if (!hints.length) return;
  const box = document.createElement("div");
  box.className = "law-workbench-tab-hints";
  const lead = document.createElement("p");
  lead.className = "law-explorer-empty";
  lead.textContent = "공식 조문 자동 매칭에 실패했습니다. 다른 탭 결과를 확인하세요:";
  box.append(lead);
  for (const hint of hints) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "law-workbench-tab-hint";
    button.textContent = hint.label;
    button.addEventListener("click", () => setActiveTab(hint.tab));
    box.append(button);
  }
  target.append(box);
}

function countOtherTabResults(data) {
  const len = (items) => (Array.isArray(items) ? items.length : 0);
  return {
    decisions: len(data?.decisions?.precedents?.items) + len(data?.decisions?.interpretations?.items) + len(data?.decisions?.adminRules?.items),
    system: (data?.structure?.tiers ? 1 : 0) + len(data?.delegated?.items) + len(data?.ordinances?.items),
    history: len(data?.history?.revisions)
  };
}

function renderArticle(target, article) {
  if (!article?.ok) {
    appendEmptySection(target, "조문 본문", "조문 본문을 확인하지 못했습니다.");
    return;
  }
  const section = document.createElement("section");
  section.className = "law-workbench-result-section";
  const header = document.createElement("h4");
  header.className = "law-workbench-section-head";
  header.textContent = article.citation?.locator || "조문 본문";
  const body = document.createElement("pre");
  body.className = "law-snapshot-body";
  body.textContent = article.text || "(본문 없음)";
  section.append(header, body);
  target.append(section);
}

function renderHistory(target, history) {
  const revisions = Array.isArray(history?.revisions) ? history.revisions : [];
  if (!revisions.length) {
    appendEmptySection(target, "개정 이력", "개정 이력을 확인하지 못했습니다.");
    return;
  }
  renderListPanel(target, revisions, "개정 이력", (item) => [
    item.effectiveDate ? `시행 ${item.effectiveDate}` : "시행일 미상",
    item.promulgationDate ? `공포 ${item.promulgationDate}` : "",
    item.revisionType || ""
  ].filter(Boolean).join(" / "));
}

function renderStructure(target, structure) {
  const tiers = structure?.tiers;
  if (!tiers) {
    appendEmptySection(target, "법체계", "법체계 정보를 확인하지 못했습니다.");
    return;
  }
  if (Array.isArray(tiers)) return renderListPanel(target, tiers, "법체계");
  const rows = Object.entries(tiers).map(([level, value]) => ({
    title: `${level}: ${value?.lawName || "확인 안 됨"}`,
    url: value?.url || ""
  }));
  renderListPanel(target, rows, "법체계");
}

function renderDecisions(target, decisions = {}) {
  const groups = [
    ["판례", decisions.precedents?.items],
    ["해석례", decisions.interpretations?.items],
    ["행정규칙", decisions.adminRules?.items]
  ];
  let hasAny = false;
  for (const [label, items] of groups) {
    if (Array.isArray(items) && items.length) hasAny = true;
    const section = document.createElement("section");
    section.className = "law-workbench-result-section";
    const title = document.createElement("h4");
    title.textContent = label;
    section.append(title);
    appendItems(section, items || []);
    target.append(section);
  }
  if (!hasAny) {
    // sections already rendered empty placeholders via appendItems
  }
}

function renderImpact(target, impact) {
  if (!impact?.ok && !impact?.impactMap) {
    appendEmptySection(target, "내부자료 영향", impact?.summary || "내부자료 영향 분석 결과가 없습니다.");
    return;
  }
  const section = document.createElement("section");
  section.className = "law-workbench-result-section";
  const heading = document.createElement("h4");
  heading.textContent = "내부자료 영향";
  section.append(heading);
  const summary = document.createElement("p");
  summary.className = "law-workbench-summary";
  summary.textContent = impact.summary || "내부자료 영향 분석을 완료했습니다.";
  section.append(summary);
  const nodes = (impact.impactMap?.nodes || []).filter((node) => node.type !== "law_article" && node.type !== "review_subject");
  appendItems(section, nodes, (node) => `${node.label || node.id} - ${node.summary || ""}`);
  target.append(section);
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

function appendEmptySection(target, title, message) {
  const section = document.createElement("section");
  section.className = "law-workbench-result-section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  const empty = document.createElement("p");
  empty.className = "law-explorer-empty";
  empty.textContent = message;
  section.append(heading, empty);
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
    const label = labelFn(item);
    const url = item && typeof item === "object" ? item.url : "";
    if (url) {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      anchor.className = "law-workbench-result-link";
      anchor.textContent = label;
      row.append(anchor);
    } else {
      row.textContent = label;
    }
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
    const state = ensureWorkbenchState(getActiveLawReview());
    state.terms = Array.isArray(payload.terms) ? payload.terms : [];
    state.input = readInputs();
    touchReviewState(state);
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
  button.textContent = isBusy ? "중단" : "검토";
  button.setAttribute("aria-busy", isBusy ? "true" : "false");
}

function setStatus(message, mode = "idle") {
  if (!elements.lawWorkbenchStatus) return;
  elements.lawWorkbenchStatus.textContent = message || "";
  elements.lawWorkbenchStatus.dataset.mode = mode;
}

function touchReviewState(state) {
  if (!state || !state.id) return;
  state.updatedAt = new Date().toISOString();
}

function deriveReviewTitle(input = {}) {
  const title = input.query || [input.lawName, input.article].filter(Boolean).join(" ");
  return String(title || "법령검토").trim().slice(0, 80) || "법령검토";
}
