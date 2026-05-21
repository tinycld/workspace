package mail

import (
	"strings"
	"testing"

	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tests"
)

// padID normalises a test fixture ID to PocketBase's default format:
// exactly 15 lowercase alphanumeric characters.
func padID(id string) string {
	lower := strings.ToLower(id)
	stripped := make([]byte, 0, len(lower))
	for i := 0; i < len(lower); i++ {
		c := lower[i]
		if (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') {
			stripped = append(stripped, c)
		}
	}
	out := string(stripped)
	if len(out) >= 15 {
		return out[:15]
	}
	return out + strings.Repeat("x", 15-len(out))
}

func setupAliasTestApp(t *testing.T) *tests.TestApp {
	t.Helper()
	app, err := tests.NewTestApp()
	if err != nil {
		t.Fatalf("failed to create test app: %v", err)
	}
	t.Cleanup(func() { app.Cleanup() })

	// mail_domains (domain text only — we don't care about org FK for these unit tests)
	domains := core.NewBaseCollection("mail_domains")
	domains.Fields.Add(&core.TextField{Name: "domain", Required: true})
	domains.Fields.Add(&core.TextField{Name: "org"})
	if err := app.Save(domains); err != nil {
		t.Fatalf("failed to save mail_domains: %v", err)
	}

	// mail_mailboxes
	mailboxes := core.NewBaseCollection("mail_mailboxes")
	mailboxes.Fields.Add(&core.TextField{Name: "address", Required: true})
	mailboxes.Fields.Add(&core.RelationField{
		Name:          "domain",
		Required:      true,
		CollectionId:  domains.Id,
		CascadeDelete: true,
		MaxSelect:     1,
	})
	mailboxes.Fields.Add(&core.TextField{Name: "display_name"})
	mailboxes.Fields.Add(&core.TextField{Name: "type"})
	if err := app.Save(mailboxes); err != nil {
		t.Fatalf("failed to save mail_mailboxes: %v", err)
	}

	// mail_mailbox_aliases
	aliases := core.NewBaseCollection("mail_mailbox_aliases")
	aliases.Fields.Add(&core.RelationField{
		Name:          "mailbox",
		Required:      true,
		CollectionId:  mailboxes.Id,
		CascadeDelete: true,
		MaxSelect:     1,
	})
	aliases.Fields.Add(&core.TextField{Name: "address", Required: true})
	if err := app.Save(aliases); err != nil {
		t.Fatalf("failed to save mail_mailbox_aliases: %v", err)
	}

	return app
}

func TestResolveMailboxByAddress_PrimaryMatch(t *testing.T) {
	app := setupAliasTestApp(t)

	_ = seedDomainAndMailbox(t, app, "example.com", "support", "mbox_primary")

	mailbox, alias, err := resolveMailboxByAddress(app, "support", "example.com")
	if err != nil {
		t.Fatalf("expected primary match, got error: %v", err)
	}
	if mailbox == nil || mailbox.Id != padID("mbox_primary") {
		t.Fatalf("expected mailbox mbox_primary, got %+v", mailbox)
	}
	if alias != nil {
		t.Fatalf("expected nil alias on primary match, got %+v", alias)
	}
}

func TestResolveMailboxByAddress_AliasMatch(t *testing.T) {
	app := setupAliasTestApp(t)

	seedDomainAndMailbox(t, app, "example.com", "team", "mbox_alias_tgt")
	seedAlias(t, app, "mbox_alias_tgt", "help", "alias_help")

	mailbox, alias, err := resolveMailboxByAddress(app, "help", "example.com")
	if err != nil {
		t.Fatalf("expected alias match, got error: %v", err)
	}
	if mailbox == nil || mailbox.Id != padID("mbox_alias_tgt") {
		t.Fatalf("expected mailbox mbox_alias_tgt, got %+v", mailbox)
	}
	if alias == nil || alias.Id != padID("alias_help") {
		t.Fatalf("expected alias alias_help, got %+v", alias)
	}
}

