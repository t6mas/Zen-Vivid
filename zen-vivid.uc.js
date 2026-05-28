// ==UserScript==
// @name           Zen Vivid
// @description    Samples the visible top of the page and tints Zen chrome + sidebar.
// @version        0.1.0
// ==/UserScript==

(() => {
  "use strict";

  const ROOT_ID = "zen-vivid";
  const FRAME_SCRIPT_URL = "chrome://sine/content/zen-vivid/frame.js";
  const MESSAGE_NAME = "zen-vivid:sample";
  const DEFAULT_TRANSITION = "140ms";
  const DEFAULT_FALLBACK_OPACITY = 0.12;

  const state = {
    initialized: false,
    listeners: [],
    browsers: new WeakMap(),
    lastAppliedKey: "",
    lastBrowser: null,
    boostObserver: null,
    boostActive: false,
    fallbackScheme: "dark",
    scheduleToken: 0,
    pendingReason: ""
  };

  function $(id) {
    return document.getElementById(id);
  }

  function getServices() {
    try {
      if (typeof Services !== "undefined") {
        return Services;
      }
    } catch {}
    try {
      return ChromeUtils.importESModule("resource://gre/modules/Services.sys.mjs").Services;
    } catch {
      return null;
    }
  }

  function getPrefService() {
    return getServices()?.prefs || null;
  }

  function readBoolPref(name, fallback) {
    try {
      return getPrefService()?.getBoolPref(name, fallback) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function readStringPref(name, fallback) {
    try {
      return getPrefService()?.getStringPref(name, fallback) ?? fallback;
    } catch {}
    try {
      return getPrefService()?.getCharPref(name, fallback) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function parseOpacityPercent(value, fallback = DEFAULT_FALLBACK_OPACITY) {
    const raw = String(value ?? "").trim();
    if (!raw) return fallback;
    const num = Number(raw.replace("%", ""));
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(100, num)) / 100;
  }

  function parseMs(value, fallback = DEFAULT_TRANSITION) {
    const raw = String(value ?? "").trim();
    if (!raw) return fallback;
    if (/^\d+(\.\d+)?ms$/.test(raw) || /^\d+(\.\d+)?s$/.test(raw)) return raw;
    const num = Number(raw);
    if (!Number.isFinite(num)) return fallback;
    return `${num}ms`;
  }

  function getScheme() {
    try {
      const scheme = getComputedStyle(document.documentElement).colorScheme;
      if (scheme && /dark/i.test(scheme)) return "dark";
      if (scheme && /light/i.test(scheme)) return "light";
    } catch {}
    return window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ? "dark" : "light";
  }

  function getActiveBrowser() {
    return window.gBrowser?.selectedBrowser || null;
  }

  function getBrowserHref(browser) {
    try {
      return browser?.currentURI?.spec || browser?.contentPrincipal?.URI?.spec || "";
    } catch {
      return "";
    }
  }

  function isWebPageHref(href) {
    return /^https?:\/\//i.test(String(href || ""));
  }

  function ensureFrameScript(browser) {
    const manager = browser?.messageManager || browser?.frameLoader?.messageManager;
    if (!manager?.loadFrameScript) return false;
    if (state.browsers.get(browser)?.frameLoaded) return true;

    try {
      manager.loadFrameScript(FRAME_SCRIPT_URL, false);
      state.browsers.set(browser, {
        frameLoaded: true,
        listenerAttached: !!state.browsers.get(browser)?.listenerAttached
      });
      return true;
    } catch (error) {
      console.warn("[Zen Vivid] Frame script load failed:", error);
      return false;
    }
  }

  function attachMessageListener(browser) {
    const manager = browser?.messageManager || browser?.frameLoader?.messageManager;
    if (!manager?.addMessageListener) return false;

    const existing = state.browsers.get(browser) || {};
    if (existing.listenerAttached) return true;

    const listener = {
      receiveMessage(message) {
        const data = message?.data || null;
        if (!data?.bg) return;
        applyTheme(browser, data);
      }
    };

    try {
      manager.addMessageListener(MESSAGE_NAME, listener);
      state.browsers.set(browser, {
        ...existing,
        frameLoaded: !!existing.frameLoaded,
        listenerAttached: true,
        listener
      });
      return true;
    } catch (error) {
      console.warn("[Zen Vivid] Message listener failed:", error);
      return false;
    }
  }

  function cleanupBrowser(browser) {
    const entry = state.browsers.get(browser);
    const manager = browser?.messageManager || browser?.frameLoader?.messageManager;
    if (entry?.listenerAttached && entry.listener && manager?.removeMessageListener) {
      try {
        manager.removeMessageListener(MESSAGE_NAME, entry.listener);
      } catch {}
    }
    state.browsers.delete(browser);
  }

  function luminanceFromRgbString(color) {
    const match = String(color || "").match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!match) return null;
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    if (![r, g, b].every(Number.isFinite)) return null;
    return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  }

  function readableForeground(bg, fallbackScheme = state.fallbackScheme) {
    const luminance = luminanceFromRgbString(bg);
    if (luminance === null) {
      return fallbackScheme === "light" ? "rgba(14, 18, 24, 0.92)" : "rgba(248, 250, 252, 0.96)";
    }
    return luminance > 0.56 ? "rgba(14, 18, 24, 0.92)" : "rgba(248, 250, 252, 0.96)";
  }

  function setRootVars(root, data) {
    if (!root?.style) return;
    const style = root.style;
    const transition = parseMs(readStringPref("uc.zen-vivid.transition-ms", DEFAULT_TRANSITION), DEFAULT_TRANSITION);
    const opacity = parseOpacityPercent(readStringPref("uc.zen-vivid.fallback-opacity", "12"), DEFAULT_FALLBACK_OPACITY);
    const bg = data?.bg || "";
    const fg = data?.fg || readableForeground(bg);

    style.setProperty("--zen-vivid-transition", transition);
    style.setProperty("--zen-vivid-page-bg", bg || "");
    style.setProperty("--zen-vivid-page-fg", fg || "");
    style.setProperty("--zen-vivid-neutral-opacity", String(opacity));
    style.setProperty("--zen-tab-header-background", bg || "");
    style.setProperty("--zen-tab-header-foreground", fg || "");
    style.setProperty("--zen-main-browser-background", bg || "");
    style.setProperty("--zen-main-browser-background-toolbar", bg || "");
    style.setProperty("--zen-vivid-source", String(data?.source || "fallback"));
  }

  function clearVars(root, scheme = state.fallbackScheme) {
    if (!root?.style) return;
    const style = root.style;
    style.removeProperty("--zen-vivid-page-bg");
    style.removeProperty("--zen-vivid-page-fg");
    style.removeProperty("--zen-tab-header-background");
    style.removeProperty("--zen-tab-header-foreground");
    style.removeProperty("--zen-main-browser-background");
    style.removeProperty("--zen-main-browser-background-toolbar");
    style.removeProperty("--zen-vivid-source");
    root.dataset.zenVividScheme = scheme;
    root.dataset.zenVividSource = "fallback";
  }

  function applyTheme(browser, data) {
    const root = document.documentElement;
    const href = data?.href || getBrowserHref(browser);
    const bg = String(data?.bg || "").trim();
    if (!bg) return;

    const fg = String(data?.fg || readableForeground(bg)).trim();
    const source = String(data?.source || "pixel-top-edge").trim() || "pixel-top-edge";
    const key = `${href}::${bg}::${fg}::${source}::${state.boostActive ? "boost" : "plain"}`;

    if (key === state.lastAppliedKey && state.lastBrowser === browser) {
      return;
    }

    state.lastAppliedKey = key;
    state.lastBrowser = browser;

    setRootVars(root, { bg, fg, source });
    root.dataset.zenVividScheme = state.fallbackScheme;
    root.dataset.zenVividSource = source;
    root.dataset.zenVividBoost = state.boostActive ? "true" : "false";

    if (window.gBrowser?.selectedBrowser === browser) {
      // Mirror the most recent sample into a few chrome containers for older selectors.
      const targets = [
        $("navigator-toolbox"),
        $("nav-bar"),
        $("PersonalToolbar"),
        $("sidebar-box"),
        $("sidebar-main"),
        $("zen-sidebar-top-buttons"),
        $("zen-sidebar-foot-buttons"),
        $("zen-appcontent-navbar-wrapper"),
        $("titlebar"),
        $("zen-media-controls-toolbar"),
        $("zen-sidebar-splitter"),
        $("sidebar-splitter")
      ].filter(Boolean);

      for (const node of targets) {
        node.style.setProperty("background-color", bg, "important");
        node.style.setProperty("color", fg, "important");
        node.style.setProperty("fill", "currentColor", "important");
      }
    }
  }

  function applyFallback(reason = "fallback") {
    const root = document.documentElement;
    state.fallbackScheme = getScheme();
    const opacity = parseOpacityPercent(readStringPref("uc.zen-vivid.fallback-opacity", "12"), DEFAULT_FALLBACK_OPACITY);
    const bg = state.fallbackScheme === "light"
      ? `rgba(255, 255, 255, ${opacity})`
      : `rgba(0, 0, 0, ${opacity})`;
    const fg = state.fallbackScheme === "light"
      ? "rgba(14, 18, 24, 0.90)"
      : "rgba(248, 250, 252, 0.94)";

    state.lastAppliedKey = `fallback::${state.fallbackScheme}::${bg}`;
    setRootVars(root, { bg, fg, source: "fallback" });
    root.dataset.zenVividScheme = state.fallbackScheme;
    root.dataset.zenVividSource = "fallback";
    root.dataset.zenVividReason = reason;
  }

  function requestSample(browser, reason = "manual") {
    if (!browser) return false;
    ensureFrameScript(browser);
    attachMessageListener(browser);

    const manager = browser?.messageManager || browser?.frameLoader?.messageManager;
    if (!manager?.sendAsyncMessage) return false;

    try {
      manager.sendAsyncMessage(MESSAGE_NAME, {
        kind: "sample-now",
        reason,
        followScroll: readBoolPref("uc.zen-vivid.follow-scroll", true),
        useThemeColorFallback: readBoolPref("uc.zen-vivid.use-theme-color-fallback", true),
        boostsEnabled: readBoolPref("uc.zen-vivid.boosts.enabled", true)
      });
      return true;
    } catch (error) {
      console.warn("[Zen Vivid] Sample request failed:", error);
      return false;
    }
  }

  function scheduleUpdate(reason = "event") {
    state.pendingReason = reason;
    const token = ++state.scheduleToken;
    requestAnimationFrame(() => {
      if (token !== state.scheduleToken) return;
      const browser = getActiveBrowser();
      if (!browser) {
        applyFallback(reason);
        return;
      }
      if (!isWebPageHref(getBrowserHref(browser))) {
        applyFallback(reason);
        return;
      }
      requestSample(browser, reason);
    });
  }

  function isBoostActive() {
    const boostButton = $("zen-site-data-icon-button");
    return !!boostButton?.hasAttribute?.("boosting");
  }

  function observeBoostButton() {
    const target = $("zen-site-data-icon-button");
    if (!target || !readBoolPref("uc.zen-vivid.boosts.enabled", true)) return;

    state.boostActive = isBoostActive();
    state.boostObserver?.disconnect?.();
    state.boostObserver = new MutationObserver(() => {
      const next = isBoostActive();
      if (next === state.boostActive) return;
      state.boostActive = next;
      scheduleUpdate("boost-change");
    });

    state.boostObserver.observe(target, {
      attributes: true,
      attributeFilter: ["boosting", "aria-pressed", "data-state"]
    });
  }

  function onTabSelect() {
    observeBoostButton();
    scheduleUpdate("tab-select");
  }

  function onLoad() {
    if (state.initialized) return;
    state.initialized = true;

    state.fallbackScheme = getScheme();
    applyFallback("startup");

    const tabContainer = window.gBrowser?.tabContainer;
    if (tabContainer) {
      tabContainer.addEventListener("TabSelect", onTabSelect, true);
      state.listeners.push(["TabSelect", tabContainer, onTabSelect]);
    }

    const events = [
      ["DOMContentLoaded", window, () => scheduleUpdate("domcontentloaded")],
      ["load", window, () => scheduleUpdate("load")],
      ["resize", window, () => scheduleUpdate("resize")],
      ["pageshow", window, () => scheduleUpdate("pageshow")],
      ["fullscreenchange", document, () => scheduleUpdate("fullscreenchange")],
      ["ZenThemeChanged", window, () => scheduleUpdate("theme-change")]
    ];

    for (const [type, target, handler] of events) {
      target.addEventListener(type, handler, true);
      state.listeners.push([type, target, handler]);
    }

    const browsers = window.gBrowser?.browsers || [];
    for (const browser of browsers) {
      ensureFrameScript(browser);
      attachMessageListener(browser);
    }

    observeBoostButton();
    scheduleUpdate("init");
  }

  function cleanup() {
    state.boostObserver?.disconnect?.();
    state.boostObserver = null;

    for (const [type, target, handler] of state.listeners) {
      try {
        target.removeEventListener(type, handler, true);
      } catch {}
    }
    state.listeners.length = 0;

    const browsers = window.gBrowser?.browsers || [];
    for (const browser of browsers) {
      cleanupBrowser(browser);
    }
  }

  window.addEventListener("unload", cleanup, { once: true });
  if (document.readyState === "complete" || document.readyState === "interactive") {
    onLoad();
  } else {
    window.addEventListener("DOMContentLoaded", onLoad, { once: true });
  }

})();
