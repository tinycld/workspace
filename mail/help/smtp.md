---
title: Connecting an SMTP client
summary: Send email from Apple Mail, Thunderbird, or any SMTP-capable client
tags: [smtp, send, submission, apple-mail, thunderbird]
order: 130
---

## What SMTP gives you

SMTP submission lets your desktop or phone mail client *send* through TinyCld — the outbound counterpart to [IMAP](help://mail:imap) for reading. Once configured, hitting Send in Apple Mail / Thunderbird / mutt routes through TinyCld → your mail provider → the recipient.

This is **not** the same as the SMTP your mail provider uses to deliver mail across the internet. This is the *submission* endpoint — you authenticate as a TinyCld user, TinyCld validates the sender address is one you have access to, and then forwards the message through your configured provider with all the right SPF / DKIM signing.

## Connection settings

| Setting | Value |
|---|---|
| **Server** | your TinyCld hostname (e.g. `mail.example.com`) |
| **Port** | **465** |
| **Encryption** | SSL / TLS (implicit) |
| **Username** | your TinyCld email |
| **Password** | your TinyCld password |
| **Authentication** | Normal password |

The same credentials as [IMAP](help://mail:imap) — your regular TinyCld login.

## Why port 465 (not 587)

TinyCld's SMTP server uses **implicit TLS on port 465** in production. STARTTLS on port 587 isn't exposed — implicit TLS is simpler, more secure, and has fewer ways to misconfigure (no "downgrade to plain" failure mode).

Most clients support this — just pick **SSL / TLS** (not STARTTLS) when prompted, and port 465.

## Connecting Apple Mail (macOS)

This is usually done as part of [IMAP setup](help://mail:imap) — the same account holds both incoming and outgoing config. If you need to add outgoing separately:

1. **Mail → Settings → Accounts**, pick the TinyCld account.
2. Click the **Server Settings** tab.
3. Under **Outgoing Mail Server (SMTP)**:
   - Host Name: your TinyCld hostname.
   - User Name: your TinyCld email.
   - Password: your TinyCld password.
   - Use TLS/SSL: **Yes**.
   - Port: **465**.
   - Authentication: **Password**.
4. Click **Save**.

## Connecting Thunderbird

1. **Account Settings → Outgoing Server (SMTP) → Add**.
2. Description: anything (e.g. "TinyCld").
3. Server Name: your TinyCld hostname.
4. Port: **465**.
5. Connection security: **SSL/TLS**.
6. Authentication method: **Normal password**.
7. User Name: your TinyCld email.
8. Click **OK**.

Then in your account's Server Settings, set this SMTP server as the outgoing server for the account.

## Connecting mutt

In your `~/.muttrc`:

```muttrc
set smtp_url = "smtps://you@yourdomain.com@mail.example.com:465"
set smtp_pass = "your-tinycld-password"
set ssl_force_tls = yes
set from = "you@yourdomain.com"
set realname = "Your Name"
```

## Which address you can send from

When your SMTP client submits a message, TinyCld validates the `From:` header is one you actually have access to. Specifically, the address must be:

- The primary address of a mailbox you're a member of, OR
- An [alias](help://mail:mailboxes) of a mailbox you're a member of.

If you try to send from an address you don't own, the SMTP server rejects with `550 You don't own this address`.

## Size limits

Outbound messages are capped at **25 MB total** (including attachments). Larger messages are rejected at the SMTP layer with `552`. For large files, send a link to a [Drive](help://drive:files) share instead.

## Why messages might be rejected

- **Auth failed** — wrong email or password. Same as IMAP — use your TinyCld login.
- **From address not owned** — see above; the From header has to match a mailbox or alias you have access to.
- **Domain not verified** — the sending domain has to be fully verified (MX, SPF, DKIM, Return-Path). See [Custom domains](help://mail:custom-domains).
- **Provider not configured** — your org hasn't connected to a mail provider yet. See [Provider setup](help://mail:provider-setup).
- **Message size too large** — 25 MB max.

## See also

- [IMAP](help://mail:imap) — the receive side
- [Mailboxes and aliases](help://mail:mailboxes)
- [Custom domains](help://mail:custom-domains)
