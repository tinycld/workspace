---
title: Shading table cells
summary: Apply background colors to table cells
tags: [table, shading, background, color, cell]
order: 70
---

## To shade a table cell

1. Click inside the cell you want to color. (The cell-related toolbar buttons enable only when the caret is in a table.)
2. Click the **Cell shading** button in the table toolbar — the paint-bucket icon next to the borders button.
3. Pick a color from the swatch grid:
   - **None** — clears any existing shading.
   - **Yellow**, **Light Yellow**, **Light Green**, **Light Blue**, **Light Red**, **Light Purple**, **Light Orange** — soft highlight tones that stay readable on both light and dark themes.
   - **Light Gray**, **Dark Gray**, **Black** — neutral tones.

The color applies to the current cell only. Select multiple cells first if you want to shade several at once (shift-click drag through the cells).

## What's preserved on save

Shading round-trips through the OOXML `<w:tcPr><w:shd>` element. A Word doc with colored cells keeps those colors here; cells colored in the editor are written back so Word readers see the same shading.

Borders and shading on the same cell don't interfere — set both independently.
