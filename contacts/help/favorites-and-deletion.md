---
title: Favorites, deletion, and restore
summary: Starring contacts, soft-delete, restoring, and permanent delete
tags: [favorite, star, delete, trash, restore]
order: 40
---

## Favorites

Toggle the star on any contact row to mark it as a favorite. The **Favorites** sidebar entry shows only starred contacts, with a count badge.

You can also toggle the **Favorite** switch from the contact's detail screen.

Stars are per-contact, not per-list — every place the contact appears (main list, label view, search) shows the star.

## Deleting a contact (soft delete)

From the row action menu, choose **Delete**. The contact is **soft-deleted**:

- It disappears from the main list, Favorites, and any label views.
- It moves to **Deleted** in the sidebar, with a count badge.
- It still exists in the database; the `deleted_at` timestamp is what hides it.
- CardDAV clients see it as deleted and will eventually drop it.

## Restoring a deleted contact

Open **Deleted** in the sidebar, find the contact, and choose **Restore** from its action menu. It returns to your main list with all its fields, labels, and favorite status intact.

## Permanent deletion

To delete forever, open **Deleted**, find the contact, and choose **Delete permanently**. After this:

- The row is removed from the database, including its `vcard_uid`. CardDAV clients see the contact as gone.
- The search index entry is removed.
- It cannot be recovered through the app.

There's no automatic cleanup of the Deleted bin — soft-deleted contacts stay there until you permanently delete them.

## See also

- [Editing contacts](help://contacts:editing-contacts)
- [Search](help://contacts:search)
