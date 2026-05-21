package mail

import (
	"fmt"
	"strings"

	"github.com/pocketbase/pocketbase/core"
)

// resolveSenderAddressRecords returns the local part of the From address,
// preferring the alias address when present.
func resolveSenderAddressRecords(mailbox, alias *core.Record) string {
	if alias != nil {
		return alias.GetString("address")
	}
	return mailbox.GetString("address")
}

// buildFromAddress formats an outgoing From header using the alias address
// when supplied, else the mailbox's primary address. Display name always
// comes from the mailbox record.
func buildFromAddress(mailbox, domain, alias *core.Record) string {
	address := resolveSenderAddressRecords(mailbox, alias)
	displayName := mailbox.GetString("display_name")
	domainName := domain.GetString("domain")
	if displayName == "" {
		return fmt.Sprintf("<%s@%s>", address, domainName)
	}
	return fmt.Sprintf("%s <%s@%s>", displayName, address, domainName)
}

// verifyAliasBelongsToMailbox returns an error if alias is non-nil and does
// not belong to mailboxID. Nil alias is OK.
func verifyAliasBelongsToMailbox(alias *core.Record, mailboxID string) error {
	if alias == nil {
		return nil
	}
	if alias.GetString("mailbox") != mailboxID {
		return fmt.Errorf("alias %s does not belong to mailbox %s", alias.Id, mailboxID)
	}
	return nil
}

// findMailboxViaAlias looks up a mailbox by searching mail_mailbox_aliases
// for an address belonging to the given domain. Returns the mailbox record
// and the matching alias record. Comparison is case-insensitive.
func findMailboxViaAlias(app core.App, domainID, localPart string) (*core.Record, *core.Record, error) {
	normalized := strings.ToLower(strings.TrimSpace(localPart))

	aliases, err := app.FindRecordsByFilter(
		"mail_mailbox_aliases",
		"address = {:address} && mailbox.domain = {:domain}",
		"",
		1,
		0,
		map[string]any{"address": normalized, "domain": domainID},
	)
	if err != nil {
		return nil, nil, fmt.Errorf("alias lookup failed: %w", err)
	}
	if len(aliases) == 0 {
		return nil, nil, fmt.Errorf("alias %s not found on domain %s", localPart, domainID)
	}

	alias := aliases[0]
	mailbox, err := app.FindRecordById("mail_mailboxes", alias.GetString("mailbox"))
	if err != nil {
		return nil, nil, fmt.Errorf("alias %s references unknown mailbox: %w", localPart, err)
	}

	return mailbox, alias, nil
}

// checkAliasAddressAvailable returns an error if `address` collides with an
// existing primary mailbox or another alias on the same domain. Comparisons
// are case-insensitive.
func checkAliasAddressAvailable(app core.App, domainID, address string) error {
	normalized := strings.ToLower(strings.TrimSpace(address))

	mailboxes, err := app.FindRecordsByFilter(
		"mail_mailboxes",
		"address = {:address} && domain = {:domain}",
		"",
		1,
		0,
		map[string]any{"address": normalized, "domain": domainID},
	)
	if err != nil {
		return fmt.Errorf("mailbox lookup failed: %w", err)
	}
	if len(mailboxes) > 0 {
		return fmt.Errorf("address %s is already a primary mailbox on this domain", normalized)
	}

	aliases, err := app.FindRecordsByFilter(
		"mail_mailbox_aliases",
		"address = {:address} && mailbox.domain = {:domain}",
		"",
		1,
		0,
		map[string]any{"address": normalized, "domain": domainID},
	)
	if err != nil {
		return fmt.Errorf("alias lookup failed: %w", err)
	}
	if len(aliases) > 0 {
		return fmt.Errorf("address %s is already an alias on this domain", normalized)
	}

	return nil
}

// checkPrimaryAddressAvailable returns an error if `address` is already taken
// by an alias on the same domain, excluding aliases owned by excludeMailboxID
// (so a mailbox can update without self-colliding). Case-insensitive.
func checkPrimaryAddressAvailable(app core.App, domainID, address, excludeMailboxID string) error {
	normalized := strings.ToLower(strings.TrimSpace(address))

	// limit 2: at most one "self" alias + any colliding alias from another mailbox
	aliases, err := app.FindRecordsByFilter(
		"mail_mailbox_aliases",
		"address = {:address} && mailbox.domain = {:domain}",
		"",
		2,
		0,
		map[string]any{"address": normalized, "domain": domainID},
	)
	if err != nil {
		return fmt.Errorf("alias lookup failed: %w", err)
	}
	for _, a := range aliases {
		if excludeMailboxID != "" && a.GetString("mailbox") == excludeMailboxID {
			continue
		}
		return fmt.Errorf("address %s is already an alias on this domain", normalized)
	}
	return nil
}

