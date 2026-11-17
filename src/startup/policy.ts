interface BrowserProfile {
  userAgent: string;
  platform: string;
  maxTouchPoints: number;
  userAgentData?: { mobile: boolean };
}

export function prefersPreview(browser: BrowserProfile, compactTouchScreen: boolean) {
  return browser.userAgentData?.mobile === true ||
    /Android|iPhone|iPad|iPod|\bMobile\b/i.test(browser.userAgent) ||
    (browser.platform === 'MacIntel' && browser.maxTouchPoints > 1) ||
    compactTouchScreen;
}

const ACTIVE_TAB = 'cubesat-imaging-sim:renderer-active';

// A browser that terminates the page can reload the same tab without running pagehide.
export function sessionWasInterrupted() {
  try { return sessionStorage.getItem(ACTIVE_TAB) === '1'; }
  catch { return false; }
}
export function markSessionActive(active: boolean) {
  try {
    if (active) sessionStorage.setItem(ACTIVE_TAB, '1');
    else sessionStorage.removeItem(ACTIVE_TAB);
  } catch { /* Phone preview still works when site storage is disabled. */ }
}
