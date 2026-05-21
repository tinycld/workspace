---
title: Trash
summary: Soft-delete, restore, and permanent deletion
tags: [trash, delete, restore]
order: 90
---

## Moving things to trash

Right-click a file or folder and choose **Move to trash**, select it and use the toolbar's trash button, or just drag it onto the **Trash** entry in the sidebar.

Trashed items disappear from their original location but aren't gone yet. They:

- Move to the **Trash** section in the sidebar.
- Are excluded from search results.
- Stop appearing in **Shared with me** for anyone who had access (their links return a 404 until you restore).
- Still count toward your org's storage quota.

## Restoring

Open **Trash**, right-click the item, and choose **Restore**. The action does one of two things:

- **Restore** — moves it back to its original location.
- **Restore to...** — opens a folder picker. This appears when the original location has itself been deleted, so the file has nowhere obvious to land.

Restored files come back with their full version history, share links (re-enabled), stars, and comments intact.

## Permanent deletion

Right-click in Trash and choose **Delete permanently**. A confirmation dialog warns you this can't be undone. After permanent deletion:

- The file's bytes are removed from disk.
- Every version, comment, and share link is removed.
- The storage quota is freed.

There's no automatic cleanup of trash — files stay there until you delete them permanently.

## Deleting folders

Moving a folder to trash trashes everything inside it. Restoring the folder restores everything inside. Permanently deleting a folder permanently deletes everything inside — no per-file confirmation, so be sure first.

## Recovering after permanent deletion

You can't, from Drive. If your administrator has off-site backups of the PocketBase database and uploaded files, recovery requires restoring those backups; that's outside the app.

## See also

- [Files](help://drive:files)
- [Folders](help://drive:folders)
- [Versions](help://drive:versions)
