---
title: Getting started with Mail
summary: A tour of mailboxes, folders, and the inbox view
tags: [intro, basics, tour]
order: 10
---

## What Mail is

A full email client backed by a mail provider like Postmark for actual delivery. You can:

- Read and write email in the web / iPad UI.
- Connect any standard mail client (Apple Mail, Thunderbird, mutt) via [IMAP](help://mail:imap) and [SMTP](help://mail:smtp).
- Use your org's custom domain — set up MX, SPF, DKIM, and inbound routing once and Mail handles the rest.

## Mailboxes vs folders

A **mailbox** is a complete email account — an address like `you@example.com` plus its history. You can have:

- **Personal mailboxes** — automatically created the moment you join an org (one per org).
- **Shared mailboxes** — like `support@` or `sales@`. Multiple people can read and send from one mailbox, with `owner` and `member` roles.

Inside each mailbox there are **folders** that group threads: Inbox, Starred, Sent, Drafts, All Mail, Spam, Trash, Archive. Folders are per-user — what *you* mark as starred or move to Archive doesn't affect other members of a shared mailbox.

## The sidebar

- **Compose** button — top of the sidebar, opens the compose window from anywhere.
- **All Inboxes** — only appears when you have 2 or more mailboxes; shows everything new across all of them.
- **One section per mailbox** — expanded by default, with the 8 folders inside.
- **Labels** — colored tags you can apply to threads. Same label system used by other packages — see [Labels](help://mail:labels).

## A thread vs a message

Mail groups related messages into **threads** (conversations). Replying to a thread keeps everything in one place; viewing a thread shows every message in order. Threading uses RFC 5322 `In-Reply-To` and `References` headers, with a subject-line fallback when those are missing.

## Where to go next

- [Mailboxes and aliases](help://mail:mailboxes)
- [Composing and sending](help://mail:composing)
- [Reading threads](help://mail:reading-threads)
- [Folders](help://mail:folders)
- [Labels](help://mail:labels)
- [Search](help://mail:search)
- [Setting up a custom domain](help://mail:custom-domains)
- [Connecting Apple Mail / Thunderbird (IMAP)](help://mail:imap)
