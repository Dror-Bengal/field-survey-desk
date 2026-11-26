// PWA install helpers. Two surfaces: detect whether we're already running
// installed, detect the user's platform so we can show the right install
// instructions, and capture Chrome's `beforeinstallprompt` event so an
// "Install app" button can call .prompt() later (Android Chrome only — iOS
// Safari has no equivalent JS API).

// Captured on first dispatch and held forever so any consumer mounted after
// the event arrives can still trigger a native install.
let deferredPrompt = null;
const promptListeners = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    for (const cb of promptListeners) cb(e);
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
  });
}

export function isStandalone() {
  if (typeof window === 'undefined') return false;
  // iOS uses navigator.standalone; everywhere else uses the standard media query.
  if (window.navigator?.standalone === true) return true;
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(display-mode: standalone)').matches;
}

export function detectPlatform() {
  if (typeof navigator === 'undefined') return 'other';
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua)
    || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1); // iPadOS desktop UA
  if (isIOS) {
    // Chrome on iOS reports "CriOS"; Firefox reports "FxiOS". Both still need
    // the Safari Share-sheet flow because the WebView is WKWebView.
    if (/CriOS|FxiOS|EdgiOS/.test(ua)) return 'ios-chrome';
    return 'ios-safari';
  }
  if (/Android/.test(ua)) {
    if (/Firefox/.test(ua)) return 'android-firefox';
    return 'android-chrome';
  }
  return 'desktop';
}

// Returns the deferred prompt event if one has already been captured. Otherwise
// returns a Promise that resolves with the event when it fires, or null if it
// never does (caller should race against a timeout if they care).
export function captureInstallPromptEvent() {
  if (deferredPrompt) return Promise.resolve(deferredPrompt);
  return new Promise((resolve) => {
    const cb = (e) => {
      promptListeners.delete(cb);
      resolve(e);
    };
    promptListeners.add(cb);
  });
}

// Resolves the deferred prompt's user choice ('accepted' | 'dismissed') or
// throws if the prompt isn't available (no captured event).
export async function promptInstall() {
  if (!deferredPrompt) throw new Error('install_prompt_unavailable');
  const evt = deferredPrompt;
  deferredPrompt = null;
  evt.prompt();
  const choice = await evt.userChoice;
  return choice.outcome;
}
