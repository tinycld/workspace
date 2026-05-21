---
title: Composing and sending email
summary: The compose window, attachments, and choosing which address to send from
tags: [compose, send, draft, attachment, from]
order: 30
---

## Opening compose

Three ways:

- Click **Compose** at the top of the sidebar.
- Press **c** anywhere in Mail.
- Click **Reply** or **Forward** on an open thread (this is technically [inline reply](#inline-replies), see below).

The compose window opens in the bottom-right corner. You can move it, minimize it, or pop it out into a full-screen overlay. Multiple compose windows can be open at once — useful for drafting a reply while you check another thread.

## Filling the form

- **From** — which address to send as. The picker lists your personal mailbox, every shared mailbox you're a member of, and every alias of each. The default picks something sensible based on context (replying to `support@` defaults to `support@`).
- **To** — primary recipients. Type and tab/comma to add multiple. Recipients auto-suggest from [Contacts](help://contacts:getting-started) if you have it installed.
- **Cc / Bcc** — secondary recipients. Hidden by default; click **Cc Bcc** in the header to reveal.
- **Subject** — required.
- **Body** — rich-text editor with bold, italic, lists, links, and inline images.

## Attachments

Drag files onto the compose window or click the paperclip icon. Attachments:

- Are uploaded as part of the message — no separate upload step.
- Are limited to 25 MB total per message (SMTP submission limit).
- Show as a ribbon at the bottom of the compose window; click the **×** on any attachment to remove it.

## Inline images

Drag an image into the body to embed it inline (vs as a separate attachment). The image gets a content-ID and is referenced via `cid:` in the HTML body. Recipients see it inline regardless of whether their client renders external images.

## Drafts

Drafts auto-save every few seconds while you type. They live in the **Drafts** folder of the mailbox you're sending from. If you close the compose window, the draft stays — reopen it from Drafts to keep working. To discard, open the draft and click **Delete draft** (or **Move to trash** from the list).

## Sending

Click **Send**. The message goes through your org's mail provider (typically Postmark), and:

- Immediately appears in **Sent** for the sending mailbox.
- Gets a `delivery_status` of `sending`, updated to `sent` once the provider accepts it, then to `delivered`, `bounced`, or `spam_complaint` based on provider callbacks. See [Delivery tracking](help://mail:delivery-tracking).

If your org hasn't configured a mail provider, sending fails with a clear error pointing at Provider settings.

## Inline replies

Replies don't open a new compose window — they expand inline at the bottom of the thread. The same form is there, pre-filled with the recipient, subject (with `Re:`), and quoted history. Send and the thread refreshes with the reply at the end.

## Keyboard shortcuts

In the compose window:

| Shortcut | Action |
|---|---|
| **Cmd/Ctrl + Enter** | Send |
| **Esc** | Close (drafts stay saved) |
| **Cmd/Ctrl + B / I / U** | Bold / italic / underline |
| **Cmd/Ctrl + K** | Add a link |

## See also

- [Reading threads](help://mail:reading-threads)
- [Delivery tracking](help://mail:delivery-tracking)
- [Mailboxes and aliases](help://mail:mailboxes)
