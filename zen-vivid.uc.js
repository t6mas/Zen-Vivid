// ==UserScript==
// @name           Zen-Vivid
// @description    Dynamic toolbar & sidebar coloring
// @version        2.0.0
// ==/UserScript==

(() => {
  'use strict';

  // ──────────────────────── Inicialización segura de servicios ────────────────────────
  let Services;
  try {
    if (typeof Services !== 'undefined') {
      // Ya está en el ámbito
    } else {
      Services = ChromeUtils.importESModule('resource://gre/modules/Services.sys.mjs').Services;
    }
  } catch (e) {
    console.error('[Zen-Vivid] No se pudo cargar Services:', e);
    return;
  }

  // ──────────────────────── Constantes ────────────────────────
  const FRAME_SCRIPT_URL = 'chrome://zen-vivid/content/frame.js';
  const MESSAGE_NAME = 'zen-vivid:color';
  const PREF_BRANCH = 'uc.zen-vivid.';

  const PREFS = {
    enabled: PREF_BRANCH + 'enabled',
    colorToolbar: PREF_BRANCH + 'color-toolbar',
    colorSidebar: PREF_BRANCH + 'color-sidebar',
    tintEnabled: PREF_BRANCH + 'tint.enabled',
    tintStrength: PREF_BRANCH + 'tint.strength'
  };

  const DEFAULTS = {
    enabled: true,
    colorToolbar: true,
    colorSidebar: true,
    tintEnabled: false,
    tintStrength: 25
  };

  let settings = { ...DEFAULTS };
  const colorsByBrowser = new WeakMap();
  let activeBrowser = null;

  // ──────────────────────── Funciones de preferencias ────────────────────────
  function loadSettings() {
    for (const [key, defaultValue] of Object.entries(DEFAULTS)) {
      const prefName = PREFS[key] || `${PREF_BRANCH}${key}`;
      try {
        if (typeof defaultValue === 'boolean') {
          settings[key] = Services.prefs.getBoolPref(prefName, defaultValue);
        } else if (typeof defaultValue === 'number') {
          settings[key] = Services.prefs.getIntPref(prefName, defaultValue);
        }
      } catch (_) {
        settings[key] = defaultValue;
      }
    }
    if (settings.tintStrength < 0 || settings.tintStrength > 100) settings.tintStrength = 25;
  }

  function onPrefChange(subject, topic, data) {
    if (topic !== 'nsPref:changed') return;
    const changedPref = data;
    if (Object.values(PREFS).includes(changedPref)) {
      loadSettings();
      applyColorToUI(colorsByBrowser.get(activeBrowser));
    }
  }

  Services.prefs.addObserver(PREF_BRANCH, onPrefChange);

  // ──────────────────────── Aplicación visual ────────────────────────
  function applyColorToUI(color) {
    const root = document.documentElement.style;

    if (!settings.enabled || !color) {
      root.removeProperty('--zen-vivid-toolbar-bg');
      root.removeProperty('--zen-vivid-toolbar-fg');
      root.removeProperty('--zen-vivid-sidebar-bg');
      root.removeProperty('--zen-vivid-sidebar-fg');
      root.removeProperty('--zen-tab-header-background');
      root.removeProperty('--zen-tab-header-foreground');
      root.removeProperty('--zen-vivid-window-tint');
      return;
    }

    if (settings.colorToolbar) {
      root.setProperty('--zen-vivid-toolbar-bg', color.bg, 'important');
      root.setProperty('--zen-vivid-toolbar-fg', color.fg, 'important');
    } else {
      root.removeProperty('--zen-vivid-toolbar-bg');
      root.removeProperty('--zen-vivid-toolbar-fg');
    }

    if (settings.colorSidebar) {
      root.setProperty('--zen-vivid-sidebar-bg', color.bg, 'important');
      root.setProperty('--zen-vivid-sidebar-fg', color.fg, 'important');
      // Compatibilidad con el sidebar que ya tienes
      root.setProperty('--zen-tab-header-background', color.bg, 'important');
      root.setProperty('--zen-tab-header-foreground', color.fg, 'important');
    } else {
      root.removeProperty('--zen-vivid-sidebar-bg');
      root.removeProperty('--zen-vivid-sidebar-fg');
      root.removeProperty('--zen-tab-header-background');
      root.removeProperty('--zen-tab-header-foreground');
    }

    if (settings.tintEnabled) {
      const tint = `color-mix(in srgb, ${color.bg} ${settings.tintStrength}%, transparent)`;
      root.setProperty('--zen-vivid-window-tint', tint, 'important');
    } else {
      root.removeProperty('--zen-vivid-window-tint');
    }
  }

  // ──────────────────────── Comunicación con los frames ────────────────────────
  function handleMessage(message) {
    if (message.name !== MESSAGE_NAME || message.target !== message.data.browser) return;
    const browser = message.target;
    const color = message.data.color;
    colorsByBrowser.set(browser, color);
    if (browser === activeBrowser) {
      applyColorToUI(color);
    }
  }

  function requestColor(browser) {
    if (!browser || !browser.messageManager) return;
    browser.messageManager.sendAsyncMessage('zen-vivid:request-color');
  }

  function injectFrameScript(browser) {
    if (!browser || !browser.messageManager) return;
    if (browser.__zenVividInjected) return;
    browser.__zenVividInjected = true;

    try {
      browser.messageManager.loadFrameScript(FRAME_SCRIPT_URL, false);
      browser.messageManager.addMessageListener(MESSAGE_NAME, handleMessage);
    } catch (e) {
      console.error('[Zen-Vivid] Error al inyectar frame script:', e);
      browser.__zenVividInjected = false;
    }
  }

  // ──────────────────────── Gestión de pestañas ────────────────────────
  function onTabSelect(event) {
    const browser = event.target.linkedBrowser || gBrowser.selectedBrowser;
    if (!browser) return;
    activeBrowser = browser;
    injectFrameScript(browser);
    // Forzar una actualización inmediata
    requestColor(browser);
    // Restaurar el color si ya lo teníamos cacheado
    const cached = colorsByBrowser.get(browser);
    if (cached) applyColorToUI(cached);
  }

  function hookNewTabs() {
    const originalAddTab = gBrowser.addTab;
    gBrowser.addTab = function(...args) {
      const tab = originalAddTab.apply(this, args);
      const browser = gBrowser.getBrowserForTab(tab);
      injectFrameScript(browser);
      // No enviamos requestColor aquí, se hará al seleccionar la pestaña
      return tab;
    };
  }

  // ──────────────────────── Arranque ────────────────────────
  function init() {
    if (typeof gBrowser === 'undefined' || !gBrowser) {
      setTimeout(init, 300);
      return;
    }

    loadSettings();
    hookNewTabs();

    // Inyectar en todas las pestañas existentes
    const tabs = gBrowser.tabs;
    for (let i = 0; i < tabs.length; i++) {
      const browser = gBrowser.getBrowserForTab(tabs[i]);
      injectFrameScript(browser);
    }

    // Pestaña activa inicial
    activeBrowser = gBrowser.selectedBrowser;
    injectFrameScript(activeBrowser);
    requestColor(activeBrowser);

    gBrowser.tabContainer.addEventListener('TabSelect', onTabSelect);
  }

  // ──────────────────────── Limpieza (unload) ────────────────────────
  window.addEventListener('unload', () => {
    Services.prefs.removeObserver(PREF_BRANCH, onPrefChange);
    gBrowser.tabContainer.removeEventListener('TabSelect', onTabSelect);
    for (let i = 0; i < gBrowser.tabs.length; i++) {
      const browser = gBrowser.getBrowserForTab(gBrowser.tabs[i]);
      if (browser.messageManager) {
        browser.messageManager.removeMessageListener(MESSAGE_NAME, handleMessage);
      }
    }
    document.documentElement.style.removeProperty('--zen-vivid-toolbar-bg');
    document.documentElement.style.removeProperty('--zen-vivid-toolbar-fg');
    document.documentElement.style.removeProperty('--zen-vivid-sidebar-bg');
    document.documentElement.style.removeProperty('--zen-vivid-sidebar-fg');
    document.documentElement.style.removeProperty('--zen-tab-header-background');
    document.documentElement.style.removeProperty('--zen-tab-header-foreground');
    document.documentElement.style.removeProperty('--zen-vivid-window-tint');
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();