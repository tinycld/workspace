package mail

import (
	"strings"
	"testing"
)

func TestSMTP_BuildOutgoingFrom_UsesAliasAddress(t *testing.T) {
	app := setupAliasTestApp(t)

	seedDomainAndMailbox(t, app, "acme.com", "support", "mb00000000000001")
	seedAlias(t, app, "mb00000000000001", "help", "al00000000000001")

	// Set display_name on the mailbox for a more realistic From header.
	mb, err := app.FindRecordById("mail_mailboxes", padID("mb00000000000001"))
	if err != nil {
		t.Fatalf("load mailbox: %v", err)
	}
	mb.Set("display_name", "Support Team")
	if err := app.Save(mb); err != nil {
		t.Fatalf("save mailbox: %v", err)
	}

	mb, alias, err := resolveMailboxByAddress(app, "help", "acme.com")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	domain, err := app.FindRecordById("mail_domains", mb.GetString("domain"))
	if err != nil {
		t.Fatalf("domain: %v", err)
	}

	s := &smtpSession{mailbox: mb, alias: alias, domain: domain}
	got := buildOutgoingFrom(s)
	if !strings.Contains(got, "help@acme.com") {
		t.Fatalf("expected alias address in From, got %q", got)
	}
	if !strings.Contains(got, "Support Team") {
		t.Fatalf("expected mailbox display_name in From, got %q", got)
	}
}

func TestSMTP_BuildOutgoingFrom_UsesPrimaryWhenNoAlias(t *testing.T) {
	app := setupAliasTestApp(t)

	seedDomainAndMailbox(t, app, "acme.com", "support", "mb00000000000002")

	mb, _, err := resolveMailboxByAddress(app, "support", "acme.com")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	domain, err := app.FindRecordById("mail_domains", mb.GetString("domain"))
	if err != nil {
		t.Fatalf("domain: %v", err)
	}

	s := &smtpSession{mailbox: mb, alias: nil, domain: domain}
	got := buildOutgoingFrom(s)
	if !strings.Contains(got, "support@acme.com") {
		t.Fatalf("expected primary address in From, got %q", got)
	}
}

func TestSMTP_BuildOutgoingFrom_EmptyDisplayName(t *testing.T) {
	app := setupAliasTestApp(t)

	seedDomainAndMailbox(t, app, "acme.com", "support", "mb00000000000003")
	seedAlias(t, app, "mb00000000000003", "help", "al00000000000003")

	mb, alias, err := resolveMailboxByAddress(app, "help", "acme.com")
	if err != nil {
		t.Fatalf("resolve: %v", err)
	}
	domain, err := app.FindRecordById("mail_domains", mb.GetString("domain"))
	if err != nil {
		t.Fatalf("domain: %v", err)
	}

	s := &smtpSession{mailbox: mb, alias: alias, domain: domain}
	got := buildOutgoingFrom(s)
	if got != "<help@acme.com>" {
		t.Fatalf("expected bare angle-addr with empty display_name, got %q", got)
	}
}
