import GrcWorkbench from './components/GrcWorkbench.svelte';
import { syncFromActiveReview } from './stores/grcStore';

let grcApp: GrcWorkbench | null = null;

export function mountGrcWorkbench() {
  const container = document.getElementById('grcWorkbenchContainer');
  if (container && !grcApp) {
    grcApp = new GrcWorkbench({ target: container, props: {} });
  }
  syncFromActiveReview();
}

export function unmountGrcWorkbench() {
  if (grcApp) {
    grcApp.$destroy();
    grcApp = null;
  }
}

export function getActiveGrcReview() {
  const s: any = (window as any).state;
  if (!s?.grcReviews?.items) return null;
  return s.grcReviews.items.find((r: any) => r.id === s.grcReviews.activeId) || null;
}

export function persistActiveGrcReview(patch: Record<string, any>) {
  const review = getActiveGrcReview();
  if (!review) return;
  Object.assign(review, patch);
  // Derive title from the target doc name when user hasn't customized it
  if (patch.targetDocName && (!review.title || review.title === '새 내부검토')) {
    review.title = String(patch.targetDocName).replace(/\.[^/.]+$/, '').slice(0, 80) || '새 내부검토';
  }
  review.updatedAt = new Date().toISOString();
  const w = window as any;
  if (typeof w.scheduleSave === 'function') w.scheduleSave();
  if (typeof w.renderGrcReviews === 'function') w.renderGrcReviews();
}

(window as any).MyAIFrontend = {
  mountGrcWorkbench,
  unmountGrcWorkbench,
  getActiveGrcReview,
  persistActiveGrcReview
};

window.addEventListener('myai:grcreviewchange', () => {
  syncFromActiveReview();
});

document.addEventListener('DOMContentLoaded', () => {
  mountGrcWorkbench();
});
