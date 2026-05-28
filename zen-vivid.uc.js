// ==UserScript==
// @name           Zen Vivid
// @description    Page-aware color blending for addressbar and sidebar in Zen Browser.
//                 Reads the actual rendered pixel color just below the address bar and
//                 applies it to the toolbar and sidebar via Zen's native CSS variables.
//                 Supports Zen Boosts, scroll changes, compact mode, and single-toolbar mode.
// @version        1.1.0
// @author         zen-vivid
// ==/UserScript==

(() => {
  'use strict';

  if (window.__zenVivid_inited) return;
  window.__zenVivid_inited = true;

  // ─── Pref keys ────────────────────────────────────────────────────────────
  const PREF = {
    enabled:      'uc.zen-vivid.enabled',
    transitionMs: 'uc.zen-vivid.transition-ms',
    addrbar:      'uc.zen-vivid.colorize-addressbar',
    sidebar:      'uc.zen-vivid.colorize-sidebar',
    windowTint:   'uc.zen-vivid.window-tint',
    tintStrength: 'uc.zen-vivid.tint-strength',
  };

  // ─── Message IDs ──────────────────────────────────────────────────────────
  const MSG_FALLBACK = 'zen-vivid:fallback-color';
  const MSG_SCROLLED = 'zen-vivid:scrolled';

  // ─── State ────────────────────────────────────────────────────────────────
  const root = document.documentElement;
  let lastKey  = '';
  let boostObserver = null;
  let boostActive   = false;
  let resampleTimer = 0;

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

  // ─── Chrome-side pixel sampler ────────────────────────────────────────────
  //
  // drawWindow() is a chrome-only API. Since this uc.js runs in chrome context,
  // we can sample the rendered page content directly — including Boost filters —
  // without any frame script. This is the primary color source.
  //
  let _sampleCanvas = null;
  let _sampleCtx    = null;
  const SAMP_W = 12;

  function ensureSampleCanvas() {
    if (_sampleCtx) return _sampleCtx;
    try {
      _sampleCanvas = document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
      _sampleCanvas.width  = SAMP_W;
      _sampleCanvas.height = SAMP_W;
      _sampleCtx = _sampleCanvas.getContext('2d', { willReadFrequently: true });
    } catch {
      _sampleCanvas = _sampleCtx = null;
    }
    return _sampleCtx;
  }

  function samplePixelFromChrome(browser) {
    try {
      const win = browser?.contentWindow;
      if (!win) return null;

      const ctx = ensureSampleCanvas();
      if (!ctx || typeof ctx.drawWindow !== 'function') return null;

      // clientWidth of the browser element gives us the actual viewport width
      const vw = browser.clientWidth || win.innerWidth || 0;
      const vh = browser.clientHeight || win.innerHeight || 0;
      if (vw <= 0 || vh <= 0) return null;

      // Sample a strip SAMP_W × SAMP_W pixels at the horizontal center,
      // 3px from the top of the page viewport.
      const x = Math.max(0, Math.floor(vw / 2) - Math.floor(SAMP_W / 2));
      const y = 3;

      ctx.clearRect(0, 0, SAMP_W, SAMP_W);
      ctx.drawWindow(win, x, y, SAMP_W, SAMP_W, 'rgba(0,0,0,0)');

      const d = ctx.getImageData(0, 0, SAMP_W, SAMP_W).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < SAMP_W * SAMP_W; i++) {
        const o = i * 4;
        if (d[o + 3] < 20) continue; // skip transparent
        r += d[o]; g += d[o + 1]; b += d[o + 2]; n++;
      }
      if (!n) return null;
      return `rgb(${Math.round(r / n)}, ${Math.round(g / n)}, ${Math.round(b / n)})`;
    } catch {
      return null;
    }
  }

  // ─── Foreground color from background luminance ───────────────────────────
  function chooseFg(bg) {
    const m = String(bg || '').match(/rgba?\(([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/);
    if (!m) return null;
    const lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
    return lum > 0.55 ? 'rgba(11,13,16,0.92)' : 'rgba(245,247,251,0.96)';
  }

  // ─── Apply / clear theme ──────────────────────────────────────────────────
  //
  // We set Zen's native CSS variables directly.
  // --zen-tab-header-background / --zen-tab-header-foreground are read by
  // Zen's own stylesheets for the navbar and, with our style.css, the sidebar.
  //
  function applyTheme(bg, fg) {
    if (!bg) { clearTheme(); return; }

    const ms      = getTransMs();
    const tintPct = getTintPct();

    root.style.setProperty('--zen-tab-header-background',  bg);
    root.style.setProperty('--zen-tab-header-foreground',  fg || 'inherit');
    root.style.setProperty('--zen-vivid-transition',       `${ms}ms linear`);
    root.style.setProperty('--zen-vivid-tint-bg',         bg);
    root.style.setProperty('--zen-vivid-tint-pct',        `${tintPct}%`);

    root.setAttribute('data-zen-vivid', '1');
    root.toggleAttribute('data-zen-vivid-addrbar',  doAddrbar());
    root.toggleAttribute('data-zen-vivid-sidebar',  doSidebar());
    root.toggleAttribute('data-zen-vivid-tint',     doWindowTint());
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
    lastKey = '';
  }

  // ─── Full resample cycle ──────────────────────────────────────────────────
  function resample(browser) {
    if (!isEnabled()) { clearTheme(); return; }

    browser = browser || gBrowser?.selectedBrowser;
    if (!browser) return;

    // Primary: chrome-side pixel read (captures Boost filters too)
    let bg = samplePixelFromChrome(browser);

    // Fallback if pixel read fails: wait for frame script CSS/meta fallback
    // (the frame script sends MSG_FALLBACK with a bg color when available)
    if (!bg) return; // frame script fallback will fire separately

    const fg  = chooseFg(bg);
    const key = (browser.currentURI?.spec || '') + '|' + bg + '|' + fg;
    if (key === lastKey) return;
    lastKey = key;
    applyTheme(bg, fg);
  }

  function scheduleResample(browser, delay = 0) {
    if (delay === 0) {
      resample(browser);
      return;
    }
    clearTimeout(resampleTimer);
    resampleTimer = setTimeout(() => resample(browser), delay);
  }

  // ─── Frame script (fallback + scroll events) ──────────────────────────────
  //
  // This is a minimal frame script: it only handles CSS/meta color fallback
  // (for pages where pixel sampling fails, e.g. blank tabs) and scroll events.
  // No drawWindow here — that runs on the chrome side above.
  //
  const FRAME_SRC = `(function () {
  'use strict';

  if (content.__zenVivid_frame_inited) {
    if (typeof content.__zenVivid_frame_sample === 'function') content.__zenVivid_frame_sample();
    return;
  }
  content.__zenVivid_frame_inited = true;

  const MSG_FALLBACK = 'zen-vivid:fallback-color';
  const MSG_SCROLLED = 'zen-vivid:scrolled';
  let lastKey = '';
  let scrollTimer = 0;

  function isBlank(c) {
    if (!c || c === 'transparent') return true;
    const m = String(c).match(/rgba\\([^)]+\\)/);
    if (m) {
      const parts = m[0].match(/[\\d.]+/g) || [];
      if (parts.length === 4 && parseFloat(parts[3]) < 0.05) return true;
    }
    return false;
  }

  function pickMeta(doc) {
    const metas = doc.querySelectorAll('meta[name="theme-color" i]');
    let fallback = null;
    for (const m of metas) {
      const val = m.getAttribute('content');
      if (!val) continue;
      const media = m.getAttribute('media');
      if (!media) { fallback = fallback || val; continue; }
      try { if (content.matchMedia(media).matches) return val; } catch {}
    }
    return fallback;
  }

  function pickCssBg() {
    const doc = content.document;
    const view = doc && doc.defaultView;
    if (!view) return null;
    for (const el of [doc.body, doc.documentElement]) {
      if (!el) continue;
      const bg = view.getComputedStyle(el).backgroundColor;
      if (!isBlank(bg)) return bg;
    }
    return null;
  }

  function normColor(c) {
    if (!c) return null;
    try {
      const cv = content.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
      cv.width = cv.height = 1;
      const cx = cv.getContext('2d');
      cx.fillStyle = c.trim();
      cx.fillRect(0, 0, 1, 1);
      const d = cx.getImageData(0, 0, 1, 1).data;
      if (d[3] < 20) return null;
      return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
    } catch { return null; }
  }

  function sendFallback() {
    const doc = content.document;
    if (!doc || doc.readyState === 'loading') return;
    const bg = normColor(pickMeta(doc)) || pickCssBg();
    if (!bg) return;
    const href = content.location && content.location.href || '';
    const key = href + '|' + bg;
    if (key === lastKey) return;
    lastKey = key;
    sendAsyncMessage(MSG_FALLBACK, { bg, href });
  }
  content.__zenVivid_frame_sample = sendFallback;

  function onScroll() {
    if (scrollTimer) return;
    scrollTimer = content.setTimeout(function () {
      scrollTimer = 0;
      sendAsyncMessage(MSG_SCROLLED, {});
    }, 160);
  }

  addMessageListener('zen-vivid:request-fallback', function () {
    content.setTimeout(sendFallback, 20);
  });

  content.addEventListener('scroll', onScroll, { capture: true, passive: true });

  // Watch for theme attribute changes (dark/light mode switches)
  function startObserving() {
    const doc = content.document;
    if (!doc || !doc.body) { content.setTimeout(startObserving, 150); return; }
    const ATTRS = ['class','style','theme','data-theme','data-mode','data-bs-theme',
                   'data-color-scheme','data-color-mode','data-dark-mode','color-scheme'];
    const obs = new content.MutationObserver(sendFallback);
    obs.observe(doc.documentElement, { attributes: true, attributeFilter: ATTRS });
    obs.observe(doc.body,            { attributes: true, attributeFilter: ATTRS });
  }

  if (content.document.readyState === 'loading') {
    content.document.addEventListener('DOMContentLoaded', sendFallback, { once: true, capture: true });
  } else {
    sendFallback();
  }
  startObserving();
  content.addEventListener('load', function () {
    content.setTimeout(sendFallback, 300);
  }, { capture: true });
  content.addEventListener('pageshow', function () {
    content.setTimeout(sendFallback, 50);
  }, { capture: true });

})();`;

  const FRAME_URL = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(FRAME_SRC);

  // ─── Fallback color message handler ───────────────────────────────────────
  function onFallbackColor({ data }) {
    if (!isEnabled()) { clearTheme(); return; }
    if (!data?.bg) return;

    const browser = gBrowser?.selectedBrowser;
    // Only use fallback if chrome pixel sampling didn't already set a key
    if (lastKey) return;

    const fg  = chooseFg(data.bg);
    const key = (data.href || '') + '|' + data.bg + '|' + fg;
    if (key === lastKey) return;
    lastKey = key;
    applyTheme(data.bg, fg);
  }

  // ─── Scroll message handler ────────────────────────────────────────────────
  function onScrolled() {
    const browser = gBrowser?.selectedBrowser;
    if (browser) resample(browser);
  }

  // ─── Boost detection ─────────────────────────────────────────────────────
  function isBoostActive() {
    const btn = document.getElementById('zen-site-data-icon-button');
    return btn?.hasAttribute('boosting') || btn?.getAttribute('boosting') === 'true';
  }

  function onBoostChange() {
    const active = isBoostActive();
    if (active === boostActive) return;
    boostActive = active;
    // Give Boost's CSS time to apply before re-sampling
    const browser = gBrowser?.selectedBrowser;
    if (browser) {
      scheduleResample(browser, 80);
      scheduleResample(browser, 320);
    }
  }

  function observeBoost() {
    const btn = document.getElementById('zen-site-data-icon-button');
    if (!btn) { setTimeout(observeBoost, 800); return; }
    boostActive = isBoostActive();
    if (boostObserver) boostObserver.disconnect();
    boostObserver = new MutationObserver(onBoostChange);
    boostObserver.observe(btn, { attributes: true });
  }

  // ─── Tab events ───────────────────────────────────────────────────────────
  function onTabSelect() {
    lastKey = ''; // force re-apply for the new tab
    const browser = gBrowser?.selectedBrowser;
    if (!browser) return;
    // Multiple delays to catch pages at different load stages
    scheduleResample(browser, 0);
    scheduleResample(browser, 300);
    scheduleResample(browser, 800);
    // Also ask frame script for CSS fallback
    try { browser.messageManager?.sendAsyncMessage('zen-vivid:request-fallback', {}); } catch {}
  }

  // ─── Navigation listener ──────────────────────────────────────────────────
  const progressListener = {
    onStateChange(browser, webProgress, _req, flags, _status) {
      if (!webProgress.isTopLevel) return;
      if (browser !== gBrowser?.selectedBrowser) return;
      // Clear on navigation start
      if (flags & 0x00000001 /* STATE_START */ && flags & 0x00000040 /* STATE_IS_NETWORK */) {
        clearTheme();
      }
      // Re-sample on page fully loaded
      if (flags & 0x00000010 /* STATE_STOP */ && flags & 0x00000040 /* STATE_IS_NETWORK */) {
        scheduleResample(browser, 200);
        scheduleResample(browser, 800);
        scheduleResample(browser, 2000);
      }
    },
    onLocationChange(browser, webProgress) {
      if (!webProgress.isTopLevel) return;
      if (browser !== gBrowser?.selectedBrowser) return;
      clearTheme();
      scheduleResample(browser, 100);
    }
  };

  // ─── Init ─────────────────────────────────────────────────────────────────
  function init() {
    // Load frame script into all tabs (current + future)
    Services.mm.loadFrameScript(FRAME_URL, true);
    Services.mm.addMessageListener(MSG_FALLBACK, onFallbackColor);
    Services.mm.addMessageListener(MSG_SCROLLED, onScrolled);

    gBrowser.tabContainer.addEventListener('TabSelect', onTabSelect, false);
    gBrowser.addProgressListener(progressListener);

    observeBoost();

    // Initial sample
    const browser = gBrowser?.selectedBrowser;
    if (browser) {
      scheduleResample(browser, 400);
      scheduleResample(browser, 1000);
    }

    window.addEventListener('unload', () => {
      try { Services.mm.removeMessageListener(MSG_FALLBACK, onFallbackColor); } catch {}
      try { Services.mm.removeMessageListener(MSG_SCROLLED, onScrolled); } catch {}
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
