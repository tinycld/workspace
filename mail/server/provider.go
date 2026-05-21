package mail

import (
	"context"

	"tinycld.org/core/mailer"
)

// Re-export shared types so existing mail code doesn't need to change import paths.
type Recipient = mailer.Recipient
type Attachment = mailer.Attachment
type Header = mailer.Header
type SendRequest = mailer.SendRequest
type SendResult = mailer.SendResult

// Provider defines the pluggable email provider interface.
// Send is delegated to the shared mailer package. The remaining methods
// are mail-package-specific (inbound parsing, bounces, domain management).
type Provider interface {
	Send(ctx context.Context, req *SendRequest) (*SendResult, error)
	ParseInbound(body []byte) (*InboundMessage, error)
	ParseBounce(body []byte) (*BounceEvent, error)
	VerifyWebhookSignature(headers map[string]string, body []byte) error
	AddDomain(ctx context.Context, domain string) (*DomainVerification, error)
	CheckDomainVerification(ctx context.Context, domain string) (*DomainVerification, error)
	CheckInboundDomain(ctx context.Context) (*InboundVerification, error)
}

// InboundVerification describes the server-side InboundDomain setting reported
// by the mail provider (e.g. Postmark). Used to confirm the provider end of
// inbound mail forwarding is wired up for the org's domain.
type InboundVerification struct {
	ServerInboundDomain string `json:"server_inbound_domain"`
	InboundAddress      string `json:"inbound_address,omitempty"`
}

// BounceEvent represents a parsed bounce or spam complaint notification.
type BounceEvent struct {
	RecordType  string `json:"record_type"`
	BounceType  string `json:"bounce_type"`
	MessageID   string `json:"message_id"`
	Email       string `json:"email"`
	Description string `json:"description"`
	BouncedAt   string `json:"bounced_at"`
}

type InboundMessage struct {
	From          Recipient           `json:"from"`
	To            []Recipient         `json:"to"`
	Cc            []Recipient         `json:"cc,omitempty"`
	Subject       string              `json:"subject"`
	HTMLBody      string              `json:"html_body"`
	TextBody      string              `json:"text_body"`
	StrippedReply string              `json:"stripped_reply"`
	Date          string              `json:"date"`
	MessageID     string              `json:"message_id"`
	InReplyTo     string              `json:"in_reply_to"`
	References    string              `json:"references"`
	Headers       []Header            `json:"headers,omitempty"`
	Attachments   []InboundAttachment `json:"attachments,omitempty"`
}

type InboundAttachment struct {
	Name        string `json:"name"`
	ContentType string `json:"content_type"`
	Content     string `json:"content"`
	ContentID   string `json:"content_id,omitempty"`
	Size        int64  `json:"size"`
}

type DomainVerification struct {
	Domain               string `json:"domain"`
	ID                   int64  `json:"id"`
	SPFVerified          bool   `json:"spf_verified"`
	DKIMVerified         bool   `json:"dkim_verified"`
	ReturnPathVerified   bool   `json:"return_path_verified"`
	DKIMHost             string `json:"dkim_host,omitempty"`
	DKIMTextValue        string `json:"dkim_text_value,omitempty"`
	ReturnPathDomain     string `json:"return_path_domain,omitempty"`
	ReturnPathCNAMEValue string `json:"return_path_cname_value,omitempty"`
}
