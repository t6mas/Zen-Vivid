// Frame script inyectado en cada página
const SAMPLE_Y = 1; // píxel desde el borde superior
const DEBOUNCE_MS = 150;
let lastColor = null;
let debounceTimer = null;

function getTopColor() {
  const x = content.innerWidth / 2;
  const y = Math.min(SAMPLE_Y, content.innerHeight - 1);
  let element = content.document.elementFromPoint(x, y);
  if (!element) element = content.document.body || content.document.documentElement;

  // Subir por el árbol buscando un fondo opaco
  let bg = null;
  let fg = null;
  let current = element;
  while (current) {
    const style = content.getComputedStyle(current);
    const backgroundColor = style.backgroundColor;
    if (backgroundColor && backgroundColor !== 'rgba(0, 0, 0, 0)' && backgroundColor !== 'transparent') {
      bg = backgroundColor;
      // Intentar obtener un color de texto del mismo elemento o ancestros
      fg = style.color;
      if (fg && fg !== 'rgba(0, 0, 0, 0)') break;
    }
    current = current.parentElement;
  }

  // Si no se encontró fondo, usar blanco
  if (!bg) {
    bg = '#ffffff';
    fg = '#000000';
  }

  // Asegurar que fg sea legible (cálculo simple de luminancia)
  if (!fg || fg === 'rgba(0, 0, 0, 0)') {
    const rgb = bg.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
      fg = luminance > 0.6 ? '#000000' : '#ffffff';
    } else {
      fg = '#000000';
    }
  }

  return { bg, fg };
}

function sendColor() {
  const color = getTopColor();
  // Solo enviar si cambió
  if (lastColor && lastColor.bg === color.bg && lastColor.fg === color.fg) return;
  lastColor = color;
  sendAsyncMessage('zen-vivid:color', color);
}

// Escuchar solicitud de color desde el chrome
addMessageListener('zen-vivid:request-color', () => {
  sendColor();
});

// Enviar color al cargar la página
if (content.document.readyState === 'loading') {
  content.document.addEventListener('DOMContentLoaded', sendColor, { once: true });
} else {
  sendColor();
}

// Observar scroll con debounce
content.addEventListener('scroll', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(sendColor, DEBOUNCE_MS);
}, { passive: true });

// Observar cambios en el DOM (por si un Boost modifica estilos sin scroll)
const observer = new content.MutationObserver(() => {
  sendColor();
});
observer.observe(content.document.documentElement, {
  attributes: true,
  attributeFilter: ['class', 'style', 'data-theme'],
  subtree: true
});