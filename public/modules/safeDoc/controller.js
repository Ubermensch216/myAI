// 문서보안 화면 제어 — 이벤트 연결과 화면 전이
//
// safeDoc 원본의 src/main.js(575줄, 진입점·이벤트·정책저장을 한 파일에 담고 있던
// 유일한 구조적 부채)를 myAI의 bindXxxEvents() 관례에 맞춰 분해한 것이다.
//
// 개인정보 원문은 콘솔·저장소에 기록하지 않는다 (NFR-003).
// 작업 세션(session)은 이 모듈 스코프에만 존재하며 window.state 에 넣지 않는다 —
// persistence.js 는 state 만 직렬화하므로 이 구조가 곧 영속화 차단이다.

import { state, showConfirmDialog } from '../state.js';
import { scheduleSave } from '../persistence.js';
import { PROGRAM_VERSION } from './version.js';
import { RULE_VERSION } from './detect/engine.js';
import { PII_TYPES, ACTION_LABELS } from './detect/types.js';
import { WorkSession } from './core/session.js';
import { validateAndRead, downloadBlob, resultFileName } from './core/fileManager.js';
import { parseDocument, analyze, buildResult, restoreDocument } from './core/analyzer.js';
import { applyToText } from './core/deidentify.js';
import { buildMappingTable, mappingTableToBlob, parseMappingTable } from './core/mappingTable.js';
import { buildSummary, summaryToBlob } from './core/summary.js';
import { AppError } from './core/errors.js';
import { normalizeTypePolicies } from './policies.js';
import { $, $side, $$, $$side, toast, showScreen, showTab, textOffsetIn, escapeHtml } from './ui/dom.js';
import {
  renderPreviewHtml, renderCandidateListHtml, renderAfterHtml, renderSummaryHtml
} from './ui/render.js';

let session = new WorkSession();
let analyzeCancelled = false;
let manualSeq = 0;

// ---------- 설정 영속화 (myAI 암호화 IndexedDB 경유) ----------

function ensureSafeDocState() {
  if (!state.safeDoc || typeof state.safeDoc !== 'object') {
    state.safeDoc = { typePolicies: {}, userRules: [] };
  }
  if (!Array.isArray(state.safeDoc.userRules)) state.safeDoc.userRules = [];
  return state.safeDoc;
}

function loadPolicies() {
  const saved = normalizeTypePolicies(ensureSafeDocState().typePolicies);
  for (const [type, action] of Object.entries(saved)) {
    if (session.typePolicies[type]) session.typePolicies[type] = action;
  }
}

function savePolicies() {
  ensureSafeDocState().typePolicies = normalizeTypePolicies(session.typePolicies);
  scheduleSave();
}

// 사용자 정의 규칙은 정규식이라 ReDoS 벡터이며 명세상 세션 한정(FR-803)이다.
// state 에 두되 persistence.js 의 직렬화 대상에서는 제외된다(policies.js 참고).
const userRules = () => ensureSafeDocState().userRules;

// ---------- 초기화 ----------

let bound = false;

export function initController() {
  const version = $('#sdcVersion');
  if (version) version.textContent = `v${PROGRAM_VERSION} · 탐지규칙 v${RULE_VERSION}`;

  loadPolicies();
  populateTypeSelects();
  renderPolicyList();
  renderRuleList();

  if (!bound) {
    bindTabEvents();
    bindSafeDocUploadEvents();
    bindSafeDocReviewEvents();
    bindSafeDocResultEvents();
    bindSafeDocRestoreEvents();
    bindSafeDocSettingsEvents();
    // 페이지 이탈 시 임시 데이터 정리 (FR-705)
    window.addEventListener('beforeunload', () => session.dispose());
    bound = true;
  }
}

/** 화면 이탈·새 문서 시 작업 세션 폐기 (원본 문서·개인정보 원문·대응표 해제) */
export function disposeController() {
  session.dispose();
  session.reset();
  analyzeCancelled = true;
  resetReviewUi();
  showScreen('main');
}

