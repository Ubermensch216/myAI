// 문서보안 화면 DOM 도우미
//
// 원본 safeDoc은 자체 페이지 전체를 소유했으나 myAI에서는 #safeDocArea 안에서만
// 동작해야 하므로 선택자를 그 범위로 한정한다. 화면 전환도 .active 클래스가 아니라
// myAI 규칙에 따라 [hidden] 속성으로 처리한다(docs/DESIGN.md).

const ROOT_ID = 'safeDocArea';

export const root = () => document.getElementById(ROOT_ID);
export const $ = (sel) => root()?.querySelector(sel) ?? null;
export const $$ = (sel) => Array.from(root()?.querySelectorAll(sel) ?? []);

// 사이드바(문서보안 보조 패널)는 #safeDocArea 밖에 있으므로 별도 조회
export const sidebar = () => document.querySelector('.sidebar-content[data-view-content="safedoc"]');
export const $side = (sel) => sidebar()?.querySelector(sel) ?? null;
export const $$side = (sel) => Array.from(sidebar()?.querySelectorAll(sel) ?? []);

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------- 알림 ----------

const SCREEN_IDS = {
  main: 'sdcScreenMain',
  analyze: 'sdcScreenAnalyze',
  review: 'sdcScreenReview',
  result: 'sdcScreenResult'
};

let toastTimer = null;

export function toast(message, isError = false) {
  const container = root();
  if (!container) return;
  let el = container.querySelector('#sdcToast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'sdcToast';
    container.appendChild(el);
  }
  el.textContent = message;
  el.className = isError ? 'sd-toast sd-toast-error' : 'sd-toast';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

// ---------- 화면 전환 ----------

/** 비식별 탭 안의 4단계 화면 전환. 사이드바 진행 표시도 함께 갱신한다. */
export function showScreen(name) {
  for (const [key, id] of Object.entries(SCREEN_IDS)) {
    const el = document.getElementById(id);
    if (el) el.hidden = key !== name;
  }
  updateStepIndicator(name);
}

const STEP_ORDER = ['main', 'analyze', 'review', 'result'];

function updateStepIndicator(current) {
  const currentIndex = STEP_ORDER.indexOf(current);
  for (const li of $$side('.sd-step')) {
    const index = STEP_ORDER.indexOf(li.dataset.sdStep);
    li.classList.toggle('current', index === currentIndex);
    li.classList.toggle('done', index >= 0 && index < currentIndex);
  }
}

/** 문서보안 대메뉴 안의 3개 작업 탭 전환 */
export function showTab(name) {
  const panels = {
    deidentify: 'sdcTabDeidentify',
    restore: 'sdcTabRestore',
    settings: 'sdcTabSettings'
  };
  for (const [key, id] of Object.entries(panels)) {
    const el = document.getElementById(id);
    if (el) el.hidden = key !== name;
  }
  for (const btn of $$side('.sd-side-tab')) {
    const active = btn.dataset.sdTab === name;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', active ? 'true' : 'false');
  }
  const steps = $side('#sdcStepIndicator');
  if (steps) steps.hidden = name !== 'deidentify';
}

// 컨테이너 내 특정 노드·오프셋의 텍스트 기준 위치 계산 (수동 추가용)
export function textOffsetIn(container, targetNode, offsetInNode) {
  let offset = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) return offset + offsetInNode;
    offset += node.textContent.length;
  }
  return -1;
}
