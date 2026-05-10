import { state, elements } from "./state.js";

const PRESETS = {
  default: [{ label: "default" }],
  rerank: [
    { label: "no-rerank", rerank: false },
    { label: "rerank", rerank: true }
  ],
  qe: [
    { label: "no-qe", queryExpansion: false },
    { label: "qe", queryExpansion: true }
  ],
  kg: [
    { label: "baseline", graphExpansion: false },
    { label: "graph", graphExpansion: true }
  ],
  all: [
    { label: "base", rerank: false, queryExpansion: false },
    { label: "rerank-only", rerank: true, queryExpansion: false },
    { label: "qe-only", rerank: false, queryExpansion: true },
    { label: "rerank+qe", rerank: true, queryExpansion: true }
  ]
};

const ragEvalState = {
  golden: null,
  notebooks: [],
  activeTab: "golden",
  variants: PRESETS.default,
  activePreset: "default",
  activeRunId: null,
  eventSource: null,
  runs: [],
  selectedRunId: null
};

function authHeaders() {
  return state.admin?.token ? { Authorization: `Bearer ${state.admin.token}` } : {};
}

async function api(path, init = {}) {
  const headers = { "Content-Type": "application/json", ...authHeaders(), ...(init.headers || {}) };
  const response = await fetch(`/api/admin/rag-eval${path}`, { ...init, headers });
  if (!response.ok) {
    let body = "";
    try { body = (await response.json()).error || ""; } catch { /* ignore */ }
    throw new Error(body || `HTTP ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

function fmtPct(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function fmtNum(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return value.toFixed(4);
}

function fmtMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "—";
  return `${Math.round(value)}ms`;
}

function fmtSignedNum(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "??";
  return `${value >= 0 ? "+" : ""}${value.toFixed(4)}`;
}

function fmtSignedMs(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "??";
  return `${value >= 0 ? "+" : ""}${Math.round(value)}ms`;
}

// ===== Tabs =====

function setActiveTab(name) {
  ragEvalState.activeTab = name;
  const tabs = document.querySelectorAll("#adminRagEvalPanel .rag-eval-tab");
  tabs.forEach((btn) => {
    const isActive = btn.dataset.tab === name;
    btn.classList.toggle("active", isActive);
    btn.setAttribute("aria-selected", isActive ? "true" : "false");
  });
  document.querySelectorAll("#adminRagEvalPanel .rag-eval-tab-panel").forEach((panel) => {
    panel.hidden = panel.dataset.tab !== name;
  });
  if (name === "golden") refreshGolden().catch(reportError);
  else if (name === "run") refreshNotebooksForRun().catch(reportError);
  else if (name === "results") refreshRuns().catch(reportError);
  else if (name === "health") refreshHealth().catch(reportError);
}

function reportError(err) {
  console.warn(`[rag-eval] ${err.message}`);
  if (elements.ragEvalRunStatus && ragEvalState.activeTab === "run") {
    elements.ragEvalRunStatus.textContent = `오류: ${err.message}`;
  }
}

// ===== Golden tab =====

async function refreshGolden() {
  const data = await api("/golden");
  ragEvalState.golden = data.golden;
  renderGoldenSuiteOptions();
  renderGoldenTable();
}

function renderGoldenSuiteOptions() {
  if (!elements.ragEvalGoldenSuiteFilter) return;
  const current = elements.ragEvalGoldenSuiteFilter.value;
  elements.ragEvalGoldenSuiteFilter.innerHTML =
    `<option value="">전체 Suite</option>` +
    (ragEvalState.golden?.suites || [])
      .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.id)} — ${escapeHtml(s.notebookId)}</option>`)
      .join("");
  elements.ragEvalGoldenSuiteFilter.value = current;

  if (elements.ragEvalRunSuite) {
    const cur = elements.ragEvalRunSuite.value;
    elements.ragEvalRunSuite.innerHTML =
      `<option value="">전체</option>` +
      (ragEvalState.golden?.suites || [])
        .map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.id)}</option>`)
        .join("");
    elements.ragEvalRunSuite.value = cur;
  }
}

function renderGoldenTable() {
  const body = elements.ragEvalGoldenTableBody;
  if (!body) return;
  const search = (elements.ragEvalGoldenSearch?.value || "").toLowerCase();
  const suiteFilter = elements.ragEvalGoldenSuiteFilter?.value || "";

  const rows = [];
  let totalCases = 0;
  for (const suite of ragEvalState.golden?.suites || []) {
    if (suiteFilter && suite.id !== suiteFilter) continue;
    for (const c of suite.cases || []) {
      totalCases++;
      const haystack = `${c.id} ${c.query}`.toLowerCase();
      if (search && !haystack.includes(search)) continue;
      rows.push({ suite, c });
    }
  }

  if (elements.ragEvalGoldenStats) {
    elements.ragEvalGoldenStats.textContent =
      `Suite ${ragEvalState.golden?.suites?.length || 0}개 · 케이스 ${totalCases}개${rows.length !== totalCases ? ` · 표시 ${rows.length}` : ""}`;
  }

  if (elements.ragEvalGoldenEmpty) elements.ragEvalGoldenEmpty.hidden = rows.length > 0;

  body.innerHTML = "";
  for (const { suite, c } of rows) {
    const tr = document.createElement("tr");
    tr.dataset.suiteId = suite.id;
    tr.dataset.caseId = c.id;
    tr.innerHTML = `
      <td><code>${escapeHtml(c.id)}</code></td>
      <td><code>${escapeHtml(suite.id)}</code></td>
      <td class="rag-eval-query-cell">${escapeHtml(c.query || "")}</td>
      <td class="rag-eval-keys-cell">${(c.relevantChunkKeys || c.relevantDocIds || []).map((k) => `<code>${escapeHtml(k)}</code>`).join(" ")}</td>
      <td>${c.quick ? "✓" : ""}</td>
      <td class="rag-eval-row-actions">
        <button class="ghost-button rag-eval-edit" type="button">편집</button>
        <button class="ghost-button admin-danger-button rag-eval-delete" type="button">삭제</button>
      </td>
    `;
    body.appendChild(tr);
  }
}

function suiteById(id) {
  return (ragEvalState.golden?.suites || []).find((s) => s.id === id);
}

function caseInSuite(suite, caseId) {
  return (suite?.cases || []).find((c) => c.id === caseId);
}

async function openGoldenCaseEditor({ suiteId, caseId } = {}) {
  const suites = ragEvalState.golden?.suites || [];
  if (!suites.length) {
    alert("골든셋에 suite가 없습니다. 먼저 fixtures의 suite 정의를 확인하세요.");
    return;
  }

  const editingSuite = suiteId ? suiteById(suiteId) : suites[0];
  const editingCase = editingSuite ? caseInSuite(editingSuite, caseId) : null;

  const dialog = document.createElement("dialog");
  dialog.className = "rag-eval-case-dialog";
  dialog.innerHTML = `
    <form method="dialog" class="rag-eval-case-form">
      <h3>${editingCase ? "케이스 편집" : "새 케이스"}</h3>
      <div class="field">
        <label class="field-label">Suite</label>
        <select name="suiteId" class="text-input" ${editingCase ? "disabled" : ""}>
          ${suites.map((s) => `<option value="${escapeHtml(s.id)}" ${s.id === (editingSuite?.id) ? "selected" : ""}>${escapeHtml(s.id)} — ${escapeHtml(s.notebookId)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label class="field-label">Case ID</label>
        <input name="caseId" class="text-input" required pattern="[a-zA-Z0-9_\\-]+" maxlength="40" value="${escapeHtml(editingCase?.id || "")}" ${editingCase ? "readonly" : ""} />
      </div>
      <div class="field">
        <label class="field-label">질의</label>
        <textarea name="query" class="text-input" rows="2" required maxlength="500">${escapeHtml(editingCase?.query || "")}</textarea>
      </div>
      <div class="field">
        <label class="field-label">관련 청크 키 (한 줄에 하나, 형식: documentId:chunkIndex)</label>
        <textarea name="relevantChunkKeys" class="text-input" rows="3">${escapeHtml((editingCase?.relevantChunkKeys || []).join("\n"))}</textarea>
      </div>
      <div class="field">
        <label class="rag-eval-checkbox"><input type="checkbox" name="quick" ${editingCase?.quick ? "checked" : ""} /> quick 평가에 포함</label>
      </div>
      <div class="rag-eval-case-actions">
        <button type="button" class="ghost-button" data-action="cancel">취소</button>
        <button type="submit" class="send-button">저장</button>
      </div>
    </form>
  `;
  document.body.appendChild(dialog);
  dialog.querySelector('[data-action="cancel"]').addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => dialog.remove());
  dialog.querySelector("form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const targetSuiteId = editingCase ? editingSuite.id : String(data.get("suiteId") || "");
    const caseEntry = {
      id: String(data.get("caseId") || "").trim(),
      query: String(data.get("query") || "").trim(),
      relevantChunkKeys: String(data.get("relevantChunkKeys") || "")
        .split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
    };
    if (data.get("quick")) caseEntry.quick = true;
    if (!caseEntry.id || !caseEntry.query || !caseEntry.relevantChunkKeys.length) {
      alert("ID / 질의 / 최소 1개 이상의 관련 청크 키가 필요합니다.");
      return;
    }
    try {
      await api("/golden/case", { method: "PUT", body: JSON.stringify({ suiteId: targetSuiteId, case: caseEntry }) });
      dialog.close();
      await refreshGolden();
    } catch (err) {
      alert(`저장 실패: ${err.message}`);
    }
  });
  dialog.showModal();
}

