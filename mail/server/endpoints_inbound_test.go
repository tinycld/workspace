package mail

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
	"github.com/pocketbase/pocketbase/tools/router"
)

// makeInboundRequest constructs a *core.RequestEvent suitable for calling
// handleInbound directly. The request body is the JSON-encoded payload, the
// {token} path value is set explicitly, and the response writer is a
// httptest.ResponseRecorder so the test can inspect status and body.
func makeInboundRequest(t *testing.T, app core.App, token string, payload []byte) (*core.RequestEvent, *httptest.ResponseRecorder) {
	t.Helper()

	req := httptest.NewRequest(http.MethodPost, "/api/mail/inbound/"+token, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("token", token)

	rec := httptest.NewRecorder()

	re := &core.RequestEvent{App: app}
	re.Request = req
	re.Response = rec
	return re, rec
}

// postmarkPayload builds a minimal Postmark inbound JSON payload for the given
// recipient(s).
func postmarkPayload(t *testing.T, recipients []string, subject, textBody, messageID string) []byte {
	t.Helper()

	type recipient struct {
		Name  string `json:"Name"`
		Email string `json:"Email"`
	}
	type header struct {
		Name  string `json:"Name"`
		Value string `json:"Value"`
	}
	type payload struct {
		FromFull  recipient   `json:"FromFull"`
		ToFull    []recipient `json:"ToFull"`
		Subject   string      `json:"Subject"`
		TextBody  string      `json:"TextBody"`
		HTMLBody  string      `json:"HtmlBody"`
		Date      string      `json:"Date"`
		MessageID string      `json:"MessageID"`
		Headers   []header    `json:"Headers"`
	}

	to := make([]recipient, 0, len(recipients))
	for _, addr := range recipients {
		to = append(to, recipient{Email: addr})
	}

	p := payload{
		FromFull:  recipient{Name: "Sender", Email: "sender@example.org"},
		ToFull:    to,
		Subject:   subject,
		TextBody:  textBody,
		Date:      "Fri, 02 May 2026 10:00:00 -0500",
		MessageID: messageID,
	}

	body, err := json.Marshal(p)
	if err != nil {
		t.Fatalf("failed to marshal payload: %v", err)
	}
	return body
}

// stubProvider is a Provider that returns a parsed InboundMessage from a
// pre-supplied parser func. Lets tests force ParseInbound success or failure
// without depending on Postmark's exact JSON shape.
type stubProvider struct {
	parse func(body []byte) (*InboundMessage, error)
}

func (s *stubProvider) Send(_ context.Context, _ *SendRequest) (*SendResult, error) {
	return nil, nil
}
func (s *stubProvider) ParseInbound(body []byte) (*InboundMessage, error) {
	return s.parse(body)
}
func (s *stubProvider) ParseBounce(_ []byte) (*BounceEvent, error) { return nil, nil }
func (s *stubProvider) VerifyWebhookSignature(_ map[string]string, _ []byte) error {
	return nil
}
func (s *stubProvider) AddDomain(_ context.Context, _ string) (*DomainVerification, error) {
	return nil, nil
}
func (s *stubProvider) CheckDomainVerification(_ context.Context, _ string) (*DomainVerification, error) {
	return nil, nil
}
func (s *stubProvider) CheckInboundDomain(_ context.Context) (*InboundVerification, error) {
	return nil, nil
}

// setupInboundTestApp creates a test app with all collections needed by the
// inbound webhook flow.
func setupInboundTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app := setupAliasTestApp(t)

	mailboxesCol, err := app.FindCollectionByNameOrId("mail_mailboxes")
	if err != nil {
		t.Fatalf("mail_mailboxes collection missing: %v", err)
	}

	members := core.NewBaseCollection("mail_mailbox_members")
	members.Fields.Add(&core.RelationField{
		Name:          "mailbox",
		Required:      true,
		CollectionId:  mailboxesCol.Id,
		CascadeDelete: true,
		MaxSelect:     1,
	})
	members.Fields.Add(&core.TextField{Name: "user_org", Required: true})
	members.Fields.Add(&core.TextField{Name: "role"})
	if err := app.Save(members); err != nil {
		t.Fatalf("failed to save mail_mailbox_members: %v", err)
	}

	threads := core.NewBaseCollection("mail_threads")
	threads.Fields.Add(&core.RelationField{
		Name:          "mailbox",
		Required:      true,
		CollectionId:  mailboxesCol.Id,
		CascadeDelete: true,
		MaxSelect:     1,
	})
	threads.Fields.Add(&core.TextField{Name: "subject"})
	threads.Fields.Add(&core.TextField{Name: "snippet"})
	threads.Fields.Add(&core.NumberField{Name: "message_count"})
	threads.Fields.Add(&core.TextField{Name: "latest_date"})
	threads.Fields.Add(&core.TextField{Name: "participants"})
	threads.Fields.Add(&core.TextField{Name: "last_sender_name"})
	threads.Fields.Add(&core.TextField{Name: "last_sender_email"})
	if err := app.Save(threads); err != nil {
		t.Fatalf("failed to save mail_threads: %v", err)
	}

	messages := core.NewBaseCollection("mail_messages")
	messages.Fields.Add(&core.RelationField{
		Name:          "thread",
		Required:      true,
		CollectionId:  threads.Id,
		CascadeDelete: true,
		MaxSelect:     1,
	})
	messages.Fields.Add(&core.TextField{Name: "message_id"})
	messages.Fields.Add(&core.TextField{Name: "in_reply_to"})
	messages.Fields.Add(&core.TextField{Name: "alias"})
	messages.Fields.Add(&core.TextField{Name: "sender_name"})
	messages.Fields.Add(&core.TextField{Name: "sender_email"})
	messages.Fields.Add(&core.TextField{Name: "date"})
	messages.Fields.Add(&core.TextField{Name: "subject"})
	messages.Fields.Add(&core.TextField{Name: "snippet"})
	messages.Fields.Add(&core.BoolField{Name: "has_attachments"})
	messages.Fields.Add(&core.NumberField{Name: "total_size"})
	messages.Fields.Add(&core.TextField{Name: "delivery_status"})
	messages.Fields.Add(&core.FileField{Name: "body_html", MaxSelect: 1})
	messages.Fields.Add(&core.FileField{Name: "attachments", MaxSelect: 99})
	messages.Fields.Add(&core.TextField{Name: "recipients_to"})
	messages.Fields.Add(&core.TextField{Name: "recipients_cc"})
	if err := app.Save(messages); err != nil {
		t.Fatalf("failed to save mail_messages: %v", err)
	}

	threadState := core.NewBaseCollection("mail_thread_state")
	threadState.Fields.Add(&core.RelationField{
		Name:          "thread",
		Required:      true,
		CollectionId:  threads.Id,
		CascadeDelete: true,
		MaxSelect:     1,
	})
	threadState.Fields.Add(&core.TextField{Name: "user_org", Required: true})
	threadState.Fields.Add(&core.TextField{Name: "folder"})
	threadState.Fields.Add(&core.BoolField{Name: "is_read"})
	threadState.Fields.Add(&core.BoolField{Name: "is_starred"})
	if err := app.Save(threadState); err != nil {
		t.Fatalf("failed to save mail_thread_state: %v", err)
	}

	return app
}

