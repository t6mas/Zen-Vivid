// ==UserScript==
// @name           Zen Vivid Engine
// @description    Motor que gestiona los colores dinámicos y los Boosts
// ==/UserScript==

(() => {
  'use strict';

  const chromeDoc = document;
  const frameScriptUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(`
    // Carga el script de la página
    Services.scriptloader.loadSubScript('chrome://sine/content/zen-vivid-dynamic-theme/frame.js', this);
  `);

  // Aplicar colores recibidos
  function applyColors(bg, fg) {
    const rootStyle = chromeDoc.documentElement.style;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      rootStyle.setProperty('--zen-vivid-bg', bg);
      rootStyle.setProperty('--zen-vivid-fg', fg);
    } else {
      rootStyle.removeProperty('--zen-vivid-bg');
      rootStyle.removeProperty('--zen-vivid-fg');
    }
  }

  // Leer opciones de velocidad del engranaje
  function updatePreferences() {
    try {
      const speed = Services.prefs.getStringPref('uc.zen-vivid.transition.speed', '0.3s');
      chromeDoc.documentElement.style.setProperty('--zen-vivid-transition', speed + ' ease');
    } catch (e) {}
  }

  // Escuchar a la página web
  const messageListener = {
    receiveMessage(message) {
      if (message.name === 'zen-vivid:color-update') {
        applyColors(message.data.bg, message.data.fg);
      }
    }
  };

  // Inyectar el espía en las pestañas
  function injectIntoTab(browser) {
    if (!browser || !browser.messageManager) return;
    try {
      browser.messageManager.addMessageListener('zen-vivid:color-update', messageListener);
      browser.messageManager.loadFrameScript('chrome://sine/content/zen-vivid-dynamic-theme/frame.js', false);
    } catch (e) {}
  }

  // Vigilar los Zen Boosts
  function observeBoosts() {
    const boostButton = chromeDoc.getElementById('zen-site-data-icon-button');
    if (!boostButton) return;

    const observer = new MutationObserver(() => {
      // Si el usuario activa/desactiva un Boost, forzamos al frame a re-leer la pantalla
      const browser = gBrowser.selectedBrowser;
      injectIntoTab(browser); 
    });
    observer.observe(boostButton, { attributes: true, attributeFilter: ['boosting'] });
  }

  // Iniciar todo
  function init() {
    if (typeof gBrowser === 'undefined') {
      setTimeout(init, 500);
      return;
    }

    updatePreferences();
    observeBoosts();

    // Cuando cambiamos de pestaña, inyectar el script
    gBrowser.tabContainer.addEventListener('TabSelect', () => {
      const browser = gBrowser.selectedBrowser;
      injectIntoTab(browser);
    });

    // Vigilar si el usuario cambia las opciones en el engranaje
    Services.prefs.addObserver('uc.zen-vivid.', {
      observe() { updatePreferences(); }
    });

    // Inyectar en la pestaña actual al abrir el navegador
    injectIntoTab(gBrowser.selectedBrowser);
  }

  init();
})();