package mail

import (
	"context"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/emersion/go-sasl"
	"github.com/emersion/go-smtp"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"tinycld.org/core/coreserver"
)

type smtpBackend struct {
	app *pocketbase.PocketBase
}

func (b *smtpBackend) NewSession(c *smtp.Conn) (smtp.Session, error) {
	return &smtpSession{app: b.app}, nil
}

type smtpSession struct {
	app *pocketbase.PocketBase

	// Auth state (persists across transactions)
	user *core.Record

	// Transaction state (reset between MAIL FROM commands)
	from       string
	mailbox    *core.Record
	alias      *core.Record
	domain     *core.Record
	orgID      string
	userOrg    *core.Record
	recipients []string
}

// AuthMechanisms returns supported SASL mechanisms.
func (s *smtpSession) AuthMechanisms() []string {
	return []string{"PLAIN", "LOGIN"}
}

// Auth handles SASL authentication.
func (s *smtpSession) Auth(mech string) (sasl.Server, error) {
	switch mech {
	case "PLAIN":
		return sasl.NewPlainServer(func(identity, username, password string) error {
			return s.authenticate(username, password)
		}), nil
	case "LOGIN":
		return &loginServer{auth: s.authenticate}, nil
	default:
		return nil, fmt.Errorf("unsupported mechanism")
	}
}

// loginServer implements sasl.Server for the LOGIN mechanism.
// LOGIN is a simple two-step exchange: server challenges with "Username:" then
// "Password:", client responds with each value.
type loginServer struct {
	auth     func(username, password string) error
	username string
	step     int
}

func (s *loginServer) Next(response []byte) (challenge []byte, done bool, err error) {
	switch s.step {
	case 0:
		s.step++
		return []byte("Username:"), false, nil
	case 1:
		s.username = string(response)
		s.step++
		return []byte("Password:"), false, nil
	case 2:
		s.step++
		err := s.auth(s.username, string(response))
		return nil, true, err
	default:
		return nil, false, fmt.Errorf("unexpected LOGIN step")
	}
}

func (s *smtpSession) authenticate(username, password string) error {
	record, err := s.app.FindAuthRecordByEmail("users", username)
	if err != nil {
		return &smtp.SMTPError{
			Code:         535,
			EnhancedCode: smtp.EnhancedCode{5, 7, 8},
			Message:      "Authentication credentials invalid",
		}
	}
	if !record.ValidatePassword(password) {
		return &smtp.SMTPError{
			Code:         535,
			EnhancedCode: smtp.EnhancedCode{5, 7, 8},
			Message:      "Authentication credentials invalid",
		}
	}

	s.user = record
	return nil
}

// Mail handles MAIL FROM command — validates the sender is authorized.
func (s *smtpSession) Mail(from string, opts *smtp.MailOptions) error {
	if s.user == nil {
		return &smtp.SMTPError{
			Code:         530,
			EnhancedCode: smtp.EnhancedCode{5, 7, 0},
			Message:      "Authentication required",
		}
	}

	local, domainStr := splitAddress(from)
	if local == "" || domainStr == "" {
		return &smtp.SMTPError{
			Code:         550,
			EnhancedCode: smtp.EnhancedCode{5, 1, 0},
			Message:      "Sender address not recognized",
		}
	}

	mailbox, alias, err := resolveMailboxByAddress(s.app, local, domainStr)
	if err != nil {
		return &smtp.SMTPError{
			Code:         550,
			EnhancedCode: smtp.EnhancedCode{5, 1, 0},
			Message:      "Sender address not recognized",
		}
	}

	domainRecord, err := s.app.FindRecordById("mail_domains", mailbox.GetString("domain"))
	if err != nil {
		return &smtp.SMTPError{
			Code:         550,
			EnhancedCode: smtp.EnhancedCode{5, 1, 0},
			Message:      "Sender address not recognized",
		}
	}

	orgID := domainRecord.GetString("org")

	userOrg, err := resolveUserOrg(s.app, s.user.Id, orgID)
	if err != nil {
		return &smtp.SMTPError{
			Code:         550,
			EnhancedCode: smtp.EnhancedCode{5, 7, 1},
			Message:      "Not authorized to send from this address",
		}
	}

	if _, err := verifyMailboxMembership(s.app, mailbox.Id, userOrg.Id); err != nil {
		return &smtp.SMTPError{
			Code:         550,
			EnhancedCode: smtp.EnhancedCode{5, 7, 1},
			Message:      "Not authorized to send from this address",
		}
	}

	s.from = from
	s.mailbox = mailbox
	s.alias = alias
	s.domain = domainRecord
	s.orgID = orgID
	s.userOrg = userOrg
	s.recipients = nil

	return nil
}

