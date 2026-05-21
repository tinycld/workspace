package mail

import (
	"context"
	"encoding/json"
	"fmt"
	"net/mail"
	"time"

	"github.com/jaytaylor/html2text"
	"github.com/mrz1836/postmark"
	"tinycld.org/core/mailer"
)

// normalizePostmarkDate converts an RFC-2822 date header (Postmark's wire
// format) into the RFC-3339 string the rest of the mail package expects.
// Falls back to the current UTC time if the input is empty or unparseable —
// the message itself is more valuable than the timestamp, so we never reject
// inbound mail over a malformed Date header.
func normalizePostmarkDate(s string) string {
	if t, err := mail.ParseDate(s); err == nil {
		return t.UTC().Format(time.RFC3339)
	}
	return time.Now().UTC().Format(time.RFC3339)
}

type PostmarkProvider struct {
	sender *mailer.PostmarkSender
}

func NewPostmarkProvider(serverToken, accountToken string) *PostmarkProvider {
	return &PostmarkProvider{
		sender: mailer.NewPostmarkSender(serverToken, accountToken, ""),
	}
}

func (p *PostmarkProvider) Send(ctx context.Context, req *SendRequest) (*SendResult, error) {
	return p.sender.SendFull(ctx, req)
}

// postmarkInboundPayload matches Postmark's inbound webhook JSON structure.
type postmarkInboundPayload struct {
	From          string              `json:"From"`
	FromName      string              `json:"FromName"`
	FromFull      postmarkRecipient   `json:"FromFull"`
	To            string              `json:"To"`
	ToFull        []postmarkRecipient `json:"ToFull"`
	CcFull        []postmarkRecipient `json:"CcFull"`
	Subject       string              `json:"Subject"`
	Date          string              `json:"Date"`
	TextBody          string              `json:"TextBody"`
	HTMLBody          string              `json:"HtmlBody"`
	StrippedTextReply string              `json:"StrippedTextReply"`
	MessageID         string              `json:"MessageID"`
	MailboxHash   string              `json:"MailboxHash"`
	Headers       []postmarkHeader    `json:"Headers"`
	Attachments   []postmarkAttachment `json:"Attachments"`
}

type postmarkRecipient struct {
	Name  string `json:"Name"`
	Email string `json:"Email"`
}

type postmarkHeader struct {
	Name  string `json:"Name"`
	Value string `json:"Value"`
}

type postmarkAttachment struct {
	Name          string `json:"Name"`
	Content       string `json:"Content"`
	ContentType   string `json:"ContentType"`
	ContentID     string `json:"ContentID"`
	ContentLength int64  `json:"ContentLength"`
}

func (p *PostmarkProvider) ParseInbound(body []byte) (*InboundMessage, error) {
	var payload postmarkInboundPayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("failed to parse inbound payload: %w", err)
	}

	textBody := payload.TextBody
	// When the sender provides no text/plain part, Postmark synthesizes
	// TextBody from HtmlBody by inserting <br/>\n for line breaks but
	// leaving the rest of the markup intact, which makes the result useless
	// for snippets and FTS. If we have an HtmlBody, we regenerate TextBody
	// from it via html2text. We deliberately do not touch StrippedTextReply:
	// it's "what Postmark could parse as the new (un-quoted) content" and
	// the consumers fall back to TextBody when it's empty, which is the
	// correct behavior for HTML-only mail where reply-stripping is unreliable.
	if payload.HTMLBody != "" {
		if converted, err := html2text.FromString(payload.HTMLBody, html2text.Options{}); err == nil {
			textBody = converted
		}
	}

	msg := &InboundMessage{
		From: Recipient{
			Name:  payload.FromFull.Name,
			Email: payload.FromFull.Email,
		},
		To:       convertRecipients(payload.ToFull),
		Cc:       convertRecipients(payload.CcFull),
		Subject:       payload.Subject,
		HTMLBody:       payload.HTMLBody,
		TextBody:       textBody,
		StrippedReply:  payload.StrippedTextReply,
		Date:           normalizePostmarkDate(payload.Date),
	}

	for _, h := range payload.Headers {
		switch h.Name {
		case "Message-ID", "Message-Id":
			msg.MessageID = h.Value
		case "In-Reply-To":
			msg.InReplyTo = h.Value
		case "References":
			msg.References = h.Value
		}
		msg.Headers = append(msg.Headers, Header{Name: h.Name, Value: h.Value})
	}

	if msg.MessageID == "" && payload.MessageID != "" {
		msg.MessageID = "<" + payload.MessageID + ">"
	}

	for _, att := range payload.Attachments {
		msg.Attachments = append(msg.Attachments, InboundAttachment{
			Name:        att.Name,
			ContentType: att.ContentType,
			Content:     att.Content,
			ContentID:   att.ContentID,
			Size:        att.ContentLength,
		})
	}

	return msg, nil
}