function populateTypeSelects() {
  const options = Object.entries(PII_TYPES)
    .map(([code, def]) => `<option value="${code}">${escapeHtml(def.label)}</option>`)
    .join('');
  for (const id of ['#sdcSearchType', '#sdcAddType']) {
    const el = $(id);
    if (!el) continue;
    el.innerHTML = options;
    el.value = 'CUSTOM';
  }
}

// ---------- 작업 탭 전환 ----------

function bindTabEvents() {
  for (const btn of $$side('.sd-side-tab')) {
    btn.addEventListener('click', () => showTab(btn.dataset.sdTab));
  }
  const newDoc = $side('#sdcNewDocButton');
  newDoc?.addEventListener('click', async () => {
    if (session.parsed && !(await confirmDiscard())) return;
    startNewDocument();
    showTab('deidentify');
  });
}

// ---------- 업로드 (FR-101, FR-102) ----------

function bindSafeDocUploadEvents() {
  const dropZone = $('#sdcDropZone');
  const fileInput = $('#sdcFileInput');
  if (!dropZone || !fileInput) return;

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) handleFile(fileInput.files[0]);
  });
  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
  });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]);
  });
}

function confirmDiscard() {
  return showConfirmDialog({
    title: '작업 중인 문서를 버립니다',
    body: '작업 중인 문서가 있습니다. 새 문서를 열면 현재 작업 내용이 사라집니다.\n계속하시겠습니까?',
    okText: '새 문서 열기',
    danger: true
  });
}

function startNewDocument() {
  session.dispose();
  session.reset();
  loadPolicies();
  resetReviewUi();
  showScreen('main');
}

async function handleFile(file) {
  const fileInput = $('#sdcFileInput');
  // 중복 업로드 방지 (FR-106)
  if (session.parsed && !(await confirmDiscard())) {
    if (fileInput) fileInput.value = '';
    return;
  }
  session.reset();
  loadPolicies();
  analyzeCancelled = false;

  try {
    const read = await validateAndRead(file);
    session.file = read;

    // 대용량 경고 (FR-207)
    if (read.size > 10 * 1024 * 1024) {
      toast('10MB를 초과하는 문서는 처리 속도가 느려질 수 있습니다.');
    }

    showScreen('analyze');
    const info = `파일명: <strong>${escapeHtml(read.name)}</strong> · 형식: ${escapeHtml(read.ext.toUpperCase())} · 크기: ${(read.size / 1024).toFixed(1)}KB`;
    setHtml('#sdcAnalyzeFileInfo', info);
    const sideInfo = $side('#sdcSideFileInfo');
    if (sideInfo) {
      sideInfo.innerHTML = info;
      sideInfo.hidden = false;
    }
    await runAnalysis();
  } catch (err) {
    showError(err);
    showScreen('main');
  } finally {
    if (fileInput) fileInput.value = '';
  }
}

function setProgress(percent, statusText) {
  const bar = $('#sdcAnalyzeProgress');
  if (bar) bar.style.width = `${percent}%`;
  const status = $('#sdcAnalyzeStatus');
  if (status) status.textContent = statusText;
}

// 분석 실행 — 단계 사이에 제어권을 양보하여 화면 멈춤 방지 (NFR-104)
async function runAnalysis() {
  const yieldUi = () => new Promise((r) => setTimeout(r, 30));
  try {
    setProgress(10, '파일을 읽는 중...');
    await yieldUi();
    if (analyzeCancelled) throw new AppError('E010');

    session.parsed = await parseDocument(session.file);
    setProgress(40, '문서 내용을 추출했습니다. 개인정보를 탐지하는 중...');
    await yieldUi();
    if (analyzeCancelled) throw new AppError('E010');

    session.candidates = runDetection();
    setProgress(90, '탐지 결과를 정리하는 중...');
    await yieldUi();
    if (analyzeCancelled) throw new AppError('E010');

    setProgress(100, '분석 완료');
    renderParsedMeta();
    renderReview();
    showScreen('review');
  } catch (err) {
    showError(err);
    session.dispose();
    showScreen('main');
  }
}

