import { elements, getActiveLawReview, documentCacheHeaders } from "./state.js";
import { scheduleSave } from "./persistence.js";
import { openWithPreparedDraft } from "./documentStudio.js";
import { fileTypeIcon, displayFileName } from "../fileDisplay.js";

const MATERIAL_TEXT_LIMIT = 10000;
const DEFAULT_TAB = "review";
const VALID_TABS = new Set(["review", "evidence", "history"]);

// Legacy tab → new grouped tab. Keeps room state migration painless.
const LEGACY_TAB_MAP = {
  main: "evidence",
  system: "evidence",
  decisions: "evidence",
  article: "evidence",
  annexes: "evidence",
  structure: "evidence",
  delegated: "evidence",
  ordinances: "evidence",
  history: "history",
  impact: "history",
  report: "review"
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
  elements.lawWorkbenchResetButton?.addEventListener("click", resetLawWorkbench);
  elements.lawWorkbenchTabs?.forEach((button) => {
    button.addEventListener("click", () => setActiveTab(button.dataset.lawWorkbenchTab || DEFAULT_TAB));
  });
  for (const input of [
    elements.lawWorkbenchQuery,
    elements.lawWorkbenchLawName,
    elements.lawWorkbenchArticle,
    elements.lawWorkbenchRegion,
    elements.lawWorkbenchReviewType,
    elements.lawWorkbenchOutputType,
    elements.lawWorkbenchConditionText
  ]) {
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
  bindLawReviewUpload();
}

function bindLawReviewUpload() {
  elements.lawWorkbenchAttachButton?.addEventListener("click", () => {
    elements.lawWorkbenchUploadInput?.click();
  });
  elements.lawWorkbenchUploadInput?.addEventListener("change", (event) => {
    const target = event.target;
    if (target?.files?.length) uploadLawReviewFiles(target.files);
    if (target) target.value = "";
  });
  const zone = elements.lawWorkbenchDropZone;
  if (!zone) return;
  let depth = 0;
  zone.addEventListener("dragenter", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    depth += 1;
    zone.classList.add("is-dragover");
  });
  zone.addEventListener("dragover", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  });
  zone.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (depth === 0) zone.classList.remove("is-dragover");
  });
  zone.addEventListener("drop", (event) => {
    if (!hasDraggedFiles(event)) return;
    event.preventDefault();
    depth = 0;
    zone.classList.remove("is-dragover");
    const files = event.dataTransfer?.files;
    if (files && files.length) uploadLawReviewFiles(files);
  });
}

function hasDraggedFiles(event) {
  const types = event.dataTransfer?.types;
  if (!types) return false;
  return Array.from(types).includes("Files");
}

async function uploadLawReviewFiles(fileList) {
  const state = ensureWorkbenchState(getActiveLawReview());
  if (!state || !state.id) {
    setStatus("법령검토 항목을 먼저 선택하세요.", "error");
    return;
  }
  if (!Array.isArray(state.documents)) state.documents = [];
  const files = Array.from(fileList || []);
  if (!files.length) return;
  let failed = 0;
  for (const file of files) {
    setStatus(`${file.name} 업로드 중...`, "running");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/upload", {
        method: "POST",
        headers: documentCacheHeaders(),
        body: form
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `status ${response.status}`);
      if (payload.document) {
        state.documents.push(payload.document);
        touchReviewState(state);
      }
    } catch (error) {
      failed += 1;
      setStatus(`${file.name}: ${error.message || "업로드 실패"}`, "error");
    }
  }
  scheduleSave();
  renderLawReviewAttachments();
  if (!failed) setStatus(`자료 ${files.length}개를 첨부했습니다.`, "idle");
}

