# tinycld/mailer

Shared email sending package for all TinyCld packages. Wraps the configured provider (currently Postmark) so any package can send transactional emails without depending on the mail package.

## Usage

```go
import "tinycld/mailer"

// Simple transactional email (notifications, invites, etc.)
err := mailer.DefaultSender().Send(ctx, &mailer.Message{
    To:      []mailer.Recipient{{Name: "Holly", Email: "holly@example.com"}},
    Subject: "You've been invited",
    HTML:    "<p>Hello!</p>",
    Text:    "Hello!",
})

// Rich email with CC, BCC, attachments, threading headers
result, err := mailer.Default().SendFull(ctx, &mailer.SendRequest{
    From:    "sender@example.com",
    To:      []mailer.Recipient{{Name: "Holly", Email: "holly@example.com"}},
    Subject: "Re: Project update",
    HTMLBody: "<p>Sounds good</p>",
    TextBody: "Sounds good",
    InReplyTo: "<original-message-id@example.com>",
})
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `POSTMARK_SERVER_TOKEN` | Yes (for delivery) | Postmark server API token |
| `MAIL_FROM_ADDRESS` | No | Default "From" address. Defaults to `noreply@tinycld.org` |
| `SKIP_SENDING_MAIL` | No | `true` forces logging instead of delivery; `false` forces real delivery. When unset, the default is `true` for PocketBase processes started with `--dev` (dev/test/seed) and `false` otherwise. |

## Development

By default, any PocketBase started with `--dev` logs emails to stdout instead of delivering. Production runs without `--dev` and delivers normally. Set `SKIP_SENDING_MAIL=false` in a `--dev` process to force real delivery (e.g. for end-to-end testing against Postmark sandboxes).

Logged emails are printed in a formatted box. This applies to both simple sends (`Send`) and full sends (`SendFull`) across all packages.

```
╭──────────────────────────────────────────────────────────╮
│  EMAIL (not delivered — SKIP_SENDING_MAIL is set)        │
├──────────────────────────────────────────────────────────┤
│  To:      Holly Stitt <holly@example.com>
│  Subject: Nathan shared "API Design Proposal" with you
├──────────────────────────────────────────────────────────┤
Hi Holly,

Nathan shared "API Design Proposal" with you.

Open: http://localhost:7100/a/test-org/drive?file=abc123
╰──────────────────────────────────────────────────────────╯
```

Add `SKIP_SENDING_MAIL=true` to your `.env` file for local development.