// 사용자 정규식은 메인 스레드에서 실행되므로 ReDoS 로 화면이 멈출 수 있다.
// 규칙 등록 시 정적 검증을 하고(bindSafeDocSettingsEvents), 여기서는 실행 시간을
// 재어 한도를 넘긴 규칙을 비활성화한 뒤 나머지로 재시도한다.
const RULE_TIME_BUDGET_MS = 3000;

function runDetection() {
  const rules = userRules();
  if (rules.length === 0) return analyze(session.parsed, []);

  const started = performance.now();
  const result = analyze(session.parsed, rules);
  const elapsed = performance.now() - started;

  if (elapsed > RULE_TIME_BUDGET_MS) {
    // 어느 규칙이 느린지 개별 측정하여 그 규칙만 끈다.
    const slow = [];
    const safe = [];
    for (const rule of rules) {
      const t = performance.now();
      try {
        analyze(session.parsed, [rule]);
      } catch {
        slow.push(rule);
        continue;
      }
      (performance.now() - t > RULE_TIME_BUDGET_MS ? slow : safe).push(rule);
    }
    if (slow.length > 0) {
      ensureSafeDocState().userRules = safe;
      renderRuleList();
      toast(`처리가 지나치게 오래 걸리는 규칙 ${slow.length}건을 해제했습니다: ${slow.map((r) => r.name).join(', ')}`, true);
      return analyze(session.parsed, safe);
    }
  }
  return result;
}

// 파싱 결과 메타정보 표시 (FR-104 — 원본에서는 계산만 하고 버려져 있었다)
function renderParsedMeta() {
  const meta = session.parsed?.meta;
  const sideInfo = $side('#sdcSideFileInfo');
  if (!meta || !sideInfo) return;
  const labels = {
    pageCount: '쪽수',
    charCount: '글자수',
    sheetNames: '시트',
    rowCount: '행수',
    paragraphCount: '문단수'
  };
  const parts = Object.entries(meta)
    .filter(([, v]) => v !== undefined && v !== null && String(v).length > 0)
    .map(([k, v]) => `${labels[k] || k}: ${escapeHtml(Array.isArray(v) ? v.join(', ') : String(v))}`);
  if (parts.length === 0) return;
  sideInfo.innerHTML += `<div class="sd-side-meta">${parts.join(' · ')}</div>`;
}

// ---------- 검토 화면 ----------

function setHtml(sel, html) {
  const el = $(sel);
  if (el) el.innerHTML = html;
}

function renderReview() {
  setHtml('#sdcPreview', renderPreviewHtml(session.parsed.text, session.candidates));
  setHtml('#sdcCandidateList', renderCandidateListHtml(session.candidates, session.typePolicies));
  const total = session.candidates.length;
  const selected = session.candidates.filter((c) => c.selected).length;
  const badge = $('#sdcDetectCount');
  if (badge) badge.textContent = `탐지 ${total}건 / 처리 대상 ${selected}건`;
}

function pushHistory() {
  // 되돌리기용 스냅샷 (FR-409) — 메모리에서만 유지
  session.history.push(JSON.stringify(session.candidates));
  if (session.history.length > 50) session.history.shift();
}

function findCandidate(id) {
  return session.candidates.find((c) => c.id === id);
}

