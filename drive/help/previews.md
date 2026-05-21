---
title: Previewing files
summary: Viewing files in the browser without downloading
tags: [preview, view, pdf, image, video]
order: 50
---

## What can be previewed

Drive can preview common file types in-app — no download needed:

- **PDFs** — rendered page-by-page in a canvas viewer with zoom and page navigation.
- **Images** — JPG, PNG, GIF, WebP, SVG, HEIC.
- **Video** — MP4, MOV, WebM, with native HTML5 controls.
- **Audio** — MP3, WAV, AAC, FLAC, with native playback controls.
- **Text and code** — plain text, source code, JSON, YAML, Markdown.

Anything else opens the **Info** panel — there's no in-app viewer, so you'll need to download to view.

## Custom previewers

Some packages register their own previewers and replace the default for a specific file type. The most common example: a `.xlsx` opens in [Calc](help://calc:getting-started) rather than as a generic file preview. When a custom previewer is available, both **Open in &lt;package&gt;** and **Preview** appear on the file's context menu — Open uses the custom UI, Preview falls back to a generic view if there is one.

## In the preview modal

The preview opens in an overlay above Drive. While it's open:

- **Arrow keys** (or swipe on iPad) move between adjacent files in the current view.
- **Esc** closes the preview.
- A toolbar at the top has **Download**, **Share**, **Info**, **Star**, and **Move to trash** so you can act on the file without closing first.

## Thumbnails

In Grid view, every file shows a thumbnail. For images and videos, that's a downscaled version of the file. For PDFs, it's the first page. For other types, it's a category icon. Thumbnails are generated on the server when a file is uploaded, so they appear shortly after upload completes, not instantly.

## See also

- [Files](help://drive:files)
- [Folders](help://drive:folders)