async function deleteGoldenCase(suiteId, caseId) {
  if (!confirm(`케이스 "${caseId}"를 삭제할까요?`)) return;
  try {
    await api(`/golden/case?suiteId=${encodeURIComponent(suiteId)}&caseId=${encodeURIComponent(caseId)}`, { method: "DELETE" });
    await refreshGolden();
  } catch (err) {
    alert(`삭제 실패: ${err.message}`);
  }
}

// ===== Run tab =====

async function refreshNotebooksForRun() {
  // Pull notebooks from the existing list endpoint to populate filters.
  try {
    const response = await fetch("/api/notebooks", { headers: authHeaders() });
    if (response.ok) {
      const data = await response.json();
      ragEvalState.notebooks = data.notebooks || [];
      const cur = elements.ragEvalRunNotebook?.value || "";
      const curHealth = elements.ragEvalHealthNotebook?.value || "";
      const opts = `<option value="">전체</option>` + ragEvalState.notebooks
        .map((n) => `<option value="${escapeHtml(n.id)}">${escapeHtml(n.name || n.id)}</option>`)
        .join("");
      if (elements.ragEvalRunNotebook) { elements.ragEvalRunNotebook.innerHTML = opts; elements.ragEvalRunNotebook.value = cur; }
      if (elements.ragEvalHealthNotebook) { elements.ragEvalHealthNotebook.innerHTML = opts; elements.ragEvalHealthNotebook.value = curHealth; }
    }
  } catch { /* ignore */ }
  if (!ragEvalState.golden) await refreshGolden().catch(() => {});
  renderVariantsPreview();
}

