import GrcWorkbench from './components/GrcWorkbench.svelte';
import GrcSidebar from './components/GrcSidebar.svelte';

let grcApp: GrcWorkbench | null = null;
let grcSidebarApp: GrcSidebar | null = null;

export function mountGrcWorkbench() {
  const container = document.getElementById('grcWorkbenchContainer');
  if (container && !grcApp) {
    grcApp = new GrcWorkbench({ target: container, props: {} });
  }

  const sidebarContainer = document.getElementById('grcSidebarMount');
  if (sidebarContainer && !grcSidebarApp) {
    grcSidebarApp = new GrcSidebar({ target: sidebarContainer, props: {} });
  }
}

export function unmountGrcWorkbench() {
  if (grcApp) {
    grcApp.$destroy();
    grcApp = null;
  }
  if (grcSidebarApp) {
    grcSidebarApp.$destroy();
    grcSidebarApp = null;
  }
}

(window as any).MyAIFrontend = {
  mountGrcWorkbench,
  unmountGrcWorkbench
};

document.addEventListener('DOMContentLoaded', () => {
  mountGrcWorkbench();
});