func TestResolveMailboxByAddress_AliasOnWrongDomainDoesNotMatch(t *testing.T) {
	app := setupAliasTestApp(t)

	seedDomainAndMailbox(t, app, "example.com", "team", "mbox_domainA")
	seedAlias(t, app, "mbox_domainA", "help", "alias_help_a")

	// Second domain, no aliases
	seedDomainAndMailbox(t, app, "other.com", "team", "mbox_domainB")

	_, _, err := resolveMailboxByAddress(app, "help", "other.com")
	if err == nil {
		t.Fatalf("expected not-found error when alias lives on a different domain")
	}
}

func TestResolveMailboxByAddress_CaseInsensitive(t *testing.T) {
	app := setupAliasTestApp(t)

	seedDomainAndMailbox(t, app, "example.com", "team", "mbox_case")
	seedAlias(t, app, "mbox_case", "help", "alias_case_help")

	mailbox, alias, err := resolveMailboxByAddress(app, "HELP", "EXAMPLE.COM")
	if err != nil {
		t.Fatalf("expected case-insensitive alias match, got error: %v", err)
	}
	if mailbox == nil || mailbox.Id != padID("mbox_case") {
		t.Fatalf("expected mailbox mbox_case, got %+v", mailbox)
	}
	if alias == nil || alias.Id != padID("alias_case_help") {
		t.Fatalf("expected alias alias_case_help, got %+v", alias)
	}
}

func TestAliasCollision_WithExistingMailboxAddress(t *testing.T) {
	app := setupAliasTestApp(t)

	domainID := seedDomainAndMailbox(t, app, "example.com", "support", "mbox_coll_primary")

	if err := checkAliasAddressAvailable(app, domainID, "support"); err == nil {
		t.Fatalf("expected collision error when alias matches existing primary address")
	}
}

func TestAliasCollision_WithExistingAlias(t *testing.T) {
	app := setupAliasTestApp(t)

	domainID := seedDomainAndMailbox(t, app, "example.com", "team", "mbox_coll_alias")
	seedAlias(t, app, "mbox_coll_alias", "help", "alias_existing")

	if err := checkAliasAddressAvailable(app, domainID, "help"); err == nil {
		t.Fatalf("expected collision error when alias matches existing alias")
	}
}

func TestAliasCollision_CaseInsensitive(t *testing.T) {
	app := setupAliasTestApp(t)

	domainID := seedDomainAndMailbox(t, app, "example.com", "support", "mbox_case_primary")

	if err := checkAliasAddressAvailable(app, domainID, "SUPPORT"); err == nil {
		t.Fatalf("expected case-insensitive collision against primary address")
	}
}

func TestMailboxCollision_WithExistingAlias(t *testing.T) {
	app := setupAliasTestApp(t)

	domainID := seedDomainAndMailbox(t, app, "example.com", "team", "mbox_existing")
	seedAlias(t, app, "mbox_existing", "help", "alias_blocks_new_mailbox")

	// A different mailbox cannot claim "help" as its primary
	if err := checkPrimaryAddressAvailable(app, domainID, "help", padID("some_other_mbx")); err == nil {
		t.Fatalf("expected collision when new mailbox primary matches existing alias")
	}

	// The mailbox that owns the alias is allowed (e.g. an update that renames itself)
	if err := checkPrimaryAddressAvailable(app, domainID, "help", padID("mbox_existing")); err != nil {
		t.Fatalf("expected no collision when alias belongs to excluded mailbox, got %v", err)
	}
}

// --- helpers ---