function bindSafeDocReviewEvents() {
  // 미리보기에서 후보 클릭 → 목록 강조 이동
  $('#sdcPreview')?.addEventListener('click', (e) => {
    const mark = e.target.closest('mark.sd-pii');
    if (!mark) return;
    for (const m of $$('mark.sd-pii.focused')) m.classList.remove('focused');
    mark.classList.add('focused');
    const item = $(`.sd-candidate[data-id="${mark.dataset.id}"]`);
    if (item) {
      item.scrollIntoView({ block: 'center', behavior: 'smooth' });
      item.classList.add('flash');
      setTimeout(() => item.classList.remove('flash'), 1200);
    }
  });

  const list = $('#sdcCandidateList');

  // 후보 목록 상호작용 (위임)
  list?.addEventListener('click', (e) => {
    const item = e.target.closest('.sd-candidate');
    if (!item) return;
    const c = findCandidate(item.dataset.id);
    if (!c) return;

    if (e.target.classList.contains('c-exclude')) {
      // 탐지 제외/포함 (FR-403)
      pushHistory();
      c.selected = !c.selected;
      renderReview();
    } else if (e.target.classList.contains('c-same')) {
      // 동일값 일괄 선택 (FR-406)
      pushHistory();
      const targetState = !c.selected ? true : c.selected;
      let count = 0;
      for (const other of session.candidates) {
        if (other.originalText === c.originalText && other.type === c.type) {
          other.selected = targetState;
          other.action = c.action;
          count += 1;
        }
      }
      renderReview();
      toast(`동일한 값 ${count}건에 일괄 적용했습니다.`);
    } else if (e.target.classList.contains('c-check')) {
      pushHistory();
      c.selected = e.target.checked;
      renderReview();
    }
  });

  list?.addEventListener('change', (e) => {
    const item = e.target.closest('.sd-candidate');
    if (!item) return;
    const c = findCandidate(item.dataset.id);
    if (!c) return;
    if (e.target.classList.contains('c-type')) {
      // 유형 변경 (FR-405)
      pushHistory();
      c.type = e.target.value;
      c.action = null; // 새 유형의 기본 정책 적용
      renderReview();
    } else if (e.target.classList.contains('c-action')) {
      // 개별 처리방식 (FR-407)
      pushHistory();
      c.action = e.target.value;
    }
  });

  // 전체 선택/해제
  $('#sdcSelectAll')?.addEventListener('click', () => {
    pushHistory();
    for (const c of session.candidates) c.selected = true;
    renderReview();
  });
  $('#sdcDeselectAll')?.addEventListener('click', () => {
    pushHistory();
    for (const c of session.candidates) c.selected = false;
    renderReview();
  });

  // 검색 일괄 지정 (FR-408)
  $('#sdcSearchAdd')?.addEventListener('click', () => {
    const term = $('#sdcSearchInput')?.value ?? '';
    if (!term) {
      toast('검색할 문자열을 입력하십시오.', true);
      return;
    }
    const type = $('#sdcSearchType').value;
    pushHistory();
    const added = addCandidatesByText(term, type, 'SEARCH');
    renderReview();
    toast(
      added > 0 ? `"${term}" ${added}건을 개인정보로 지정했습니다.` : '이미 지정되었거나 문서에 없는 문자열입니다.',
      added === 0
    );
  });

  // 선택 영역 수동 추가 (FR-404)
  $('#sdcAddSelection')?.addEventListener('click', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      toast('미리보기에서 추가할 문자열을 먼저 드래그하십시오.', true);
      return;
    }
    const preview = $('#sdcPreview');
    if (!preview.contains(sel.anchorNode) || !preview.contains(sel.focusNode)) {
      toast('문서 미리보기 안의 문자열만 추가할 수 있습니다.', true);
      return;
    }
    let start = textOffsetIn(preview, sel.anchorNode, sel.anchorOffset);
    let end = textOffsetIn(preview, sel.focusNode, sel.focusOffset);
    if (start < 0 || end < 0) return;
    if (start > end) [start, end] = [end, start];
    if (start === end) return;

    const type = $('#sdcAddType').value;
    pushHistory();
    const ok = addManualCandidate(start, end, type);
    sel.removeAllRanges();
    renderReview();
    toast(ok ? '개인정보로 추가했습니다.' : '기존 후보와 겹치는 영역입니다.', !ok);
  });

  // 되돌리기 (FR-409)
  $('#sdcUndo')?.addEventListener('click', () => {
    const snapshot = session.history.pop();
    if (!snapshot) {
      toast('되돌릴 작업이 없습니다.', true);
      return;
    }
    session.candidates = JSON.parse(snapshot);
    renderReview();
  });

  // 최종 확인 후 실행 (FR-410)
  $('#sdcFinalConfirm')?.addEventListener('change', (e) => {
    const btn = $('#sdcExecute');
    if (btn) btn.disabled = !e.target.checked;
  });
  $('#sdcExecute')?.addEventListener('click', executeDeidentify);
  $('#sdcCancelAnalyze')?.addEventListener('click', () => { analyzeCancelled = true; });
}

