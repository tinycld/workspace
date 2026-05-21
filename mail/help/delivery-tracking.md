---
title: Delivery tracking
summary: What the green / red dots on a sent message mean
tags: [delivery, sent, bounced, status]
order: 80
---

## Why this exists

When you send email through a third-party provider like Postmark, the provider sends back callbacks (webhooks) when the recipient's mail server accepts the message, when it gets delivered, when it bounces, and when the recipient marks it as spam. Mail records each event so you know what actually happened to a sent message.

## The states

Every outgoing message has a `delivery_status`. As callbacks come in, the status moves through:

- **draft** — you're still composing. Auto-saved but never sent.
- **sending** — the **Send** button has been clicked and we've submitted to the provider, but haven't gotten a `sent` confirmation back yet.
- **sent** — the provider has accepted the message for delivery. Most messages spend less than a second in `sending` before flipping to `sent`.
- **delivered** — the recipient's mail server has accepted the message. This is the "successfully delivered" state.
- **bounced** — the recipient's mail server rejected the message. Could be a hard bounce (address doesn't exist), a soft bounce (mailbox full, temporary failure), or any other delivery error.
- **spam_complaint** — the recipient marked the message as spam. This is rare but important; it's a strong signal for the recipient's mail provider that you're sending unwanted mail.

## Where you see this

In any thread that contains messages you sent, each sent message has a small indicator showing its current status:

- ✓ green checkmark — `delivered`.
- ⏳ spinner — `sending` or `sent` (not yet confirmed delivered).
- ⚠ red exclamation — `bounced`.
- 🚫 red ban — `spam_complaint`.

Hover (or tap) the indicator to see the exact state and the timestamp of the most recent transition.

## What happens on a bounce

Bounces are recorded but Mail doesn't currently auto-retry — if a message bounces, you'll see it in the thread and can decide whether to resend manually. Hard bounces (invalid address) won't ever succeed; soft bounces sometimes succeed if you wait and resend.

## What happens on a spam complaint

Same treatment: recorded, indicator shown, no automatic action. Repeated spam complaints from your sending domain hurt your sender reputation and eventually lead to provider-level deliverability issues. If you see complaints, audit who you're emailing and whether they actually expect it.

## The webhook

Delivery status changes arrive via Postmark webhooks at `/api/mail/bounces/{token}`, where the token is your domain's `webhook_secret`. The webhook is unauthenticated *to the outside world* but secured by the token (which Postmark also uses to authenticate). Mail handles the routing automatically when you set up a domain.

## See also

- [Custom domains](help://mail:custom-domains)
- [Provider setup](help://mail:provider-setup)
