---
title: Find and replace
summary: Search the document and replace matches, on web or mobile
tags: [find, search, replace]
order: 40
---

The Find / Replace bar lets you walk through every occurrence of a query in the current document and, optionally, swap them out for something else. It works the same way on the web, iOS, and Android — the underlying engine highlights matches and steps through them in document order.

## To open the bar

- **On web**, press **⌘F**. The bar slides in at the top-right of the editor and the cursor lands in the **Find** input.
- **On mobile**, tap the document menu (the three-dot icon in the title bar) and choose **Find…**. The bar appears anchored to the top edge of the editor.

The bar stays open until you tap the **×** button or press **Escape** (web only).

## To walk through matches

Type into the **Find** input. As you type, every match in the document highlights and the count next to the input updates (e.g. *3/12* — the third of twelve matches). The current match is highlighted more strongly than the others.

- Press **Enter** (web) or tap the **↓** chevron to jump to the next match.
- Press **⇧Enter** (web) or tap the **↑** chevron to jump to the previous match.
- **⌘G** / **F3** cycle forward; **⌘⇧G** / **⇧F3** cycle backward (web only).

The editor scrolls so the active match is visible. Matches wrap around at the end of the document.

## To replace text

Type a replacement into the **Replace** input, then:

- Tap **Replace** to swap out the currently active match. The bar jumps to the next match automatically.
- Tap **Replace all** to swap out every match in one operation.

On phone-width screens the **Replace** and **Replace all** buttons collapse to icons to keep the bar from overflowing. The action is the same — the long-press accessibility label still announces "Replace" or "Replace all".

## Limitations in v1

The current matcher is **plain-text and case-insensitive**. It does not support:

- Regular expressions
- Whole-word matching
- Case-sensitive matching
- Matching across paragraph or list boundaries

A future release will surface those options as toggles on the bar.
