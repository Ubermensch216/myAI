import GrcWorkbench from './components/GrcWorkbench.svelte';

let grcApp: GrcWorkbench | null = null;

export function mountGrcWorkbench() {
  const container = document.getElementById('grcWorkbenchContainer');
  if (!container) return;

  if (grcApp) {
    // If already mounted, do nothing
    return;
  }

  grcApp = new GrcWorkbench({
    target: container,
    props: {}
  });
}

export function unmountGrcWorkbench() {
  if (grcApp) {
    grcApp.$destroy();
    grcApp = null;
  }
}

// Expose mounting utilities globally so public/app.js can trigger them on tab switch
(window as any).MyAIFrontend = {
  mountGrcWorkbench,
  unmountGrcWorkbench
};

// Automount if container is present on load
document.addEventListener('DOMContentLoaded', () => {
  mountGrcWorkbench();
});
