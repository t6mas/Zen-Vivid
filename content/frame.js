// ──────────────────────── Frame script ────────────────────────
const DEBOUNCE_MS = 150;
let lastColor = null;
let debounceTimer = null;

// ── Utilidades de color ──
function parseRgb(str) {
  const m = str.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : null;
}

function luminance(rgb) {
  const toLinear = c => (c / 255) <= 0.03928 ? (c / 255) / 12.92 : Math.pow((c / 255 + 0.055) / 1.055, 2.4);
  return 0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b);
}

function foregroundForBg(bgColor) {
  const rgb = parseRgb(bgColor);
  if (!rgb) return '#000000';
  const lum = luminance(rgb);
  return lum > 0.6 ? 'rgba(11, 13, 16, 0.92)' : 'rgba(245, 247, 251, 0.96)';
}

function hasVisibleColor(color) {
  if (!color || color === 'transparent') return false;
  const m = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/);
  if (m) {
    return parseFloat(m[4]) > 0.08;
  }
  return true; // no es rgba, asumimos visible
}

// ── Muestreo del color superior visible ──
function getTopColor() {
  const doc = content.document;
  const view = doc.defaultView;
  const width = view.innerWidth;
  const height = view.innerHeight;
  if (width <= 0 || height <= 0) return null;

  // Puntos de muestreo: centro horizontal, y=1px; además un punto auxiliar
  const xMid = Math.floor(width / 2);
  const yTop = 1;
  let element = doc.elementFromPoint(xMid, yTop);
  if (!element) element = doc.body || doc.documentElement;

  // Subir por ancestros buscando fondo visible
  let bg = null;
  let fg = null;
  let current = element;
  const visited = new Set();
  while (current) {
    if (visited.has(current)) break;
    visited.add(current);
    const style = view.getComputedStyle(current);
    const bgImage = style.backgroundImage;
    const bgColor = style.backgroundColor;

    // Preferir color de fondo sólido
    if (hasVisibleColor(bgColor)) {
      bg = bgColor;
      fg = style.color;
      break;
    }

    // Si hay imagen/gradiente, intentar extraer un color promedio con canvas
    if (bgImage && bgImage !== 'none') {
      const tempCanvas = doc.createElementNS('http://www.w3.org/1999/xhtml', 'canvas');
      tempCanvas.width = 1; tempCanvas.height = 1;
      const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = bgImage;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      if (a > 0) {
        bg = `rgb(${r}, ${g}, ${b})`;
        fg = style.color;
        break;
      }
    }

    current = current.parentElement;
  }

  // Fallback: body, luego documentElement
  if (!bg) {
    const bodyStyle = view.getComputedStyle(doc.body);
    if (hasVisibleColor(bodyStyle.backgroundColor)) {
      bg = bodyStyle.backgroundColor;
      fg = bodyStyle.color;
    }
  }
  if (!bg) {
    const htmlStyle = view.getComputedStyle(doc.documentElement);
    if (hasVisibleColor(htmlStyle.backgroundColor)) {
      bg = htmlStyle.backgroundColor;
      fg = htmlStyle.color;
    }
  }

  // Fallback definitivo: blanco
  if (!bg) {
    bg = '#ffffff';
    fg = '#000000';
  } else {
    // Asegurar un color de texto legible
    if (!hasVisibleColor(fg)) {
      fg = foregroundForBg(bg);
    }
  }

  return { bg, fg };
}

// ── Envío al chrome ──
function sendColor() {
  const color = getTopColor();
  if (!color) return;
  if (lastColor && lastColor.bg === color.bg && lastColor.fg === color.fg) return;
  lastColor = color;
  sendAsyncMessage('zen-vivid:color', color);
}

// ── Observación de cambios ──
addMessageListener('zen-vivid:request-color', () => {
  sendColor();
});

if (content.document.readyState === 'loading') {
  content.document.addEventListener('DOMContentLoaded', () => {
    sendColor();
    // segunda pasada por si el DOM tarda en pintarse
    content.setTimeout(sendColor, 300);
  }, { once: true });
} else {
  sendColor();
  content.setTimeout(sendColor, 300);
}

content.addEventListener('scroll', () => {
  clearTimeout(debounceTimer);
  debounceTimer = content.setTimeout(sendColor, DEBOUNCE_MS);
}, { passive: true });

// Observar cambios que puedan modificar el color sin scroll (ej. Boosts)
const observer = new content.MutationObserver(() => {
  clearTimeout(debounceTimer);
  debounceTimer = content.setTimeout(sendColor, DEBOUNCE_MS);
});
observer.observe(content.document.documentElement, {
  attributes: true,
  attributeFilter: ['class', 'style', 'data-theme', 'data-mode', 'data-color-scheme'],
  subtree: true
});