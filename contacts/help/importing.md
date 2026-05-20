---
title: Importing contacts from Google
summary: Bringing your existing Google contacts into TinyCld
tags: [import, google, takeout, vcf]
order: 90
---

## What you can import

The **Google Takeout Import** package (a separate optional install) can bring your existing Google contacts into TinyCld. Each contact arrives with its phone numbers, email addresses, company, title, and notes mapped to TinyCld fields.

Imports use your TinyCld user_org as the owner, so imported contacts go into *your* personal address book, not a shared one.

## To import

1. Make sure the **Google Takeout Import** package is installed in this org. If you don't see an **Import** section in your account settings, ask an org owner to install it.
2. Go to [google.com/takeout](https://takeout.google.com/), select **Contacts**, request the export, and download the resulting `.zip` when Google emails you the link.
3. In TinyCld, open **Settings → Google Takeout Import**, drop the `.zip` onto the upload zone.
4. The importer inspects the archive, detects that it contains contacts, and shows a confirmation with the contact count.
5. Click **Import** and watch the progress.

## How deduplication works

Every contact carries a stable `vcard_uid`. Google's export preserves the same UID across multiple exports of the same person, so re-importing the same takeout zip — or a later export that includes the same person — **updates** the existing TinyCld record instead of creating a duplicate.

If a contact in the import doesn't have a UID (older export formats), one is generated client-side and used for de-dup matching by email instead.

## What gets imported

- **Names** — first, last (from the `N` field, with `FN` fallback).
- **Email** — the first email in the Google contact's email array.
- **Phone** — the first phone number.
- **Company** — `ORG` field.
- **Job title** — `TITLE` field.
- **Notes** — `NOTE` field, with formatting preserved as plain text.

## What doesn't get imported

- **Photos** — Google contacts can have photos; TinyCld doesn't store contact photos. The initial-based avatar in the UI is generated from the name.
- **Multiple emails / phones / addresses** — only the first of each is imported (TinyCld stores one of each).
- **Custom Google fields** (relationships, websites, IM handles, etc.) — dropped.
- **Groups** — Google's contact groups don't map to TinyCld [labels](help://contacts:labels). After import, label contacts yourself if you want to group them.

## See also

- [CardDAV](help://contacts:carddav) — for syncing with Google Contacts continuously (via DAVx5 or Apple Contacts), instead of one-shot imports
- [Adding contacts](help://contacts:adding-contacts)
