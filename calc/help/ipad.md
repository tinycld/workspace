---
title: Using Calc on iPad
summary: Touch gestures, the soft-keyboard accessory, and what's different from web
tags: [ipad, ios, touch, mobile]
order: 180
---

## iPad support

Calc is designed to work on both web and iPad. Most features behave identically — the differences are in how you reach them.

iPhone (small phone screens) isn't supported yet.

## Selecting cells

- **Tap** a cell to select it.
- **Drag** to select a range.
- After a range is selected, drag the **corner handles** at any edge of the selection to extend it. (There's no shift key, so the handles take that role.)

## Editing a cell

Tap to select, then tap again to start editing — the soft keyboard slides up. Or use the **fx** button on the keyboard accessory to start a formula.

## The keyboard accessory

Above the iPad soft keyboard, Calc adds a small toolbar with the controls that don't fit on a touch screen:

- **▲ / ▼** — move the cursor up/down without committing.
- **Tab** — commit and move right.
- **Enter** — commit and move down.
- **Esc** — cancel the edit.
- **fx** — start a formula (inserts `=`).

These give you the equivalent of a desktop keyboard's navigation keys without leaving the soft keyboard.

## Context menus

Long-press a cell, row, column, or sheet tab to open the same context menu that right-click opens on web. The grid darkens briefly while the menu is preparing.

## What's web-only

A few interactions don't have a touch equivalent and are simply unavailable on iPad:

- **Disjoint selection** (⌘-click on web). iPad has no modifier key, so each new tap starts a fresh selection.
- **Live shift toggle mid-fill-drag** for the fill handle.
- The **marching-ants** cut animation — iPad shows a static dashed border instead.

## CSV and print

- **Download as CSV** uses the iOS share sheet instead of a browser download, so you can save to Files, AirDrop to a Mac, send via Mail, etc.
- **Print** uses the iOS print sheet — pick an AirPrint printer or share the rendered output anywhere.

## External keyboard

If you attach a hardware keyboard, all standard [keyboard shortcuts](help://calc:keyboard-shortcuts) work just like on web. The on-screen accessory bar disappears when a hardware keyboard is detected.

## See also

- [Editing cells](help://calc:editing)
- [Clipboard and paste](help://calc:clipboard)
- [Keyboard shortcuts](help://calc:keyboard-shortcuts)
