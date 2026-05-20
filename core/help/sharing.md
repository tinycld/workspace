---
title: Sharing content
summary: Generating share links and managing what others can see
tags: [share, links, permissions]
order: 40
---

## Sharing content

Some packages let you share records — for example a file in Drive or a contact card — with people outside your organization.

## How share links work

When you share a record, the app generates a unique **share token**. Anyone with the link can view the record without signing in. You stay in control: revoking the link from the same screen immediately invalidates it.

Share links live under `/share/<token>` and don't require an org context. They're read-only by default; some packages also support edit-permission links for collaborators.

## What gets shared

Only the specific record you share is visible — not your other data, not your org name, not your account. If a record references other records (for example, a file inside a folder), only the record you shared is exposed.

## Revoking access

Open the share dialog on the record and click **Revoke**. The next attempt to use the link will return a 404.