function addManualCandidate(start, end, type, method = 'MANUAL') {
  const overlaps = session.candidates.some((c) => start < c.end && c.start < end);
  if (overlaps) return false;
  manualSeq += 1;
  session.candidates.push({
    id: `pii-manual-${String(manualSeq).padStart(4, '0')}`,
    documentPart: 'body',
    start,
    end,
    originalText: session.parsed.text.slice(start, end),
    type,
    confidence: 1,
    detectionMethod: method,
    context: '',
    selected: true,
    action: null,
    replacementText: null
  });
  session.manuallyAddedCount += 1;
  return true;
}

function addCandidatesByText(term, type, method) {
  const text = session.parsed.text;
  let added = 0;
  let idx = text.indexOf(term);
  while (idx >= 0) {
    if (addManualCandidate(idx, idx + term.length, type, method)) added += 1;
    idx = text.indexOf(term, idx + term.length);
  }
  return added;
}

// ---------- 비식별 실행 및 결과 ----------

async function executeDeidentify() {
  const startedAt = new Date();
  const executeButton = $('#sdcExecute');
  if (executeButton) executeButton.disabled = true;
  try {
    const { text: afterText, applied } = applyToText(session.parsed.text, session.candidates, session);
    const resultName = resultFileName(session.file.name);
    const blob = await buildResult(session.parsed, afterText, applied);

    session.excludedCount = session.candidates.filter((c) => !c.selected).length;
    const summary = buildSummary({
      session, applied, startedAt, finishedAt: new Date(), resultName
    });
    const mappingTable = buildMappingTable(session.file.name, resultName, applied);

    session.result = { blob, fileName: resultName, afterText, applied, summary, mappingTable };

    // 미처리 경고 (FR-608)
    const warnBox = $('#sdcUnprocessedWarning');
    if (warnBox) {
      if (session.excludedCount > 0) {
        warnBox.textContent = `처리하지 않은 개인정보 후보가 ${session.excludedCount}건 있습니다. 결과 파일에 원문이 남아 있을 수 있으니 확인하십시오.`;
        warnBox.hidden = false;
      } else {
        warnBox.hidden = true;
      }
    }

    // PDF는 가림 영역을 근사 좌표로 계산하므로 육안 확인이 필요하다.
    const pdfWarn = $('#sdcPdfWarning');
    if (pdfWarn) pdfWarn.hidden = session.parsed.format !== 'pdf';

    setHtml('#sdcResultSummary', renderSummaryHtml(summary));
    setHtml('#sdcCompareBefore', renderPreviewHtml(session.parsed.text, session.candidates.filter((c) => c.selected)));
    setHtml('#sdcCompareAfter', renderAfterHtml(afterText, applied));
    showScreen('result');
  } catch (err) {
    showError(err);
    if (executeButton) executeButton.disabled = false;
  }
}

