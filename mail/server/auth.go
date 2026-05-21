package mail

import (
	"fmt"

	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
)

// resolveUserOrg finds the user_org record linking a user to an org.
func resolveUserOrg(app *pocketbase.PocketBase, userID, orgID string) (*core.Record, error) {
	records, err := app.FindRecordsByFilter(
		"user_org",
		"user = {:user} && org = {:org}",
		"",  // sort
		1,   // limit
		0,   // offset
		map[string]any{"user": userID, "org": orgID},
	)
	if err != nil || len(records) == 0 {
		return nil, fmt.Errorf("user %s is not a member of org %s", userID, orgID)
	}
	return records[0], nil
}

// verifyMailboxMembership checks that a user_org has access to a mailbox.
func verifyMailboxMembership(app *pocketbase.PocketBase, mailboxID, userOrgID string) (*core.Record, error) {
	records, err := app.FindRecordsByFilter(
		"mail_mailbox_members",
		"mailbox = {:mailbox} && user_org = {:userOrg}",
		"",
		1,
		0,
		map[string]any{"mailbox": mailboxID, "userOrg": userOrgID},
	)
	if err != nil || len(records) == 0 {
		return nil, fmt.Errorf("user_org %s is not a member of mailbox %s", userOrgID, mailboxID)
	}
	return records[0], nil
}

// verifyOrgAdmin checks that a user has the admin role for the given org.
func verifyOrgAdmin(app *pocketbase.PocketBase, userID, orgID string) error {
	userOrg, err := resolveUserOrg(app, userID, orgID)
	if err != nil {
		return err
	}
	role := userOrg.GetString("role")
	if role != "admin" && role != "owner" {
		return fmt.Errorf("user %s is not an admin of org %s", userID, orgID)
	}
	return nil
}

// getMailboxOrgID returns the org ID for a mailbox by expanding through its domain.
func getMailboxOrgID(app *pocketbase.PocketBase, mailboxID string) (string, error) {
	mailbox, err := app.FindRecordById("mail_mailboxes", mailboxID)
	if err != nil {
		return "", fmt.Errorf("mailbox not found: %w", err)
	}

	domainID := mailbox.GetString("domain")
	domain, err := app.FindRecordById("mail_domains", domainID)
	if err != nil {
		return "", fmt.Errorf("domain not found: %w", err)
	}

	return domain.GetString("org"), nil
}
