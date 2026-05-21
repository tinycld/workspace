---
title: Folders
summary: Inbox, Starred, Sent, Drafts, All Mail, Spam, Trash, Archive
tags: [folder, inbox, sent, drafts, trash, archive]
order: 50
---

## The eight folders

Every mailbox has the same set of folders:

- **Inbox** — incoming threads you haven't archived or trashed.
- **Starred** — threads you've starred. The star is a per-user flag, not a separate copy.
- **Sent** — messages you've sent from this mailbox.
- **Drafts** — auto-saved compositions you haven't sent.
- **All Mail** — every thread the mailbox has ever held, regardless of folder. Like Gmail's "All Mail".
- **Spam** — threads marked as spam (by you or by the provider's spam filter).
- **Trash** — soft-deleted threads. Restorable from here.
- **Archive** — threads explicitly archived out of Inbox. Still listed in All Mail.

## What folder placement actually is

Folders are **not** physical locations — they're a piece of state on `mail_thread_state`, which is per-user-org. So:

- *You* archive a thread → it leaves *your* Inbox view but stays visible to other shared-mailbox members.
- A thread can only be in one folder for you at a time (Inbox vs Trash vs Archive — but Starred is independent, it's a separate flag).

The "All Mail" view ignores folder state entirely and shows everything the mailbox has ever received or sent.

## Moving a thread

Three ways:

- **Toolbar** in an open thread: archive, move to trash, move to spam.
- **Row actions** in the list (hover or right-click): same set.
- **Bulk select** in the list (checkbox or **x** key), then use the toolbar at the top of the list. See [Keyboard shortcuts](help://mail:keyboard-shortcuts).

## Starring

Click the star icon on a row or the toolbar of an open thread. Starred threads appear in the **Starred** view; the folder placement is unchanged (a starred thread in Inbox stays in Inbox).

## Restoring from Trash

Open **Trash**, find the thread, and choose **Move to Inbox** (or **Move to Archive**) from the toolbar. Soft-deleted threads are not auto-purged — they stay in Trash until you take action.

There is no "Empty trash" bulk action yet; delete threads individually.

## All Inboxes

If you have two or more mailboxes, an **All Inboxes** entry appears at the top of the sidebar. It shows unread threads across every Inbox you have access to. Use it as a triage view first thing in the morning.

## See also

- [Reading threads](help://mail:reading-threads)
- [Labels](help://mail:labels)
- [Keyboard shortcuts](help://mail:keyboard-shortcuts)