// seedMember creates a mail_mailbox_members row linking a mailbox to a user_org.
func seedMember(t *testing.T, app core.App, mailboxID, userOrgID string) {
	t.Helper()
	col, err := app.FindCollectionByNameOrId("mail_mailbox_members")
	if err != nil {
		t.Fatalf("mail_mailbox_members collection missing: %v", err)
	}
	member := core.NewRecord(col)
	member.Set("mailbox", padID(mailboxID))
	member.Set("user_org", userOrgID)
	member.Set("role", "owner")
	if err := app.Save(member); err != nil {
		t.Fatalf("failed to save mailbox member: %v", err)
	}
}

// TestHandleInbound_MembersLookupFailureReturns500 — if getMailboxMembers
// fails (DB issue, missing collection), the message must not be silently
// stored without thread state. Return 500 so Postmark retries.
func TestHandleInbound_MembersLookupFailureReturns500(t *testing.T) {
	app := setupInboundTestApp(t)
	seedDomainAndMailbox(t, app, "acme.com", "alice", "mb_memfail_001")

	col, err := app.FindCollectionByNameOrId("mail_mailbox_members")
	if err != nil {
		t.Fatalf("members collection missing: %v", err)
	}
	if err := app.Delete(col); err != nil {
		t.Fatalf("failed to drop members collection: %v", err)
	}

	body := postmarkPayload(t, []string{"alice@acme.com"}, "memfail", "body", "<msg-memfail-1@example.org>")
	re, _ := makeInboundRequest(t, app, "tok-memfail", body)

	provider := &stubProvider{parse: (&PostmarkProvider{}).ParseInbound}

	err = handleInbound(app, provider, re, "tok-memfail")
	if err == nil {
		t.Fatalf("expected 500 error, got nil")
	}
	apiErr, ok := err.(*router.ApiError)
	if !ok {
		t.Fatalf("expected *router.ApiError, got %T: %v", err, err)
	}
	if apiErr.Status != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", apiErr.Status)
	}
}

