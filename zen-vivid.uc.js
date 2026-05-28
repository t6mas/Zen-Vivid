// ==UserScript==
// @name           Zen Vivid Engine V1.1
// @description    Motor unificado para leer scroll, colores y Boosts.
// ==/UserScript==

(() => {
  'use strict';

  const chromeDoc = document;

  // EL ESPÍA: Este código se inyecta directamente en la página web
  const frameScript = `
    (() => {
      if (content.__zen_vivid_inited) return;
      content.__zen_vivid_inited = true;
      let scrollTimeout;

      // Decide si usar texto oscuro o claro
      function getReadableTextColor(rgbString) {
        const match = rgbString.match(/\\d+/g);
        if (!match || match.length < 3) return 'currentColor';
        const r = parseInt(match[0]), g = parseInt(match[1]), b = parseInt(match[2]);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        // Usa los colores recomendados de Zen para legibilidad
        return luminance > 0.55 ? 'rgba(11, 13, 16, 0.92)' : 'rgba(245, 247, 251, 0.96)';
      }

      function extractTopColor() {
        try {
          const x = Math.floor(content.innerWidth / 2);
          const y = 5; // Leer casi pegado al borde superior
          let element = content.document.elementFromPoint(x, y);
          let bgColor = 'transparent';

          // Subir por los elementos si son transparentes
          while (element && element !== content.document.body && element !== content.document.documentElement) {
            const style = content.getComputedStyle(element);
            if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
              bgColor = style.backgroundColor;
              break;
            }
            element = element.parentElement;
          }

          // Fallback: Si todo es transparente, usar el fondo del body o html
          if (bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)') {
            const bodyStyle = content.getComputedStyle(content.document.body);
            const rootStyle = content.getComputedStyle(content.document.documentElement);
            bgColor = bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)' ? bodyStyle.backgroundColor : rootStyle.backgroundColor;
          }

          if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
            sendAsyncMessage('zen-vivid:color-update', { bg: bgColor, fg: getReadableTextColor(bgColor) });
          }
        } catch (e) {}
      }

      // Reaccionar al scroll
      content.addEventListener('scroll', () => {
        content.clearTimeout(scrollTimeout);
        scrollTimeout = content.setTimeout(extractTopColor, 80);
      }, { passive: true });

      // Reaccionar a cambios en el DOM (como cuando activas un Boost)
      const observer = new content.MutationObserver(() => {
        content.clearTimeout(scrollTimeout);
        scrollTimeout = content.setTimeout(extractTopColor, 150);
      });
      
      if (content.document.documentElement) {
        observer.observe(content.document.documentElement, { attributes: true, childList: true, subtree: true });
        extractTopColor();
      }
    })();
  `;

  // Convertimos el espía en una ruta de datos segura
  const frameScriptUrl = 'data:application/javascript;charset=utf-8,' + encodeURIComponent(frameScript);

  // Escribimos las variables NATIVAS de Zen Browser
  function applyColors(bg, fg) {
    const rootStyle = chromeDoc.documentElement.style;
    if (bg) {
      rootStyle.setProperty('--zen-tab-header-background', bg, 'important');
      rootStyle.setProperty('--zen-tab-header-foreground', fg, 'important');
    }
  }

  // Recibir los mensajes desde la página
  const messageListener = {
    receiveMessage(message) {
      if (message.name === 'zen-vivid:color-update') {
        applyColors(message.data.bg, message.data.fg);
      }
    }
  };

  // Función para inyectar el espía usando el MessageManager nativo
  function injectIntoTab(browser) {
    const mm = browser?.messageManager || browser?.frameLoader?.messageManager;
    if (!mm) return;
    try {
      mm.addMessageListener('zen-vivid:color-update', messageListener);
      mm.loadFrameScript(frameScriptUrl, false);
    } catch (e) {}
  }

  // Detectar el botón de "Boost" de Zen
  function observeBoosts() {
    const boostButton = chromeDoc.getElementById('zen-site-data-icon-button');
    if (!boostButton) {
      setTimeout(observeBoosts, 1000);
      return;
    }
    const observer = new MutationObserver(() => {
      injectIntoTab(gBrowser.selectedBrowser);
    });
    observer.observe(boostButton, { attributes: true, attributeFilter: ['boosting'] });
  }

  // Inicializar
  function init() {
    if (typeof gBrowser === 'undefined') {
      setTimeout(init, 500);
      return;
    }

    observeBoosts();

    // Cuando cambias de pestaña
    gBrowser.tabContainer.addEventListener('TabSelect', () => {
      injectIntoTab(gBrowser.selectedBrowser);
    });

    // Cuando la página termina de cargar
    gBrowser.addTabsProgressListener({
      onStateChange(browser, webProgress, req, flags) {
        const isStop = flags & Ci.nsIWebProgressListener.STATE_STOP;
        if (isStop && browser === gBrowser.selectedBrowser) {
          injectIntoTab(browser);
        }
      }
    });

    // Inyectar en la pestaña actual al arrancar
    injectIntoTab(gBrowser.selectedBrowser);
  }

  init();
})();