---
title: Public share links
summary: Sharing files with people who don't have an account
tags: [share, public-link, link, expiry]
order: 80
---

## What a public link is

A public share link is a tokenized URL — anyone who has it can open the file without signing in. Use this when you need to share with someone outside your org, on a mailing list, or to embed a file in another tool.

The link looks like `https://&lt;your-instance&gt;/share/&lt;token&gt;`. The token is a long random string — guessing one is computationally infeasible.

## Who can create one

Only the **owner** of a file can create, modify, or revoke its public links. Editors and viewers of a file can use a public link someone else created, but they can't generate one themselves. If you don't see the public-link section in the share dialog, you're not an owner of that file — ask the owner.

## Creating a link

Open the share dialog (right-click → **Share**) and scroll to **Anyone with the link**. Click to enable. Pick a role:

- **Viewer** — recipients can open and download.
- **Editor** — recipients can edit. (Available for file types whose package supports anonymous editing — e.g. a Calc workbook lets anyone with an editor link edit cells.)

The link is generated and copied to your clipboard. Click **Copy link** at any time to copy it again.

## Optional settings

Each public link can have:

- **Expiry** — pick a date after which the link stops working. Leave unset for "never expires." After expiry, opening the link returns a 404.
- **Download count** — Drive tracks how many times the link's been used. The number's visible in the share dialog. There's no per-link download cap currently.
- **Last accessed** — a timestamp showing the most recent successful open.

## Disabling a link

Toggle **Anyone with the link** off in the share dialog. The link immediately stops working. You can re-enable it later — the *same* token is reused, so previously-copied links start working again.

If you want to invalidate a link without ever wanting it back, **delete** the link from the share dialog. A fresh link generated afterward gets a new token; the old URL is permanently 404.

## What recipients see

Opening a public link takes the recipient to a minimal viewer page at `/share/&lt;token&gt;`. They see:

- The file's name.
- The file itself — preview for previewable types (PDFs, images, video, audio, text), or a download button for everything else.
- An **Open in &lt;package&gt;** action if the file type has one (e.g. a workbook with an editor-role link opens the Calc editor).
- No nav rail, no sidebar, no other files from your Drive.

Recipients can't see who else has access, your other files, or your org's name.

## Best practices

- For sensitive files, prefer [direct shares](help://drive:sharing) over public links — direct shares require a sign-in, leave an audit trail, and can't be forwarded.
- Set an expiry for time-bound sharing (interview portfolios, draft documents).
- If you're unsure who's used a link, check **Last accessed** and **Download count** before relying on it being inactive.

## See also

- [Sharing with org members](help://drive:sharing)
