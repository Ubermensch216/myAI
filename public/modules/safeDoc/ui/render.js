// 검토·결과 화면 렌더링

import { escapeHtml } from './dom.js';
import { PII_TYPES, ACTION_LABELS, confidenceLabel, CONFIDENCE_LEVELS } from '../detect/types.js';

// 미리보기 표시 상한 (화면 응답성 유지, NFR-104)
const PREVIEW_CHAR_LIMIT = 200000;

const METHOD_LABELS = {
  REGEX: '정규식',
  CONTEXT: '문맥',
  DICTIONARY: '사전',
  FIELD_HEADER: '열 제목',
  USER_RULE: '사용자 규칙',
  MANUAL: '수동 추가',
  SEARCH: '검색 지정',
};

// 문서 텍스트 + 후보 목록 → 하이라이트된 미리보기 HTML (FR-401)
export function renderPreviewHtml(text, candidates) {
  const truncated = text.length > PREVIEW_CHAR_LIMIT;
  const viewText = truncated ? text.slice(0, PREVIEW_CHAR_LIMIT) : text;
  const sorted = candidates
    .filter((c) => c.start < viewText.length)
    .slice()
    .sort((a, b) => a.start - b.start);

  let html = '';
  let pos = 0;
  for (const c of sorted) {
    if (c.start < pos) continue; // 중첩 방지(이미 정리되었지만 방어)
    html += escapeHtml(viewText.slice(pos, c.start));
    const cls = `sd-pii t-${c.type}${c.selected ? '' : ' excluded'}`;
    html += `<mark class="${cls}" data-id="${c.id}" title="${escapeHtml(PII_TYPES[c.type]?.label || c.type)} · ${confidenceLabel(c.confidence)}">${escapeHtml(viewText.slice(c.start, Math.min(c.end, viewText.length)))}</mark>`;
    pos = Math.min(c.end, viewText.length);
  }
  html += escapeHtml(viewText.slice(pos));
  if (truncated) {
    html += `\n\n<span class="sd-muted">… (미리보기는 ${PREVIEW_CHAR_LIMIT.toLocaleString()}자까지만 표시됩니다. 처리는 문서 전체에 적용됩니다)</span>`;
  }
  return html;
}

function confClass(conf) {
  if (conf >= CONFIDENCE_LEVELS.HIGH) return 'conf-high';
  if (conf >= CONFIDENCE_LEVELS.MEDIUM) return 'conf-mid';
  return 'conf-low';
}

function typeOptions(selected) {
  return Object.entries(PII_TYPES)
    .map(([code, def]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${def.label}</option>`)
    .join('');
}

function actionOptions(selected) {
  return Object.entries(ACTION_LABELS)
    .map(([code, label]) => `<option value="${code}"${code === selected ? ' selected' : ''}>${label}</option>`)
    .join('');
}

// 개인정보 후보 목록 렌더링 (FR-402)
export function renderCandidateListHtml(candidates, typePolicies) {
  if (candidates.length === 0) {
    return '<p class="sd-muted">탐지된 개인정보 후보가 없습니다. 미리보기에서 문자열을 드래그하여 직접 추가할 수 있습니다.</p>';
  }
  const sorted = candidates.slice().sort((a, b) => a.start - b.start);
  let html = '';
  let seq = 0;
  for (const c of sorted) {
    seq += 1;
    const action = c.action || typePolicies[c.type] || 'REPLACE';
    html += `
<div class="sd-candidate${c.selected ? '' : ' excluded'}" data-id="${c.id}">
  <input type="checkbox" class="c-check" ${c.selected ? 'checked' : ''} aria-label="처리 대상 선택" />
  <span class="c-text">${escapeHtml(c.originalText)}</span>
  <button class="sd-mini c-exclude">${c.selected ? '제외' : '포함'}</button>
  <div class="c-meta">
    <span>#${seq}</span>
    <select class="c-type" aria-label="개인정보 유형">${typeOptions(c.type)}</select>
    <select class="c-action" aria-label="처리방식">${actionOptions(action)}</select>
    <span class="${confClass(c.confidence)}">${confidenceLabel(c.confidence)} (${c.confidence.toFixed(2)})</span>
    <span>${METHOD_LABELS[c.detectionMethod] || c.detectionMethod}</span>
    <button class="sd-mini c-same">동일값 일괄</button>
  </div>
</div>`;
  }
  return html;
}

// 결과 화면: 처리 후 텍스트에서 치환된 부분 강조 (FR-602)
export function renderAfterHtml(afterText, applied) {
  // applied는 앞→뒤 순서, 처리 후 텍스트 기준 위치 재계산
  let html = '';
  let searchFrom = 0;
  const view = afterText.length > PREVIEW_CHAR_LIMIT ? afterText.slice(0, PREVIEW_CHAR_LIMIT) : afterText;
  for (const c of applied) {
    const idx = view.indexOf(c.replacementText, searchFrom);
    if (idx < 0) continue;
    html += escapeHtml(view.slice(searchFrom, idx));
    html += `<mark class="sd-replaced">${escapeHtml(c.replacementText)}</mark>`;
    searchFrom = idx + c.replacementText.length;
  }
  html += escapeHtml(view.slice(searchFrom));
  if (afterText.length > PREVIEW_CHAR_LIMIT) html += '\n<span class="sd-muted">… (일부만 표시)</span>';
  return html;
}

// 결과 요약 테이블 (FR-606)
export function renderSummaryHtml(summary) {
  const typeRows = Object.entries(summary.typeCounts)
    .map(([t, n]) => `<tr><td>${PII_TYPES[t]?.label || t}</td><td>${n}건</td></tr>`)
    .join('');
  const actionRows = Object.entries(summary.actionCounts)
    .map(([a, n]) => `<tr><td>${ACTION_LABELS[a] || a}</td><td>${n}건</td></tr>`)
    .join('');
  return `
<p>원본 파일: <strong>${escapeHtml(summary.sourceFileName)}</strong> → 결과 파일: <strong>${escapeHtml(summary.resultFileName)}</strong></p>
<p>총 탐지 <strong>${summary.detectedCount}</strong>건 · 처리 <strong>${summary.processedCount}</strong>건 · 제외 <strong>${summary.excludedCount}</strong>건 · 수동 추가 <strong>${summary.manuallyAddedCount}</strong>건</p>
<table><thead><tr><th>개인정보 유형</th><th>처리 건수</th></tr></thead><tbody>${typeRows || '<tr><td colspan="2">없음</td></tr>'}</tbody></table>
<table><thead><tr><th>처리방식</th><th>건수</th></tr></thead><tbody>${actionRows || '<tr><td colspan="2">없음</td></tr>'}</tbody></table>
<p class="sd-muted">프로그램 버전 ${summary.programVersion} · 탐지규칙 버전 ${summary.ruleVersion} · 처리 시각 ${new Date(summary.processedAt).toLocaleString('ko-KR')}</p>`;
}
