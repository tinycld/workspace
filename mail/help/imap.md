---
title: Connecting an IMAP client
summary: Read your mail from Apple Mail, Thunderbird, mutt, or any IMAP-compatible client
tags: [imap, apple-mail, thunderbird, mutt, mobile]
order: 120
---

## What IMAP gives you

IMAP lets you read your TinyCld mail from any desktop or phone mail client. Once configured:

- **Folders sync** — Inbox, Sent, Drafts, Spam, Trash, Archive show up in your client.
- **Unread state syncs** — marking a message read in your client updates TinyCld and vice versa.
- **Multi-mailbox support** — every mailbox you're a member of (personal + shared) appears in your client.
- **IDLE** — modern IMAP clients use the IDLE extension to get push-style updates. TinyCld supports it, so new messages appear within a second of arriving.

IMAP is **read + state**, not send. To also send from your client, set up [SMTP](help://mail:smtp).

## Connection settings

| Setting | Value |
|---|---|
| **Server** | your TinyCld hostname (e.g. `mail.example.com`) |
| **Port** | **993** |
| **Encryption** | SSL / TLS (implicit) |
| **Username** | your TinyCld email |
| **Password** | your TinyCld password |
| **Authentication** | Normal password |

There is no separate "IMAP password" — use your regular TinyCld login.

## Connecting Apple Mail (macOS)

1. **Mail → Settings → Accounts → +**.
2. Choose **Other Mail Account…**, click **Continue**.
3. Enter your name, email address, and TinyCld password. Click **Sign In**.
4. Apple Mail will probably fail auto-config — that's expected; the manual page appears.
5. **Account Type**: IMAP.
6. **Incoming Mail Server**: your TinyCld hostname.
7. **User Name**: your TinyCld email.
8. **Password**: your TinyCld password.
9. Click **Sign In**.

The mail account appears in the sidebar. Each mailbox you have access to shows up as a separate account folder.

## Connecting Apple Mail (iOS / iPadOS)

1. **Settings → Mail → Accounts → Add Account → Other → Add Mail Account**.
2. Fill in your name, email, password.
3. Tap **Next** — iOS will try to auto-config and fail; the manual screen appears.
4. Pick **IMAP**.
5. Incoming Mail Server — Host Name: your TinyCld hostname, User Name: your email, Password: your password.
6. Outgoing Mail Server — same hostname, port 465. (Set up [SMTP](help://mail:smtp) to send.)
7. Tap **Save**.

## Connecting Thunderbird

1. **File → New → Existing Mail Account**.
2. Enter your name, email, password. Click **Continue**.
3. Thunderbird auto-discovers; if it doesn't, click **Configure manually**.
4. **Incoming**: Protocol IMAP, Hostname your TinyCld hostname, Port 993, SSL/TLS, Authentication Normal password.
5. **Outgoing**: SMTP, same hostname, Port 465, SSL/TLS — see [SMTP](help://mail:smtp).
6. Click **Done**.

## Connecting mutt

In your `~/.muttrc`:

```muttrc
set imap_user = "you@yourdomain.com"
set imap_pass = "your-tinycld-password"
set folder = "imaps://mail.example.com:993"
set spoolfile = "+INBOX"
set ssl_force_tls = yes

# For sending, see the SMTP help topic
```

## Folder names

In every IMAP client you'll see these folder names per mailbox (case may vary by client):

- **INBOX**
- **Sent** (flagged `\Sent`)
- **Drafts** (flagged `\Drafts`)
- **Trash** (flagged `\Trash`)
- **Spam** (flagged `\Junk`)
- **Archive** (flagged `\Archive`)

When you have multiple mailboxes, IMAP namespaces them — typically as separate sub-folders or as separate accounts (depending on your client). Each mailbox's folders are independent.

## Troubleshooting

- **Auth failed** — double-check that you're using your TinyCld *email* (the one you sign in with), not just the local part of your mail address. Your TinyCld account email and your `you@yourdomain.com` address are not necessarily the same thing.
- **Connection refused / timeout** — verify your TinyCld instance is reachable on port 993. Try `openssl s_client -connect mail.example.com:993` from a terminal to test.
- **TLS certificate error** — Mail's IMAP server uses the same TLS certificate as your web UI. If your web UI works, IMAP should too. If not, check the cert hostname matches what you put in the client.
- **Folders don't sync** — IMAP IDLE should push new messages within a second, but some clients only check every 5–15 minutes by default. Look for a "check for new mail every N minutes" setting.

## See also

- [SMTP](help://mail:smtp)
- [Mailboxes and aliases](help://mail:mailboxes)