type postmarkBouncePayload struct {
	RecordType  string `json:"RecordType"`
	Type        string `json:"Type"`
	MessageID   string `json:"MessageID"`
	Description string `json:"Description"`
	Details     string `json:"Details"`
	Email       string `json:"Email"`
	BouncedAt   string `json:"BouncedAt"`
}

func (p *PostmarkProvider) ParseBounce(body []byte) (*BounceEvent, error) {
	var payload postmarkBouncePayload
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("failed to parse bounce payload: %w", err)
	}

	description := payload.Description
	if payload.Details != "" {
		description = description + ": " + payload.Details
	}

	return &BounceEvent{
		RecordType:  payload.RecordType,
		BounceType:  payload.Type,
		MessageID:   payload.MessageID,
		Email:       payload.Email,
		Description: description,
		BouncedAt:   payload.BouncedAt,
	}, nil
}

func (p *PostmarkProvider) VerifyWebhookSignature(_ map[string]string, _ []byte) error {
	return nil
}

func (p *PostmarkProvider) AddDomain(ctx context.Context, domain string) (*DomainVerification, error) {
	details, err := p.sender.Client().CreateDomain(ctx, postmark.DomainCreateRequest{
		Name: domain,
	})
	if err != nil {
		return nil, fmt.Errorf("postmark create domain failed: %w", err)
	}
	return domainDetailsToVerification(details), nil
}

func (p *PostmarkProvider) CheckDomainVerification(ctx context.Context, domain string) (*DomainVerification, error) {
	domains, err := p.sender.Client().GetDomains(ctx, 100, 0)
	if err != nil {
		return nil, fmt.Errorf("postmark list domains failed: %w", err)
	}

	for _, d := range domains.Domains {
		if d.Name == domain {
			details, err := p.sender.Client().GetDomain(ctx, d.ID)
			if err != nil {
				return nil, fmt.Errorf("postmark get domain failed: %w", err)
			}
			return domainDetailsToVerification(details), nil
		}
	}

	return nil, fmt.Errorf("domain %q not found in Postmark", domain)
}

// CheckInboundDomain fetches the current Postmark server (the one the server
// token belongs to) and returns its InboundDomain. This assumes one Postmark
// server per org — if an org later runs multiple servers, this will need to
// take the domain as input and scan all account-level servers for a match
// (requires account-token auth via GetServers).
func (p *PostmarkProvider) CheckInboundDomain(ctx context.Context) (*InboundVerification, error) {
	server, err := p.sender.Client().GetCurrentServer(ctx)
	if err != nil {
		return nil, fmt.Errorf("postmark get current server failed: %w", err)
	}
	return &InboundVerification{
		ServerInboundDomain: server.InboundDomain,
		InboundAddress:      server.InboundAddress,
	}, nil
}

func domainDetailsToVerification(d postmark.DomainDetails) *DomainVerification {
	return &DomainVerification{
		Domain:               d.Name,
		ID:                   d.ID,
		SPFVerified:          d.SPFVerified,
		DKIMVerified:         d.DKIMVerified,
		ReturnPathVerified:   d.ReturnPathDomainVerified,
		DKIMHost:             d.DKIMHost,
		DKIMTextValue:        d.DKIMTextValue,
		ReturnPathDomain:     d.ReturnPathDomain,
		ReturnPathCNAMEValue: d.ReturnPathDomainCNAMEValue,
	}
}

func convertRecipients(prs []postmarkRecipient) []Recipient {
	out := make([]Recipient, len(prs))
	for i, pr := range prs {
		out[i] = Recipient{Name: pr.Name, Email: pr.Email}
	}
	return out
}