function bindSafeDocResultEvents() {
  $('#sdcDownloadResult')?.addEventListener('click', () => {
    if (!session.result) return;
    downloadBlob(session.result.blob, session.result.fileName);
  });

  $('#sdcDownloadMapping')?.addEventListener('click', async () => {
    if (!session.result) return;
    // 대응표에는 개인정보 원문이 평문으로 포함된다 — 명시적 동의 후에만 내보낸다.
    const ok = await showConfirmDialog({
      title: '대응표에 개인정보 원문이 포함됩니다',
      body: '대응표 파일에는 개인정보 원문이 평문으로 들어 있습니다.\n'
        + '결과 파일과 분리하여 안전한 위치에 보관할 수 있는 경우에만 내려받으십시오.\n'
        + '계속하시겠습니까?',
      okText: '대응표 다운로드',
      danger: true
    });
    if (!ok) return;
    const name = resultFileName(session.file.name, '_대응표').replace(/\.[^.]+$/, '.json');
    downloadBlob(mappingTableToBlob(session.result.mappingTable), name);
  });

  $('#sdcDownloadSummary')?.addEventListener('click', () => {
    if (!session.result) return;
    const name = resultFileName(session.file.name, '_처리요약').replace(/\.[^.]+$/, '.json');
    downloadBlob(summaryToBlob(session.result.summary), name);
  });

  // 새 문서 처리 (FR-609)
  $('#sdcNewDoc')?.addEventListener('click', () => startNewDocument());

  // 작업 종료: 화면·메모리 초기화 (FR-705, 기술명세서 Ⅷ-4)
  $('#sdcFinish')?.addEventListener('click', () => {
    startNewDocument();
    toast('작업정보를 초기화했습니다.');
  });
}

function resetReviewUi() {
  for (const sel of ['#sdcPreview', '#sdcCandidateList', '#sdcCompareBefore', '#sdcCompareAfter', '#sdcResultSummary']) {
    setHtml(sel, '');
  }
  const confirmBox = $('#sdcFinalConfirm');
  if (confirmBox) confirmBox.checked = false;
  const execute = $('#sdcExecute');
  if (execute) execute.disabled = true;
  const search = $('#sdcSearchInput');
  if (search) search.value = '';
  const sideInfo = $side('#sdcSideFileInfo');
  if (sideInfo) {
    sideInfo.innerHTML = '';
    sideInfo.hidden = true;
  }
  manualSeq = 0;
}

// ---------- 복원 ----------

function bindSafeDocRestoreEvents() {
  const docInput = $('#sdcRestoreDocInput');
  const mapInput = $('#sdcRestoreMapInput');
  const btn = $('#sdcRestore');
  if (!docInput || !mapInput || !btn) return;

  const updateBtn = () => {
    btn.disabled = !(docInput.files.length > 0 && mapInput.files.length > 0);
  };
  docInput.addEventListener('change', updateBtn);
  mapInput.addEventListener('change', updateBtn);

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const docFile = docInput.files[0];
      const mapFile = mapInput.files[0];
      const read = await validateAndRead(docFile);
      const parsed = await parseDocument(read);
      const mappingTable = parseMappingTable(await mapFile.text());

      const { blob, restoredCount, notRestoredCount } = await restoreDocument(parsed, mappingTable);
      const name = resultFileName(docFile.name, '_복원');
      downloadBlob(blob, name);

      const resultBox = $('#sdcRestoreResult');
      if (resultBox) {
        resultBox.innerHTML =
          `복원 완료: <strong>${escapeHtml(name)}</strong><br />`
          + `복원된 항목 ${restoredCount}건`
          + (notRestoredCount > 0 ? ` · 복원 불가(마스킹·삭제 처리) ${notRestoredCount}건` : '');
        resultBox.hidden = false;
      }
    } catch (err) {
      showError(err);
    } finally {
      updateBtn();
    }
  });
}

// ---------- 설정 ----------

