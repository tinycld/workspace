---
title: Saving a version
summary: Tag the current state of a workbook so you can find or restore it later
tags: [version, history, snapshot, save]
order: 170
---

## What "Save version" does

Calc auto-saves continuously — your changes go to Drive within seconds. **Save version** is different: it lets you stamp a named checkpoint into the workbook's history so you can return to a specific moment, like "before I rewrote the pricing model" or "end of Q1 review."

## Saving a version

1. Open the workbook.
2. Choose **File → Save version**.
3. Add a short description (optional but recommended — empty submits a timestamp). The description can be up to 500 characters.
4. Click **Save**.

The new version appears in Drive's version history for this workbook. The current file isn't modified — saving a version is a snapshot, not a save-as.

## Seeing and restoring versions

Versions live on the underlying Drive item:

1. **File → Details** to open Drive's detail panel.
2. Switch to the **Versions** tab.
3. Each version shows its description, timestamp, size, and the person who saved it.
4. Click a version to restore it as the current workbook. The version you replace is itself snapshotted first, so restores are never destructive.

See [Drive versions](help://drive:versions) for more on managing version history.

## When to save a version

- Before a large refactor or before deleting sheets you might want back.
- At a project milestone you'd want to reference later.
- Before importing a CSV that overwrites existing data.
- Before applying conditional formatting or formulas you're unsure about.

## See also

- [Managing workbooks](help://calc:file-actions)
- [Collaboration](help://calc:collaboration)