// registerAliasHooks wires record-level create/update hooks that enforce
// address uniqueness across primary mailboxes and aliases on the same domain,
// and normalize addresses to lowercase/trimmed form before persistence.
func registerAliasHooks(app core.App) {
	app.OnRecordCreate("mail_mailbox_aliases").BindFunc(func(e *core.RecordEvent) error {
		normalized := strings.ToLower(strings.TrimSpace(e.Record.GetString("address")))
		e.Record.Set("address", normalized)

		mailboxID := e.Record.GetString("mailbox")
		if mailboxID == "" {
			return fmt.Errorf("alias is missing mailbox reference")
		}
		mb, err := e.App.FindRecordById("mail_mailboxes", mailboxID)
		if err != nil {
			return fmt.Errorf("alias references unknown mailbox: %w", err)
		}
		if err := checkAliasAddressAvailable(e.App, mb.GetString("domain"), normalized); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordUpdate("mail_mailbox_aliases").BindFunc(func(e *core.RecordEvent) error {
		normalized := strings.ToLower(strings.TrimSpace(e.Record.GetString("address")))
		e.Record.Set("address", normalized)

		mailboxID := e.Record.GetString("mailbox")
		if mailboxID == "" {
			return fmt.Errorf("alias is missing mailbox reference")
		}

		original, err := e.App.FindRecordById("mail_mailbox_aliases", e.Record.Id)
		if err != nil {
			return fmt.Errorf("failed to load original alias: %w", err)
		}
		originalAddress := strings.ToLower(strings.TrimSpace(original.GetString("address")))
		originalMailbox := original.GetString("mailbox")

		// Skip the availability check when nothing relevant changed.
		if originalAddress == normalized && originalMailbox == mailboxID {
			return e.Next()
		}

		mb, err := e.App.FindRecordById("mail_mailboxes", mailboxID)
		if err != nil {
			return fmt.Errorf("alias references unknown mailbox: %w", err)
		}
		domainID := mb.GetString("domain")

		// Check for cross-mailbox alias collisions, excluding this row itself.
		aliases, err := e.App.FindRecordsByFilter(
			"mail_mailbox_aliases",
			"address = {:address} && mailbox.domain = {:domain}",
			"",
			2,
			0,
			map[string]any{"address": normalized, "domain": domainID},
		)
		if err != nil {
			return fmt.Errorf("alias lookup failed: %w", err)
		}
		for _, a := range aliases {
			if a.Id == e.Record.Id {
				continue
			}
			return fmt.Errorf("address %s is already an alias on this domain", normalized)
		}

		// Check for primary-mailbox collisions on the same domain.
		mailboxes, err := e.App.FindRecordsByFilter(
			"mail_mailboxes",
			"address = {:address} && domain = {:domain}",
			"",
			1,
			0,
			map[string]any{"address": normalized, "domain": domainID},
		)
		if err != nil {
			return fmt.Errorf("mailbox lookup failed: %w", err)
		}
		if len(mailboxes) > 0 {
			return fmt.Errorf("address %s is already a primary mailbox on this domain", normalized)
		}

		return e.Next()
	})

	app.OnRecordCreate("mail_mailboxes").BindFunc(func(e *core.RecordEvent) error {
		normalized := strings.ToLower(strings.TrimSpace(e.Record.GetString("address")))
		e.Record.Set("address", normalized)

		domainID := e.Record.GetString("domain")
		if domainID == "" {
			return fmt.Errorf("mailbox is missing domain reference")
		}
		if err := checkPrimaryAddressAvailable(e.App, domainID, normalized, ""); err != nil {
			return err
		}
		return e.Next()
	})

	app.OnRecordUpdate("mail_mailboxes").BindFunc(func(e *core.RecordEvent) error {
		normalized := strings.ToLower(strings.TrimSpace(e.Record.GetString("address")))
		e.Record.Set("address", normalized)

		domainID := e.Record.GetString("domain")
		if domainID == "" {
			return fmt.Errorf("mailbox is missing domain reference")
		}

		original, err := e.App.FindRecordById("mail_mailboxes", e.Record.Id)
		if err != nil {
			return fmt.Errorf("failed to load original mailbox: %w", err)
		}
		originalAddress := strings.ToLower(strings.TrimSpace(original.GetString("address")))
		originalDomain := original.GetString("domain")

		if originalAddress == normalized && originalDomain == domainID {
			return e.Next()
		}

		if err := checkPrimaryAddressAvailable(e.App, domainID, normalized, e.Record.Id); err != nil {
			return err
		}
		return e.Next()
	})
}
