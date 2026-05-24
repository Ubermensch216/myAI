import { writable, get } from 'svelte/store';

export type PolicyMode = 'upload' | 'notebook';
export type GrcStatus = '적합' | '일부 보완 필요' | '충돌 가능성' | '확인 불가' | string;
export type OverallRisk = 'High' | 'Medium' | 'Low';

export interface GrcResult {
  ruleTitle: string;
  status: GrcStatus;
  reason: string;
  remediation: string;
}

export interface GrcReviewResult {
  summary: string;
  overallRisk: OverallRisk;
  results: GrcResult[];
  missingInformation: string[];
  draftOpinion: string;
}

export interface NotebookItem {
  id: string;
  name: string;
}

interface GrcState {
  notebooks: NotebookItem[];
  selectedNotebookId: string;
  policyMode: PolicyMode;

  targetDocId: string;
  targetDocName: string;
  targetText: string;
  uploadingTarget: boolean;

  policyDocId: string;
  policyDocName: string;
  policyText: string;
  uploadingPolicy: boolean;

  analyzing: boolean;
  errorMessage: string;
  reviewResult: GrcReviewResult | null;
  activeTab: 'dashboard' | 'opinion';
}

const initialState: GrcState = {
  notebooks: [],
  selectedNotebookId: '',
  policyMode: 'upload',
  targetDocId: '',
  targetDocName: '',
  targetText: '',
  uploadingTarget: false,
  policyDocId: '',
  policyDocName: '',
  policyText: '',
  uploadingPolicy: false,
  analyzing: false,
  errorMessage: '',
  reviewResult: null,
  activeTab: 'dashboard'
};

export const grcStore = writable<GrcState>({ ...initialState });

let suppressSyncBack = false;
let syncBackTimer: ReturnType<typeof setTimeout> | null = null;
const inFlightReviews = new Map<string, Promise<void>>();

function getActiveReviewId(): string {
  if (typeof window === 'undefined') return '';
  return String((window as any).state?.grcReviews?.activeId || '');
}

function getReviewById(reviewId: string): any {
  if (typeof window === 'undefined') return null;
  const reviews = (window as any).state?.grcReviews?.items;
  if (!Array.isArray(reviews)) return null;
  return reviews.find((item: any) => item?.id === reviewId) || null;
}

function persistReviewPatch(reviewId: string, patch: Record<string, any>) {
  const review = getReviewById(reviewId);
  if (!review) return;
  Object.assign(review, patch);
  if (patch.targetDocName && (!review.title || review.title === '새 내부검토')) {
    review.title = String(patch.targetDocName).replace(/\.[^/.]+$/, '').slice(0, 80) || '새 내부검토';
  }
  review.updatedAt = new Date().toISOString();
  const w = window as any;
  if (typeof w.scheduleSave === 'function') w.scheduleSave();
  if (typeof w.renderGrcReviews === 'function') w.renderGrcReviews();
}

function isReviewInFlight(reviewId: string): boolean {
  return Boolean(reviewId && inFlightReviews.has(reviewId));
}

function activeReviewPatchFromState(s: GrcState) {
  return {
    selectedNotebookId: s.selectedNotebookId,
    policyMode: s.policyMode,
    targetDocName: s.targetDocName,
    targetText: s.targetText,
    policyDocName: s.policyDocName,
    policyText: s.policyText,
    reviewResult: s.reviewResult,
    activeTab: s.activeTab,
    errorMessage: s.errorMessage
  };
}

export function syncFromActiveReview() {
  const w = window as any;
  const review = w.MyAIFrontend?.getActiveGrcReview?.();
  const activeReviewId = review?.id || '';
  suppressSyncBack = true;
  if (!review) {
    const current = get(grcStore);
    grcStore.set({ ...initialState, notebooks: current.notebooks });
  } else {
    grcStore.update((s) => ({
      ...s,
      selectedNotebookId: review.selectedNotebookId || '',
      policyMode: review.policyMode === 'notebook' ? 'notebook' : 'upload',
      targetDocId: '',
      targetDocName: review.targetDocName || '',
      targetText: review.targetText || '',
      uploadingTarget: false,
      policyDocId: '',
      policyDocName: review.policyDocName || '',
      policyText: review.policyText || '',
      uploadingPolicy: false,
      analyzing: isReviewInFlight(activeReviewId),
      errorMessage: review.errorMessage || '',
      reviewResult: review.reviewResult || null,
      activeTab: review.activeTab === 'opinion' ? 'opinion' : 'dashboard'
    }));
  }
  Promise.resolve().then(() => { suppressSyncBack = false; });
}