function applyPreset(name) {
  ragEvalState.activePreset = name;
  ragEvalState.variants = PRESETS[name] || PRESETS.default;
  document.querySelectorAll(".rag-eval-preset").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.preset === name);
  });
  renderVariantsPreview();
}

function renderVariantsPreview() {
  if (!elements.ragEvalVariantsPreview) return;
  elements.ragEvalVariantsPreview.innerHTML = ragEvalState.variants
    .map((v) => {
      const flags = [];
      if (typeof v.rerank === "boolean") flags.push(`rerank:${v.rerank ? "on" : "off"}`);
      if (typeof v.queryExpansion === "boolean") flags.push(`qe:${v.queryExpansion ? "on" : "off"}`);
      if (typeof v.graphExpansion === "boolean") flags.push(`kg:${v.graphExpansion ? "on" : "off"}`);
      return `<span class="rag-eval-variant-chip">${escapeHtml(v.label)}${flags.length ? ` <small>(${flags.join(", ")})</small>` : ""}</span>`;
    })
    .join("");
}

function setProgress(done, total) {
  if (!elements.ragEvalProgressTrack || !elements.ragEvalProgressBar) return;
  elements.ragEvalProgressTrack.hidden = false;
  const pct = total > 0 ? (done / total) * 100 : 0;
  elements.ragEvalProgressBar.style.width = `${pct.toFixed(1)}%`;
}

