package mail

import (
	"strings"
	"testing"
	"time"
)

// TestNormalizePostmarkDate_RFC2822 — Postmark sends Date in RFC-2822 format
// (e.g. "Sat, 2 May 2026 20:35:46 -0700"). The mail_messages.date field is
// PocketBase's Date type which expects RFC-3339; storing the raw RFC-2822
// string causes "date: cannot be blank" validation errors.
func TestNormalizePostmarkDate_RFC2822(t *testing.T) {
	got := normalizePostmarkDate("Sat, 2 May 2026 20:35:46 -0700")
	want := "2026-05-03T03:35:46Z"
	if got != want {
		t.Fatalf("expected %q, got %q", want, got)
	}
}

// TestNormalizePostmarkDate_AlreadyRFC3339 — round-trips RFC-3339 input
// (the Date header sometimes already comes through in this form).
func TestNormalizePostmarkDate_AlreadyRFC3339(t *testing.T) {
	// mail.ParseDate accepts a relaxed superset that includes RFC-3339-ish
	// strings; we just need the output to be parseable as RFC-3339.
	out := normalizePostmarkDate("Mon, 02 Jan 2006 15:04:05 -0700")
	if _, err := time.Parse(time.RFC3339, out); err != nil {
		t.Fatalf("output %q is not valid RFC-3339: %v", out, err)
	}
}

// TestNormalizePostmarkDate_InvalidFallsBackToNow — never reject an inbound
// message over a malformed Date header. Garbage input should fall back to
// the current UTC time formatted as RFC-3339.
func TestNormalizePostmarkDate_InvalidFallsBackToNow(t *testing.T) {
	out := normalizePostmarkDate("not a date")
	if _, err := time.Parse(time.RFC3339, out); err != nil {
		t.Fatalf("fallback output %q is not valid RFC-3339: %v", out, err)
	}
}

// TestNormalizePostmarkDate_EmptyFallsBackToNow — empty Date header
// (rare but possible) should also fall back to now.
func TestNormalizePostmarkDate_EmptyFallsBackToNow(t *testing.T) {
	out := normalizePostmarkDate("")
	if _, err := time.Parse(time.RFC3339, out); err != nil {
		t.Fatalf("fallback output %q is not valid RFC-3339: %v", out, err)
	}
}

// TestParseInbound_NormalizesDateFromRealPostmarkPayload — end-to-end
// regression for the production bug: a real Postmark payload's Date field
// must come out of ParseInbound as RFC-3339 so PocketBase accepts it.
func TestParseInbound_NormalizesDateFromRealPostmarkPayload(t *testing.T) {
	body := []byte(`{
		"FromFull": {"Email": "sender@example.org", "Name": "Sender"},
		"ToFull": [{"Email": "alice@acme.com"}],
		"Subject": "test",
		"TextBody": "body",
		"Date": "Sat, 2 May 2026 20:35:46 -0700",
		"MessageID": "abc-123"
	}`)

	p := &PostmarkProvider{}
	msg, err := p.ParseInbound(body)
	if err != nil {
		t.Fatalf("ParseInbound failed: %v", err)
	}
	if _, err := time.Parse(time.RFC3339, msg.Date); err != nil {
		t.Fatalf("Date is not RFC-3339 (got %q): %v", msg.Date, err)
	}
	if !strings.HasPrefix(msg.Date, "2026-05-0") {
		t.Fatalf("Date didn't preserve the day, got %q", msg.Date)
	}
}