grcStore.subscribe((s) => {
  if (suppressSyncBack) return;
  if (syncBackTimer) clearTimeout(syncBackTimer);
  syncBackTimer = setTimeout(() => {
    const reviewId = getActiveReviewId();
    if (!reviewId) return;
    persistReviewPatch(reviewId, activeReviewPatchFromState(s));
  }, 200);
});

function getHeaders(): Record<string, string> {
  const key = (window as any).state?.client?.documentCacheKey || '';
  return { 'x-myai-document-key': key };
}

async function readJson(response: Response): Promise<any> {
  return response.json().catch(() => ({}));
}

function userFacingError(error: any, fallback: string): string {
  const raw = String(error?.message || error || '').trim();
  if (!raw) return fallback;
  if (/fetch failed|failed to fetch|networkerror/i.test(raw)) {
    return '서버 또는 Ollama 연결에 실패했습니다. 서버가 실행 중인지, Ollama 모델이 응답 가능한지 확인해 주세요.';
  }
  if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|UND_ERR|socket|aborted/i.test(raw)) {
    return `연결 오류: ${raw}`;
  }
  return raw;
}

export async function loadNotebooks() {
  try {
    const response = await fetch('/api/notebooks');
    if (!response.ok) return;
    const data = await readJson(response);
    grcStore.update((s) => ({ ...s, notebooks: data.notebooks || [] }));
  } catch (error) {
    console.error('Notebooks fetch failed:', error);
  }
}

export async function handleFileUpload(file: File, type: 'target' | 'policy') {
  const reviewId = getActiveReviewId();
  grcStore.update((s) => {
    if (type === 'target') {
      return { ...s, targetDocName: file.name, uploadingTarget: true, errorMessage: '' };
    }
    return { ...s, policyDocName: file.name, uploadingPolicy: true, errorMessage: '' };
  });

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: getHeaders(),
      body: formData
    });
    const resData = await readJson(response);
    if (!response.ok) throw new Error(resData.error || `파일 업로드 실패: status ${response.status}`);

    const doc = resData.document;
    const detailRes = await fetch(`/api/documents/${doc.id}`, { headers: getHeaders() });
    const detailData = await readJson(detailRes);
    if (!detailRes.ok) throw new Error(detailData.error || `문서 참조 실패: status ${detailRes.status}`);
    const parsedText = detailData.document?.text || '';

    grcStore.update((s) => {
      const next = type === 'target'
        ? { ...s, targetDocId: doc.id, targetText: parsedText }
        : { ...s, policyDocId: doc.id, policyText: parsedText };
      if (reviewId) persistReviewPatch(reviewId, activeReviewPatchFromState(next));
      return next;
    });
  } catch (error: any) {
    grcStore.update((s) => ({
      ...s,
      errorMessage: `${file.name} 처리 중 오류: ${userFacingError(error, '파일 처리 중 오류가 발생했습니다.')}`
    }));
  } finally {
    grcStore.update((s) =>
      type === 'target' ? { ...s, uploadingTarget: false } : { ...s, uploadingPolicy: false }
    );
  }
}

export function setPolicyMode(mode: PolicyMode) {
  grcStore.update((s) => ({ ...s, policyMode: mode }));
}

export function setSelectedNotebookId(id: string) {
  grcStore.update((s) => ({ ...s, selectedNotebookId: id }));
}

export function setActiveTab(tab: 'dashboard' | 'opinion') {
  grcStore.update((s) => ({ ...s, activeTab: tab }));
}