function renderPolicyList() {
  const actionOptions = (selected) => Object.entries(ACTION_LABELS)
    .map(([code, label]) => `<option value="${code}"${selected === code ? ' selected' : ''}>${label}</option>`)
    .join('');

  const html = Object.entries(PII_TYPES)
    .map(([code, def]) => `
<div class="sd-policy-item">
  <span>${escapeHtml(def.label)}</span>
  <select data-type="${code}" class="text-input" aria-label="${escapeHtml(def.label)} 기본 처리방식">${actionOptions(session.typePolicies[code])}</select>
</div>`)
    .join('');
  setHtml('#sdcPolicyList', html);
}

// 중첩 수량자는 파국적 역추적(ReDoS)의 전형적 형태라 등록 단계에서 막는다.
const NESTED_QUANTIFIER = /(\([^()]*[+*][^()]*\)|\[[^\]]*\][^\s]*)\s*[+*]/;
const MAX_PATTERN_LENGTH = 200;

function validateRulePattern(pattern) {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    return `정규표현식이 너무 깁니다. (최대 ${MAX_PATTERN_LENGTH}자)`;
  }
  if (NESTED_QUANTIFIER.test(pattern)) {
    return '중첩된 반복(예: (a+)+)은 처리가 멈출 수 있어 사용할 수 없습니다.';
  }
  try {
    new RegExp(pattern, 'g');
  } catch {
    return '올바르지 않은 정규표현식입니다.';
  }
  return null;
}

function bindSafeDocSettingsEvents() {
  $('#sdcPolicyList')?.addEventListener('change', (e) => {
    const type = e.target.dataset.type;
    if (!type) return;
    session.typePolicies[type] = e.target.value;
    savePolicies();
  });

  $('#sdcAddRule')?.addEventListener('click', () => {
    const nameInput = $('#sdcRuleName');
    const patternInput = $('#sdcRulePattern');
    const name = nameInput.value.trim();
    const pattern = patternInput.value.trim();
    if (!name || !pattern) {
      toast('규칙 이름과 정규표현식을 입력하십시오.', true);
      return;
    }
    const problem = validateRulePattern(pattern);
    if (problem) {
      toast(problem, true);
      return;
    }
    userRules().push({ name, pattern, type: 'CUSTOM' });
    renderRuleList();
    nameInput.value = '';
    patternInput.value = '';
    toast('규칙을 추가했습니다. 다음 분석부터 적용됩니다.');
  });

  $('#sdcRuleList')?.addEventListener('click', (e) => {
    if (!e.target.classList.contains('sd-rule-delete')) return;
    userRules().splice(Number(e.target.dataset.index), 1);
    renderRuleList();
  });

  // 설정 초기화 (FR-804)
  $('#sdcResetSettings')?.addEventListener('click', async () => {
    const ok = await showConfirmDialog({
      title: '설정을 초기화합니다',
      body: '유형별 기본 처리방식과 사용자 정의 규칙이 모두 기본값으로 돌아갑니다.',
      okText: '초기화',
      danger: true
    });
    if (!ok) return;
    session.typePolicies = session.defaultPolicies();
    ensureSafeDocState().userRules = [];
    savePolicies();
    renderPolicyList();
    renderRuleList();
    toast('설정을 초기 상태로 되돌렸습니다.');
  });
}

function renderRuleList() {
  const rules = userRules();
  const html = rules.length === 0
    ? '<li class="sd-muted">등록된 사용자 정의 규칙이 없습니다.</li>'
    : rules
      .map((r, i) => `<li><strong>${escapeHtml(r.name)}</strong> <code>${escapeHtml(r.pattern)}</code>`
        + `<button class="sd-mini sd-rule-delete" type="button" data-index="${i}">삭제</button></li>`)
      .join('');
  setHtml('#sdcRuleList', html);
}

// ---------- 오류 표시 (개인정보 원문 미포함, NFR-003) ----------

function showError(err) {
  const message = err instanceof AppError ? err.message : '처리 중 오류가 발생했습니다. 다시 시도해 주십시오.';
  toast(message, true);
}
