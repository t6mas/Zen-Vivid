(() => {
  'use strict';
  
  // Evitar inyectar múltiples veces
  if (content.__zen_vivid_inited) return;
  content.__zen_vivid_inited = true;

  let scrollTimeout;

  // Función matemática para saber si un fondo necesita texto blanco o negro
  function getReadableTextColor(rgbString) {
    const match = rgbString.match(/\d+/g);
    if (!match || match.length < 3) return 'currentColor';
    const r = parseInt(match[0]), g = parseInt(match[1]), b = parseInt(match[2]);
    // Fórmula de luminancia relativa
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.55 ? '#1a1a1a' : '#f5f5f5';
  }

  // Extraer el color del primer elemento visible debajo de la barra
  function extractTopColor() {
    try {
      const x = Math.floor(content.innerWidth / 2); // Centro de la pantalla
      const y = 5; // A 5 píxeles desde arriba
      
      let element = content.document.elementFromPoint(x, y);
      let bgColor = 'transparent';

      // Buscar hacia arriba en el código si el elemento es transparente
      while (element && element !== content.document.body) {
        const style = content.getComputedStyle(element);
        if (style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent') {
          bgColor = style.backgroundColor;
          break;
        }
        element = element.parentElement;
      }

      // Si no encontró nada, usar el color del fondo de la página
      if (bgColor === 'transparent' || bgColor === 'rgba(0, 0, 0, 0)') {
        bgColor = content.getComputedStyle(content.document.body).backgroundColor;
      }

      const fgColor = getReadableTextColor(bgColor);

      // Enviar el color al navegador
      sendAsyncMessage('zen-vivid:color-update', { bg: bgColor, fg: fgColor });
    } catch (e) {
      // Ignorar errores silenciosamente
    }
  }

  // Vigilar el Scroll
  content.addEventListener('scroll', () => {
    content.clearTimeout(scrollTimeout);
    scrollTimeout = content.setTimeout(extractTopColor, 50); // Pequeña pausa para rendimiento
  }, { passive: true });

  // Vigilar cambios en la página (Ideal para Zen Boosts que inyectan CSS)
  const observer = new content.MutationObserver(() => {
    content.clearTimeout(scrollTimeout);
    scrollTimeout = content.setTimeout(extractTopColor, 100);
  });
  
  if (content.document.body) {
    observer.observe(content.document.body, { attributes: true, childList: true, subtree: true });
    extractTopColor(); // Ejecutar la primera vez
  }
})();