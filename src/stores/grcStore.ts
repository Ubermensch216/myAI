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
  if (!state.reviewResult || !state.reviewResult.draftOpinion) return;
  const event = new CustomEvent('myai:grc:save-output', {
    detail: {
      title: `${state.targetDocName.replace(/\.[^/.]+$/, '')} 규정 검토 보고서`,
      markdown: state.reviewResult.draftOpinion
    }
  });
  window.dispatchEvent(event);
}
