// ==UserScript==
// @name           Zen Vivid
// @description    Page-aware color blending for addressbar and sidebar in Zen Browser.
// @version        1.2.0
// @author         zen-vivid
// ==/UserScript==

(() => {
  'use strict';

  if (window.__zenVivid_inited) return;
  window.__zenVivid_inited = true;

  const LOG = (...args) => console.log('[zen-vivid]', ...args);
  const ERR = (...args) => console.error('[zen-vivid]', ...args);

  // ─── Pref keys ────────────────────────────────────────────────────────────
  const PREF = {
    enabled:      'uc.zen-vivid.enabled',
    transitionMs: 'uc.zen-vivid.transition-ms',
    addrbar:      'uc.zen-vivid.colorize-addressbar',
    sidebar:      'uc.zen-vivid.colorize-sidebar',
    windowTint:   'uc.zen-vivid.window-tint',
    tintStrength: 'uc.zen-vivid.tint-strength',
  };

  // ─── Pref helpers ─────────────────────────────────────────────────────────
  function getPrefBool(key, def = false) {
    try { return Services.prefs.getBoolPref(key, def); } catch { return def; }
  }
  function getPrefInt(key, def = 0) {
    try { return Services.prefs.getIntPref(key, def); } catch { return def; }
  }
  const isEnabled    = () => getPrefBool(PREF.enabled,      true);
  const doAddrbar    = () => getPrefBool(PREF.addrbar,      true);
  const doSidebar    = () => getPrefBool(PREF.sidebar,      true);
  const doWindowTint = () => getPrefBool(PREF.windowTint,   false);
  const getTintPct   = () => Math.max(0, Math.min(60, getPrefInt(PREF.tintStrength, 18)));
  const getTransMs   = () => Math.max(0, Math.min(2000, getPrefInt(PREF.transitionMs, 100)));

  // ─── State ────────────────────────────────────────────────────────────────
  const root = document.documentElement;
  let lastBg  = '';
  let pollTimer = null;
  let boostObserver = null;

  // ─── Color utilities ──────────────────────────────────────────────────────
  function isBlank(c) {
    if (!c || c === 'transparent') return true;
    const m = String(c).match(/rgba\(([^)]+)\)/);
    if (m) {
      const parts = m[1].split(',').map(p => parseFloat(p.trim()));
      if (parts.length === 4 && parts[3] < 0.05) return true;
    }
    return false;
  }

  let _normCanvas = null, _normCtx = null;
  function normalizeColor(c) {
    if (!c) return null;
    try {
      if (!_normCanvas) {
        _normCanvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
        _normCanvas.width = _normCanvas.height = 1;
        _normCtx = _normCanvas.getContext('2d', { willReadFrequently: true });
      }
      _normCtx.clearRect(0, 0, 1, 1);
      _normCtx.fillStyle = c.trim();
      _normCtx.fillRect(0, 0, 1, 1);
      const d = _normCtx.getImageData(0, 0, 1, 1).data;
      if (d[3] < 20) return null;
      return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
    } catch { return null; }
  }

  function chooseFg(bg) {
    const m = String(bg || '').match(/rgba?\(([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/);
    if (!m) return null;
    const lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
    return lum > 0.55 ? 'rgba(11,13,16,0.92)' : 'rgba(245,247,251,0.96)';
  }

  // ─── Pixel sampling via drawWindow (chrome context) ───────────────────────
  let _sampCanvas = null, _sampCtx = null;
  const SAMP_W = 12;

  function tryDrawWindow(browser) {
    try {
      const win = browser.contentWindow;
      if (!win) return null;
      if (!_sampCanvas) {
        _sampCanvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
        _sampCanvas.width = _sampCanvas.height = SAMP_W;
        _sampCtx = _sampCanvas.getContext('2d', { willReadFrequently: true });
      }
      if (!_sampCtx || typeof _sampCtx.drawWindow !== 'function') {
        LOG('drawWindow not available in this Zen version');
        return null;
      }
      const vw = browser.clientWidth || win.innerWidth || 0;
      const vh = browser.clientHeight || win.innerHeight || 0;
      if (vw <= 0 || vh <= 0) return null;
      const x = Math.max(0, Math.floor(vw / 2) - Math.floor(SAMP_W / 2));
      _sampCtx.clearRect(0, 0, SAMP_W, SAMP_W);
      _sampCtx.drawWindow(win, x, 3, SAMP_W, SAMP_W, 'rgba(0,0,0,0)');
      const d = _sampCtx.getImageData(0, 0, SAMP_W, SAMP_W).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < SAMP_W * SAMP_W; i++) {
        const o = i * 4;
        if (d[o + 3] < 20) continue;
        r += d[o]; g += d[o + 1]; b += d[o + 2]; n++;
      }
      if (!n) return null;
      const result = `rgb(${Math.round(r/n)}, ${Math.round(g/n)}, ${Math.round(b/n)})`;
      LOG('drawWindow sampled:', result);
      return result;
    } catch (e) {
      LOG('drawWindow failed:', e.message);
      return null;
    }
  }

  // ─── CSS / meta reading from chrome context ───────────────────────────────
  //
  // With Fission disabled (most Zen setups), browser.contentDocument IS
  // accessible from chrome context. With Fission enabled it may be null —
  // in that case we fall through gracefully.
  //
  function readFromContentDoc(browser) {
    try {
      const doc = browser.contentDocument;
      if (!doc || doc.readyState === 'loading') return null;

      // 1. <meta name="theme-color">
      const metas = doc.querySelectorAll('meta[name="theme-color" i]');
      let metaFallback = null;
      for (const m of metas) {
        const val = m.getAttribute('content');
        if (!val) continue;
        const media = m.getAttribute('media');
        if (!media) { metaFallback = metaFallback || val; continue; }
        try {
          const view = doc.defaultView;
          if (view && view.matchMedia(media).matches) {
            const c = normalizeColor(val);
            if (c) { LOG('meta theme-color (media match):', c); return c; }
          }
        } catch {}
      }
      if (metaFallback) {
        const c = normalizeColor(metaFallback);
        if (c) { LOG('meta theme-color (fallback):', c); return c; }
      }

      // 2. Computed background of body / html
      const view = doc.defaultView;
      if (view) {
        for (const el of [doc.body, doc.documentElement]) {
          if (!el) continue;
          try {
            const bg = view.getComputedStyle(el).backgroundColor;
            if (!isBlank(bg)) { LOG('CSS computed bg:', bg); return bg; }
          } catch {}
        }
      }
    } catch (e) {
      LOG('contentDocument read failed (Fission?):', e.message);
    }
    return null;
  }

  // ─── Main update function ─────────────────────────────────────────────────
  function update(browser) {
    if (!isEnabled()) { clearTheme(); return; }

    browser = browser || gBrowser?.selectedBrowser;
    if (!browser) return;

    // Priority: drawWindow > contentDocument
    let bg = tryDrawWindow(browser) || readFromContentDoc(browser);

    if (!bg) {
      // No color found — clear the theme so we don't leave stale colors
      if (lastBg) clearTheme();
      return;
    }

    if (bg === lastBg) return;
    lastBg = bg;
    applyTheme(bg, chooseFg(bg));
  }

  // ─── Apply / clear theme ──────────────────────────────────────────────────
  function applyTheme(bg, fg) {
    LOG('applying theme:', bg, fg);
    const ms = getTransMs(), tintPct = getTintPct();
    // Set Zen's native variables — their own CSS reads these for the toolbar
    root.style.setProperty('--zen-tab-header-background', bg);
    root.style.setProperty('--zen-tab-header-foreground', fg || 'inherit');
    root.style.setProperty('--zen-vivid-transition',      `${ms}ms linear`);
    root.style.setProperty('--zen-vivid-tint-bg',         bg);
    root.style.setProperty('--zen-vivid-tint-pct',        `${tintPct}%`);
    root.setAttribute('data-zen-vivid', '1');
    root.toggleAttribute('data-zen-vivid-addrbar', doAddrbar());
    root.toggleAttribute('data-zen-vivid-sidebar', doSidebar());
    root.toggleAttribute('data-zen-vivid-tint',    doWindowTint());
  }

  function clearTheme() {
    root.style.removeProperty('--zen-tab-header-background');
    root.style.removeProperty('--zen-tab-header-foreground');
    root.style.removeProperty('--zen-vivid-transition');
    root.style.removeProperty('--zen-vivid-tint-bg');
    root.style.removeProperty('--zen-vivid-tint-pct');
    root.removeAttribute('data-zen-vivid');
    root.removeAttribute('data-zen-vivid-addrbar');
    root.removeAttribute('data-zen-vivid-sidebar');
    root.removeAttribute('data-zen-vivid-tint');
    lastBg = '';
  }

  // ─── Polling ──────────────────────────────────────────────────────────────
  // Polls every 400ms — catches scroll-driven background changes without
  // needing frame script scroll events.
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(() => update(), 400);
    LOG('polling started');
  }
  function stopPolling() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
  }

  // ─── Boost detection ─────────────────────────────────────────────────────
  function observeBoost() {
    const btn = document.getElementById('zen-site-data-icon-button');
    if (!btn) { setTimeout(observeBoost, 800); return; }
    LOG('boost button found, observing');
    if (boostObserver) boostObserver.disconnect();
    boostObserver = new MutationObserver(() => {
      LOG('boost change detected, re-sampling');
      setTimeout(() => update(), 80);
      setTimeout(() => update(), 350);
    });
    boostObserver.observe(btn, { attributes: true });
  }

  // ─── Tab / navigation events ──────────────────────────────────────────────
  function onTabSelect() {
    lastBg = '';
    const browser = gBrowser?.selectedBrowser;
    setTimeout(() => update(browser), 0);
    setTimeout(() => update(browser), 300);
    setTimeout(() => update(browser), 900);
  }

  const progressListener = {
    onLocationChange(browser, webProgress) {
      if (!webProgress.isTopLevel || browser !== gBrowser?.selectedBrowser) return;
      LOG('location changed, clearing theme');
      clearTheme();
      setTimeout(() => update(browser), 150);
      setTimeout(() => update(browser), 600);
      setTimeout(() => update(browser), 1500);
      setTimeout(() => update(browser), 3000);
    },
    onStateChange(browser, webProgress, _req, flags) {
      if (!webProgress.isTopLevel || browser !== gBrowser?.selectedBrowser) return;
      const STOP = 0x00000010, NET = 0x00000040;
      if (flags & STOP && flags & NET) {
        setTimeout(() => update(browser), 200);
        setTimeout(() => update(browser), 800);
      }
    }
  };

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    LOG('init — Zen Vivid v1.2.0');

    // Verify CSS variables work by checking root access
    LOG('root element:', root.tagName, root.id || '(no id)');

    gBrowser.tabContainer.addEventListener('TabSelect', onTabSelect, false);
    gBrowser.addProgressListener(progressListener);
    observeBoost();
    startPolling();

    // Initial sample
    const browser = gBrowser?.selectedBrowser;
    if (browser) {
      update(browser);
      setTimeout(() => update(browser), 500);
      setTimeout(() => update(browser), 1500);
    }

    window.addEventListener('unload', () => {
      stopPolling();
      try { gBrowser.removeProgressListener(progressListener); } catch {}
      try { boostObserver?.disconnect(); } catch {}
    }, { once: true });
  }

  if (typeof gBrowser !== 'undefined') {
    init();
  } else {
    window.addEventListener('load', init, { once: true });
  }

})();
