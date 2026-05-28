(() => {
  "use strict";

  const MESSAGE_NAME = "zen-vivid:sample";
  const SAMPLE_SIZE = 4;
  const SAMPLE_ROWS = [2, 8, 16, 28];
  const SAMPLE_XS = [0.12, 0.5, 0.88];
  const MAX_ANCESTORS = 10;

  if (content.__zenVividFrameInited) {
    try {
      content.__zenVividFrameSample?.("reload");
    } catch {}
    return;
  }

  content.__zenVividFrameInited = true;

  let canvas = null;
  let ctx = null;
  let scheduled = 0;
  let lastKey = "";
  let pendingReason = "init";
  let pendingFlags = {
    followScroll: true,
    useThemeColorFallback: true,
    boostsEnabled: true
  };

  function ensureCanvas() {
    if (canvas && ctx) return true;
    try {
      canvas = content.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = SAMPLE_SIZE;
      canvas.height = SAMPLE_SIZE;
      ctx = canvas.getContext("2d", { willReadFrequently: true });
      return !!ctx;
    } catch {
      canvas = null;
      ctx = null;
      return false;
    }
  }

  function parseRgb(color) {
    const match = String(color || "").match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
    if (!match) return null;
    const r = Number(match[1]);
    const g = Number(match[2]);
    const b = Number(match[3]);
    if (![r, g, b].every(Number.isFinite)) return null;
    return { r, g, b };
  }

  function isTransparent(color) {
    const raw = String(color || "").trim().toLowerCase();
    return (
      !raw ||
      raw === "transparent" ||
      raw === "rgba(0, 0, 0, 0)" ||
      raw === "rgba(0,0,0,0)" ||
      raw === "rgb(0 0 0 / 0)"
    );
  }

  function normalizeColor(color) {
    if (!color) return null;
    try {
      if (!ensureCanvas()) return String(color).trim();
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "rgba(0,0,0,0)";
      ctx.fillStyle = String(color).trim();
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      if (data[3] === 0) return null;
      return `rgb(${data[0]}, ${data[1]}, ${data[2]})`;
    } catch {
      return null;
    }
  }

  function readableForeground(bg) {
    const rgb = parseRgb(bg);
    if (!rgb) return "rgba(248, 250, 252, 0.96)";
    const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
    return luminance > 0.56 ? "rgba(14, 18, 24, 0.92)" : "rgba(248, 250, 252, 0.96)";
  }

  function readThemeColorMeta(doc) {
    const metas = doc.querySelectorAll?.('meta[name="theme-color" i]') || [];
    let fallback = null;

    for (const meta of metas) {
      const content = meta.getAttribute?.("content") || "";
      if (!content) continue;

      const media = meta.getAttribute?.("media") || "";
      if (!media) {
        fallback ||= content;
        continue;
      }

      try {
        if (content && content.trim() && content.matchMedia?.(media)?.matches) {
          return content;
        }
      } catch {}
    }

    return fallback;
  }

  function samplePixelColor() {
    try {
      if (!ensureCanvas() || !ctx?.drawWindow) return null;
      const width = Math.max(1, content.innerWidth | 0);
      const height = Math.max(1, content.innerHeight | 0);
      const samples = [];

      for (const row of SAMPLE_ROWS) {
        const y = Math.max(0, Math.min(row, height - SAMPLE_SIZE));
        for (const xFactor of SAMPLE_XS) {
          const x = Math.max(0, Math.min(Math.floor(width * xFactor) - Math.floor(SAMPLE_SIZE / 2), width - SAMPLE_SIZE));
          ctx.clearRect(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
          ctx.drawWindow(content, x, y, SAMPLE_SIZE, SAMPLE_SIZE, "transparent");
          const data = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
          let r = 0, g = 0, b = 0, n = 0;

          for (let i = 0; i < data.length; i += 4) {
            if (data[i + 3] === 0) continue;
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            n++;
          }

          if (n) {
            samples.push({
              r: Math.round(r / n),
              g: Math.round(g / n),
              b: Math.round(b / n)
            });
          }
        }
      }

      if (!samples.length) return null;
      const r = Math.round(samples.reduce((sum, s) => sum + s.r, 0) / samples.length);
      const g = Math.round(samples.reduce((sum, s) => sum + s.g, 0) / samples.length);
      const b = Math.round(samples.reduce((sum, s) => sum + s.b, 0) / samples.length);
      return `rgb(${r}, ${g}, ${b})`;
    } catch {
      return null;
    }
  }

  function elementBackground(view, element) {
    if (!view || !element) return null;
    try {
      const style = view.getComputedStyle(element);
      if (style.backgroundImage && style.backgroundImage !== "none") {
        // A rendered gradient/image is still valid, but the pixel sampler is
        // better at extracting the visible colour, so keep walking up.
      }
      if (!isTransparent(style.backgroundColor)) return style.backgroundColor;
    } catch {}
    return null;
  }

  function topVisibleBackground(view, doc) {
    const width = Math.max(1, content.innerWidth | 0);
    for (const y of SAMPLE_ROWS) {
      for (const xFactor of SAMPLE_XS) {
        const x = Math.max(1, Math.min(width - 2, Math.floor(width * xFactor)));
        let element = null;
        try {
          element = doc.elementsFromPoint?.(x, y)?.[0] || doc.elementFromPoint?.(x, y) || null;
        } catch {}
        for (let step = 0; element && step < MAX_ANCESTORS; step++, element = element.parentElement) {
          const bg = elementBackground(view, element);
          if (bg) return bg;
        }
      }
    }
    return null;
  }

  function detectTheme() {
    const doc = content.document;
    const view = doc?.defaultView;
    if (!doc || !view) {
      return { bg: null, fg: null, source: "unavailable" };
    }

    const domBg = topVisibleBackground(view, doc);
    if (domBg) {
      const normalized = normalizeColor(domBg);
      if (normalized) {
        return { bg: normalized, fg: readableForeground(normalized), source: "top-visible" };
      }
    }

    const pixelBg = samplePixelColor();
    if (pixelBg) {
      return { bg: pixelBg, fg: readableForeground(pixelBg), source: "pixel-top-edge" };
    }

    if (pendingFlags.useThemeColorFallback) {
      const metaBg = readThemeColorMeta(doc);
      const normalized = normalizeColor(metaBg);
      if (normalized) {
        return { bg: normalized, fg: readableForeground(normalized), source: "theme-color" };
      }
    }

    try {
      const bodyBg = normalizeColor(view.getComputedStyle(doc.body || doc.documentElement).backgroundColor);
      if (bodyBg) {
        return { bg: bodyBg, fg: readableForeground(bodyBg), source: doc.body ? "body" : "html" };
      }
    } catch {}

    return { bg: null, fg: null, source: "unavailable" };
  }

  function emit(reason = pendingReason) {
    scheduled = 0;
    const href = String(content?.location?.href || "");
    const theme = detectTheme();
    if (!theme.bg) return;

    const payload = {
      href,
      bg: theme.bg,
      fg: theme.fg || readableForeground(theme.bg),
      source: theme.source,
      reason,
      boostsEnabled: pendingFlags.boostsEnabled
    };

    const key = `${payload.href}::${payload.bg}::${payload.fg}::${payload.source}`;
    if (key === lastKey) return;
    lastKey = key;

    try {
      sendAsyncMessage(MESSAGE_NAME, payload);
    } catch {}
  }

  function schedule(reason = "event") {
    pendingReason = reason;
    if (scheduled) return;
    scheduled = content.requestAnimationFrame(() => {
      scheduled = 0;
      emit(reason);
    });
  }

  function onMessage(message) {
    const data = message?.data || {};
    pendingFlags = {
      followScroll: data.followScroll !== false,
      useThemeColorFallback: data.useThemeColorFallback !== false,
      boostsEnabled: data.boostsEnabled !== false
    };
    schedule(data.reason || "message");
  }

  function init() {
    addMessageListener(MESSAGE_NAME, onMessage);

    const doc = content.document;
    const win = content;

    const listeners = [
      ["scroll", win, () => pendingFlags.followScroll && schedule("scroll")],
      ["resize", win, () => schedule("resize")],
      ["pageshow", win, () => schedule("pageshow")],
      ["load", win, () => schedule("load")],
      ["DOMContentLoaded", win, () => schedule("domcontentloaded")],
      ["visibilitychange", doc, () => schedule("visibilitychange")],
      ["transitionend", doc, () => schedule("transitionend")],
      ["animationend", doc, () => schedule("animationend")]
    ];

    for (const [type, target, handler] of listeners) {
      try {
        target.addEventListener(type, handler, { passive: true, capture: true });
      } catch {}
    }

    try {
      const observer = new MutationObserver(() => schedule("mutation"));
      observer.observe(doc.documentElement || doc, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ["style", "class", "data-theme", "data-color-scheme", "theme"]
      });
    } catch {}

    content.__zenVividFrameSample = (reason = "manual") => schedule(reason);
    schedule("init");
  }

  init();
})();
