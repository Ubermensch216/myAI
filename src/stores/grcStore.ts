import { writable, get } from 'svelte/store';

export type PolicyMode = 'upload' | 'notebook';
export type GrcStatus = '적합' | '일부 보완 필요' | '충돌 가능성' | '확인 불가';
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

function getHeaders(): Record<string, string> {
  const key = (window as any).state?.client?.documentCacheKey || '';
  return { 'x-myai-document-key': key };
}

export async function loadNotebooks() {
  try {
    const response = await fetch('/api/notebooks');
    if (!response.ok) return;
    const data = await response.json();
    grcStore.update((s) => ({ ...s, notebooks: data.notebooks || [] }));
  } catch (e) {
    console.error('Notebooks fetch failed:', e);
  }
}

export async function handleFileUpload(file: File, type: 'target' | 'policy') {
  grcStore.update((s) => {
    if (type === 'target') {
      return { ...s, targetDocName: file.name, uploadingTarget: true };
    }
    return { ...s, policyDocName: file.name, uploadingPolicy: true };
  });

  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch('/api/upload', {
      method: 'POST',
      headers: getHeaders(),
      body: formData
    });
    if (!response.ok) throw new Error(`파일 업로드 실패: status ${response.status}`);

    const resData = await response.json();
    const doc = resData.document;

    const detailRes = await fetch(`/api/documents/${doc.id}`, { headers: getHeaders() });
    const detailData = await detailRes.json();
    const parsedText = detailData.document?.text || '';

    grcStore.update((s) =>
      type === 'target'
        ? { ...s, targetDocId: doc.id, targetText: parsedText }
        : { ...s, policyDocId: doc.id, policyText: parsedText }
    );
  } catch (err: any) {
    grcStore.update((s) => ({
      ...s,
      errorMessage: `${file.name} 처리 중 오류 발생: ${err.message}`
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
  grcStore.update((s) => ({ ...s, errorMessage: '', reviewResult: null }));

  const state = get(grcStore);
  const currentModel =
    (document.querySelector('#modelInput') as HTMLInputElement)?.value || '';

  const payload: any = { targetText: state.targetText, model: currentModel };

  if (state.policyMode === 'notebook') {
    if (!state.selectedNotebookId) {
      grcStore.update((s) => ({ ...s, errorMessage: '참조할 부서 프로젝트를 선택해주세요.' }));
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

  grcStore.update((s) => ({ ...s, analyzing: true }));

  try {
    const response = await fetch('/api/compliance/grc/review', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `서버 오류: status ${response.status}`);
    }
    const resData = await response.json();
    grcStore.update((s) => ({
      ...s,
      reviewResult: resData.reviewResult,
      activeTab: 'dashboard'
    }));
  } catch (err: any) {
    grcStore.update((s) => ({
      ...s,
      errorMessage: err.message || 'GRC 분석 중 오류가 발생했습니다.'
    }));
  } finally {
    grcStore.update((s) => ({ ...s, analyzing: false }));
  }
}

export function resetGrc() {
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
  const markdown = getGrcOpinionMarkdown(state.reviewResult);
  if (!markdown) return;
  const event = new CustomEvent('myai:grc:save-output', {
    detail: {
      title: `${state.targetDocName.replace(/\.[^/.]+$/, '')} 규정 검토 보고서`,
      markdown
    }
  });
  window.dispatchEvent(event);
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
    '본 의견서 초안은 제출된 검토 대상 문서가 내부 규정 및 지침에 부합하는지 확인하기 위해 작성되었습니다.',
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
