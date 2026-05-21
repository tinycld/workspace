---
title: Editing images on mobile
summary: Wrap text around images and resize them on iOS and Android
tags: [image, mobile, wrap]
order: 30
---

On the web editor you select an image and drag handles appear at its edges and corner — see [Inserting, resizing, and wrapping images](help://text:images). On mobile the editor lives inside a WebView, so there's nowhere to anchor drag handles. Tap an image instead and a bottom sheet slides up with the same controls.

## To wrap text around an image

1. Tap the image. The **Image** sheet slides up from the bottom.
2. Under **Wrap**, tap a chip:
   - **Inline** — the image sits in the text flow at its insertion point, like a giant letter. Text continues on the next line below it.
   - **Wrap left** — the image floats to the left margin and text wraps around its right side.
   - **Wrap right** — the image floats to the right margin and text wraps around its left side.
   - **Break** — the image takes its own line. Text never sits beside it, only above and below.

The active wrap chip stays highlighted so you can see at a glance which mode the image is in. Swipe down or tap outside the sheet to dismiss.

## To resize an image

1. Tap the image to open the sheet.
2. Under **Size**, tap a preset:
   - **S** — about a third of the image's original width.
   - **M** — half.
   - **L** — three quarters.
   - **Original** — the image's natural size, clamped to the editor's 800-pixel content width.

The size buttons stay dim until the image has finished loading inside the editor. If the image was just inserted, give it a moment and tap again.

## Differences from desktop

The desktop editor has both a wrap toolbar that appears next to a selected image and drag handles for fine-grained resize. On mobile you get four wrap modes and four size presets — no free-form drag, but the same underlying attributes round-trip through `.docx`, so a document edited on a phone keeps its layout when reopened on the desktop.

## Related mobile capabilities

The live **word count** displays in the document footer on mobile, the same as on the web. **Comments** work end-to-end on mobile — see [Comments on mobile](help://text:comments-on-mobile). **Find and replace** is reachable from the document menu — see [Find and replace](help://text:find-and-replace).
