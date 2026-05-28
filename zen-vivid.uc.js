// ==UserScript==
// @name           Zen Vivid Engine V1.2
// @description    Lee el color real renderizado de la pestaña mediante snapshots.
// ==/UserScript==

(() => {
  'use strict';

  const doc = document;
  let loopTimer;
  let lastBg = '';

  // Función matemática para saber si el texto debe ser claro u oscuro según el fondo
  function getReadableColor(r, g, b) {
    const a = [r, g, b].map(v => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    const luminance = a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
    // Tonos recomendados de Zen para máxima legibilidad
    return luminance > 0.55 ? 'rgba(11, 13, 16, 0.92)' : 'rgba(245, 247, 251, 0.96)';
  }

  async function updateColor() {
    const browser = gBrowser.selectedBrowser;
    
    // Si no hay pestaña activa o está cargando, reintentamos en un rato
    if (!browser || !browser.browsingContext || !browser.browsingContext.currentWindowGlobal) {
      scheduleNext();
      return;
    }

    try {
      const wg = browser.browsingContext.currentWindowGlobal;
      const width = browser.clientWidth || 1000;
      
      // Tomamos 1 solo píxel en el centro exacto, 5 píxeles por debajo de la barra
      const rect = new DOMRect(Math.floor(width / 2), 5, 1, 1);
      
      // Tomamos la captura real
      const bitmap = await wg.drawSnapshot(rect, 1, "transparent");
      
      // Lo dibujamos en un canvas invisible para leer el color
      const canvas = doc.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      bitmap.close(); // Limpiamos memoria
      
      const data = ctx.getImageData(0, 0, 1, 1).data;
      
      // Si el píxel no es transparente (alpha > 0)
      if (data[3] > 0) {
        const bg = `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
        
        // Solo inyectamos CSS si el color cambió, para no saturar los recursos de tu PC
        if (bg !== lastBg) {
            lastBg = bg;
            const fg = getReadableColor(data[0], data[1], data[2]);
            
            // Escribimos nuestras variables personalizadas en la raíz del navegador
            doc.documentElement.style.setProperty('--zen-vivid-bg', bg, 'important');
            doc.documentElement.style.setProperty('--zen-vivid-fg', fg, 'important');
        }
      }
    } catch (e) {
      // Ignoramos errores de páginas internas (como about:preferences)
    }
    
    scheduleNext();
  }

  function scheduleNext() {
    clearTimeout(loopTimer);
    // Ejecutamos la lectura cada 150ms. Esto crea la sensación de cambio instantáneo al scrollear
    loopTimer = setTimeout(updateColor, 150);
  }

  function init() {
    if (typeof gBrowser === 'undefined') {
      setTimeout(init, 500);
      return;
    }
    updateColor();
  }

  init();
})();