func seedDomainAndMailbox(t *testing.T, app core.App, domainStr, localPart, mailboxID string) string {
	t.Helper()

	domainsCol, err := app.FindCollectionByNameOrId("mail_domains")
	if err != nil {
		t.Fatalf("mail_domains collection missing: %v", err)
	}
	domain := core.NewRecord(domainsCol)
	domain.Set("domain", domainStr)
	domain.Set("org", "orgplaceholder")
	if err := app.Save(domain); err != nil {
		t.Fatalf("failed to save domain %s: %v", domainStr, err)
	}

	mailboxesCol, err := app.FindCollectionByNameOrId("mail_mailboxes")
	if err != nil {
		t.Fatalf("mail_mailboxes collection missing: %v", err)
	}
	mailbox := core.NewRecord(mailboxesCol)
	mailbox.Id = padID(mailboxID)
	mailbox.Set("address", localPart)
	mailbox.Set("domain", domain.Id)
	mailbox.Set("type", "personal")
	if err := app.Save(mailbox); err != nil {
		t.Fatalf("failed to save mailbox %s@%s: %v", localPart, domainStr, err)
	}

	return domain.Id
}

func TestAliasHook_RejectsDuplicatePrimaryAddress(t *testing.T) {
	app := setupAliasTestApp(t)
	registerAliasHooks(app)

	seedDomainAndMailbox(t, app, "example.com", "support", "mbox_hook_primary")

	aliasesCol, err := app.FindCollectionByNameOrId("mail_mailbox_aliases")
	if err != nil {
		t.Fatalf("mail_mailbox_aliases collection missing: %v", err)
	}
	alias := core.NewRecord(aliasesCol)
	alias.Set("mailbox", padID("mbox_hook_primary"))
	alias.Set("address", "support")
	if err := app.Save(alias); err == nil {
		t.Fatalf("expected alias save to fail due to primary-address collision")
	}
}

func TestAliasHook_NormalizesUppercaseAddressOnCreate(t *testing.T) {
	app := setupAliasTestApp(t)
	registerAliasHooks(app)

	seedDomainAndMailbox(t, app, "example.com", "team", "mbox_hook_norm")

	aliasesCol, err := app.FindCollectionByNameOrId("mail_mailbox_aliases")
	if err != nil {
		t.Fatalf("mail_mailbox_aliases collection missing: %v", err)
	}
	alias := core.NewRecord(aliasesCol)
	alias.Id = padID("alias_hook_norm")
	alias.Set("mailbox", padID("mbox_hook_norm"))
	alias.Set("address", "HELP")
	if err := app.Save(alias); err != nil {
		t.Fatalf("expected alias save to succeed, got %v", err)
	}

	reloaded, err := app.FindRecordById("mail_mailbox_aliases", padID("alias_hook_norm"))
	if err != nil {
		t.Fatalf("failed to reload saved alias: %v", err)
	}
	if got := reloaded.GetString("address"); got != "help" {
		t.Fatalf("expected normalized address 'help', got %q", got)
	}
}

func TestPrimaryHook_RejectsCollidingWithAlias(t *testing.T) {
	app := setupAliasTestApp(t)
	registerAliasHooks(app)

	domainID := seedDomainAndMailbox(t, app, "example.com", "support", "mbox_hook_existing")
	seedAlias(t, app, "mbox_hook_existing", "help", "alias_hook_blocks")

	mailboxesCol, err := app.FindCollectionByNameOrId("mail_mailboxes")
	if err != nil {
		t.Fatalf("mail_mailboxes collection missing: %v", err)
	}
	mailbox := core.NewRecord(mailboxesCol)
	mailbox.Set("address", "help")
	mailbox.Set("domain", domainID)
	mailbox.Set("type", "personal")
	if err := app.Save(mailbox); err == nil {
		t.Fatalf("expected mailbox save to fail due to alias collision")
	}
}

func seedAlias(t *testing.T, app core.App, mailboxID, address, aliasID string) {
	t.Helper()

	aliasesCol, err := app.FindCollectionByNameOrId("mail_mailbox_aliases")
	if err != nil {
		t.Fatalf("mail_mailbox_aliases collection missing: %v", err)
	}
	alias := core.NewRecord(aliasesCol)
	alias.Id = padID(aliasID)
	alias.Set("mailbox", padID(mailboxID))
	alias.Set("address", address)
	if err := app.Save(alias); err != nil {
		t.Fatalf("failed to save alias %s: %v", address, err)
	}
}
