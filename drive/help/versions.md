---
title: Version history
summary: Restoring and downloading prior versions of a file
tags: [versions, history, restore]
order: 60
---

## How versions are created

Every time the contents of a file change, Drive saves the previous version automatically. New versions come from:

- **Upload new version** — right-click a file and pick this to replace its contents while keeping the file's identity, name, and share links.
- **System updates** — for files that other packages own (e.g. a [Calc](help://calc:getting-started) workbook saving back to its `.xlsx` blob), saves create system-source versions.

The file name, location, share settings, and stars never change with a new version — only the bytes.

## Viewing version history

Open the file's **Info** panel and switch to the **Versions** tab. Each row shows:

- A timestamp.
- The size of that version.
- The user who created it (for uploaded versions).
- A source tag — **Upload** or **System** — so you can tell automated saves apart from manual replacements.
- An optional **label** (e.g. "Before Q1 revisions"). Click any version to add or change its label.

The current version sits at the top, highlighted.

## Restoring a previous version

Click a previous version's row and choose **Restore**. The selected version becomes the current one, and the previously-current version is moved into history (so restore is itself reversible — restore the version you came from to undo).

Restore preserves the file's identity. Share links, stars, comments, and folder location are unchanged.

## Downloading a previous version

Click a previous version's row and choose **Download** to save just that version's bytes to your device. The current version is unaffected.

## How long versions are kept

Versions are kept indefinitely. They count toward your org's storage quota, so deleting old versions you don't need is a way to free up space — though there's currently no per-version delete UI; the practical lever is whether to upload new versions in the first place.

## When the file itself is deleted

Moving a file to [Trash](help://drive:trash) keeps the version history intact — restore from trash and the full history comes back. Permanently deleting a file removes every version with it.

## See also

- [Files](help://drive:files)
- [Uploading](help://drive:uploading)