function appendRunLog(line) {
  if (!elements.ragEvalRunLog) return;
  const div = document.createElement("div");
  div.className = "rag-eval-run-log-line";
  div.textContent = line;
  elements.ragEvalRunLog.appendChild(div);
  elements.ragEvalRunLog.scrollTop = elements.ragEvalRunLog.scrollHeight;
}

async function startRun() {
  if (ragEvalState.activeRunId) {
    alert("이미 진행 중인 실행이 있습니다.");
    return;
  }
  const filter = {
    notebookId: elements.ragEvalRunNotebook?.value || undefined,
    suiteId: elements.ragEvalRunSuite?.value || undefined,
    quick: !!elements.ragEvalRunQuick?.checked
  };
  const k = parseInt(elements.ragEvalRunK?.value, 10) || 10;
  const variants = ragEvalState.variants;

  if (elements.ragEvalRunLog) elements.ragEvalRunLog.textContent = "";
  setProgress(0, 1);
  if (elements.ragEvalRunStatus) elements.ragEvalRunStatus.textContent = "실행 시작…";
  appendRunLog(`▶ 시작: filter=${JSON.stringify(filter)} k=${k} variants=${variants.map((v) => v.label).join(",")}`);

  let started;
  try {
    started = await api("/runs", { method: "POST", body: JSON.stringify({ filter, k, variants }) });
  } catch (err) {
    if (elements.ragEvalRunStatus) elements.ragEvalRunStatus.textContent = `시작 실패: ${err.message}`;
    return;
  }
  ragEvalState.activeRunId = started.runId;
  if (elements.ragEvalRunCancelButton) elements.ragEvalRunCancelButton.hidden = false;
  attachStream(started.runId);
}

