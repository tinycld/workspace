package mail

import (
	"strings"
	"testing"
)

func TestBuildFromAddress_UsesAliasWhenPresent(t *testing.T) {
	app := setupAliasTestApp(t)

	seedDomainAndMailbox(t, app, "acme.com", "support", "mb_send_test003")
	seedAlias(t, app, "mb_send_test003", "help", "al_send_test003")

	mb, err := app.FindRecordById("mail_mailboxes", padID("mb_send_test003"))
	if err != nil {
		t.Fatalf("failed to load mailbox: %v", err)
	}
	domain, err := app.FindRecordById("mail_domains", mb.GetString("domain"))
	if err != nil {
		t.Fatalf("failed to load domain: %v", err)
	}
	alias, err := app.FindRecordById("mail_mailbox_aliases", padID("al_send_test003"))
	if err != nil {
		t.Fatalf("failed to load alias: %v", err)
	}

	got := buildFromAddress(mb, domain, alias)
	if !strings.Contains(got, "help@acme.com") {
		t.Fatalf("expected alias address in From, got %q", got)
	}
}

func TestBuildFromAddress_UsesPrimaryWhenAliasNil(t *testing.T) {
	app := setupAliasTestApp(t)

	seedDomainAndMailbox(t, app, "acme.com", "support", "mb_send_test004")

	mb, err := app.FindRecordById("mail_mailboxes", padID("mb_send_test004"))
	if err != nil {
		t.Fatalf("failed to load mailbox: %v", err)
	}
	domain, err := app.FindRecordById("mail_domains", mb.GetString("domain"))
	if err != nil {
		t.Fatalf("failed to load domain: %v", err)
	}

	got := buildFromAddress(mb, domain, nil)
	if !strings.Contains(got, "support@acme.com") {
		t.Fatalf("expected primary address in From, got %q", got)
	}
}

func TestVerifyAliasBelongsToMailbox_RejectsMismatch(t *testing.T) {
	app := setupAliasTestApp(t)

	seedDomainAndMailbox(t, app, "acme.com", "support", "mb_send_test005")
	seedDomainAndMailbox(t, app, "acme2.com", "sales", "mb_send_test006")
	seedAlias(t, app, "mb_send_test006", "help", "al_send_test006")

	alias, err := app.FindRecordById("mail_mailbox_aliases", padID("al_send_test006"))
	if err != nil {
		t.Fatalf("failed to load alias: %v", err)
	}

	if verifyAliasBelongsToMailbox(alias, padID("mb_send_test005")) == nil {
		t.Fatal("expected error for alias belonging to different mailbox")
	}
	if err := verifyAliasBelongsToMailbox(alias, padID("mb_send_test006")); err != nil {
		t.Fatalf("expected no error for matching mailbox, got %v", err)
	}
	if err := verifyAliasBelongsToMailbox(nil, padID("mb_send_test005")); err != nil {
		t.Fatalf("expected no error for nil alias, got %v", err)
	}
}