async function removeLawReviewFile(doc) {
  if (!doc?.id) return;
  const state = ensureWorkbenchState(getActiveLawReview());
  if (!state) return;
  try {
    await fetch(`/api/documents/${encodeURIComponent(doc.id)}`, {
      method: "DELETE",
      headers: documentCacheHeaders()
    });
  } catch {
    // Server-side cache removal is best-effort; local state is the source of truth.
  }
  state.documents = (state.documents || []).filter((d) => d.id !== doc.id);
  touchReviewState(state);
  scheduleSave();
  renderLawReviewAttachments();
}

function renderLawReviewAttachments() {
  const host = elements.lawWorkbenchAttachments;
  if (!host) return;
  const state = ensureWorkbenchState(getActiveLawReview());
  const docs = getLawReviewDocuments(state);
  host.innerHTML = "";
  if (!docs.length) return;
  for (const doc of docs) {
    const chip = document.createElement("span");
    chip.className = "law-hero-attach-chip";
    const badge = document.createElement("span");
    badge.className = "file-type-badge";
    badge.textContent = fileTypeIcon(doc);
    const name = document.createElement("span");
    name.className = "law-hero-attach-name";
    const displayName = displayFileName(doc);
    name.textContent = displayName;
    name.title = displayName;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "law-hero-attach-remove";
    remove.setAttribute("aria-label", "첨부 삭제");
    remove.textContent = "×";
    remove.addEventListener("click", () => removeLawReviewFile(doc));
    chip.append(badge, name, remove);
    host.append(chip);
  }
}

export function renderLawWorkbench() {
  const state = ensureWorkbenchState(getActiveLawReview());
  hydrateInputs(state);
  syncAdvancedOpen(state);
  renderTabs(state);
  renderTerms(state);
  renderBody(state);
  renderLawReviewAttachments();
}

function ensureWorkbenchState(studio) {
  if (!studio) return { input: {}, conditions: {}, documents: [], data: null, reviewResult: null, reviewError: "", terms: [], activeTab: DEFAULT_TAB };
  studio.input = studio.input && typeof studio.input === "object" ? studio.input : {};
  studio.conditions = studio.conditions && typeof studio.conditions === "object" ? studio.conditions : {};
  studio.documents = Array.isArray(studio.documents) ? studio.documents : [];
  studio.reviewResult = studio.reviewResult && typeof studio.reviewResult === "object" ? studio.reviewResult : null;
  studio.reviewError = typeof studio.reviewError === "string" ? studio.reviewError : "";
  studio.terms = Array.isArray(studio.terms) ? studio.terms : [];
  const storedTab = studio.activeTab;
  const normalized = VALID_TABS.has(storedTab) ? storedTab : (LEGACY_TAB_MAP[storedTab] || DEFAULT_TAB);
  studio.activeTab = normalized;
  _activeTab = normalized;
  return studio;
}

function hydrateInputs(state) {
  const input = state?.input || {};
  const conditions = state?.conditions || {};
  setValueIfFree(elements.lawWorkbenchQuery, input.query || "");
  setValueIfFree(elements.lawWorkbenchLawName, input.lawName || "");
  setValueIfFree(elements.lawWorkbenchArticle, input.article || "");
  setValueIfFree(elements.lawWorkbenchRegion, input.region || "");
  setValueIfFree(elements.lawWorkbenchReviewType, conditions.reviewType || "general");
  setValueIfFree(elements.lawWorkbenchOutputType, conditions.outputType || "law_review_opinion");
  setValueIfFree(elements.lawWorkbenchConditionText, conditions.detail || "");
}

function setValueIfFree(element, value) {
  if (!element || document.activeElement === element) return;
  element.value = value || "";
}

function syncAdvancedOpen(state) {
  const advanced = elements.lawWorkbenchAdvanced;
  if (!advanced) return;
  const input = state?.input || {};
  const conditions = state?.conditions || {};
  if (input.lawName || input.article || input.region || conditions.reviewType || conditions.outputType || conditions.detail) {
    advanced.open = true;
  }
}