function attachStream(runId) {
  // Send token via header is impossible for native EventSource, so fall back to
  // polling progress + final result via GET /runs/:id when no admin token.
  // But same-origin EventSource will not include Authorization header — use a
  // streaming fetch instead.
  const controller = new AbortController();
  ragEvalState.eventSource = controller;
  fetch(`/api/admin/rag-eval/runs/${encodeURIComponent(runId)}/stream`, {
    headers: authHeaders(),
    signal: controller.signal
  }).then(async (response) => {
    if (!response.ok || !response.body) {
      throw new Error(`stream HTTP ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const block = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        handleStreamBlock(block);
      }
    }
  }).catch((err) => {
    if (controller.signal.aborted) return;
    appendRunLog(`! 스트림 오류: ${err.message} — 결과는 폴링으로 확인합니다.`);
    pollRunUntilDone(runId).catch((e) => appendRunLog(`! 폴링 실패: ${e.message}`));
  });
}

function handleStreamBlock(block) {
  const lines = block.split("\n");
  let event = "message";
  let dataRaw = "";
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) dataRaw += line.slice(5).trim();
  }
  let data;
  try { data = JSON.parse(dataRaw); } catch { return; }

  if (event === "progress") {
    setProgress(data.done, data.total);
    if (elements.ragEvalRunStatus) elements.ragEvalRunStatus.textContent = `진행: ${data.done}/${data.total} — ${data.suiteId} / ${data.caseId} / ${data.variantLabel}`;
  } else if (event === "done") {
    finalizeRun(data.runId);
  } else if (event === "error") {
    if (elements.ragEvalRunStatus) elements.ragEvalRunStatus.textContent = `오류: ${data.error}`;
    appendRunLog(`✕ 오류: ${data.error}`);
    resetRunUI();
  } else if (event === "hello") {
    appendRunLog(`▶ 연결됨 (status=${data.status})`);
  }
}

async function pollRunUntilDone(runId) {
  for (let i = 0; i < 600; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    let info;
    try { info = await api(`/runs/${encodeURIComponent(runId)}`); } catch { continue; }
    if (info.status === "done") { finalizeRun(info.runId || runId); return; }
    if (info.status === "error") { appendRunLog(`✕ ${info.error || "error"}`); resetRunUI(); return; }
    if (info.progress) {
      setProgress(info.progress.done, info.progress.total);
      if (elements.ragEvalRunStatus) elements.ragEvalRunStatus.textContent = `진행: ${info.progress.done}/${info.progress.total}`;
    }
  }
}

async function finalizeRun(runId) {
  resetRunUI();
  appendRunLog(`✓ 완료 → 결과 탭으로 이동`);
  ragEvalState.selectedRunId = runId;
  await refreshRuns();
  setActiveTab("results");
}

function resetRunUI() {
  ragEvalState.activeRunId = null;
  ragEvalState.eventSource?.abort?.();
  ragEvalState.eventSource = null;
  if (elements.ragEvalRunCancelButton) elements.ragEvalRunCancelButton.hidden = true;
}

async function cancelRun() {
  if (!ragEvalState.activeRunId) return;
  if (!confirm("진행 중인 평가를 중지할까요?")) return;
  try {
    await api(`/runs/${encodeURIComponent(ragEvalState.activeRunId)}`, { method: "DELETE" });
  } catch (err) {
    appendRunLog(`! 중지 실패: ${err.message}`);
  }
  resetRunUI();
}

// ===== Results tab =====

async function refreshRuns() {
  const data = await api("/runs?limit=50");
  ragEvalState.runs = [...(data.active || []), ...(data.runs || [])];
  renderRunPicker();
  if (ragEvalState.selectedRunId) await renderRunDetail(ragEvalState.selectedRunId);
  else if (ragEvalState.runs[0]) {
    ragEvalState.selectedRunId = ragEvalState.runs[0].runId;
    await renderRunDetail(ragEvalState.selectedRunId);
  }
}

function renderRunPicker() {
  if (!elements.ragEvalRunPicker) return;
  elements.ragEvalRunPicker.innerHTML = ragEvalState.runs.length
    ? ragEvalState.runs.map((r) => {
        const ts = r.startedAt ? new Date(r.startedAt).toLocaleString() : r.runId;
        const status = r.status === "running" ? " · 진행 중" : "";
        return `<option value="${escapeHtml(r.runId)}" ${r.runId === ragEvalState.selectedRunId ? "selected" : ""}>${escapeHtml(ts)} · ${escapeHtml((r.variants || []).join("/"))}${status}</option>`;
      }).join("")
    : `<option value="">실행 이력이 없습니다</option>`;
  elements.ragEvalRunPicker.disabled = !ragEvalState.runs.length;
  if (elements.ragEvalResultsDeleteButton) elements.ragEvalResultsDeleteButton.hidden = !ragEvalState.runs.length;
}

function renderComparisonBlock(comparisons) {
  const rows = Array.isArray(comparisons) ? comparisons.filter((c) => c && c.n > 0) : [];
  if (!rows.length) return "";
  return `
    <div class="rag-eval-summary-grid">
      ${rows.map((c) => `
        <div class="rag-eval-summary-card">
          <header><strong>KG A/B</strong> <small>${escapeHtml(c.baseline)} -> ${escapeHtml(c.graph)} · n=${c.n}</small></header>
          <dl>
            <dt>Latency delta</dt><dd>${fmtSignedMs(c.avgLatencyDeltaMs)}</dd>
            <dt>Baseline total</dt><dd>${fmtMs(c.baselineAvgTotalMs)}</dd>
            <dt>Graph total</dt><dd>${fmtMs(c.graphAvgTotalMs)}</dd>
            <dt>Recall delta</dt><dd>${fmtSignedNum(c.recallDelta)}</dd>
            <dt>MRR delta</dt><dd>${fmtSignedNum(c.mrrDelta)}</dd>
            <dt>Precision delta</dt><dd>${fmtSignedNum(c.precisionDelta)}</dd>
            <dt>Graph sup hit</dt><dd>${typeof c.graphSupplementHitRate === "number" ? fmtPct(c.graphSupplementHitRate) : "n/a"}</dd>
            <dt>Graph used</dt><dd>${fmtPct(c.graphUsedRate)}</dd>
            <dt>Graph expansion</dt><dd>${fmtMs(c.avgGraphExpansionMs)}</dd>
            <dt>Chunk hydration</dt><dd>${fmtMs(c.avgGraphHydrationMs)}</dd>
            <dt>Noise cases</dt><dd>${fmtPct(c.noiseCaseRate)}</dd>
            <dt>Recall worse</dt><dd>${fmtPct(c.recallWorseRate)}</dd>
            <dt>Precision worse</dt><dd>${fmtPct(c.precisionWorseRate)}</dd>
          </dl>
        </div>
      `).join("")}
    </div>
  `;
}

async function renderRunDetail(runId) {
  if (!runId) return;
  ragEvalState.selectedRunId = runId;
  const body = elements.ragEvalResultsBody;
  if (!body) return;
  body.textContent = "불러오는 중…";
  let detail;
  try { detail = await api(`/runs/${encodeURIComponent(runId)}`); }
  catch (err) { body.textContent = `오류: ${err.message}`; return; }

  if (detail.status === "running") {
    body.innerHTML = `<p>이 실행은 아직 진행 중입니다. 완료 후 다시 확인하세요.</p>`;
    return;
  }

  const summary = detail.summary || {};
  const variants = Object.keys(summary);
  const summaryCards = variants.map((label) => {
    const m = summary[label] || {};
    const timing = m.avgTimingMs || {};
    const graphRows = [];
    if (typeof timing.totalMs === "number") graphRows.push(`<dt>Total latency</dt><dd>${fmtMs(timing.totalMs)}</dd>`);
    if (typeof timing.graphExpansionMs === "number") graphRows.push(`<dt>Graph expansion</dt><dd>${fmtMs(timing.graphExpansionMs)}</dd>`);
    if (typeof timing.graphHydrationMs === "number") graphRows.push(`<dt>Graph hydration</dt><dd>${fmtMs(timing.graphHydrationMs)}</dd>`);
    if (typeof m.graphSupplementHitRate === "number") graphRows.push(`<dt>Graph sup hit</dt><dd>${fmtPct(m.graphSupplementHitRate)}</dd>`);
    if (typeof m.graphHydrationRate === "number" && m.graphHydrationRate > 0) graphRows.push(`<dt>Hydration cases</dt><dd>${fmtPct(m.graphHydrationRate)}</dd>`);
    return `<div class="rag-eval-summary-card">
      <header><strong>${escapeHtml(label)}</strong> <small>n=${m.n ?? 0}</small></header>
      <dl>
        <dt>Recall@${detail.k}</dt><dd>${fmtNum(m.recall)}</dd>
        <dt>MRR@${detail.k}</dt><dd>${fmtNum(m.mrr)}</dd>
        <dt>Precision@${detail.k}</dt><dd>${fmtNum(m.precision)}</dd>
        <dt>No-evidence</dt><dd>${fmtPct(m.noEvidenceRate)}</dd>
        <dt>Fallback</dt><dd>${fmtPct(m.fallbackRate)}</dd>
        <dt>Rerank applied</dt><dd>${fmtPct(m.rerankAppliedRate)}</dd>
        ${graphRows.join("")}
      </dl>
    </div>`;
  }).join("");

  const suiteRows = (detail.suites || []).flatMap((suite) => suite.cases.map((c) => {
    const cells = variants.map((label) => {
      const v = c.variants?.[label];
      if (!v) return `<td>—</td>`;
      if (v.error) return `<td class="rag-eval-cell-error">${escapeHtml(v.error)}</td>`;
      const m = v.metrics || {};
      const diag = v.diagnostics || {};
      const flags = [];
      if (diag.rerankApplied) flags.push("R");
      if (diag.fallbackLoadedAllChunks) flags.push("FB");
      if (diag.graphExpansion?.enabled) flags.push(`KG${diag.graphExpansion?.stats?.returned ? `:${diag.graphExpansion.stats.returned}` : ""}`);
      if (diag.graphExpansion?.hydratedAllChunks) flags.push("HYD");
      if ((v.returnedCount ?? 0) === 0) flags.push("∅");
      return `<td>R:${fmtNum(m.recall)}<br/>MRR:${fmtNum(m.rr)}${flags.length ? `<br/><small>${flags.join("·")}</small>` : ""}</td>`;
    }).join("");
    return `<tr>
      <td><code>${escapeHtml(c.id)}</code></td>
      <td><code>${escapeHtml(suite.suiteId)}</code></td>
      <td class="rag-eval-query-cell">${escapeHtml(c.query)}</td>
      ${cells}
    </tr>`;
  })).join("");

  const failureSamples = (detail.failureSamples || []).slice(0, 30);
  const failureBlock = failureSamples.length ? `
    <details class="rag-eval-failures" open>
      <summary>실패 샘플 (recall=0) — ${failureSamples.length}건${detail.failureSamples.length > failureSamples.length ? ` / 총 ${detail.failureSamples.length}` : ""}</summary>
      <div class="rag-eval-failures-list">
        ${failureSamples.map((f) => `
          <div class="rag-eval-failure-card">
            <div class="rag-eval-failure-head"><code>${escapeHtml(f.caseId)}</code> · <code>${escapeHtml(f.variantLabel)}</code> · <code>${escapeHtml(f.suiteId)}</code></div>
            <div class="rag-eval-failure-query">${escapeHtml(f.query)}</div>
            <div class="rag-eval-failure-expected"><span class="rag-eval-failure-label">기대</span> ${(f.expectedKeys || []).map((k) => `<code>${escapeHtml(k)}</code>`).join(" ")}</div>
            <div class="rag-eval-failure-got"><span class="rag-eval-failure-label">Top-K</span> ${(f.gotTopK || []).slice(0, 5).map((c) => `<code>${escapeHtml(c.documentId)}:${escapeHtml(String(c.chunkIndex))}</code>`).join(" ")}</div>
          </div>
        `).join("")}
      </div>
    </details>` : "";

  body.innerHTML = `
    <div class="rag-eval-run-meta">
      <div><strong>Run</strong> <code>${escapeHtml(detail.runId || runId)}</code></div>
      <div><strong>시작</strong> ${escapeHtml(detail.startedAt || "")}</div>
      <div><strong>종료</strong> ${escapeHtml(detail.finishedAt || "")}</div>
      <div><strong>k</strong> ${detail.k} · <strong>모드</strong> ${escapeHtml(detail.mode || "")} · <strong>케이스</strong> ${detail.totalQueries ?? "—"}${detail.failedQueries ? ` (${detail.failedQueries} 실패)` : ""}</div>
    </div>
    <div class="rag-eval-summary-grid">${summaryCards}</div>
    ${renderComparisonBlock(detail.comparisons)}
    ${failureBlock}
    <div class="rag-eval-table-wrap">
      <table class="rag-eval-table">
        <thead>
          <tr>
            <th>Case</th><th>Suite</th><th>질의</th>
            ${variants.map((v) => `<th>${escapeHtml(v)}</th>`).join("")}
          </tr>
        </thead>
        <tbody>${suiteRows}</tbody>
      </table>
    </div>
  `;
}

async function deleteSelectedRun() {
  if (!ragEvalState.selectedRunId) return;
  if (!confirm(`실행 "${ragEvalState.selectedRunId}"을 삭제할까요?`)) return;
  try {
    await api(`/runs/${encodeURIComponent(ragEvalState.selectedRunId)}`, { method: "DELETE" });
    ragEvalState.selectedRunId = null;
    await refreshRuns();
  } catch (err) {
    alert(`삭제 실패: ${err.message}`);
  }
}

// ===== Health tab =====

async function refreshHealth() {
  const days = parseInt(elements.ragEvalHealthDays?.value, 10) || 7;
  const notebookId = elements.ragEvalHealthNotebook?.value || "";
  const params = new URLSearchParams({ days: String(days), profile: "department" });
  if (notebookId) params.set("notebookId", notebookId);
  let summary;
  try { summary = await api(`/retrieval-log/summary?${params}`); }
  catch (err) {
    if (elements.ragEvalHealthBody) elements.ragEvalHealthBody.textContent = `오류: ${err.message}`;
    return;
  }
  if (!elements.ragEvalHealthBody) return;
  elements.ragEvalHealthBody.innerHTML = `
    <div class="rag-eval-summary-grid">
      <div class="rag-eval-summary-card">
        <header><strong>최근 ${summary.days}일</strong></header>
        <dl>
          <dt>총 검색</dt><dd>${summary.total}</dd>
          <dt>Fallback (전체청크)</dt><dd>${fmtPct(summary.fallbackLoadedAllChunksRate)}</dd>
          <dt>No-evidence</dt><dd>${fmtPct(summary.noEvidenceRate)}</dd>
          <dt>Rerank 적용</dt><dd>${fmtPct(summary.rerankAppliedRate)}</dd>
        </dl>
      </div>
      <div class="rag-eval-summary-card">
        <header><strong>평균 지연</strong></header>
        <dl>
          ${Object.entries(summary.avgTimingMs || {}).map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${fmtMs(v)}</dd>`).join("")}
        </dl>
      </div>
    </div>
    <h4>Top fallback 사유</h4>
    <table class="rag-eval-table">
      <thead><tr><th>사유</th><th>건수</th><th>비율</th></tr></thead>
      <tbody>
        ${(summary.topFallbackReasons || []).map((r) => `<tr><td><code>${escapeHtml(r.reason)}</code></td><td>${r.count}</td><td>${fmtPct(r.rate)}</td></tr>`).join("") || `<tr><td colspan="3">데이터 없음</td></tr>`}
      </tbody>
    </table>
  `;
}

// ===== Public surface =====

export async function showAdminRagEvalPanel() {
  if (elements.adminRagEvalPanel) elements.adminRagEvalPanel.hidden = false;
  setActiveTab(ragEvalState.activeTab || "golden");
}

export function hideAdminRagEvalPanel() {
  if (elements.adminRagEvalPanel) elements.adminRagEvalPanel.hidden = true;
  resetRunUI();
}

export function bindRagEvalEvents() {
  document.querySelectorAll("#adminRagEvalPanel .rag-eval-tab").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });
  document.querySelectorAll("#adminRagEvalPanel .rag-eval-preset").forEach((btn) => {
    btn.addEventListener("click", () => applyPreset(btn.dataset.preset));
  });

  elements.ragEvalGoldenSearch?.addEventListener("input", () => renderGoldenTable());
  elements.ragEvalGoldenSuiteFilter?.addEventListener("change", () => renderGoldenTable());
  elements.ragEvalGoldenRefreshButton?.addEventListener("click", () => refreshGolden().catch(reportError));
  elements.ragEvalGoldenAddButton?.addEventListener("click", () => openGoldenCaseEditor());
  elements.ragEvalGoldenTableBody?.addEventListener("click", (event) => {
    const tr = event.target.closest("tr[data-case-id]");
    if (!tr) return;
    if (event.target.classList.contains("rag-eval-edit")) {
      openGoldenCaseEditor({ suiteId: tr.dataset.suiteId, caseId: tr.dataset.caseId });
    } else if (event.target.classList.contains("rag-eval-delete")) {
      deleteGoldenCase(tr.dataset.suiteId, tr.dataset.caseId);
    }
  });

  elements.ragEvalRunStartButton?.addEventListener("click", () => startRun());
  elements.ragEvalRunCancelButton?.addEventListener("click", () => cancelRun());

  elements.ragEvalResultsRefreshButton?.addEventListener("click", () => refreshRuns().catch(reportError));
  elements.ragEvalResultsDeleteButton?.addEventListener("click", () => deleteSelectedRun());
  elements.ragEvalRunPicker?.addEventListener("change", (event) => {
    ragEvalState.selectedRunId = event.target.value || null;
    renderRunDetail(ragEvalState.selectedRunId).catch(reportError);
  });

  elements.ragEvalHealthRefreshButton?.addEventListener("click", () => refreshHealth().catch(reportError));

  applyPreset("default");
}

// ===== utils =====

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
