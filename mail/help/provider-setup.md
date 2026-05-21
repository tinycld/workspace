---
title: Setting up a mail provider
summary: Configuring Postmark so your org can actually send and receive email
tags: [provider, postmark, setup, settings]
order: 100
---

## Who can do this

Configuring a provider is per-org — each org's mail goes through its own provider account. The provider settings page lives at **Settings → Mail → Provider** and is accessible to org **owners** and **admins** only.

## What you need

A **Postmark** account ([postmarkapp.com](https://postmarkapp.com)) with at least one server. Specifically:

- **Postmark account token** — found at **Account → API Tokens**. Used for domain operations (creating, verifying, listing).
- **Postmark server token** — found inside a specific server, at **Server → API Tokens → Server API token**. Used for sending and inbound.

Postmark has a free tier suitable for testing; production use needs a paid plan.

## Connecting

1. Open **Settings → Mail → Provider**.
2. Pick **Postmark** as the provider (currently the only option).
3. Paste your **server token** and **account token**.
4. Click **Save**.

That's the whole setup. Once saved, outbound mail submitted from any composer routes through this Postmark server, and inbound mail routed to your org's domains lands here.

## Where credentials are stored

Provider settings live in the core `settings` table at `(app='mail', org=<orgId>, key=<key>)`. They're scoped to the org — different orgs can use different Postmark accounts. The server token is treated as a secret; the settings UI shows it masked.

The values are also cached in-process per-org for performance; the cache invalidates automatically when the settings record changes.

## Per-org fallback

If an org has no provider settings, the server falls back to environment variables (`MAIL_PROVIDER`, `POSTMARK_SERVER_TOKEN`, `POSTMARK_ACCOUNT_TOKEN`). This is mostly useful for single-org self-hosted setups where it's simpler to put credentials in the deployment config than in the database.

## Verifying it works

After saving credentials:

1. Go to **Settings → Mail → Provider** and add a domain (see [Custom domains](help://mail:custom-domains)).
2. Once the domain shows green checkmarks for MX / SPF / DKIM / Return-Path, send yourself a test message.
3. If the message goes through, you're set. If not, the error in the Sent folder's status indicator will point you at the failing piece.

## Common errors

- **"Provider not configured"** — you haven't saved a server token, or the env-var fallback isn't set. Outbound is blocked.
- **"401 Unauthorized" from Postmark** — token is wrong or revoked. Regenerate in Postmark and re-save.
- **"403 Forbidden"** — token is valid but doesn't have the permissions you need (e.g. an account token where the server token is required). Double-check which is which.

## See also

- [Custom domains](help://mail:custom-domains)
- [Delivery tracking](help://mail:delivery-tracking)