// TestHandleInbound_IdempotentRetry — submitting the same Message-ID twice
// stores only one mail_messages row. Validates the idempotency check the
// 500-retry behavior depends on.
func TestHandleInbound_IdempotentRetry(t *testing.T) {
	app := setupInboundTestApp(t)
	seedDomainAndMailbox(t, app, "acme.com", "alice", "mb_idem_001")
	seedMember(t, app, "mb_idem_001", "userorg_alice")

	body := postmarkPayload(t, []string{"alice@acme.com"}, "retry-test", "body", "<msg-idem-1@example.org>")

	provider := &stubProvider{parse: (&PostmarkProvider{}).ParseInbound}

	for i := 0; i < 2; i++ {
		re, _ := makeInboundRequest(t, app, "tok-idem", body)
		if err := handleInbound(app, provider, re, "tok-idem"); err != nil {
			t.Fatalf("delivery %d: expected 200, got %v", i+1, err)
		}
	}

	msgs, _ := app.FindRecordsByFilter("mail_messages", "subject = {:s}", "", 10, 0, map[string]any{"s": "retry-test"})
	if len(msgs) != 1 {
		t.Fatalf("expected exactly 1 message after 2 deliveries (idempotency), got %d", len(msgs))
	}
}

// TestHandleInbound_MixedKnownAndUnknownReturns200 — when at least one
// recipient resolves and storage succeeds, return 200 even if other
// recipients are unknown.
func TestHandleInbound_MixedKnownAndUnknownReturns200(t *testing.T) {
	app := setupInboundTestApp(t)
	seedDomainAndMailbox(t, app, "acme.com", "alice", "mb_mixed_001")
	seedMember(t, app, "mb_mixed_001", "userorg_alice")

	body := postmarkPayload(t, []string{"alice@acme.com", "ghost@acme.com"}, "mixed", "body", "<msg-mixed-1@example.org>")
	re, _ := makeInboundRequest(t, app, "tok-mixed", body)

	provider := &stubProvider{parse: (&PostmarkProvider{}).ParseInbound}

	if err := handleInbound(app, provider, re, "tok-mixed"); err != nil {
		t.Fatalf("expected nil (200), got %v", err)
	}

	msgs, _ := app.FindRecordsByFilter("mail_messages", "subject = {:s}", "", 10, 0, map[string]any{"s": "mixed"})
	if len(msgs) != 1 {
		t.Fatalf("expected 1 message stored (for alice), got %d", len(msgs))
	}
}

// TestHandleInbound_StorageFailureReturns500 — when storeMessage fails for a
// known mailbox, return 500 so Postmark retries. No thread row should be
// left behind (orphan cleanup).
func TestHandleInbound_StorageFailureReturns500(t *testing.T) {
	app := setupInboundTestApp(t)
	seedDomainAndMailbox(t, app, "acme.com", "alice", "mb_storefail_001")
	seedMember(t, app, "mb_storefail_001", "userorg_alice")

	// Hook: reject any mail_messages save with subject "__force_storage_failure__".
	app.OnRecordValidate("mail_messages").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("subject") == "__force_storage_failure__" {
			return fmt.Errorf("synthetic storage failure")
		}
		return e.Next()
	})

	body := postmarkPayload(t, []string{"alice@acme.com"}, "__force_storage_failure__", "body", "<msg-fail-1@example.org>")
	re, _ := makeInboundRequest(t, app, "tok-storefail", body)

	provider := &stubProvider{parse: (&PostmarkProvider{}).ParseInbound}

	err := handleInbound(app, provider, re, "tok-storefail")
	if err == nil {
		t.Fatalf("expected 500 error, got nil")
	}
	apiErr, ok := err.(*router.ApiError)
	if !ok {
		t.Fatalf("expected *router.ApiError, got %T: %v", err, err)
	}
	if apiErr.Status != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", apiErr.Status)
	}
	if !strings.Contains(apiErr.Message, "synthetic storage failure") {
		t.Fatalf("expected message to include underlying error, got %q", apiErr.Message)
	}

	msgs, _ := app.FindRecordsByFilter("mail_messages", "subject = {:s}", "", 10, 0, map[string]any{"s": "__force_storage_failure__"})
	if len(msgs) != 0 {
		t.Fatalf("expected no messages stored, got %d", len(msgs))
	}

	// No orphaned thread row should remain. Any thread with zero messages
	// indicates an orphan.
	threads, _ := app.FindRecordsByFilter("mail_threads", "id != {:zero}", "", 100, 0, map[string]any{"zero": ""})
	for _, th := range threads {
		count, _ := app.FindRecordsByFilter("mail_messages", "thread = {:t}", "", 10, 0, map[string]any{"t": th.Id})
		if len(count) == 0 {
			t.Fatalf("found orphaned thread id=%s subject=%q after storage failure", th.Id, th.GetString("subject"))
		}
	}
}

