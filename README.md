# Zen Vivid

Blends your **addressbar** and **sidebar** with the actual rendered color at the very top of any page — including colors set by **Zen Boosts**.

## How it works

Zen Vivid reads the real rendered pixels right below the addressbar using `drawWindow()`. This means:

- It captures **whatever is actually visible** — no guessing from CSS declarations
- It works with **Zen Boosts** color tints, since those modify rendered output
- It **updates as you scroll** — if the page background changes when you scroll down, the UI color follows
- It falls back gracefully: if pixels can't be read, it tries `<meta name="theme-color">`, then `body`/`html` background colors

## Features

- **Addressbar coloring** — toolbar, title bar, notifications bar
- **Sidebar coloring** — all sidebar elements, icons, tabs, separators
- **Scroll-aware** — color updates within ~160ms of the page background changing
- **Boost-aware** — instantly re-samples when you activate or deactivate a Boost
- **Optional window tint** — apply a light tint to the content area
- **Configurable transition speed** — from instant to 2 seconds

## Settings

Open Zen Mods → Zen Vivid → Settings (⚙️):

| Setting | Default | Description |
|---|---|---|
| Enable Zen Vivid | ✅ | Toggle the whole mod |
| Colorize addressbar | ✅ | Color the toolbar and title bar |
| Colorize sidebar | ✅ | Color the sidebar and its icons |
| Window tint | ☐ | Apply subtle color tint to the page background area |
| Tint strength | 18 | How strong the window tint is (0–60) |
| Transition speed | 100ms | How fast colors animate when they change |

## Compatibility

- Works with all Zen modes: **normal**, **compact**, **single-toolbar**
- Works with **vertical tabs on either side**
- Compatible with **Zen Boosts** (color detection reacts to boost activation)
- Does **not** conflict with other mods that don't also set `--zen-vivid-*` variables

## Notes

- On pages where the very top is transparent (e.g. overlapping headers), the mod falls back to the `<meta name="theme-color">` tag or the computed body background.
- Dark mode switches on a page are detected within the debounce window (~160ms) via MutationObserver.