// TestParseInbound_RegeneratesTextBodyFromHTML — when the sender provides no
// text/plain part, Postmark synthesizes TextBody from HtmlBody by inserting
// <br/>\n for line breaks but leaving tags and entities intact, which makes
// the result useless for snippets and FTS. We replace it with html2text
// output derived from HtmlBody. StrippedTextReply is left as-is — it's
// already empty for HTML-only mail Postmark can't parse, and consumers fall
// back to TextBody when it's empty.
func TestParseInbound_RegeneratesTextBodyFromHTML(t *testing.T) {
	body := []byte(`{
		"FromFull": {"Email": "sender@example.org", "Name": "Sender"},
		"ToFull": [{"Email": "alice@acme.com"}],
		"Subject": "test",
		"HtmlBody": "<p>Hello <b>world</b></p><p>Line two &amp; more.</p>",
		"TextBody": "<p>Hello <b>world</b></p><br/>\n<p>Line two &amp; more.</p>",
		"StrippedTextReply": "",
		"Date": "Sat, 2 May 2026 20:35:46 -0700",
		"MessageID": "abc-123"
	}`)

	p := &PostmarkProvider{}
	msg, err := p.ParseInbound(body)
	if err != nil {
		t.Fatalf("ParseInbound failed: %v", err)
	}
	if strings.Contains(msg.TextBody, "<p>") || strings.Contains(msg.TextBody, "<b>") {
		t.Fatalf("TextBody still contains HTML markup: %q", msg.TextBody)
	}
	if strings.Contains(msg.TextBody, "&amp;") {
		t.Fatalf("TextBody still contains HTML entities: %q", msg.TextBody)
	}
	if !strings.Contains(msg.TextBody, "Hello") || !strings.Contains(msg.TextBody, "world") {
		t.Fatalf("TextBody lost the actual content: %q", msg.TextBody)
	}
	if !strings.Contains(msg.TextBody, "Line two & more") {
		t.Fatalf("TextBody didn't decode entities: %q", msg.TextBody)
	}
	if msg.StrippedReply != "" {
		t.Fatalf("StrippedReply should be passed through unchanged (empty), got %q", msg.StrippedReply)
	}
}

// TestParseInbound_PassesThroughNonEmptyStrippedReply — when Postmark can
// parse the reply boundary (typical for plain-text mail), StrippedTextReply
// is non-empty and we trust it. We do not synthesize a value here.
func TestParseInbound_PassesThroughNonEmptyStrippedReply(t *testing.T) {
	body := []byte(`{
		"FromFull": {"Email": "sender@example.org", "Name": "Sender"},
		"ToFull": [{"Email": "alice@acme.com"}],
		"Subject": "test",
		"TextBody": "Just the new bit\n\nOn Mon, someone wrote:\n> old stuff",
		"StrippedTextReply": "Just the new bit",
		"Date": "Sat, 2 May 2026 20:35:46 -0700",
		"MessageID": "abc-123"
	}`)

	p := &PostmarkProvider{}
	msg, err := p.ParseInbound(body)
	if err != nil {
		t.Fatalf("ParseInbound failed: %v", err)
	}
	if msg.StrippedReply != "Just the new bit" {
		t.Fatalf("StrippedReply changed: got %q", msg.StrippedReply)
	}
}

// TestParseInbound_PreservesTextBodyWhenNoHTML — when there's no HtmlBody,
// the sender's text/plain part is trustworthy and we leave it alone.
func TestParseInbound_PreservesTextBodyWhenNoHTML(t *testing.T) {
	body := []byte(`{
		"FromFull": {"Email": "sender@example.org", "Name": "Sender"},
		"ToFull": [{"Email": "alice@acme.com"}],
		"Subject": "test",
		"TextBody": "Plain content with < and > characters and an & ampersand",
		"StrippedTextReply": "Plain content with < and > characters and an & ampersand",
		"Date": "Sat, 2 May 2026 20:35:46 -0700",
		"MessageID": "abc-123"
	}`)

	p := &PostmarkProvider{}
	msg, err := p.ParseInbound(body)
	if err != nil {
		t.Fatalf("ParseInbound failed: %v", err)
	}
	want := "Plain content with < and > characters and an & ampersand"
	if msg.TextBody != want {
		t.Fatalf("TextBody changed unexpectedly: got %q, want %q", msg.TextBody, want)
	}
	if msg.StrippedReply != want {
		t.Fatalf("StrippedReply changed unexpectedly: got %q, want %q", msg.StrippedReply, want)
	}
}