// TestHandleInbound_KnownRecipientStoresMessage — happy path: a To address
// matches a known mailbox, the message is stored, response is 200.
func TestHandleInbound_KnownRecipientStoresMessage(t *testing.T) {
	app := setupInboundTestApp(t)
	seedDomainAndMailbox(t, app, "acme.com", "alice", "mb_known_001")
	seedMember(t, app, "mb_known_001", "userorg_alice")

	body := postmarkPayload(t, []string{"alice@acme.com"}, "Hello", "Body text", "<msg-known-1@example.org>")
	re, _ := makeInboundRequest(t, app, "tok-known", body)

	provider := &stubProvider{parse: (&PostmarkProvider{}).ParseInbound}

	if err := handleInbound(app, provider, re, "tok-known"); err != nil {
		t.Fatalf("expected nil error (200), got %v", err)
	}

	msgs, err := app.FindRecordsByFilter("mail_messages", "subject = {:s}", "", 10, 0, map[string]any{"s": "Hello"})
	if err != nil {
		t.Fatalf("failed to query mail_messages: %v", err)
	}
	if len(msgs) != 1 {
		t.Fatalf("expected exactly 1 message stored, got %d", len(msgs))
	}
}

// TestHandleInbound_ParseFailureReturns422 — when ParseInbound returns an
// error, return 422 (Unprocessable Entity) so Postmark stops retrying.
func TestHandleInbound_ParseFailureReturns422(t *testing.T) {
	app := setupInboundTestApp(t)

	body := []byte(`{"this":"is","not":"an","inbound":"email"}`)
	re, _ := makeInboundRequest(t, app, "tok-parse", body)

	provider := &stubProvider{
		parse: func(_ []byte) (*InboundMessage, error) {
			return nil, fmt.Errorf("synthetic parse error")
		},
	}

	err := handleInbound(app, provider, re, "tok-parse")
	if err == nil {
		t.Fatalf("expected error response, got nil")
	}

	apiErr, ok := err.(*router.ApiError)
	if !ok {
		t.Fatalf("expected *router.ApiError, got %T: %v", err, err)
	}
	if apiErr.Status != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422, got %d", apiErr.Status)
	}
	if !strings.Contains(apiErr.Message, "synthetic parse error") {
		t.Fatalf("expected message to include parse error, got %q", apiErr.Message)
	}
}

// TestHandleInbound_UnknownRecipientReturns403 — when the only To address
// doesn't resolve to any mailbox, return 403 with the unknown address(es)
// listed in the message so the bounce is informative.
func TestHandleInbound_UnknownRecipientReturns403(t *testing.T) {
	app := setupInboundTestApp(t)
	seedDomainAndMailbox(t, app, "acme.com", "real", "mb_unknown_001")

	body := postmarkPayload(t, []string{"nobody@acme.com"}, "test", "hello", "<msg-unknown-1@example.org>")
	re, rec := makeInboundRequest(t, app, "tok-unknown", body)

	provider := &stubProvider{parse: (&PostmarkProvider{}).ParseInbound}

	err := handleInbound(app, provider, re, "tok-unknown")
	if err == nil {
		t.Fatalf("expected error response (403), got nil (recorder body: %s)", rec.Body.String())
	}

	apiErr, ok := err.(*router.ApiError)
	if !ok {
		t.Fatalf("expected *router.ApiError, got %T: %v", err, err)
	}
	if apiErr.Status != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", apiErr.Status)
	}
	if !strings.Contains(apiErr.Message, "nobody@acme.com") {
		t.Fatalf("expected message to mention unknown address, got %q", apiErr.Message)
	}
}
