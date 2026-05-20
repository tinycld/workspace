---
title: Adding a contact
summary: Creating a new contact record
tags: [new, create, add]
order: 20
---

## To add a contact

Click **+ Create contact** in the sidebar (or press **c** anywhere in the Contacts list). The new-contact form opens.

Fill in:

- **First name** — required. The cursor lands here automatically.
- **Last name** — optional.
- **Company** — the organization the person works for. Optional.
- **Job title** — their role at the company. Optional.
- **Email** — one address.
- **Phone** — one number.
- **Notes** — a rich-text field for free-form info. Markdown-like formatting works.
- **Favorite** — toggle to star the contact so it shows up in the Favorites view.

Click **Save** to commit. The contact appears in your list immediately and propagates to any CardDAV clients connected to your address book within seconds.

## One value per field

The form holds one email and one phone per contact. If you need multiple, the CardDAV side does support multiple `EMAIL` and `TEL` entries on a vCard — clients like Apple Contacts that store multiple values will see only the first one when written into TinyCld, and TinyCld writes back just one.

## What the server does behind the scenes

When you save:

- A `vcard_uid` of the form `urn:uuid:<v4>` is auto-generated if you didn't provide one. This is the stable identity used by CardDAV and by [Google Takeout import](help://contacts:importing) for deduplication.
- The contact is added to the search index so [search](help://contacts:search) finds it immediately.
- An audit-log entry is written so admins can see contact creation/modification activity.

## See also

- [Editing contacts](help://contacts:editing-contacts)
- [Labels](help://contacts:labels)
- [Search](help://contacts:search)