function syncInputs() {
  const state = ensureWorkbenchState(getActiveLawReview());
  state.input = readInputs();
  state.conditions = readConditions();
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

function readConditions() {
  return {
    reviewType: elements.lawWorkbenchReviewType?.value?.trim() || "general",
    outputType: elements.lawWorkbenchOutputType?.value?.trim() || "law_review_opinion",
    detail: elements.lawWorkbenchConditionText?.value?.trim() || ""
  };
}

async function runLawWorkbench() {
  const state = ensureWorkbenchState(getActiveLawReview());
  const input = readInputs();
  const conditions = readConditions();
  if (!input.query && !input.lawName) {
    setStatus("질문 또는 법령명을 입력하세요.", "error");
    elements.lawWorkbenchQuery?.focus();
    return;
  }
  const reviewDocuments = getLawReviewDocuments(state);
  state.reviewResult = null;
  state.reviewError = "";
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
        materialText: collectMaterialText(reviewDocuments),
        includeInternalImpact: true
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `status ${response.status}`);
    state.input = input;
    state.conditions = conditions;
    state.data = payload;
    state.terms = Array.isArray(payload.termMatches) ? payload.termMatches : state.terms;
    state.activeTab = "review";
    _activeTab = "review";
    state.title = deriveReviewTitle(input);
    touchReviewState(state);
    scheduleSave();
    window.dispatchEvent(new CustomEvent("myai:renderlawreviews"));
    renderLawWorkbench();
    setStatus("공식근거를 바탕으로 LLM 검토 결과를 작성하는 중입니다.", "running");

    const reviewResponse = await fetch("/api/law/workbench/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: _workbenchAbort.signal,
      body: JSON.stringify({
        query: input.query || [input.lawName, input.article].filter(Boolean).join(" "),
        conditions,
        workbench: payload,
        documents: reviewDocuments
      })
    });
    const reviewPayload = await parseReviewResponse(reviewResponse);
    if (!reviewResponse.ok || reviewPayload.ok === false) {
      throw new Error(reviewPayload.error || `LLM 검토 실패: status ${reviewResponse.status}`);
    }
    state.reviewResult = reviewPayload.reviewResult || reviewPayload.result || null;
    if (!state.reviewResult) throw new Error("LLM 검토 응답에 reviewResult가 없습니다.");
    state.reviewError = "";
    touchReviewState(state);
    scheduleSave();
    setStatus("", "idle");
    renderLawWorkbench();
  } catch (error) {
    if (error?.name === "AbortError") {
      setStatus("검토를 중단했습니다.", "idle");
    } else {
      const message = error.message || "검토에 실패했습니다.";
      state.reviewError = message;
      touchReviewState(state);
      scheduleSave();
      renderLawWorkbench();
      setStatus(message, "error");
    }
  } finally {
    _workbenchAbort = null;
    setBusy(false);
  }
}

