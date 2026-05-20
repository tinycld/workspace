// Package mailer provides a shared email sending interface for all packages.
// It wraps the configured provider (e.g. Postmark) so that any package can
// send transactional emails without depending on the mail package.
//
// Delivery gating: by default, PocketBase processes started with --dev (i.e.
// dev/test/seed) log emails to stdout instead of delivering. SKIP_SENDING_MAIL
// can override either way: "true" forces logging, "false" forces real
// delivery. Production runs without --dev and delivers by default.
package mailer

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"slices"
	"strings"
	"sync"
	"time"
)

// Recipient is an email address with an optional display name.
type Recipient struct {
	Name  string `json:"name"`
	Email string `json:"email"`
}

// Header is a custom email header.
type Header struct {
	Name  string `json:"name"`
	Value string `json:"value"`
}

// Attachment is a base64-encoded file attachment.
type Attachment struct {
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Content     string `json:"content"` // base64 encoded
	ContentID   string `json:"content_id,omitempty"`
}

// SendRequest is a full email send request with CC, BCC, attachments, and threading headers.
type SendRequest struct {
	From        string       `json:"from"`
	To          []Recipient  `json:"to"`
	Cc          []Recipient  `json:"cc,omitempty"`
	Bcc         []Recipient  `json:"bcc,omitempty"`
	Subject     string       `json:"subject"`
	HTMLBody    string       `json:"html_body"`
	TextBody    string       `json:"text_body"`
	ReplyTo     string       `json:"reply_to,omitempty"`
	InReplyTo   string       `json:"in_reply_to,omitempty"`
	References  string       `json:"references,omitempty"`
	Headers     []Header     `json:"headers,omitempty"`
	Attachments []Attachment `json:"attachments,omitempty"`
}

// SendResult is the response from a successful send.
type SendResult struct {
	ProviderMessageID string `json:"provider_message_id"`
	MessageID         string `json:"message_id"`
}

// Message is a simplified email for transactional sends (notifications, invites, etc.).
type Message struct {
	From    string      `json:"from"`
	To      []Recipient `json:"to"`
	Subject string      `json:"subject"`
	HTML    string      `json:"html"`
	Text    string      `json:"text"`
	ReplyTo string      `json:"reply_to,omitempty"`
}

// Sender can send simple transactional emails.
type Sender interface {
	Send(ctx context.Context, msg *Message) error
}

// FullSender can send rich emails with CC, BCC, attachments, and threading headers.
type FullSender interface {
	SendFull(ctx context.Context, req *SendRequest) (*SendResult, error)
}

// --- Singleton ---

var (
	instance *PostmarkSender
	once     sync.Once
	deliver  bool
)

func init() {
	// Default to NOT delivering when PocketBase runs with --dev (the flag
	// only ever appears in dev/test/seed processes). Production binaries
	// invoke `serve` without --dev, so deliver defaults to true there.
	// SKIP_SENDING_MAIL=true forces no-delivery regardless; setting it to
	// "false" explicitly opts a --dev process back into real delivery.
	devMode := slices.Contains(os.Args, "--dev")
	skip := os.Getenv("SKIP_SENDING_MAIL")
	if skip == "" {
		deliver = !devMode
	} else {
		deliver = !strings.EqualFold(skip, "true")
	}
}

// Default returns the shared PostmarkSender (or nil if not configured).
func Default() *PostmarkSender {
	once.Do(func() {
		token := os.Getenv("POSTMARK_SERVER_TOKEN")
		from := os.Getenv("MAIL_FROM_ADDRESS")
		if from == "" {
			from = "noreply@tinycld.org"
		}
		if token != "" {
			instance = NewPostmarkSender(token, "", from)
		}
	})
	return instance
}

// DefaultSender returns a Sender, falling back to LogSender if no provider is configured.
// The PostmarkSender itself checks DELIVER_MAIL and logs instead of sending in dev mode.
func DefaultSender() Sender {
	s := Default()
	if s == nil {
		return &LogSender{}
	}
	return s
}

// NoopSender silently discards messages.
type NoopSender struct{}

func (n *NoopSender) Send(_ context.Context, _ *Message) error              { return nil }
func (n *NoopSender) SendFull(_ context.Context, _ *SendRequest) (*SendResult, error) {
	return &SendResult{}, nil
}