// Rcpt handles RCPT TO command — collects recipients.
func (s *smtpSession) Rcpt(to string, opts *smtp.RcptOptions) error {
	if s.user == nil {
		return &smtp.SMTPError{
			Code:         530,
			EnhancedCode: smtp.EnhancedCode{5, 7, 0},
			Message:      "Authentication required",
		}
	}
	if s.from == "" {
		return &smtp.SMTPError{
			Code:         503,
			EnhancedCode: smtp.EnhancedCode{5, 5, 1},
			Message:      "Bad sequence of commands",
		}
	}

	if !strings.Contains(to, "@") {
		return &smtp.SMTPError{
			Code:         553,
			EnhancedCode: smtp.EnhancedCode{5, 1, 3},
			Message:      "Invalid recipient address",
		}
	}

	if len(s.recipients) >= 100 {
		return &smtp.SMTPError{
			Code:         452,
			EnhancedCode: smtp.EnhancedCode{4, 5, 3},
			Message:      "Too many recipients",
		}
	}

	s.recipients = append(s.recipients, to)
	return nil
}

// resolveSenderAddress returns the local part of the outgoing From address,
// preferring the alias address when the session authenticated via an alias.
// Precondition: s.mailbox is non-nil (enforced by Mail() handler).
func resolveSenderAddress(s *smtpSession) string {
	return resolveSenderAddressRecords(s.mailbox, s.alias)
}

// buildOutgoingFrom builds the outgoing From header for this session, using
// the alias address when the session authenticated via an alias.
// Precondition: s.mailbox and s.domain are non-nil.
func buildOutgoingFrom(s *smtpSession) string {
	return buildFromAddress(s.mailbox, s.domain, s.alias)
}