async function createLawWorkbenchReport(templateOverride = "") {
  const state = ensureWorkbenchState(getActiveLawReview());
  if (!state.data && !state.reviewResult) throw new Error("먼저 검토를 실행하세요.");
  setStatus("검토 보고서 초안을 생성하는 중입니다.", "running");
  const templateId = templateOverride || elements.lawWorkbenchOutputType?.value || "law_review_opinion";
  const response = await fetch("/api/law/workbench/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ workbench: state.data, reviewResult: state.reviewResult, templateId })
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
  state.reportCreatedAt = new Date().toISOString();
  touchReviewState(state);
  scheduleSave();
  renderLawWorkbench();
  setStatus("검토 보고서 초안을 문서 편집기에 생성했습니다.", "idle");
}

function resetLawWorkbench() {
  const state = ensureWorkbenchState(getActiveLawReview());
  if (!state) return;
  state.input = {};
  state.conditions = {};
  state.data = null;
  state.reviewResult = null;
  state.reviewError = "";
  state.reportCreatedAt = "";
  state.terms = [];
  state.activeTab = DEFAULT_TAB;
  state.title = "새 법령검토";
  touchReviewState(state);
  _activeTab = DEFAULT_TAB;
  for (const input of [elements.lawWorkbenchQuery, elements.lawWorkbenchLawName, elements.lawWorkbenchArticle, elements.lawWorkbenchRegion, elements.lawWorkbenchConditionText]) {
    if (input) input.value = "";
  }
  if (elements.lawWorkbenchReviewType) elements.lawWorkbenchReviewType.value = "general";
  if (elements.lawWorkbenchOutputType) elements.lawWorkbenchOutputType.value = "law_review_opinion";
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

function renderTabs(state) {
  const data = state?.data || null;
  const hasDraft = Boolean(state?.reviewResult);
  const hasError = Boolean(state?.reviewError);
  const lampMap = {
    review:   { done: hasDraft,         active: Boolean(_workbenchAbort && data && !hasDraft), error: hasError && Boolean(data) },
    evidence: { done: Boolean(data),    active: Boolean(_workbenchAbort && !data) },
    history:  { done: Boolean(data) }
  };
  elements.lawWorkbenchTabs?.forEach((button) => {
    const tab = button.dataset.lawWorkbenchTab;
    const active = tab === _activeTab;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
    const lamp = lampMap[tab] || {};
    button.classList.toggle("is-lamp-done",   Boolean(lamp.done));
    button.classList.toggle("is-lamp-active", Boolean(lamp.active));
    button.classList.toggle("is-lamp-error",  Boolean(lamp.error));
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
  if (!data && !state?.reviewResult) {
    renderEmptyWorkbench(target);
    return;
  }
  if (_activeTab === "review") {
    renderReviewResult(target, state);
  } else if (_activeTab === "evidence") {
    renderEvidenceDashboard(target, state);
    renderArticle(target, data.article);
    renderAiCandidates(target, data.aiCandidates);
    renderEvidenceSection(target, {
      title: "별표/서식",
      block: data.annexes,
      description: "법령에 연결된 별표, 별지, 서식 후보입니다.",
      labelFn: annexEvidenceLabel
    });
    renderStructure(target, data.structure);
    renderEvidenceSection(target, {
      title: "위임/하위법령",
      block: data.delegated,
      description: "검토 조문과 함께 확인해야 할 위임·하위 법령입니다."
    });
    renderEvidenceSection(target, {
      title: "자치법규",
      block: data.ordinances,
      description: "지역 조건과 질의어로 함께 조회한 자치법규 후보입니다."
    });
    renderDecisionEvidenceSection(target, data.decisions);
  } else if (_activeTab === "history") {
    renderImpact(target, data.internalImpact);
    renderHistory(target, data.history);
  }
  renderWarnings(target, data?.warnings);
}

function renderEmptyWorkbench(target) {
  const empty = document.createElement("div");
  empty.className = "law-explorer-empty law-empty-hero";
  empty.innerHTML = `
    <h3>법령검토</h3>
    <p>검토 요청을 입력하면 공식 근거 수집, AI 검토 초안, 보고서 생성 순서로 진행합니다.</p>
    <ul class="law-empty-features">
      <li><strong>검토 초안</strong> 결론 후보, 쟁점, 리스크, 보완 권고</li>
      <li><strong>근거</strong> 조문 원문, 별표, 판례, 해석례, 법체계</li>
      <li><strong>개정/영향</strong> 시행 이력과 내부자료 영향</li>
      <li><strong>보고서</strong> 검토의견서, 민원 회신, 컴플라이언스 점검표</li>
    </ul>`;
  target.append(empty);
}

function buildReviewStatusSummary(state) {
  const data = state?.data || null;
  const officialEvidenceCount = data
    ? (data.article?.ok ? 1 : 0)
      + countItems(data.annexes?.items)
      + countDecisionEvidence(data.decisions)
      + countSystemEvidence(data)
      + countItems(data.history?.revisions)
    : 0;
  const draftStatus = state?.reviewResult
    ? "AI 초안 생성 완료"
    : state?.reviewError
    ? "AI 초안 생성 실패"
    : "AI 초안 대기";
  const documentCount = countItems(state?.documents);
  const reportStatus = (state?.data || state?.reviewResult) ? "보고서 생성 가능" : "보고서 생성 불가";
  return [
    `공식근거 ${officialEvidenceCount}건 수집`,
    draftStatus,
    `첨부자료 ${documentCount}건 반영`,
    reportStatus
  ].join(" · ");
}

function renderReviewStatusSummary(card, state) {
  const summary = document.createElement("p");
  summary.className = "law-review-status-summary";
  summary.textContent = buildReviewStatusSummary(state);
  card.append(summary);
}


function renderReviewResult(target, state) {
  const result = state?.reviewResult;
  const card = document.createElement("section");
  card.className = "law-review-result-card";
  const head = document.createElement("div");
  head.className = "law-review-result-head";
  const title = document.createElement("h3");
  title.textContent = "검토 초안";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "send-button law-review-result-cta";
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:15px;height:15px;flex:0 0 auto;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/><path d="M9 14h6M9 17h4"/></svg><span>보고서 생성</span>`;
  button.disabled = !state?.data && !state?.reviewResult;
  button.addEventListener("click", () => {
    createLawWorkbenchReport().catch((error) => setStatus(error.message || "보고서 생성에 실패했습니다.", "error"));
  });
  head.append(title, button);
  card.append(head);
  renderReviewStatusSummary(card, state);
  if (!result) {
    const empty = document.createElement("p");
    empty.className = "law-explorer-empty";
    empty.textContent = state?.reviewError
      ? `AI 검토 초안 생성 실패: ${state.reviewError}`
      : state?.data
      ? "공식 근거는 수집되었습니다. 근거 탭에서 조문, 판례, 법체계를 확인하고 다시 검토를 실행할 수 있습니다."
      : "검토를 실행하면 공식 근거와 AI 검토 초안이 표시됩니다.";
    card.append(empty);
    target.append(card);
    return;
  }
  appendResultSection(card, "요약", result.summary);
  appendResultList(card, "핵심 쟁점", result.issues);
  appendResultList(card, "확인된 사실", result.facts);
  appendResultList(card, "적용 법령 및 근거", result.legalGrounds);
  appendResultList(card, "검토 의견", result.analysis);
  appendResultList(card, "리스크", result.risks);
  appendResultList(card, "보완 권고", result.recommendations);
  appendResultList(card, "추가 확인 필요", result.missingEvidence);
  appendResultSection(card, "검토의견 초안", result.draftOpinion);
  appendResultSection(card, "고지", result.disclaimer);
  target.append(card);
}

function renderEvidenceDashboard(target, state) {
  const data = state?.data || {};
  const impactNodes = splitImpactNodes(data.internalImpact);
  const counts = [
    { label: "조문", value: data.article?.ok ? 1 : 0, detail: data.article?.citation?.locator || "본문 미확인" },
    { label: "별표/서식", value: countItems(data.annexes?.items), detail: "첨부 서식 후보" },
    { label: "법체계", value: countSystemEvidence(data), detail: "상하위 법령/자치법규" },
    { label: "판례/해석", value: countDecisionEvidence(data.decisions), detail: "판례·해석례·행정규칙" },
    { label: "개정 이력", value: countItems(data.history?.revisions), detail: "시행일자별 이력" },
    { label: "내부자료 영향", value: impactNodes.signals.length, detail: countItems(state?.documents) ? "조문과 직접 맞닿은 문장" : "전용 자료 없음" }
  ];
  const section = document.createElement("section");
  section.className = "law-evidence-dashboard";
  const heading = document.createElement("div");
  heading.className = "law-evidence-dashboard-head";
  heading.innerHTML = `<h3>근거 상태</h3><p>검토 초안에 사용된 공식 근거와 보조 근거를 먼저 확인합니다.</p>`;
  section.append(heading);
  const grid = document.createElement("div");
  grid.className = "law-evidence-grid";
  for (const item of counts) {
    const cell = document.createElement("div");
    cell.className = `law-evidence-card${item.value ? " has-data" : ""}`;
    const count = document.createElement("span");
    count.className = "law-evidence-count";
    count.textContent = String(item.value);
    const label = document.createElement("span");
    label.className = "law-evidence-label";
    label.textContent = item.label;
    const detail = document.createElement("span");
    detail.className = "law-evidence-detail";
    detail.textContent = item.detail;
    cell.append(count, label, detail);
    grid.append(cell);
  }
  section.append(grid);
  target.append(section);
}


function appendResultSection(target, title, value) {
  if (!value) return;
  const section = document.createElement("section");
  section.className = "law-review-result-section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  const body = document.createElement("p");
  body.textContent = String(value);
  section.append(heading, body);
  target.append(section);
}

function appendResultList(target, title, value) {
  const items = Array.isArray(value) ? value.filter(Boolean) : (value ? [value] : []);
  if (!items.length) return;
  const section = document.createElement("section");
  section.className = "law-review-result-section";
  const heading = document.createElement("h4");
  heading.textContent = title;
  const list = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    li.textContent = typeof item === "string" ? item : itemLabel(item);
    list.append(li);
  }
  section.append(heading, list);
  target.append(section);
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
  const evidenceCount = summary.decisions + summary.system;
  if (evidenceCount) hints.push({ tab: "evidence", label: `근거 ${evidenceCount}건` });
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

function countItems(items) {
  return Array.isArray(items) ? items.length : 0;
}

function countDecisionEvidence(decisions = {}) {
  return countItems(decisions.precedents?.items)
    + countItems(decisions.interpretations?.items)
    + countItems(decisions.adminRules?.items);
}

function countSystemEvidence(data = {}) {
  const structureCount = data.structure?.tiers ? 1 : 0;
  return structureCount + countItems(data.delegated?.items) + countItems(data.ordinances?.items);
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
  const items = Array.isArray(tiers)
    ? tiers
    : tiers && typeof tiers === "object"
      ? Object.entries(tiers).map(([level, value]) => ({
          title: `${level}: ${value?.lawName || value?.title || "확인 필요"}`,
          url: value?.url || "",
          level,
          lawName: value?.lawName || value?.title || ""
        }))
      : [];
  renderEvidenceSection(target, {
    title: "법체계",
    block: { ok: Boolean(structure?.ok), skipped: structure?.skipped, error: structure?.error, cacheHit: structure?.cacheHit, items },
    description: "상위 법령, 하위 법령, 관련 법령 체계를 확인합니다.",
    labelFn: evidenceItemLabel
  });
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

function renderDecisionEvidenceSection(target, decisions = {}) {
  const groups = [
    { title: "판례", block: decisions.precedents, description: "공식 판례 검색 결과입니다." },
    { title: "해석례", block: decisions.interpretations, description: "법령해석례 검색 결과입니다." },
    { title: "행정규칙", block: decisions.adminRules, description: "관련 고시·예규·행정규칙 후보입니다." }
  ];
  const total = groups.reduce((sum, group) => sum + countItems(group.block?.items), 0);
  const section = document.createElement("section");
  section.className = "law-workbench-result-section law-evidence-detail-section law-decision-evidence-section";
  section.append(createEvidenceSectionHead({
    title: "판례/해석",
    status: total ? { kind: "ok", label: "조회됨" } : { kind: "empty", label: "결과 없음" },
    count: total,
    description: "판례, 법령해석례, 행정규칙을 출처별로 나눠 확인합니다."
  }));
  for (const group of groups) {
    const sub = document.createElement("div");
    sub.className = "law-evidence-source-group";
    sub.append(createEvidenceSectionHead({
      title: group.title,
      status: evidenceStatus(group.block, group.block?.items),
      count: countItems(group.block?.items),
      description: group.description
    }));
    appendEvidenceItems(sub, group.block?.items, evidenceItemLabel);
    section.append(sub);
  }
  target.append(section);
}

function renderImpact(target, impact) {
  if (!impact?.ok && !impact?.impactMap) {
    appendEmptySection(target, "내부자료 영향", impact?.summary || "내부자료 영향 분석 결과가 없습니다.");
    return;
  }
  const { signals, lawNodes } = splitImpactNodes(impact);
  const section = document.createElement("section");
  section.className = "law-workbench-result-section law-impact-brief";
  const heading = document.createElement("h4");
  heading.textContent = "내부자료 영향";
  section.append(heading);

  const summaryGrid = document.createElement("div");
  summaryGrid.className = "law-impact-summary-grid";
  summaryGrid.append(
    createImpactMetric("내부자료 신호", signals.length, "첨부자료에서 조문 키워드와 직접 맞닿은 문장"),
    createImpactMetric("조문 점검 항목", lawNodes.length, "조문에서 추출한 의무·조건·리스크")
  );
  section.append(summaryGrid);

  const lead = document.createElement("p");
  lead.className = "law-workbench-summary";
  lead.textContent = signals.length
    ? `첨부자료에서 조문과 연결되는 문장 ${signals.length}건을 아래에 따로 표시했습니다.`
    : "첨부자료에서 조문과 직접 맞닿은 문장은 찾지 못했습니다.";
  section.append(lead);

  appendImpactGroup(section, {
    title: "내부자료에서 발견된 신호",
    description: "아래 문장들이 실제 첨부자료에서 잡힌 부분입니다. 이 항목을 먼저 확인하세요.",
    items: signals,
    className: "law-impact-signal-list",
    empty: "첨부자료 안에서 조문 키워드와 직접 맞닿은 문장을 찾지 못했습니다."
  });
  appendImpactGroup(section, {
    title: "조문에서 뽑은 점검 항목",
    description: "내부자료와 대조할 때 기준으로 쓴 조문 항목입니다. 내부자료 신호와는 다른 목록입니다.",
    items: lawNodes,
    className: "law-impact-law-list",
    empty: "조문에서 별도 점검 항목을 추출하지 못했습니다."
  });
  target.append(section);
}

function renderEvidenceSection(target, { title, block, description = "", labelFn = evidenceItemLabel } = {}) {
  const items = Array.isArray(block?.items) ? block.items : [];
  const section = document.createElement("section");
  section.className = "law-workbench-result-section law-evidence-detail-section";
  section.append(createEvidenceSectionHead({
    title,
    status: evidenceStatus(block, items),
    count: items.length,
    description
  }));
  appendEvidenceItems(section, items, labelFn);
  target.append(section);
}

function createEvidenceSectionHead({ title, status, count, description }) {
  const head = document.createElement("div");
  head.className = "law-evidence-detail-head";
  const titleBox = document.createElement("div");
  const heading = document.createElement("h4");
  heading.textContent = title;
  const desc = document.createElement("p");
  desc.textContent = description;
  titleBox.append(heading, desc);
  const badge = document.createElement("span");
  badge.className = `law-evidence-source-badge is-${status.kind}`;
  badge.textContent = status.label;
  const countBadge = document.createElement("span");
  countBadge.className = "law-evidence-source-count";
  countBadge.textContent = `${count}건`;
  head.append(titleBox, badge, countBadge);
  return head;
}

function evidenceStatus(block, items) {
  if (block?.error) return { kind: "error", label: "조회 실패" };
  if (block?.skipped) return { kind: "skipped", label: "조회 생략" };
  if (Array.isArray(items) && items.length) return { kind: "ok", label: block?.cacheHit ? "캐시 조회" : "조회됨" };
  if (block && typeof block === "object") return { kind: "empty", label: "결과 없음" };
  return { kind: "empty", label: "미확인" };
}

function appendEvidenceItems(target, items, labelFn = evidenceItemLabel) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "law-explorer-empty";
    empty.textContent = "조회된 항목이 없습니다.";
    target.append(empty);
    return;
  }
  const wrap = document.createElement("div");
  wrap.className = "law-evidence-item-list";
  for (const item of list.slice(0, 12)) {
    const row = document.createElement(item?.url ? "a" : "div");
    row.className = "law-evidence-item";
    if (item?.url) {
      row.href = item.url;
      row.target = "_blank";
      row.rel = "noopener noreferrer";
    }
    const title = document.createElement("strong");
    title.textContent = labelFn(item);
    const meta = document.createElement("span");
    meta.textContent = evidenceItemMeta(item);
    row.append(title);
    if (meta.textContent) row.append(meta);
    wrap.append(row);
  }
  target.append(wrap);
}

function splitImpactNodes(impact) {
  const nodes = Array.isArray(impact?.impactMap?.nodes) ? impact.impactMap.nodes : [];
  return {
    signals: nodes.filter((node) => node.type === "material_signal"),
    lawNodes: nodes.filter((node) => !["law_article", "review_subject", "material_signal"].includes(node.type))
  };
}

function createImpactMetric(label, value, detail) {
  const item = document.createElement("div");
  item.className = "law-impact-metric";
  const count = document.createElement("strong");
  count.textContent = String(value);
  const name = document.createElement("span");
  name.textContent = label;
  const note = document.createElement("small");
  note.textContent = detail;
  item.append(count, name, note);
  return item;
}

function appendImpactGroup(target, { title, description, items, className, empty }) {
  const group = document.createElement("div");
  group.className = `law-impact-group ${className}`;
  const head = document.createElement("div");
  head.className = "law-impact-group-head";
  const heading = document.createElement("h5");
  heading.textContent = title;
  const body = document.createElement("p");
  body.textContent = description;
  head.append(heading, body);
  group.append(head);

  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    const emptyText = document.createElement("p");
    emptyText.className = "law-explorer-empty";
    emptyText.textContent = empty;
    group.append(emptyText);
    target.append(group);
    return;
  }

  for (const node of list.slice(0, 12)) {
    const row = document.createElement("div");
    row.className = "law-impact-row";
    const badge = document.createElement("span");
    badge.className = `law-impact-type law-impact-type-${node.type || "item"}`;
    badge.textContent = impactNodeTypeLabel(node.type);
    const text = document.createElement("span");
    text.textContent = node.summary || node.label || node.id || "확인 필요";
    row.append(badge, text);
    group.append(row);
  }
  target.append(group);
}

function impactNodeTypeLabel(type) {
  if (type === "material_signal") return "자료";
  if (type === "obligation") return "의무";
  if (type === "condition") return "조건";
  if (type === "risk") return "리스크";
  return "항목";
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

function evidenceItemLabel(item = {}) {
  return item.title || item.caseNumber || item.lawName || item.name || item.locator || item.effectiveDate || JSON.stringify(item).slice(0, 120);
}

function annexEvidenceLabel(item = {}) {
  return [item.title, item.annexNo || item.formNo].filter(Boolean).join(" / ") || evidenceItemLabel(item);
}

function evidenceItemMeta(item = {}) {
  return [
    item.caseNumber,
    item.lawName,
    item.region,
    item.effectiveDate,
    item.promulgationDate,
    item.revisionType,
    item.annexType,
    item.mst ? `MST ${item.mst}` : "",
    item.precId ? `판례ID ${item.precId}` : "",
    item.expcId ? `해석ID ${item.expcId}` : "",
    item.admrulId ? `행정규칙ID ${item.admrulId}` : ""
  ].filter(Boolean).join(" · ");
}

async function parseReviewResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const preview = text.replace(/\s+/g, " ").trim().slice(0, 160);
    throw new Error(`LLM 검토 응답 JSON 파싱 실패: ${preview || "empty response"}`);
  }
}

function getLawReviewDocuments(state) {
  return Array.isArray(state?.documents) ? state.documents : [];
}

function collectMaterialText(documents = []) {
  const chunks = [];
  for (const doc of documents) {
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
