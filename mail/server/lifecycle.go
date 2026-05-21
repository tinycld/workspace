package mail

import (
	"fmt"
	"regexp"
	"strings"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

var addressSanitizer = regexp.MustCompile(`[^a-z0-9._-]`)

// handleUserOrgCreated auto-creates a personal mailbox when a user joins an org.
func handleUserOrgCreated(app *pocketbase.PocketBase, userOrgRecord *core.Record) {
	orgID := userOrgRecord.GetString("org")
	userID := userOrgRecord.GetString("user")

	// Find verified mail domains for this org
	domains, err := app.FindRecordsByFilter(
		"mail_domains",
		"org = {:org} && verified = true",
		"created",
		1,
		0,
		map[string]any{"org": orgID},
	)
	if err != nil || len(domains) == 0 {
		return
	}
	domain := domains[0]

	// Look up user to get name/email
	user, err := app.FindRecordById("users", userID)
	if err != nil {
		app.Logger().Warn("mail lifecycle: failed to find user",
			"userID", userID, "error", err)
		return
	}

	address := deriveMailboxAddress(app, user.GetString("email"), domain.Id)
	if address == "" {
		app.Logger().Warn("mail lifecycle: could not derive mailbox address",
			"userEmail", user.GetString("email"))
		return
	}

	// Create the personal mailbox
	mbCollection, err := app.FindCollectionByNameOrId("mail_mailboxes")
	if err != nil {
		app.Logger().Warn("mail lifecycle: mail_mailboxes collection not found", "error", err)
		return
	}

	mailbox := core.NewRecord(mbCollection)
	mailbox.Set("address", address)
	mailbox.Set("domain", domain.Id)
	mailbox.Set("display_name", user.GetString("name"))
	mailbox.Set("type", "personal")
	org, orgErr := app.FindRecordById("orgs", orgID)
	if orgErr == nil {
		mailbox.Set("name", org.GetString("name"))
	}
	if err := app.Save(mailbox); err != nil {
		app.Logger().Warn("mail lifecycle: failed to create personal mailbox",
			"address", address, "error", err)
		return
	}

	// Add the user as owner
	memberCollection, err := app.FindCollectionByNameOrId("mail_mailbox_members")
	if err != nil {
		app.Logger().Warn("mail lifecycle: mail_mailbox_members collection not found", "error", err)
		return
	}

	member := core.NewRecord(memberCollection)
	member.Set("mailbox", mailbox.Id)
	member.Set("user_org", userOrgRecord.Id)
	member.Set("role", "owner")
	if err := app.Save(member); err != nil {
		app.Logger().Warn("mail lifecycle: failed to create mailbox member",
			"mailbox", mailbox.Id, "error", err)
	}
}

// handleUserOrgDeleted cleans up orphaned personal mailboxes after a user leaves an org.
func handleUserOrgDeleted(app *pocketbase.PocketBase, userOrgRecord *core.Record) {
	orgID := userOrgRecord.GetString("org")

	domains, err := app.FindRecordsByFilter(
		"mail_domains",
		"org = {:org}",
		"",
		100,
		0,
		map[string]any{"org": orgID},
	)
	if err != nil || len(domains) == 0 {
		return
	}

	for _, domain := range domains {
		mailboxes, err := app.FindRecordsByFilter(
			"mail_mailboxes",
			"type = 'personal' && domain = {:domain}",
			"",
			1000,
			0,
			map[string]any{"domain": domain.Id},
		)
		if err != nil {
			continue
		}

		for _, mailbox := range mailboxes {
			members, err := app.FindRecordsByFilter(
				"mail_mailbox_members",
				"mailbox = {:mailbox}",
				"",
				1,
				0,
				map[string]any{"mailbox": mailbox.Id},
			)
			if err != nil || len(members) == 0 {
				if err := app.Delete(mailbox); err != nil {
					app.Logger().Warn("mail lifecycle: failed to delete orphaned mailbox",
						"mailboxID", mailbox.Id, "error", err)
				}
			}
		}
	}
}

// deriveMailboxAddress generates a unique mailbox address from a user's email.
func deriveMailboxAddress(app *pocketbase.PocketBase, userEmail, domainID string) string {
	parts := strings.SplitN(userEmail, "@", 2)
	if len(parts) == 0 || parts[0] == "" {
		return ""
	}

	base := strings.ToLower(parts[0])
	base = addressSanitizer.ReplaceAllString(base, "")
	if base == "" {
		return ""
	}

	// Try the base address first, then append numeric suffixes
	candidate := base
	for i := 2; i <= 99; i++ {
		existing, err := app.FindRecordsByFilter(
			"mail_mailboxes",
			"address = {:address} && domain = {:domain}",
			"",
			1,
			0,
			map[string]any{"address": candidate, "domain": domainID},
		)
		if err != nil || len(existing) == 0 {
			return candidate
		}
		candidate = fmt.Sprintf("%s%d", base, i)
	}

	return ""
}
