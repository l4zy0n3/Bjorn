import { t } from './i18n.js';

/**
 * Shared page sidebar layout controller.
 * Provides one common desktop/mobile behavior for pages with left sidebars.
 */

export function initSharedSidebarLayout(root, opts = {}) {
  if (!root) return () => { };

  const sidebarSelector = opts.sidebarSelector || '.page-sidebar';
  const mainSelector = opts.mainSelector || '.page-main';
  const storageKey = opts.storageKey || '';
  const mobileBreakpoint = Number(opts.mobileBreakpoint || 900);
  const toggleLabel = String(opts.toggleLabel || t('sidebar.close'));
  const mobileDefaultOpen = !!opts.mobileDefaultOpen;

  const sidebar = root.querySelector(sidebarSelector);
  const main = root.querySelector(mainSelector);
  if (!sidebar || !main) return () => { };

  root.classList.add('page-with-sidebar');
  sidebar.classList.add('page-sidebar');
  main.classList.add('page-main');

  const media = window.matchMedia(`(max-width: ${mobileBreakpoint}px)`);
  let desktopHidden = false;
  let mobileOpen = false;

  if (storageKey) {
    try {
      desktopHidden = localStorage.getItem(storageKey) === '1';
    } catch {
      desktopHidden = false;
    }
  }

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn sidebar-toggle-btn sidebar-fab sidebar-fab-unified';
  btn.innerHTML = '<span aria-hidden="true">☰</span>';
  btn.title = toggleLabel;
  btn.setAttribute('aria-label', toggleLabel);

  const backdrop = document.createElement('button');
  backdrop.type = 'button';
  backdrop.className = 'page-sidebar-backdrop';
  backdrop.setAttribute('aria-label', 'Close sidebar');

  if (!root.querySelector(':scope > .sidebar-fab')) {
    root.appendChild(btn);
  }
  if (!root.querySelector(':scope > .page-sidebar-backdrop')) {
    root.appendChild(backdrop);
  }

  function setDesktopHidden(next) {
    desktopHidden = !!next;
    root.classList.toggle('sidebar-collapsed', desktopHidden);
    if (storageKey) {
      try { localStorage.setItem(storageKey, desktopHidden ? '1' : '0'); } catch { }
    }
    refreshFabVisibility();
  }

  function setMobileOpen(next) {
    mobileOpen = !!next;
    root.classList.toggle('sidebar-open', mobileOpen);
    refreshFabVisibility();
  }

  function syncMode() {
    if (media.matches) {
      root.classList.add('sidebar-mobile');
      root.classList.remove('sidebar-collapsed');
      setMobileOpen(mobileDefaultOpen);
    } else {
      root.classList.remove('sidebar-mobile');
      setMobileOpen(false);
      setDesktopHidden(desktopHidden);
    }
    refreshFabVisibility();
  }

  function refreshFabVisibility() {
    if (media.matches) {
      btn.style.display = mobileOpen ? 'none' : '';
      return;
    }
    btn.style.display = desktopHidden ? '' : 'none';
  }

  function onToggle() {
    if (media.matches) {
      setMobileOpen(!mobileOpen);
    } else {
      setDesktopHidden(!desktopHidden);
    }
  }

  function onHideBtn() {
    if (media.matches) setMobileOpen(false);
    else setDesktopHidden(true);
  }

  function onBackdrop() {
    if (media.matches) setMobileOpen(false);
  }

  btn.addEventListener('click', onToggle);
  backdrop.addEventListener('click', onBackdrop);
  media.addEventListener('change', syncMode);

  const hideBtn = sidebar.querySelector('#hideSidebar, [data-hide-sidebar="1"]');
  if (hideBtn) hideBtn.addEventListener('click', onHideBtn);

  syncMode();
  refreshFabVisibility();

  return () => {
    btn.removeEventListener('click', onToggle);
    backdrop.removeEventListener('click', onBackdrop);
    media.removeEventListener('change', syncMode);
    if (hideBtn) hideBtn.removeEventListener('click', onHideBtn);
    if (btn.parentNode) btn.parentNode.removeChild(btn);
    if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    root.classList.remove('sidebar-open', 'sidebar-collapsed', 'sidebar-mobile', 'page-with-sidebar');
    sidebar.classList.remove('page-sidebar');
    main.classList.remove('page-main');
  };
}
