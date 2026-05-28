# Zen Vivid v1.1.0

Page-aware color blending for the address bar and sidebar in Zen Browser.

## What it does

- Reads the **actual rendered color** at the top of the page (a few pixels below the URL bar)
- Applies it to the **toolbar** and **sidebar** with smooth transitions
- Works with **Zen Boosts** — the sampler captures the color after Boost filters are applied
- **Scroll-aware** — if the page background changes as you scroll, the color follows
- Supports **compact mode**, **single-toolbar mode**, and **right-side sidebar**

## How it works (v1.1.0 architecture)

### Chrome-side pixel sampling
The primary color source uses `drawWindow()` directly in the chrome (privileged) context —
the same process where the uc.js script runs. This gives two key advantages:

1. It captures Boost color filters (because it reads the fully-composited rendered output)
2. It always works, regardless of the page's same-origin policy

### Zen native CSS variables
Instead of fighting Zen's own styles with `!important` everywhere,
zen-vivid sets `--zen-tab-header-background` and `--zen-tab-header-foreground`
on `:root`. Zen's own stylesheets read these variables for the toolbar,
and `style.css` uses them for the sidebar. This is the same approach
used by the official Blended Sidebar mod.

### Frame script (lightweight fallback)
A minimal frame script handles:
- CSS/meta fallback colors for pages where pixel sampling fails (e.g., new-tab page)
- Scroll events (sends a message to trigger a re-sample on the chrome side)
- Theme-attribute mutation observation (for dark/light mode switches)

## Settings (⚙️)

| Setting | Default | Description |
|---|---|---|
| Enable Zen Vivid | ✅ | Master toggle |
| Colorize address bar | ✅ | Apply color to the toolbar/navbar |
| Colorize sidebar | ✅ | Apply color to the sidebar |
| Window tint | ❌ | Subtle tint over the content area |
| Tint strength | 18% | Intensity when window tint is on |
| Transition speed | 100ms | How fast the color animation is |

## Installation

1. Place `zen-vivid.uc.js` in your `chrome/` folder (or use a mod manager)
2. Place `style.css` where your mod manager can load it (or `@import` it from `userChrome.css`)
3. Restart Zen Browser
4. Open the mod settings panel (⚙️) to configure

## Changelog

### v1.1.0
- **Fix**: Pixel sampling now runs from chrome context using `drawWindow()` —
  this was the root cause of the v1.0.0 failure (data: URL frame scripts lack chrome privileges)
- **Fix**: Now sets Zen's native CSS variables (`--zen-tab-header-background`,
  `--zen-tab-header-foreground`) instead of custom ones, so all UI elements
  pick up the color correctly without fighting Zen's own styles
- Sidebar CSS rewritten to match Blended Sidebar's proven approach
- Frame script is now lightweight (scroll events + CSS fallback only)

### v1.0.0
- Initial release
