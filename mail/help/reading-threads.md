---
title: Reading threads
summary: How conversations work and what you can do with them
tags: [thread, conversation, read, reply]
order: 40
---

## Opening a thread

Click any row in the list to open the thread. You can also press **Enter** or **o** on a focused row (keyboard navigation with **j** / **k**).

The thread view shows every message in the conversation, ordered oldest to newest. Unread messages are expanded; previously-read messages collapse into a one-line preview that you can click to expand.

## How threading works

Threads group messages that are part of the same conversation. Grouping uses RFC 5322 headers:

1. **`In-Reply-To`** — if the incoming message references an existing message's ID, it joins that thread.
2. **`References`** — fallback to the references chain when there's no direct parent.
3. **Subject match** — last-resort fallback: messages with the same normalized subject (stripping `Re:` / `Fwd:`) within the same mailbox.

Two unrelated emails with the same subject won't merge as long as one of the first two strategies fires. If both fail (e.g. someone manually typed your subject into a fresh email), they may collide — open the thread and use the message header dropdown to split.

## Message body rendering

HTML bodies are sanitized server-side before they reach your browser:

- Scripts, iframes, forms, and embedded objects are stripped.
- Style attributes are preserved for common elements (so corporate templates still look right).
- External images load through the [private image proxy](help://mail:privacy) by default — senders never see your IP or whether you opened the message.
- `cid:` references to inline images are rewritten to local file URLs.

## Marking and moving

The toolbar above an open thread has:

- **Star** / unstar — adds the thread to your **Starred** folder.
- **Archive** — moves the thread out of Inbox into All Mail. Reachable from the **All Mail** folder afterward.
- **Move to** — pick a folder (Inbox / Spam / Trash / Archive).
- **Labels** — assign / unassign labels. See [Labels](help://mail:labels).
- **Mark as unread** — flips read state for the thread.

All of these are per-user — they don't affect what other members of a shared mailbox see.

## Reply, Reply all, Forward

The bottom of an open thread has **Reply**, **Reply all**, **Forward**. Each opens an [inline reply](help://mail:composing) form pre-filled with the appropriate recipients, subject, and quoted body.

## Attachments

Attachments appear as cards below the message body — name, size, and a download button. PDFs, images, Office documents, and HEIC photos get **thumbnails** generated server-side; other attachments show a category icon.

Click an attachment to download. There's no in-app preview yet; consider [saving to Drive](help://drive:files) first if you want to preview before downloading.

## See also

- [Composing](help://mail:composing)
- [Folders](help://mail:folders)
- [Privacy and image proxy](help://mail:privacy)