// Data handles the DATA command — parses the RFC 5322 message and sends it
// through the existing provider pipeline.
func (s *smtpSession) Data(r io.Reader) error {
	if s.user == nil {
		return &smtp.SMTPError{
			Code:         530,
			EnhancedCode: smtp.EnhancedCode{5, 7, 0},
			Message:      "Authentication required",
		}
	}
	if s.from == "" || len(s.recipients) == 0 {
		return &smtp.SMTPError{
			Code:         503,
			EnhancedCode: smtp.EnhancedCode{5, 5, 1},
			Message:      "Bad sequence of commands",
		}
	}

	raw, err := io.ReadAll(r)
	if err != nil {
		return &smtp.SMTPError{
			Code:         451,
			EnhancedCode: smtp.EnhancedCode{4, 7, 0},
			Message:      "Temporary delivery failure",
		}
	}

	msg, err := parseRFC5322(raw)
	if err != nil {
		return &smtp.SMTPError{
			Code:         554,
			EnhancedCode: smtp.EnhancedCode{5, 6, 0},
			Message:      "Message could not be parsed",
		}
	}

	// Build From address from the mailbox record — we intentionally use the
	// mailbox's configured display name, not the one from the message headers,
	// to enforce consistent sender identity across all channels.
	displayName := s.mailbox.GetString("display_name")
	domainName := s.domain.GetString("domain")
	senderAddress := resolveSenderAddress(s)
	fromAddr := buildOutgoingFrom(s)

	// Build To/Cc from parsed headers, derive Bcc from RCPT TO envelope
	toMap := make(map[string]bool)
	for _, r := range msg.To {
		toMap[strings.ToLower(r.Email)] = true
	}
	for _, r := range msg.Cc {
		toMap[strings.ToLower(r.Email)] = true
	}

	var bcc []Recipient
	for _, rcpt := range s.recipients {
		if !toMap[strings.ToLower(rcpt)] {
			bcc = append(bcc, Recipient{Email: rcpt})
		}
	}

	// Convert InboundAttachment → Attachment for the provider
	var attachments []Attachment
	for _, att := range msg.Attachments {
		attachments = append(attachments, Attachment{
			Name:        att.Name,
			ContentType: att.ContentType,
			Content:     att.Content,
		})
	}

	// Resolve provider
	provider := providerForOrg(s.app, s.orgID)

	// Preserve threading headers from the original message
	inReplyToHeader := msg.InReplyTo
	referencesHeader := msg.References
	if referencesHeader == "" && inReplyToHeader != "" {
		referencesHeader = inReplyToHeader
	}

	sendReq := &SendRequest{
		From:        fromAddr,
		To:          msg.To,
		Cc:          msg.Cc,
		Bcc:         bcc,
		Subject:     msg.Subject,
		HTMLBody:    msg.HTMLBody,
		TextBody:    msg.TextBody,
		InReplyTo:   inReplyToHeader,
		References:  referencesHeader,
		Attachments: attachments,
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var result *SendResult
	if s.user != nil && coreserver.IsDemoUser(s.app, s.user.Id) {
		// Demo user: skip relay, synthesize a result so the local Sent-folder
		// persistence below runs unchanged.
		result = &SendResult{MessageID: demoMessageID()}
	} else {
		var sendErr error
		result, sendErr = provider.Send(ctx, sendReq)
		if sendErr != nil {
			return &smtp.SMTPError{
				Code:         451,
				EnhancedCode: smtp.EnhancedCode{4, 7, 0},
				Message:      "Temporary delivery failure",
			}
		}
	}

	// Store the sent message locally. The provider Send already succeeded, so
	// storage failures are logged but don't fail the SMTP transaction — the
	// message was delivered, it just won't appear in the user's Sent folder.
	now := time.Now().UTC().Format(time.RFC3339)
	mailboxID := s.mailbox.Id

	// Dedup: if the client already APPENDed this Message-ID via IMAP (or this
	// is an SMTP retry), reuse the existing thread and just retag the folder.
	existingMsg, existingThread, _ := findMessageInMailbox(s.app, mailboxID, result.MessageID)
	if existingMsg != nil {
		if err := ensureThreadState(s.app, existingThread.Id, s.userOrg.Id, "sent", true); err != nil {
			s.app.Logger().Error("SMTP: failed to create thread state for deduped message", "error", err)
		}
		globalNotifier.notify(mailboxID)
		return nil
	}

	thread, err := findOrCreateThread(s.app, mailboxID, msg.Subject, inReplyToHeader, referencesHeader)
	if err != nil {
		s.app.Logger().Error("SMTP: message sent but failed to create thread — will not appear in Sent folder",
			"error", err, "subject", msg.Subject, "from", fromAddr)
		return nil
	}

	storedMsg := &storedMessage{
		MessageID:      result.MessageID,
		InReplyTo:      inReplyToHeader,
		SenderName:     displayName,
		SenderEmail:    fmt.Sprintf("%s@%s", senderAddress, domainName),
		To:             msg.To,
		Cc:             msg.Cc,
		Date:           now,
		Subject:        msg.Subject,
		HTMLBody:       msg.HTMLBody,
		TextBody:       msg.TextBody,
		DeliveryStatus: "sent",
		Attachments:    msg.Attachments,
		Alias:          aliasIDFromSession(s),
	}

	if _, err := storeMessage(s.app, thread.Id, storedMsg); err != nil {
		s.app.Logger().Error("SMTP: message sent but failed to store — will not appear in Sent folder",
			"error", err, "subject", msg.Subject, "from", fromAddr)
		return nil
	}

	if err := updateThreadMetadata(s.app, thread, displayName, storedMsg.SenderEmail, storedMsg.TextBody, now); err != nil {
		s.app.Logger().Error("SMTP: failed to update thread metadata", "error", err)
	}

	if err := ensureThreadState(s.app, thread.Id, s.userOrg.Id, "sent", true); err != nil {
		s.app.Logger().Error("SMTP: failed to create thread state", "error", err)
	}

	globalNotifier.notify(mailboxID)

	return nil
}

// Reset clears transaction state but preserves authentication.
func (s *smtpSession) Reset() {
	s.from = ""
	s.mailbox = nil
	s.alias = nil
	s.domain = nil
	s.orgID = ""
	s.userOrg = nil
	s.recipients = nil
}

// Logout clears all session state.
func (s *smtpSession) Logout() error {
	s.user = nil
	s.Reset()
	return nil
}

// Ensure smtpSession implements the AuthSession interface.
var _ smtp.AuthSession = (*smtpSession)(nil)

func aliasIDFromSession(s *smtpSession) string {
	if s.alias == nil {
		return ""
	}
	return s.alias.Id
}