// LogSender prints emails to stdout instead of delivering them. If the
// TINYCLD_EMAIL_LOG env var is set, each email is also appended as a JSON
// line to that file — used by e2e tests to assert on outbound email.
type LogSender struct{}

// loggedEmail is the JSON shape written to TINYCLD_EMAIL_LOG. One JSON
// object per line (JSONL), so tests can read the file lazily.
type loggedEmail struct {
	Timestamp   string      `json:"timestamp"`
	To          []Recipient `json:"to"`
	Cc          []Recipient `json:"cc,omitempty"`
	Bcc         []Recipient `json:"bcc,omitempty"`
	From        string      `json:"from,omitempty"`
	Subject     string      `json:"subject"`
	Text        string      `json:"text,omitempty"`
	HTML        string      `json:"html,omitempty"`
	Attachments int         `json:"attachments,omitempty"`
}

// fileLogMu serializes concurrent writes so JSONL lines never interleave.
var fileLogMu sync.Mutex

func appendToEmailLog(entry loggedEmail) {
	path := os.Getenv("TINYCLD_EMAIL_LOG")
	if path == "" {
		return
	}
	fileLogMu.Lock()
	defer fileLogMu.Unlock()

	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[mailer] failed to open email log %q: %v\n", path, err)
		return
	}
	defer f.Close()

	line, err := json.Marshal(entry)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[mailer] failed to marshal email log entry: %v\n", err)
		return
	}
	if _, err := f.Write(append(line, '\n')); err != nil {
		fmt.Fprintf(os.Stderr, "[mailer] failed to write email log: %v\n", err)
	}
}

func (l *LogSender) Send(_ context.Context, msg *Message) error {
	fmt.Println("╭──────────────────────────────────────────────────────────╮")
	fmt.Println("│  EMAIL (not delivered — SKIP_SENDING_MAIL is set)   │")
	fmt.Println("├──────────────────────────────────────────────────────────┤")
	fmt.Printf("│  To:      %s\n", FormatRecipients(msg.To))
	if msg.From != "" {
		fmt.Printf("│  From:    %s\n", msg.From)
	}
	fmt.Printf("│  Subject: %s\n", msg.Subject)
	fmt.Println("├──────────────────────────────────────────────────────────┤")
	if msg.Text != "" {
		fmt.Println(msg.Text)
	} else {
		fmt.Println("(HTML only — no text body)")
	}
	fmt.Println("╰──────────────────────────────────────────────────────────╯")

	appendToEmailLog(loggedEmail{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		To:        msg.To,
		From:      msg.From,
		Subject:   msg.Subject,
		Text:      msg.Text,
		HTML:      msg.HTML,
	})
	return nil
}

func (l *LogSender) SendFull(_ context.Context, req *SendRequest) (*SendResult, error) {
	fmt.Println("╭──────────────────────────────────────────────────────────╮")
	fmt.Println("│  EMAIL (not delivered — SKIP_SENDING_MAIL is set)   │")
	fmt.Println("├──────────────────────────────────────────────────────────┤")
	fmt.Printf("│  To:      %s\n", FormatRecipients(req.To))
	if len(req.Cc) > 0 {
		fmt.Printf("│  Cc:      %s\n", FormatRecipients(req.Cc))
	}
	if len(req.Bcc) > 0 {
		fmt.Printf("│  Bcc:     %s\n", FormatRecipients(req.Bcc))
	}
	if req.From != "" {
		fmt.Printf("│  From:    %s\n", req.From)
	}
	fmt.Printf("│  Subject: %s\n", req.Subject)
	if len(req.Attachments) > 0 {
		fmt.Printf("│  Attach:  %d file(s)\n", len(req.Attachments))
	}
	fmt.Println("├──────────────────────────────────────────────────────────┤")
	if req.TextBody != "" {
		fmt.Println(req.TextBody)
	} else {
		fmt.Println("(HTML only — no text body)")
	}
	fmt.Println("╰──────────────────────────────────────────────────────────╯")

	appendToEmailLog(loggedEmail{
		Timestamp:   time.Now().UTC().Format(time.RFC3339Nano),
		To:          req.To,
		Cc:          req.Cc,
		Bcc:         req.Bcc,
		From:        req.From,
		Subject:     req.Subject,
		Text:        req.TextBody,
		HTML:        req.HTMLBody,
		Attachments: len(req.Attachments),
	})
	return &SendResult{MessageID: "dev-logged"}, nil
}
