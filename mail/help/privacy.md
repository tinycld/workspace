---
title: Privacy and image proxy
summary: How Mail protects you from tracking pixels and malicious HTML
tags: [privacy, image, tracking, sanitize, security]
order: 90
---

## The threat

A typical HTML email is full of pixels and external images that load directly from the sender's servers when your mail client renders the message. Senders use this to track:

- **Whether** you opened the email (a 1×1 tracking pixel).
- **When** you opened it (timestamp of the request).
- **Where** you opened it (your IP address, geo-located).
- **What** you opened it with (user agent — desktop vs phone, which browser).
- **How many times** (each open is a separate request).

If you reply or click a link, the link target often includes a unique ID so the sender knows it was specifically *you* who clicked.

Beyond tracking, an unsanitized HTML body can contain `<script>` tags, malicious iframes, forms that try to phish credentials, or styles that overlay legitimate UI.

## What Mail does

Two layers of protection happen automatically — you don't have to configure anything:

### Server-side HTML sanitization

Every inbound HTML body is run through **bluemonday**'s UGC policy with table support enabled. Stripped:

- `<script>`, `<iframe>`, `<embed>`, `<object>`, `<form>`, `<input>`, `<button>`.
- `javascript:` and other unsafe URL schemes on links.
- Event handlers (`onclick`, `onload`, etc.) on every element.
- Unknown / unsafe HTML tags.

Preserved:

- Tables (with cell padding, alignment, colspan, etc.) — so corporate templates still render.
- `style` attributes on common block and inline elements (also normalized).
- Inline images via `cid:` references — those are rewritten to local file URLs.

The sanitized HTML is what gets stored and what every client (web, IMAP, mobile) eventually displays. Even if a future client doesn't sanitize, you can't be shown raw inbound HTML.

### Image proxy

External images in an inbound HTML body are rewritten to load through `/api/mail/image-proxy` with a per-user token. When you view a message:

- The proxy fetches the image *from your server*, not from your browser.
- Senders see your server's IP, not yours.
- They see the proxy's user-agent, not Safari / Chrome / your specific build.
- Repeat opens are served from a 1-hour memory cache (500-entry cap) — senders don't see every view, just the first one per hour.
- Private / RFC 1918 IPs are refused (SSRF guard) — proxy can't be used to scan your internal network.
- Responses larger than 10 MB are refused (DoS guard).

So a 1×1 tracking pixel still loads visually (your message looks the same as in any other client), but the sender's analytics see only your server.

### Outbound limits

Outbound submission via SMTP or the web composer has a 25 MB total message size limit (set on the SMTP server). Larger messages need a different transport — typically a link to a [Drive](help://drive:getting-started) file instead.

## What Mail doesn't (yet) do

- **Read receipts** — Mail doesn't send these, intentionally.
- **Click-tracking** — sender tracking links still navigate normally if you click them. We don't rewrite links, only images. If you want to know whether a link is tracking you, hover before clicking.
- **Opt-out images entirely** — there's no "always show as text" toggle yet. Workaround: most browsers let you disable image loading; the proxy still serves them, your browser just won't render them.

## See also

- [Reading threads](help://mail:reading-threads)
- [Custom domains](help://mail:custom-domains)
