---
title: Mailboxes, members, and aliases
summary: Personal vs shared mailboxes, managing access, and multiple addresses
tags: [mailbox, shared, alias, members, owner]
order: 20
---

## Personal mailboxes

When you join an org that has Mail installed, a personal mailbox is created automatically. The address is derived from your account email; you can rename it from **Settings → Mailboxes**. You're the **owner** of your personal mailbox and you're the only member — no other org member can read it.

If you leave the org (your `user_org` is removed), your personal mailbox and all its messages are cleaned up automatically.

## Shared mailboxes

A shared mailbox is for an address that multiple people work out of — `support@`, `sales@`, `team@`. To create one:

1. Open **Settings → Mailboxes**.
2. Click **+ New mailbox**.
3. Pick **Shared** as the type and fill in the local part of the address, display name, and domain.
4. Click **Save**.

You're automatically the owner. To add other members, open the mailbox row and click **Add member**.

## Roles

Every mailbox member has one of two roles:

- **Owner** — can add and remove members, rename the mailbox, set up aliases, and delete it.
- **Member** — can read and send from the mailbox, but can't change membership or settings.

You can't have a mailbox with zero owners — removing the last owner is blocked. If you need to transfer a mailbox, promote someone to owner first, then remove yourself.

## Aliases

A mailbox can have multiple addresses pointing to it. The mailbox's primary address (e.g. `support@example.com`) is one; aliases are additional addresses (e.g. `help@example.com`, `contact@example.com`) that all deliver to the same place.

To add an alias:

1. **Settings → Mailboxes**, click the mailbox.
2. **+ Add alias**, enter the local part (everything before `@`), pick a domain.
3. Save.

When you compose, the **From** picker lets you choose which address to send as — the primary or any alias. Replies use whichever address the incoming message was sent *to*, so threading stays clean.

## What every member sees

When you join a shared mailbox, you immediately see:

- Existing threads in their folders (the actual message data — Inbox, Sent, etc.).
- New incoming messages in real time.

But each member has their own:

- Read / unread state.
- Starred flag.
- Folder placement (you can archive a thread without affecting other members).
- Label assignments.

So if Alice and Bob both have access to `support@`, Alice can star a thread without changing what Bob sees, and Bob can move it to Archive while Alice keeps it in Inbox.

## See also

- [Custom domains](help://mail:custom-domains)
- [Provider setup](help://mail:provider-setup)
- [Folders](help://mail:folders)