export async function startGrcReview() {
  const reviewId = getActiveReviewId();
  if (!reviewId) {
    grcStore.update((s) => ({ ...s, errorMessage: '내부검토 항목을 먼저 선택해 주세요.' }));
    return;
  }
  if (inFlightReviews.has(reviewId)) return inFlightReviews.get(reviewId);

  grcStore.update((s) => ({ ...s, errorMessage: '', reviewResult: null }));

  const state = get(grcStore);
  const currentModel =
    (document.querySelector('#modelInput') as HTMLInputElement)?.value || '';

  const payload: any = { targetText: state.targetText, model: currentModel };

  if (state.policyMode === 'notebook') {
    if (!state.selectedNotebookId) {
      grcStore.update((s) => ({ ...s, errorMessage: '참조할 부서 프로젝트를 선택해 주세요.' }));
      return;
    }
    payload.notebookId = state.selectedNotebookId;
  } else {
    if (!state.policyText) {
      grcStore.update((s) => ({ ...s, errorMessage: '비교 검증할 규정 문서를 업로드해 주세요.' }));
      return;
    }
    payload.policyText = state.policyText;
  }

  if (!state.targetText) {
    grcStore.update((s) => ({ ...s, errorMessage: '검토 대상 문서를 업로드해 주세요.' }));
    return;
  }

  const initialPatch = { ...activeReviewPatchFromState(state), reviewResult: null, errorMessage: '' };
  persistReviewPatch(reviewId, initialPatch);
  grcStore.update((s) => ({ ...s, analyzing: true }));

  const run = (async () => {
    try {
      const response = await fetch('/api/compliance/grc/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const resData = await readJson(response);
      if (!response.ok || resData.ok === false) {
        throw new Error(resData.error || `서버 오류: status ${response.status}`);
      }
      const patch = {
        reviewResult: resData.reviewResult,
        activeTab: 'dashboard' as const,
        errorMessage: ''
      };
      persistReviewPatch(reviewId, patch);
      if (getActiveReviewId() === reviewId) {
        grcStore.update((s) => ({ ...s, ...patch }));
      }
    } catch (error: any) {
      const message = userFacingError(error, 'GRC 분석 중 오류가 발생했습니다.');
      persistReviewPatch(reviewId, { errorMessage: message });
      if (getActiveReviewId() === reviewId) {
        grcStore.update((s) => ({ ...s, errorMessage: message }));
      }
    } finally {
      inFlightReviews.delete(reviewId);
      if (getActiveReviewId() === reviewId) {
        grcStore.update((s) => ({ ...s, analyzing: false }));
      }
    }
  })();

  inFlightReviews.set(reviewId, run);
  return run;
}

export function resetGrc() {
  if (inFlightReviews.has(getActiveReviewId())) return;
  grcStore.update((s) => ({
    ...s,
    targetDocId: '',
    targetDocName: '',
    targetText: '',
    policyDocId: '',
    policyDocName: '',
    policyText: '',
    selectedNotebookId: '',
    reviewResult: null,
    errorMessage: ''
  }));
}

export function sendToStudio() {
  const state = get(grcStore);
  if (!state.reviewResult) return;
  const markdown = getGrcReportMarkdown(state.reviewResult, {
    targetDocName: state.targetDocName,
    policyDocName: state.policyMode === 'notebook'
      ? state.notebooks.find((notebook) => notebook.id === state.selectedNotebookId)?.name || ''
      : state.policyDocName,
    policyMode: state.policyMode
  });
  if (!markdown) return;
  const event = new CustomEvent('myai:grc:save-output', {
    detail: {
      title: `${state.targetDocName.replace(/\.[^/.]+$/, '')} 규정 검토 보고서`,
      markdown,
      metadata: { compliance: true, grc: true },
      source: { sourceType: 'grc_review' }
    }
  });
  window.dispatchEvent(event);
}

export function getGrcReportMarkdown(
  result: GrcReviewResult | null,
  context: { targetDocName?: string; policyDocName?: string; policyMode?: PolicyMode } = {}
): string {
  if (!result) return '';
  const opinion = getGrcOpinionMarkdown(result).trim();
  const dashboard = getGrcDashboardAttachmentMarkdown(result, context).trim();
  return [opinion, dashboard].filter(Boolean).join('\n\n---\n\n');
}

export function getGrcOpinionMarkdown(result: GrcReviewResult | null): string {
  if (!result) return '';
  const draft = typeof result.draftOpinion === 'string' ? result.draftOpinion.trim() : '';
  if (draft) return result.draftOpinion;

  const riskLabel =
    result.overallRisk === 'High' ? '높음' : result.overallRisk === 'Medium' ? '보통' : '낮음';
  const findings = Array.isArray(result.results) && result.results.length
    ? result.results.map((item, index) => {
        return [
          `${index + 1}. ${item.ruleTitle || '검토 항목'}`,
          `   - 판정: ${item.status || '확인 불가'}`,
          item.reason ? `   - 검토 의견: ${item.reason}` : '',
          item.remediation ? `   - 조치 권고: ${item.remediation}` : ''
        ].filter(Boolean).join('\n');
      }).join('\n\n')
    : '구조화된 상세 진단 결과가 충분히 생성되지 않았습니다.';
  const missing = Array.isArray(result.missingInformation) && result.missingInformation.length
    ? result.missingInformation.map((item) => `- ${item}`).join('\n')
    : '- 추가 확인이 필요한 정보는 별도로 식별되지 않았습니다.';

  return [
    '## 1. 검토 목적',
    '본 의견서는 제출된 검토 대상 문서가 내부 규정 및 지침에 부합하는지 확인하기 위해 작성되었습니다.',
    '',
    '## 2. 종합 의견',
    result.summary || '검토 결과 요약이 충분히 생성되지 않았습니다.',
    '',
    `- 종합 위험도: ${riskLabel}`,
    '',
    '## 3. 상세 분석',
    findings,
    '',
    '## 4. 조치 권고사항',
    missing,
    '',
    '본 문서는 AI가 생성한 업무 검토용 초안이므로 최종 제출 전 담당자의 사실관계 및 법무/준법 검토가 필요합니다.'
  ].join('\n');
}

function getGrcDashboardAttachmentMarkdown(
  result: GrcReviewResult,
  context: { targetDocName?: string; policyDocName?: string; policyMode?: PolicyMode } = {}
): string {
  const items = Array.isArray(result.results) ? result.results : [];
  const counts = {
    high: items.filter((item) => statusLevel(item.status) === 'high').length,
    medium: items.filter((item) => statusLevel(item.status) === 'medium').length,
    low: items.filter((item) => statusLevel(item.status) === 'low').length,
    info: items.filter((item) => statusLevel(item.status) === 'info').length
  };
  const risk = result.overallRisk === 'High' ? '높음' : result.overallRisk === 'Medium' ? '보통' : '낮음';
  const policyName = String(context.policyDocName || '').trim() || (context.policyMode === 'notebook' ? '부서 프로젝트' : '검토 기준');
  const targetName = String(context.targetDocName || '').trim() || '대상 문서';

  const lines = [
    '## 첨부자료 A. 검토 대시보드',
    '',
    '> 아래 내용은 내부검토 화면의 검토 대시보드 정보를 보고서 첨부자료로 옮긴 것입니다.',
    '',
    '### A-1. 대시보드 요약 카드',
    '',
    '| 항목 | 내용 |',
    '| --- | --- |',
    `| 검토 기준 | ${tableCell(policyName)} |`,
    `| 검토 대상 | ${tableCell(targetName)} |`,
    `| 종합 위험도 | ${tableCell(risk)} |`,
    `| 종합 요약 | ${tableCell(result.summary || '요약 없음')} |`,
    '',
    '### A-2. 판정 통계 카드',
    '',
    '| 충돌 가능성 | 보완 필요 | 적합 | 확인 불가 |',
    '| ---: | ---: | ---: | ---: |',
    `| ${counts.high} | ${counts.medium} | ${counts.low} | ${counts.info} |`,
    '',
    '### A-3. 상세 진단 카드',
    ''
  ];

  if (items.length) {
    lines.push('| 번호 | 판정 | 검토 항목 | 검토 의견 | 조치 권고 |');
    lines.push('| ---: | --- | --- | --- | --- |');
    items.forEach((item, index) => {
      lines.push([
        `| ${index + 1}`,
        tableCell(item.status || '확인 불가'),
        tableCell(item.ruleTitle || '검토 항목'),
        tableCell(item.reason || '검토 의견 없음'),
        tableCell(item.remediation || (statusLevel(item.status) === 'low' ? '별도 조치 없음' : '조치 권고 없음'))
      ].join(' | ') + ' |');
    });
  } else {
    lines.push('상세 진단 항목이 없습니다.');
  }

  lines.push('', '### A-4. 추가 확인 필요 정보', '');
  const missing = Array.isArray(result.missingInformation) ? result.missingInformation.filter(Boolean) : [];
  if (missing.length) {
    missing.forEach((item) => lines.push(`- ${item}`));
  } else {
    lines.push('- 추가 확인 필요 정보가 별도로 식별되지 않았습니다.');
  }

  lines.push(
    '',
    '### A-5. 원본 대시보드 데이터',
    '',
    '```json',
    JSON.stringify({
      summary: result.summary || '',
      overallRisk: result.overallRisk || 'Low',
      counts,
      results: items,
      missingInformation: missing
    }, null, 2),
    '```'
  );

  return lines.join('\n');
}

function statusLevel(status: string): 'high' | 'medium' | 'low' | 'info' {
  const text = String(status || '').toLowerCase();
  if (text === 'high') return 'high';
  if (text === 'medium') return 'medium';
  if (text === 'low') return 'low';
  if (text.includes('충돌') || text.includes('위반') || text.includes('부적합') || text.includes('conflict') || text.includes('non-compliant')) return 'high';
  if (text.includes('보완') || text.includes('주의') || text.includes('warn')) return 'medium';
  if (text.includes('적합') || text.includes('통과') || text.includes('compliant') || text.includes('pass')) return 'low';
  return 'info';
}

function tableCell(value: unknown): string {
  return String(value ?? '')
    .replace(/\r?\n+/g, '<br>')
    .replace(/\|/g, '\\|')
    .trim();
}
