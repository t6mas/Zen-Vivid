// ==UserScript==
// @name           Zen Vivid
// @description    Page-aware color blending for addressbar and sidebar in Zen Browser.
//                 Reads the actual rendered pixel color at the top of the page and
//                 applies it to the toolbar and sidebar with smooth transitions.
//                 Supports Zen Boosts, compact mode, single-toolbar mode, and scroll changes.
// @version        1.0.0
// @author         zen-vivid
// ==/UserScript==

(() => {
  'use strict';

  // ─── Duplicate-init guard ─────────────────────────────────────────────────
  if (window.__zenVivid_inited) return;
  window.__zenVivid_inited = true;

  // ─── Preference keys ──────────────────────────────────────────────────────
  const P = 'uc.zen-vivid.';
  const PREF = {
    enabled:        P + 'enabled',
    transitionMs:   P + 'transition-ms',
    addrbar:        P + 'colorize-addressbar',
    sidebar:        P + 'colorize-sidebar',
    windowTint:     P + 'window-tint',
    tintStrength:   P + 'tint-strength',
  };

  // ─── Message IDs ──────────────────────────────────────────────────────────
  const MSG_COLOR = 'zen-vivid:color';
  const MSG_FORCE = 'zen-vivid:force-sample';

  // ─── State ────────────────────────────────────────────────────────────────
  const root = document.documentElement;
  let lastKey  = '';
  let boostObserver = null;
  let boostActive   = false;

  // ─── Services helper ──────────────────────────────────────────────────────
  let _svc = null;
  function svc() {
    if (_svc) return _svc;
    try { _svc = Services; return _svc; } catch {}
    try {
      _svc = ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs').Services;
      return _svc;
    } catch {}
    return null;
  }

  // ─── Preference readers ───────────────────────────────────────────────────
  function getPrefBool(key, def = false) {
    try { return svc()?.prefs.getBoolPref(key, def); } catch { return def; }
  }
  function getPrefInt(key, def = 0) {
    try { return svc()?.prefs.getIntPref(key, def); } catch { return def; }
  }

  function isEnabled()     { return getPrefBool(PREF.enabled,      true); }
  function doAddrbar()     { return getPrefBool(PREF.addrbar,      true); }
  function doSidebar()     { return getPrefBool(PREF.sidebar,      true); }
  function doWindowTint()  { return getPrefBool(PREF.windowTint,   false); }
  function getTintPct()    { return Math.max(0, Math.min(60, getPrefInt(PREF.tintStrength, 18))); }
  function getTransMs()    { return Math.max(0, Math.min(2000, getPrefInt(PREF.transitionMs, 100))); }

  // ─── CSS variable helpers ─────────────────────────────────────────────────
  function cssSet(name, value) {
    if (root.style.getPropertyValue(name) !== value)
      root.style.setProperty(name, value);
  }
  function cssClear(name) {
    if (root.style.getPropertyValue(name))
      root.style.removeProperty(name);
  }

  // ─── Theme application ────────────────────────────────────────────────────
  function applyTheme(bg, fg) {
    if (!bg) { clearTheme(); return; }

    const ms       = getTransMs();
    const tintPct  = getTintPct();

    cssSet('--zen-vivid-bg',         bg);
    cssSet('--zen-vivid-fg',         fg || 'inherit');
    cssSet('--zen-vivid-transition', `${ms}ms linear`);
    cssSet('--zen-vivid-tint-pct',   `${tintPct}%`);

    root.setAttribute('data-zen-vivid', '1');
    root.toggleAttribute('data-zen-vivid-addrbar',  doAddrbar());
    root.toggleAttribute('data-zen-vivid-sidebar',  doSidebar());
    root.toggleAttribute('data-zen-vivid-tint',     doWindowTint());
  }

  function clearTheme() {
    cssClear('--zen-vivid-bg');
    cssClear('--zen-vivid-fg');
    cssClear('--zen-vivid-transition');
    cssClear('--zen-vivid-tint-pct');
    root.removeAttribute('data-zen-vivid');
    root.removeAttribute('data-zen-vivid-addrbar');
    root.removeAttribute('data-zen-vivid-sidebar');
    root.removeAttribute('data-zen-vivid-tint');
    lastKey = '';
  }

  // ─── Message from frame script ───────────────────────────────────────────
  function onColorMessage({ data }) {
    if (!isEnabled()) { clearTheme(); return; }
    const key = (data?.href || '') + '|' + (data?.bg || '') + '|' + (data?.fg || '');
    if (key === lastKey) return;
    lastKey = key;
    applyTheme(data?.bg || null, data?.fg || null);
  }

  // ─── Force re-sample in a specific browser frame ──────────────────────────
  function forceSample(browser) {
    try {
      if (browser?.messageManager) {
        browser.messageManager.sendAsyncMessage(MSG_FORCE, {});
      }
    } catch {}
  }

  // ─── Boost detection ─────────────────────────────────────────────────────
  function isBoostActive() {
    return !!document.getElementById('zen-site-data-icon-button')?.hasAttribute('boosting');
  }

  function onBoostChange() {
    const active = isBoostActive();
    if (active === boostActive) return;
    boostActive = active;
    // Give Boost's CSS filter time to render before re-sampling
    const browser = gBrowser?.selectedBrowser;
    if (browser) {
      setTimeout(() => forceSample(browser), 60);
      setTimeout(() => forceSample(browser), 280);
    }
  }

  function observeBoost() {
    const btn = document.getElementById('zen-site-data-icon-button');
    if (!btn) { setTimeout(observeBoost, 700); return; }
    boostActive = isBoostActive();
    if (boostObserver) boostObserver.disconnect();
    boostObserver = new MutationObserver(onBoostChange);
    boostObserver.observe(btn, { attributes: true, attributeFilter: ['boosting'] });
  }

  // ─── Tab events ───────────────────────────────────────────────────────────
  function onTabSelect() {
    const browser = gBrowser?.selectedBrowser;
    if (!browser) return;
    // Ask the already-loaded frame script for its cached/current color
    forceSample(browser);
  }

  // Track navigation to clear stale color during page load
  const progressListener = {
    onStateChange(browser, webProgress, _req, flags, _status) {
      if (!webProgress.isTopLevel) return;
      if (browser !== gBrowser?.selectedBrowser) return;
      const STATE_START = 0x00000001;
      const STATE_IS_NETWORK = 0x00000040;
      if (flags & STATE_START & STATE_IS_NETWORK) {
        clearTheme();
        lastKey = '';
      }
    }
  };

  // ─── Frame script source (embedded, injected via data: URL) ──────────────
  //
  // This runs inside the content process for every browser tab.
  // It samples pixel colors from the very top of the rendered page and
  // sends them back to the chrome script via sendAsyncMessage.
  //
  const FRAME_SOURCE = /* javascript */ `(function () {
    'use strict';

    // ── Init guard ───────────────────────────────────────────────────────────
    if (content.__zenVivid_inited) {
      if (typeof content.__zenVivid_sample === 'function') content.__zenVivid_sample(true);
      return;
    }
    content.__zenVivid_inited = true;

    const MSG      = 'zen-vivid:color';
    const SAMP_W   = 9;    // pixels wide to sample across
    const SAMP_Y   = 3;    // pixels from top of viewport to sample at
    const DEBOUNCE = 160;  // ms debounce for scroll / mutation events

    let lastKey       = '';
    let debounceTimer = 0;
    let canvas        = null;
    let ctx           = null;

    // ── Canvas for color math and drawWindow ─────────────────────────────────
    function ensureCanvas() {
      if (canvas && ctx) return true;
      try {
        canvas = content.document.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
        canvas.width  = SAMP_W;
        canvas.height = SAMP_W;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
        return !!ctx;
      } catch { canvas = ctx = null; return false; }
    }

    // ── Read actual rendered pixels at top of viewport (captures Boost too) ──
    function readPixelTop() {
      try {
        const w = content.innerWidth  | 0;
        const h = content.innerHeight | 0;
        if (w <= 0 || h <= 0 || !ensureCanvas() || !ctx.drawWindow) return null;

        const x = Math.max(0, Math.floor(w / 2) - Math.floor(SAMP_W / 2));
        const y = Math.max(0, Math.min(SAMP_Y, h - SAMP_W));

        ctx.clearRect(0, 0, SAMP_W, SAMP_W);
        ctx.drawWindow(content, x, y, SAMP_W, SAMP_W, 'rgba(0,0,0,0)');

        const d = ctx.getImageData(0, 0, SAMP_W, SAMP_W).data;
        let r = 0, g = 0, b = 0, n = 0;
        for (let i = 0; i < SAMP_W * SAMP_W; i++) {
          const o = i * 4;
          if (d[o + 3] < 20) continue;  // skip nearly transparent pixels
          r += d[o]; g += d[o + 1]; b += d[o + 2]; n++;
        }
        if (!n) return null;
        return 'rgb(' + Math.round(r / n) + ',' + Math.round(g / n) + ',' + Math.round(b / n) + ')';
      } catch { return null; }
    }

    // ── Normalize any CSS color string to rgb() via canvas ───────────────────
    function normColor(color) {
      if (!color || !ensureCanvas()) return null;
      try {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = 'rgba(0,0,0,0)';
        ctx.fillStyle = color.trim();
        ctx.fillRect(0, 0, 1, 1);
        const d = ctx.getImageData(0, 0, 1, 1).data;
        if (d[3] < 20) return null;
        return 'rgb(' + d[0] + ',' + d[1] + ',' + d[2] + ')';
      } catch { return null; }
    }

    // ── Semantic: <meta name="theme-color"> (respects media queries) ─────────
    function pickMetaThemeColor() {
      const metas = content.document.querySelectorAll('meta[name="theme-color" i]');
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

    // ── Semantic: computed background of <body> or <html> ───────────────────
    function readComputedBg() {
      const doc  = content.document;
      const view = doc && doc.defaultView;
      if (!view) return null;
      for (const el of [doc.body, doc.documentElement]) {
        if (!el) continue;
        const bg = view.getComputedStyle(el).backgroundColor;
        if (!bg || bg === 'transparent' || bg === 'rgba(0, 0, 0, 0)') continue;
        // Skip fully-transparent rgba
        const m = bg.match(/rgba\\([^)]+\\)/);
        if (m) {
          const parts = m[0].match(/[\\d.]+/g) || [];
          if (parts.length === 4 && parseFloat(parts[3]) < 0.08) continue;
        }
        return bg;
      }
      return null;
    }

    // ── Visual: walk ancestors at top-center point ────────────────────────────
    function readAncestorBg() {
      try {
        const doc  = content.document;
        const view = doc && doc.defaultView;
        const w    = content.innerWidth | 0;
        if (!view || w <= 0) return null;
        let el = doc.elementFromPoint(Math.floor(w / 2), SAMP_Y + 8);
        for (let i = 0; el && i < 12; i++) {
          const bg = view.getComputedStyle(el).backgroundColor;
          if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') {
            const parts = (bg.match(/[\\d.]+/g) || []);
            if (parts.length < 4 || parseFloat(parts[3]) > 0.08) return bg;
          }
          el = el.parentElement;
        }
      } catch {}
      return null;
    }

    // ── Compute readable foreground for a background ─────────────────────────
    function chooseFg(bg) {
      const m = String(bg || '').match(/rgba?\\(([\\d.]+)[, ]+([\\d.]+)[, ]+([\\d.]+)/);
      if (!m) return null;
      const lum = (0.299 * +m[1] + 0.587 * +m[2] + 0.114 * +m[3]) / 255;
      return lum > 0.55 ? 'rgba(11,13,16,0.92)' : 'rgba(245,247,251,0.96)';
    }

    // ── Main sampling function ────────────────────────────────────────────────
    function doSample(force) {
      const doc = content.document;
      if (!doc || doc.readyState === 'loading') return;

      // Priority: rendered pixels → meta theme-color → body/html bg → ancestor walk
      let bg = readPixelTop();
      if (!bg) bg = normColor(pickMetaThemeColor());
      if (!bg) bg = readComputedBg();
      if (!bg) bg = readAncestorBg();

      const fg   = chooseFg(bg);
      const href = content.location && content.location.href || '';
      const key  = href + '|' + (bg || '') + '|' + (fg || '');

      if (!force && key === lastKey) return;
      lastKey = key;
      sendAsyncMessage(MSG, { bg: bg || null, fg: fg || null, href });
    }
    content.__zenVivid_sample = doSample;

    // ── Debounced re-sample (for scroll + mutations) ──────────────────────────
    function debouncedSample() {
      if (debounceTimer) return;
      debounceTimer = content.setTimeout(function () {
        debounceTimer = 0;
        doSample(false);
      }, DEBOUNCE);
    }

    // ── MutationObserver for theme switches (dark/light mode etc.) ────────────
    function startObserving() {
      const doc = content.document;
      if (!doc || !doc.body) { content.setTimeout(startObserving, 150); return; }

      const THEME_ATTRS = [
        'class', 'style', 'theme', 'data-theme', 'data-mode',
        'data-bs-theme', 'data-color-scheme', 'data-color-mode',
        'data-dark-mode', 'color-scheme', 'data-prefers-color-scheme'
      ];

      const obs = new content.MutationObserver(debouncedSample);
      obs.observe(doc.documentElement, { attributes: true, attributeFilter: THEME_ATTRS });
      obs.observe(doc.body,           { attributes: true, attributeFilter: THEME_ATTRS });

      if (doc.head) {
        const headObs = new content.MutationObserver(debouncedSample);
        headObs.observe(doc.head, {
          childList: true, subtree: true, attributes: true,
          attributeFilter: ['content', 'media', 'href', 'disabled']
        });
      }
    }

    // ── Listen for force-sample commands from chrome ──────────────────────────
    addMessageListener('zen-vivid:force-sample', function () {
      content.setTimeout(function () { doSample(true); }, 40);
    });

    // ── Scroll triggers re-sample so color follows the page ──────────────────
    content.addEventListener('scroll', debouncedSample, { capture: true, passive: true });

    // ── Initial sampling ─────────────────────────────────────────────────────
    if (doc && doc.readyState === 'loading') {
      content.document.addEventListener('DOMContentLoaded', function () { doSample(true); },
        { capture: true, once: true });
    } else {
      doSample(true);
    }

    startObserving();

    content.addEventListener('load', function () {
      content.setTimeout(function () { doSample(true); }, 100);
      content.setTimeout(function () { doSample(true); }, 800);
    }, { capture: true });

    content.addEventListener('pageshow', function () {
      content.setTimeout(function () { doSample(true); }, 50);
    }, { capture: true });

  })();`;

  // ─── Register frame script (once per session) ─────────────────────────────
  const FRAME_URL = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(FRAME_SOURCE);

  function initFrameScript() {
    try {
      // Global message manager: applies the frame script to all current + future tabs
      Services.mm.loadFrameScript(FRAME_URL, true);
      Services.mm.addMessageListener(MSG_COLOR, onColorMessage);
    } catch (e) {
      console.error('[zen-vivid] Failed to load frame script:', e);
    }
  }

  // ─── Wiring ───────────────────────────────────────────────────────────────
  function init() {
    // Register the frame script in all content frames
    initFrameScript();

    // Handle tab switches
    gBrowser.tabContainer.addEventListener('TabSelect', onTabSelect, false);

    // Handle navigation (clear color on load start)
    gBrowser.addProgressListener(progressListener);

    // Observe the Boost button (may not exist yet on early load)
    observeBoost();

    // Sample current tab on first run
    const browser = gBrowser?.selectedBrowser;
    if (browser) {
      setTimeout(() => forceSample(browser), 400);
    }

    // Clean up on window close
    window.addEventListener('unload', () => {
      try { Services.mm.removeMessageListener(MSG_COLOR, onColorMessage); } catch {}
      try { gBrowser.removeProgressListener(progressListener); } catch {}
      try { boostObserver?.disconnect(); } catch {}
    }, { once: true });
  }

  // Wait for gBrowser to be available
  if (typeof gBrowser !== 'undefined') {
    init();
  } else {
    window.addEventListener('load', init, { once: true });
  }

})();
