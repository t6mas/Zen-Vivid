// ==UserScript==
// @name           Zen-Vivid
// @description    Dynamic toolbar and sidebar coloring
// @version        1.0.0
// ==/UserScript==

(() => {
  'use strict';

  const FRAME_SCRIPT_URL = 'chrome://zen-vivid/content/frame.js';
  const MESSAGE_NAME = 'zen-vivid:color';
  const DEBOUNCE_MS = 150;

  // Preferencias
  const PREF_BRANCH = 'uc.zen-vivid.';
  const PREFS = {
    enabled: PREF_BRANCH + 'enabled',
    colorToolbar: PREF_BRANCH + 'color-toolbar',
    colorSidebar: PREF_BRANCH + 'color-sidebar',
    tintEnabled: PREF_BRANCH + 'tint.enabled',
    tintStrength: PREF_BRANCH + 'tint.strength'
  };

  const DEFAULT_SETTINGS = {
    enabled: true,
    colorToolbar: true,
    colorSidebar: true,
    tintEnabled: false,
    tintStrength: 25
  };

  let settings = { ...DEFAULT_SETTINGS };
  let lastColor = null;
  let frameScriptLoaded = false;

  // Cargar preferencias iniciales
  function loadSettings() {
    for (const [key, defaultValue] of Object.entries(DEFAULT_SETTINGS)) {
      try {
        const prefName = PREFS[key] || `${PREF_BRANCH}${key}`;
        settings[key] = Services.prefs.getBoolPref(prefName) ?? defaultValue;
      } catch {}
    }
    try {
      settings.tintStrength = Services.prefs.getIntPref(PREFS.tintStrength) ?? 25;
    } catch {}
  }

  // Guardar preferencias
  function saveSetting(key, value) {
    try {
      const prefName = PREFS[key] || `${PREF_BRANCH}${key}`;
      if (typeof value === 'boolean') {
        Services.prefs.setBoolPref(prefName, value);
      } else if (typeof value === 'number') {
        Services.prefs.setIntPref(prefName, value);
      }
    } catch (e) {
      console.error('[Zen-Vivid] Error saving setting:', key, e);
    }
  }

  // Observar cambios de preferencias (para el engranaje)
  function observePrefs() {
    const prefObserver = {
      observe(subject, topic, data) {
        if (topic !== 'nsPref:changed') return;
        const changedPref = data;
        for (const [key, prefName] of Object.entries(PREFS)) {
          if (changedPref === prefName) {
            loadSettings();
            applyCurrentColor(lastColor);
            break;
          }
        }
      }
    };
    Services.prefs.addObserver(PREF_BRANCH, prefObserver);
  }

  // Aplicar color a las variables CSS
  function applyCurrentColor(color) {
    if (!settings.enabled || !color) {
      clearColors();
      return;
    }

    const root = document.documentElement.style;
    const bg = color.bg;
    const fg = color.fg;

    // Toolbar
    if (settings.colorToolbar) {
      root.setProperty('--zen-vivid-toolbar-bg', bg, 'important');
      root.setProperty('--zen-vivid-toolbar-fg', fg, 'important');
    } else {
      root.removeProperty('--zen-vivid-toolbar-bg');
      root.removeProperty('--zen-vivid-toolbar-fg');
    }

    // Sidebar (mantenemos compatibilidad con las variables que usa tu sidebar)
    if (settings.colorSidebar) {
      root.setProperty('--zen-vivid-sidebar-bg', bg, 'important');
      root.setProperty('--zen-vivid-sidebar-fg', fg, 'important');
      // Compatibilidad con blended-sidebar
      root.setProperty('--zen-tab-header-background', bg, 'important');
      root.setProperty('--zen-tab-header-foreground', fg, 'important');
    } else {
      root.removeProperty('--zen-vivid-sidebar-bg');
      root.removeProperty('--zen-vivid-sidebar-fg');
      root.removeProperty('--zen-tab-header-background');
      root.removeProperty('--zen-tab-header-foreground');
    }

    // Tinte de ventana (opcional)
    if (settings.tintEnabled) {
      const strength = settings.tintStrength / 100;
      const tint = `color-mix(in srgb, ${bg} ${settings.tintStrength}%, transparent)`;
      root.setProperty('--zen-vivid-window-tint', tint, 'important');
    } else {
      root.removeProperty('--zen-vivid-window-tint');
    }
  }

  function clearColors() {
    const root = document.documentElement.style;
    root.removeProperty('--zen-vivid-toolbar-bg');
    root.removeProperty('--zen-vivid-toolbar-fg');
    root.removeProperty('--zen-vivid-sidebar-bg');
    root.removeProperty('--zen-vivid-sidebar-fg');
    root.removeProperty('--zen-tab-header-background');
    root.removeProperty('--zen-tab-header-foreground');
    root.removeProperty('--zen-vivid-window-tint');
  }

  // Recibir color del frame script
  function handleMessage(message) {
    if (message.name !== MESSAGE_NAME) return;
    const color = message.data;
    lastColor = color;
    applyCurrentColor(color);
  }

  // Inyectar frame script en una pestaña
  function injectFrameScript(browser) {
    if (!browser || !browser.messageManager) return;
    try {
      browser.messageManager.loadFrameScript(FRAME_SCRIPT_URL, false);
      browser.messageManager.addMessageListener(MESSAGE_NAME, handleMessage);
    } catch (e) {
      console.error('[Zen-Vivid] Failed to load frame script:', e);
    }
  }

  // Gestionar pestañas
  function onTabSelect() {
    const browser = gBrowser.selectedBrowser;
    if (browser) {
      injectFrameScript(browser);
      // Forzar un refresco de color al cambiar de pestaña
      if (browser.messageManager) {
        browser.messageManager.sendAsyncMessage('zen-vivid:request-color');
      }
    }
  }

  function init() {
    if (typeof gBrowser === 'undefined' || !gBrowser) {
      setTimeout(init, 500);
      return;
    }

    loadSettings();
    observePrefs();

    // Inyectar en la pestaña actual y futuras
    gBrowser.tabContainer.addEventListener('TabSelect', onTabSelect);
    window.addEventListener('unload', () => {
      gBrowser.tabContainer.removeEventListener('TabSelect', onTabSelect);
      clearColors();
    });

    // Inyectar en todas las pestañas existentes
    for (let i = 0; i < gBrowser.tabs.length; i++) {
      const browser = gBrowser.getBrowserForTab(gBrowser.tabs[i]);
      injectFrameScript(browser);
    }

    // También inyectar cuando se crea una nueva pestaña
    const originalAddTab = gBrowser.addTab;
    gBrowser.addTab = function(...args) {
      const tab = originalAddTab.apply(this, args);
      const browser = gBrowser.getBrowserForTab(tab);
      injectFrameScript(browser);
      return tab;
    };

    // Pestaña activa inicial
    onTabSelect();
  }

  // Esperar a que el entorno esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();