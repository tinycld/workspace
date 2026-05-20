---
title: Connecting an address book client (CardDAV)
summary: Sync your contacts with Apple Contacts, GNOME Contacts, Thunderbird, or DAVx5
tags: [carddav, sync, apple-contacts, davx5, thunderbird, gnome]
order: 80
---

## What CardDAV gives you

CardDAV is a standard for syncing address books. Once you connect a CardDAV client to TinyCld, your contacts:

- Stay in sync — adding a contact on your phone shows up in the web UI within seconds, and vice versa.
- Are usable offline (most clients cache locally).
- Become available to anything on your OS that reads the system address book — Mail, Messages, autocomplete in any app.

Your TinyCld contacts and your client's contacts merge into a single address book.

## The connection URL

The CardDAV endpoint is at:

```
https://<your-instance>/carddav/
```

Authentication is HTTP Basic using your TinyCld email and password. One address book is exposed per organization you belong to, served at `/carddav/u/ab/<orgSlug>/`. There's also a `/.well-known/carddav` URL that redirects to the right place, which most clients auto-discover.

## Connecting Apple Contacts (macOS)

1. Open **Contacts**.
2. Choose **Contacts → Settings → Accounts → +**.
3. Pick **Other Contacts Account…**, click **Continue**.
4. Choose Account Type: **CardDAV**.
5. Username: your TinyCld email.
6. Password: your TinyCld password.
7. Server address: `your-instance.tinycld.app` (no `https://`, no path — Apple Contacts auto-discovers via `/.well-known/carddav`).
8. Click **Sign In**.

Your TinyCld contacts appear as a new group in the sidebar. New contacts you add to that group sync back to TinyCld.

## Connecting Apple Contacts (iOS / iPadOS)

1. **Settings → Contacts → Accounts → Add Account → Other → Add CardDAV Account**.
2. Server: `your-instance.tinycld.app`.
3. User Name: your TinyCld email.
4. Password: your TinyCld password.
5. Description: anything you like (e.g. "TinyCld").
6. Tap **Next** — iOS validates and finishes setup.

The account also exposes your contacts to Mail, Messages, and the system contact picker.

## Connecting DAVx5 (Android)

DAVx5 is the standard third-party CardDAV/CalDAV client for Android.

1. Open **DAVx5** and tap **+ Add account**.
2. Choose **Login with URL and user name**.
3. Base URL: `https://your-instance.tinycld.app/carddav/`.
4. User name: your TinyCld email.
5. Password: your TinyCld password.
6. Tap **Login**, then **Create account**.
7. After it syncs, open the account's **CARDDAV** tab and enable the address book(s) you want — one per org.

DAVx5 exposes the contacts to Android's system address book; any contacts app picks them up.

## Connecting Thunderbird

1. **Address Book → File → New → CardDAV Address Book**.
2. User name: your TinyCld email.
3. Location: `https://your-instance.tinycld.app/carddav/`.
4. Click **Continue**, enter your password when prompted.
5. Tick the address book(s) you want to subscribe to (one per org).
6. Click **Continue**, then **Done**.

## Connecting GNOME Contacts / Evolution

1. Open **Evolution** (or **GNOME Online Accounts** in Settings).
2. **Edit → Accounts → Add → CardDAV**.
3. URL: `https://your-instance.tinycld.app/carddav/`.
4. Username: your TinyCld email.
5. Password: your TinyCld password.
6. Click **Find** to discover the address book(s), then check the ones you want.

GNOME Contacts reads from Evolution's address book, so the contacts appear there automatically.

## What's synced

Per-field mapping between TinyCld and CardDAV:

| TinyCld field | vCard field |
|---|---|
| First name + Last name | `N`, `FN` |
| Email | `EMAIL` (one) |
| Phone | `TEL` (one) |
| Company | `ORG` |
| Job title | `TITLE` |
| Notes | `NOTE` |
| vcard_uid | `UID` |

**Not synced**: the favorite flag, soft-delete state, and labels are TinyCld-side metadata that doesn't map to vCard. Starring a contact via the web UI won't show up in Apple Contacts.

If your CardDAV client supports multiple emails or phones per contact, only the first of each is written back into TinyCld — TinyCld stores one of each.

## See also

- [Importing from Google](help://contacts:importing)
- [Getting started](help://contacts:getting-started)
