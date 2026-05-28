# Zen Vivid

Zen Vivid samples the first visible color near the top of the webpage, then tints Zen's address bar and sidebar to match it.

## What it does

- Follows the visible color while you scroll.
- Uses a rendered top-edge sample first, so Zen Boosts are reflected naturally.
- Falls back to `theme-color`, body, or document colors when needed.
- Tints the top chrome, sidebar surfaces, splitters, and common toolbar icons.
- Includes Sine preferences, so Zen shows a settings section for the mod.

## Notes

Boosts in Zen were added in 1.20b and let you tint colors, customize fonts and styles, zap elements, and enable automatic dark mode on websites. This mod is built to follow the rendered page, not just the raw HTML color hints.

## Installation

Copy the folder into Sine's mod directory or install it through the Sine mods screen after adding the repository.

## Files

- `theme.json` — Sine metadata
- `preferences.json` — the settings that create the gear/options section
- `zen-vivid.uc.js` — chrome-side controller
- `frame.js` — content sampler
- `style.css` — chrome styling

## Current status

This is a fresh first pass, not a final polished release. The next step is to test it on a few pages with:
- a normal colored header,
- a long page with changing sections,
- and a Zen Boost page.
