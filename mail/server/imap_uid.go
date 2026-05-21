package mail

import (
	"fmt"
	"sync"

	"github.com/pocketbase/pocketbase/core"
)

// uidMutex serializes UID allocation per mailbox to guarantee monotonicity.
var uidMutex sync.Map // map[string]*sync.Mutex  (mailboxID → mutex)

func mailboxUIDMutex(mailboxID string) *sync.Mutex {
	v, _ := uidMutex.LoadOrStore(mailboxID, &sync.Mutex{})
	return v.(*sync.Mutex)
}

// getOrCreateMailboxState returns the mail_imap_mailbox_state record for a
// mailbox, creating one if it doesn't exist (uid_validity=1, uid_next=1).
func getOrCreateMailboxState(app core.App, mailboxID string) (*core.Record, error) {
	records, err := app.FindRecordsByFilter(
		"mail_imap_mailbox_state",
		"mailbox = {:mailbox}",
		"",
		1,
		0,
		map[string]any{"mailbox": mailboxID},
	)
	if err == nil && len(records) > 0 {
		return records[0], nil
	}

	collection, err := app.FindCollectionByNameOrId("mail_imap_mailbox_state")
	if err != nil {
		return nil, fmt.Errorf("mail_imap_mailbox_state collection not found: %w", err)
	}
	record := core.NewRecord(collection)
	record.Set("mailbox", mailboxID)
	record.Set("uid_validity", 1)
	record.Set("uid_next", 1)
	if err := app.Save(record); err != nil {
		return nil, fmt.Errorf("failed to create mailbox state: %w", err)
	}
	return record, nil
}

// assignUID atomically allocates the next UID for a message within a mailbox
// and sets imap_uid on the message record.
func assignUID(app core.App, mailboxID string, messageRecord *core.Record) (uint32, error) {
	mu := mailboxUIDMutex(mailboxID)
	mu.Lock()
	defer mu.Unlock()

	state, err := getOrCreateMailboxState(app, mailboxID)
	if err != nil {
		return 0, err
	}

	uid := uint32(state.GetInt("uid_next"))

	// Increment uid_next
	state.Set("uid_next", int(uid)+1)
	if err := app.Save(state); err != nil {
		return 0, fmt.Errorf("failed to update uid_next: %w", err)
	}

	// Set UID on message
	messageRecord.Set("imap_uid", int(uid))
	if err := app.Save(messageRecord); err != nil {
		return 0, fmt.Errorf("failed to set imap_uid on message: %w", err)
	}

	return uid, nil
}

// ensureMessageUID assigns a UID to a message if it doesn't have one yet.
// Called on message creation paths (inbound, send, draft).
func ensureMessageUID(app core.App, mailboxID string, messageRecord *core.Record) (uint32, error) {
	existing := messageRecord.GetInt("imap_uid")
	if existing > 0 {
		return uint32(existing), nil
	}
	return assignUID(app, mailboxID, messageRecord)
}

// lookupMessagesByUID queries mail_messages by imap_uid range within a mailbox's threads.
func lookupMessagesByUID(app core.App, mailboxID string, uidLow, uidHigh uint32) ([]*core.Record, error) {
	// Find all threads for this mailbox
	threads, err := app.FindRecordsByFilter(
		"mail_threads",
		"mailbox = {:mailbox}",
		"",
		0, // no limit
		0,
		map[string]any{"mailbox": mailboxID},
	)
	if err != nil || len(threads) == 0 {
		return nil, nil
	}

	threadIDs := make([]any, len(threads))
	for i, t := range threads {
		threadIDs[i] = t.Id
	}

	// Build filter for messages in these threads with UIDs in range
	messages, err := app.FindRecordsByFilter(
		"mail_messages",
		"imap_uid >= {:uidLow} && imap_uid <= {:uidHigh} && thread.mailbox = {:mailbox}",
		"imap_uid",
		0,
		0,
		map[string]any{"uidLow": int(uidLow), "uidHigh": int(uidHigh), "mailbox": mailboxID},
	)
	if err != nil {
		return nil, fmt.Errorf("failed to lookup messages by UID: %w", err)
	}
	return messages, nil
}

// getMailboxUIDValidity returns the UIDVALIDITY for a mailbox.
func getMailboxUIDValidity(app core.App, mailboxID string) (uint32, error) {
	state, err := getOrCreateMailboxState(app, mailboxID)
	if err != nil {
		return 0, err
	}
	return uint32(state.GetInt("uid_validity")), nil
}

// getMailboxUIDNext returns the next UID that will be assigned for a mailbox.
func getMailboxUIDNext(app core.App, mailboxID string) (uint32, error) {
	state, err := getOrCreateMailboxState(app, mailboxID)
	if err != nil {
		return 0, err
	}
	return uint32(state.GetInt("uid_next")), nil
}
