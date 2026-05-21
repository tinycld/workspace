package mail

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strings"

	"github.com/emersion/go-imap/v2"
	"github.com/emersion/go-imap/v2/imapserver"
	"github.com/pocketbase/pocketbase"
	"github.com/pocketbase/pocketbase/core"
	"github.com/pocketbase/pocketbase/tools/filesystem"
)

// mailboxContext holds the resolved info for a single mailbox membership.
type mailboxContext struct {
	name      string // friendly name for IMAP prefix ("Acme Corp")
	mailboxID string
	orgID     string
	userOrgID string
}

// imapSession implements imapserver.SessionIMAP4rev2 backed by PocketBase.
type imapSession struct {
	app *pocketbase.PocketBase

	// Set after Login
	user     *core.Record   // users record
	userOrgs []*core.Record // user_org records
	// Resolved during Login: all mailbox memberships across all orgs
	mailboxMemberships []*core.Record // mail_mailbox_members records

	// Mailbox index built at login — one entry per mailbox membership
	mailboxIndex []mailboxContext
	multiMailbox bool // true when the user has more than one mailbox

	// Selected state
	selectedMailboxID  string
	selectedOrgID      string
	selectedUserOrgID  string
	selectedFolderName string // bare IMAP folder name (e.g. "INBOX", "Sent", "Labels/Foo")
	// Per-session \Deleted flags (executed on EXPUNGE)
	deleted map[string]bool // message record ID → true
}

var _ imapserver.SessionIMAP4rev2 = (*imapSession)(nil)

func newIMAPSession(app *pocketbase.PocketBase) *imapSession {
	return &imapSession{
		app:     app,
		deleted: make(map[string]bool),
	}
}

// Close cleans up the session.
func (s *imapSession) Close() error {
	s.user = nil
	s.userOrgs = nil
	s.mailboxMemberships = nil
	s.mailboxIndex = nil
	s.multiMailbox = false
	s.selectedMailboxID = ""
	s.selectedFolderName = ""
	s.deleted = nil
	return nil
}

// Login authenticates via PocketBase.
func (s *imapSession) Login(username, password string) error {
	record, err := s.app.FindAuthRecordByEmail("users", username)
	if err != nil {
		return imapserver.ErrAuthFailed
	}
	if !record.ValidatePassword(password) {
		return imapserver.ErrAuthFailed
	}

	s.user = record

	// Load all user_org memberships
	userOrgs, err := s.app.FindRecordsByFilter(
		"user_org",
		"user = {:user}",
		"",
		100,
		0,
		map[string]any{"user": record.Id},
	)
	if err != nil {
		return fmt.Errorf("failed to load user orgs: %w", err)
	}
	s.userOrgs = userOrgs

	// Load all mailbox memberships for all user_orgs
	for _, uo := range userOrgs {
		members, err := s.app.FindRecordsByFilter(
			"mail_mailbox_members",
			"user_org = {:userOrg}",
			"",
			100,
			0,
			map[string]any{"userOrg": uo.Id},
		)
		if err == nil {
			s.mailboxMemberships = append(s.mailboxMemberships, members...)
		}
	}

	// Build mailbox index for multi-org IMAP folder namespacing
	for _, mb := range s.mailboxMemberships {
		mailboxID := mb.GetString("mailbox")
		userOrgID := mb.GetString("user_org")
		mailbox, err := s.app.FindRecordById("mail_mailboxes", mailboxID)
		if err != nil {
			continue
		}
		domain, err := s.app.FindRecordById("mail_domains", mailbox.GetString("domain"))
		if err != nil {
			continue
		}
		orgID := domain.GetString("org")
		name := mailbox.GetString("name")
		if name == "" {
			name = mailbox.GetString("display_name")
		}
		if name == "" {
			name = mailbox.GetString("address") + "@" + domain.GetString("domain")
		}
		s.mailboxIndex = append(s.mailboxIndex, mailboxContext{
			name: name, mailboxID: mailboxID, orgID: orgID, userOrgID: userOrgID,
		})
	}
	s.multiMailbox = len(s.mailboxIndex) > 1

	return nil
}

// Namespace returns the personal namespace descriptor.
func (s *imapSession) Namespace() (*imap.NamespaceData, error) {
	return &imap.NamespaceData{
		Personal: []imap.NamespaceDescriptor{{Delim: imapDelim}},
	}, nil
}

// List enumerates available folders.
func (s *imapSession) List(w *imapserver.ListWriter, ref string, patterns []string, options *imap.ListOptions) error {
	if len(patterns) == 0 {
		return w.WriteList(&imap.ListData{
			Attrs: []imap.MailboxAttr{imap.MailboxAttrNoSelect},
			Delim: imapDelim,
		})
	}

	if len(s.mailboxIndex) == 0 {
		return nil
	}

	var allFolders []imap.ListData

	for _, ctx := range s.mailboxIndex {
		folders, err := listUserFolders(s.app, ctx.orgID, ctx.userOrgID)
		if err != nil {
			continue
		}

		if s.multiMailbox {
			// Emit the mailbox name as a non-selectable parent
			allFolders = append(allFolders, imap.ListData{
				Mailbox: ctx.name,
				Delim:   imapDelim,
				Attrs:   []imap.MailboxAttr{imap.MailboxAttrNoSelect},
			})
			for _, f := range folders {
				f.Mailbox = ctx.name + "/" + f.Mailbox
				allFolders = append(allFolders, f)
			}
		} else {
			allFolders = append(allFolders, folders...)
		}
	}

	for _, data := range allFolders {
		match := false
		for _, pattern := range patterns {
			if imapserver.MatchList(data.Mailbox, imapDelim, ref, pattern) {
				match = true
				break
			}
		}
		if !match {
			continue
		}

		if options != nil && options.SelectSubscribed {
			data.Attrs = append(data.Attrs, imap.MailboxAttrSubscribed)
		}

		if err := w.WriteList(&data); err != nil {
			return err
		}
	}

	return nil
}

// Select opens a mailbox for access.
func (s *imapSession) Select(name string, options *imap.SelectOptions) (*imap.SelectData, error) {
	ctx, bareName := s.matchMailboxContext(name)
	mailboxID, orgID, userOrgID, err := s.resolveFolderWithContext(ctx)
	if err != nil {
		return nil, err
	}

	s.selectedMailboxID = mailboxID
	s.selectedOrgID = orgID
	s.selectedUserOrgID = userOrgID
	s.selectedFolderName = bareName
	s.deleted = make(map[string]bool)

	return s.buildSelectData(bareName)
}

// Unselect closes the selected mailbox without expunging.
func (s *imapSession) Unselect() error {
	s.selectedMailboxID = ""
	s.selectedOrgID = ""
	s.selectedUserOrgID = ""
	s.selectedFolderName = ""
	s.deleted = make(map[string]bool)
	return nil
}

// Status returns mailbox status without selecting it.
func (s *imapSession) Status(name string, options *imap.StatusOptions) (*imap.StatusData, error) {
	ctx, bareName := s.matchMailboxContext(name)
	mailboxID, orgID, userOrgID, err := s.resolveFolderWithContext(ctx)
	if err != nil {
		return nil, err
	}

	return s.buildStatusData(bareName, mailboxID, orgID, userOrgID, options)
}

// Fetch retrieves messages from the selected mailbox.
func (s *imapSession) Fetch(w *imapserver.FetchWriter, numSet imap.NumSet, options *imap.FetchOptions) error {
	messages, err := s.resolveMessages(numSet)
	if err != nil {
		return err
	}

	for seqNum, msg := range messages {
		if err := s.writeMessage(w, uint32(seqNum), msg, options); err != nil {
			return err
		}
	}

	return nil
}

// Search finds messages matching criteria in the selected mailbox.
func (s *imapSession) Search(kind imapserver.NumKind, criteria *imap.SearchCriteria, options *imap.SearchOptions) (*imap.SearchData, error) {
	messages, err := s.selectedMessages()
	if err != nil {
		return nil, err
	}

	// Pre-compute FTS matching for Body/Text criteria to leverage the FTS5
	// index (which has the full body_text, not just the snippet).
	ftsMatchIDs := s.buildFTSMatchSet(criteria)

	var allUIDs []imap.UID
	var allSeqNums []uint32

	for seqNum, msg := range messages {
		if matchesCriteria(s.app, msg, criteria, s.deleted, ftsMatchIDs) {
			uid := imap.UID(msg.GetInt("imap_uid"))
			allUIDs = append(allUIDs, uid)
			allSeqNums = append(allSeqNums, uint32(seqNum))
		}
	}

	data := &imap.SearchData{}
	if kind == imapserver.NumKindUID {
		var uidSet imap.UIDSet
		for _, uid := range allUIDs {
			uidSet.AddNum(uid)
		}
		data.All = uidSet
	} else {
		var seqSet imap.SeqSet
		for _, seq := range allSeqNums {
			seqSet.AddNum(seq)
		}
		data.All = seqSet
	}

	return data, nil
}

// buildFTSMatchSet queries the FTS5 index for Body and Text search criteria,
// returning a set of matching message record IDs. Returns nil if no FTS
// criteria are present (meaning FTS should not constrain results).
func (s *imapSession) buildFTSMatchSet(criteria *imap.SearchCriteria) map[string]bool {
	if criteria == nil {
		return nil
	}

	// Collect all text search terms from Body and Text criteria
	var bodyTerms, textTerms []string
	bodyTerms = append(bodyTerms, criteria.Body...)
	textTerms = append(textTerms, criteria.Text...)

	if len(bodyTerms) == 0 && len(textTerms) == 0 {
		return nil
	}

	result := make(map[string]bool)
	db := s.app.DB()

	// Body searches message body content via FTS
	for _, term := range bodyTerms {
		ftsQuery := sanitizeFTSQuery(term)
		if ftsQuery == "" {
			continue
		}
		var matches []struct {
			RecordID string `db:"record_id"`
		}
		err := db.NewQuery(`
			SELECT record_id FROM fts_mail_messages
			WHERE fts_mail_messages MATCH {:q}
		`).Bind(map[string]any{"q": ftsQuery}).All(&matches)
		if err != nil {
			continue
		}
		// For the first term, seed the set; for subsequent terms, intersect
		if len(result) == 0 && len(bodyTerms) == 1 && len(textTerms) == 0 {
			for _, m := range matches {
				result[m.RecordID] = true
			}
		} else {
			for _, m := range matches {
				result[m.RecordID] = true
			}
		}
	}

	// Text searches both headers and body — query both FTS tables
	for _, term := range textTerms {
		ftsQuery := sanitizeFTSQuery(term)
		if ftsQuery == "" {
			continue
		}

		// Search messages (body + headers)
		var msgMatches []struct {
			RecordID string `db:"record_id"`
		}
		err := db.NewQuery(`
			SELECT record_id FROM fts_mail_messages
			WHERE fts_mail_messages MATCH {:q}
		`).Bind(map[string]any{"q": ftsQuery}).All(&msgMatches)
		if err == nil {
			for _, m := range msgMatches {
				result[m.RecordID] = true
			}
		}

		// Search threads (subject, participants) — need to map thread IDs
		// back to message IDs
		var threadMatches []struct {
			RecordID string `db:"record_id"`
		}
		err = db.NewQuery(`
			SELECT record_id FROM fts_mail_threads
			WHERE fts_mail_threads MATCH {:q}
		`).Bind(map[string]any{"q": ftsQuery}).All(&threadMatches)
		if err == nil {
			for _, tm := range threadMatches {
				// Find all messages in this thread
				msgs, err := s.app.FindRecordsByFilter(
					"mail_messages",
					"thread = {:thread}",
					"",
					0,
					0,
					map[string]any{"thread": tm.RecordID},
				)
				if err == nil {
					for _, msg := range msgs {
						result[msg.Id] = true
					}
				}
			}
		}
	}

	return result
}

// Store modifies flags on messages.
func (s *imapSession) Store(w *imapserver.FetchWriter, numSet imap.NumSet, flags *imap.StoreFlags, options *imap.StoreOptions) error {
	messages, err := s.resolveMessages(numSet)
	if err != nil {
		return err
	}

	for seqNum, msg := range messages {
		s.applyFlags(msg, flags)

		if !flags.Silent {
			respWriter := w.CreateMessage(uint32(seqNum))
			respWriter.WriteUID(imap.UID(msg.GetInt("imap_uid")))
			respWriter.WriteFlags(s.messageFlags(msg))
			respWriter.Close()
		}
	}

	return nil
}

// Copy copies messages to another mailbox.
func (s *imapSession) Copy(numSet imap.NumSet, dest string) (*imap.CopyData, error) {
	destCtx, destBareName := s.matchMailboxContext(dest)
	destMailboxID, _, destUserOrgID, err := s.resolveFolderWithContext(destCtx)
	if err != nil {
		return nil, &imap.Error{
			Type: imap.StatusResponseTypeNo,
			Code: imap.ResponseCodeTryCreate,
			Text: "No such mailbox",
		}
	}

	messages, err := s.resolveMessages(numSet)
	if err != nil {
		return nil, err
	}

	var sourceUIDs, destUIDs imap.UIDSet
	destFolder, _ := imapNameToFolder(destBareName)

	for _, msg := range messages {
		srcUID := imap.UID(msg.GetInt("imap_uid"))
		sourceUIDs.AddNum(srcUID)

		if isLabelFolder(destBareName) {
			s.addLabelToThread(msg.GetString("thread"), destUserOrgID, destCtx.orgID, destBareName)
		} else if destFolder != "" {
			threadID := msg.GetString("thread")
			ensureThreadState(s.app, threadID, destUserOrgID, destFolder, false)
		}

		destUIDs.AddNum(srcUID)
	}

	uidValidity, _ := getMailboxUIDValidity(s.app, destMailboxID)

	return &imap.CopyData{
		UIDValidity: uidValidity,
		SourceUIDs:  sourceUIDs,
		DestUIDs:    destUIDs,
	}, nil
}

// Move moves messages to another mailbox.
func (s *imapSession) Move(w *imapserver.MoveWriter, numSet imap.NumSet, dest string) error {
	destCtx, destBareName := s.matchMailboxContext(dest)
	_, _, destUserOrgID, err := s.resolveFolderWithContext(destCtx)
	if err != nil {
		return &imap.Error{
			Type: imap.StatusResponseTypeNo,
			Code: imap.ResponseCodeTryCreate,
			Text: "No such mailbox",
		}
	}

	messages, err := s.resolveMessages(numSet)
	if err != nil {
		return err
	}

	destFolder, _ := imapNameToFolder(destBareName)
	var sourceUIDs, destUIDs imap.UIDSet

	for _, msg := range messages {
		srcUID := imap.UID(msg.GetInt("imap_uid"))
		sourceUIDs.AddNum(srcUID)
		destUIDs.AddNum(srcUID)

		threadID := msg.GetString("thread")

		if isLabelFolder(destBareName) {
			s.addLabelToThread(threadID, destUserOrgID, destCtx.orgID, destBareName)
		} else if destFolder != "" {
			ensureThreadState(s.app, threadID, destUserOrgID, destFolder, false)
		}
	}

	destValidity, _ := getMailboxUIDValidity(s.app, s.selectedMailboxID)

	return w.WriteCopyData(&imap.CopyData{
		UIDValidity: destValidity,
		SourceUIDs:  sourceUIDs,
		DestUIDs:    destUIDs,
	})
}

// Append adds a message to a mailbox (e.g., saving a draft or archiving from a client).
func (s *imapSession) Append(mailbox string, r imap.LiteralReader, options *imap.AppendOptions) (*imap.AppendData, error) {
	ctx, bareName := s.matchMailboxContext(mailbox)
	mailboxID, _, userOrgID, err := s.resolveFolderWithContext(ctx)
	if err != nil {
		return nil, &imap.Error{
			Type: imap.StatusResponseTypeNo,
			Code: imap.ResponseCodeTryCreate,
			Text: "No such mailbox",
		}
	}

	raw, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("failed to read literal: %w", err)
	}

	msg, err := parseRFC5322(raw)
	if err != nil {
		return nil, fmt.Errorf("failed to parse message: %w", err)
	}

	// Determine folder from the target mailbox name (stripped of prefix)
	folder, _ := imapNameToFolder(bareName)
	if folder == "" || folder == "starred" || folder == "all" {
		folder = "inbox"
	}

	// Set delivery status based on folder
	switch folder {
	case "drafts":
		msg.DeliveryStatus = "draft"
	case "sent":
		msg.DeliveryStatus = "sent"
	default:
		msg.DeliveryStatus = "delivered"
	}

	// Dedup: if a message with this Message-ID already exists in this mailbox
	// (e.g. SMTP submission already saved it before the client APPENDed), reuse
	// the existing thread and message. Folder/flag updates below still apply,
	// so a subsequent APPEND-to-Drafts of the same message correctly retags.
	existingMsg, existingThread, _ := findMessageInMailbox(s.app, mailboxID, msg.MessageID)

	var thread, record *core.Record
	if existingMsg != nil {
		thread = existingThread
		record = existingMsg
	} else {
		thread, err = findOrCreateThread(s.app, mailboxID, msg.Subject, msg.InReplyTo, "")
		if err != nil {
			return nil, err
		}

		record, err = storeMessage(s.app, thread.Id, msg)
		if err != nil {
			return nil, err
		}

		// Store raw headers
		if len(raw) > 0 {
			headerEnd := bytes.Index(raw, []byte("\r\n\r\n"))
			if headerEnd < 0 {
				headerEnd = bytes.Index(raw, []byte("\n\n"))
			}
			if headerEnd > 0 {
				storeRawHeaders(s.app, record, raw[:headerEnd])
			}
		}

		snippet := msg.TextBody
		if snippet == "" {
			snippet = msg.Subject
		}
		updateThreadMetadata(s.app, thread, msg.SenderName, msg.SenderEmail, snippet, msg.Date)
	}

	ensureThreadState(s.app, thread.Id, userOrgID, folder, false)

	// Apply flags from APPEND options
	if options != nil && len(options.Flags) > 0 {
		s.applyAppendFlags(thread.Id, userOrgID, options.Flags)
	}

	uid, err := ensureMessageUID(s.app, mailboxID, record)
	if err != nil {
		return nil, err
	}

	uidValidity, _ := getMailboxUIDValidity(s.app, mailboxID)

	// Notify IDLE sessions
	globalNotifier.notify(mailboxID)

	return &imap.AppendData{
		UID:         imap.UID(uid),
		UIDValidity: uidValidity,
	}, nil
}

// Expunge permanently removes messages marked with \Deleted.
func (s *imapSession) Expunge(w *imapserver.ExpungeWriter, uids *imap.UIDSet) error {
	messages, err := s.selectedMessages()
	if err != nil {
		return err
	}

	for seqNum, msg := range messages {
		msgID := msg.Id
		uid := imap.UID(msg.GetInt("imap_uid"))

		if !s.deleted[msgID] {
			continue
		}

		if uids != nil && !uids.Contains(uid) {
			continue
		}

		// Move to trash, or permanently delete if already in trash
		threadID := msg.GetString("thread")
		states, err := s.app.FindRecordsByFilter(
			"mail_thread_state",
			"thread = {:thread} && user_org = {:userOrg}",
			"",
			1,
			0,
			map[string]any{"thread": threadID, "userOrg": s.selectedUserOrgID},
		)
		if err == nil && len(states) > 0 {
			if states[0].GetString("folder") == "trash" {
				// Already in trash — permanently delete the message
				s.app.Delete(msg)
			} else {
				// Move to trash
				states[0].Set("folder", "trash")
				s.app.Save(states[0])
			}
		}

		delete(s.deleted, msgID)

		if err := w.WriteExpunge(uint32(seqNum)); err != nil {
			return err
		}
	}

	return nil
}

// Create creates a new mailbox (only label folders supported).
func (s *imapSession) Create(name string, options *imap.CreateOptions) error {
	ctx, bareName := s.matchMailboxContext(name)
	if isSystemFolder(bareName) {
		return &imap.Error{
			Type: imap.StatusResponseTypeNo,
			Text: "Cannot create system folder",
		}
	}
	if !isLabelFolder(bareName) && !strings.HasPrefix(bareName, "Labels/") {
		return &imap.Error{
			Type: imap.StatusResponseTypeNo,
			Text: "Can only create label folders (Labels/<name>)",
		}
	}
	return createLabelFolder(s.app, ctx.orgID, bareName)
}

// Delete deletes a mailbox (only label folders supported).
func (s *imapSession) Delete(name string) error {
	ctx, bareName := s.matchMailboxContext(name)
	if isSystemFolder(bareName) {
		return &imap.Error{
			Type: imap.StatusResponseTypeNo,
			Text: "Cannot delete system folder",
		}
	}
	return deleteLabelFolder(s.app, ctx.orgID, bareName)
}

// Rename renames a mailbox (only label folders supported).
func (s *imapSession) Rename(oldName, newName string, options *imap.RenameOptions) error {
	oldCtx, oldBareName := s.matchMailboxContext(oldName)
	_, newBareName := s.matchMailboxContext(newName)
	if isSystemFolder(oldBareName) || isSystemFolder(newBareName) {
		return &imap.Error{
			Type: imap.StatusResponseTypeNo,
			Text: "Cannot rename system folder",
		}
	}
	return renameLabelFolder(s.app, oldCtx.orgID, oldBareName, newBareName)
}

// Subscribe is a no-op (all folders are always subscribed).
func (s *imapSession) Subscribe(name string) error { return nil }

// Unsubscribe is a no-op.
func (s *imapSession) Unsubscribe(name string) error { return nil }

// Poll checks for updates since the last check.
func (s *imapSession) Poll(w *imapserver.UpdateWriter, allowExpunge bool) error {
	// No-op for now — updates are pushed via Idle
	return nil
}

// Idle waits for changes to the selected mailbox.
func (s *imapSession) Idle(w *imapserver.UpdateWriter, stop <-chan struct{}) error {
	if s.selectedMailboxID == "" {
		<-stop
		return nil
	}

	ch := make(chan struct{}, 1)
	globalNotifier.subscribe(s.selectedMailboxID, ch)
	defer globalNotifier.unsubscribe(s.selectedMailboxID, ch)

	for {
		select {
		case <-stop:
			return nil
		case <-ch:
			// Mailbox changed — send EXISTS/RECENT update
			messages, err := s.selectedMessages()
			if err != nil {
				continue
			}
			exists := uint32(len(messages))
			if err := w.WriteNumMessages(exists); err != nil {
				return err
			}
		}
	}
}

// --- Helper methods ---

// matchMailboxContext matches an IMAP folder name to a mailbox context.
// For multi-mailbox sessions, it strips the mailbox name prefix.
// Returns the matching context and the bare folder name (without prefix).
func (s *imapSession) matchMailboxContext(name string) (mailboxContext, string) {
	if len(s.mailboxIndex) == 0 {
		return mailboxContext{}, name
	}
	if !s.multiMailbox {
		return s.mailboxIndex[0], name
	}
	for _, ctx := range s.mailboxIndex {
		prefix := ctx.name + "/"
		if strings.HasPrefix(name, prefix) {
			return ctx, name[len(prefix):]
		}
		// Exact match on the mailbox name itself (e.g. SELECT "Acme Corp")
		if name == ctx.name {
			return ctx, "INBOX"
		}
	}
	// No prefix match — default to first
	return s.mailboxIndex[0], name
}

// resolveFolderWithContext resolves mailbox/org/userOrg from a pre-matched context.
func (s *imapSession) resolveFolderWithContext(ctx mailboxContext) (mailboxID, orgID, userOrgID string, err error) {
	if ctx.mailboxID == "" {
		return "", "", "", &imap.Error{
			Type: imap.StatusResponseTypeNo,
			Code: imap.ResponseCodeNonExistent,
			Text: "No mailbox available",
		}
	}
	return ctx.mailboxID, ctx.orgID, ctx.userOrgID, nil
}

// buildSelectData constructs the response data for a SELECT command.
func (s *imapSession) buildSelectData(name string) (*imap.SelectData, error) {
	messages, err := s.selectedMessages()
	if err != nil {
		return nil, err
	}

	uidValidity, _ := getMailboxUIDValidity(s.app, s.selectedMailboxID)
	uidNext, _ := getMailboxUIDNext(s.app, s.selectedMailboxID)

	numMessages := uint32(len(messages))

	// Count recent (unread) messages
	var numRecent uint32
	for _, msg := range messages {
		threadID := msg.GetString("thread")
		states, err := s.app.FindRecordsByFilter(
			"mail_thread_state",
			"thread = {:thread} && user_org = {:userOrg} && is_read = false",
			"",
			1,
			0,
			map[string]any{"thread": threadID, "userOrg": s.selectedUserOrgID},
		)
		if err == nil && len(states) > 0 {
			numRecent++
		}
	}

	flags := []imap.Flag{
		imap.FlagSeen,
		imap.FlagAnswered,
		imap.FlagFlagged,
		imap.FlagDeleted,
		imap.FlagDraft,
	}

	return &imap.SelectData{
		Flags:          flags,
		PermanentFlags: append(flags, imap.Flag(`\*`)),
		NumMessages:    numMessages,
		UIDValidity:    uidValidity,
		UIDNext:        imap.UID(uidNext),
	}, nil
}

// buildStatusData constructs the response data for a STATUS command.
func (s *imapSession) buildStatusData(name, mailboxID, orgID, userOrgID string, options *imap.StatusOptions) (*imap.StatusData, error) {
	data := &imap.StatusData{Mailbox: name}

	if options == nil {
		return data, nil
	}

	if options.NumMessages {
		messages, err := s.messagesForFolder(name, mailboxID, orgID, userOrgID)
		if err == nil {
			n := uint32(len(messages))
			data.NumMessages = &n
		}
	}

	if options.UIDValidity {
		v, _ := getMailboxUIDValidity(s.app, mailboxID)
		data.UIDValidity = v
	}

	if options.UIDNext {
		n, _ := getMailboxUIDNext(s.app, mailboxID)
		uid := imap.UID(n)
		data.UIDNext = uid
	}

	if options.NumUnseen {
		filter, params := folderToFilter(s.app, name, orgID, userOrgID)
		filter += " && is_read = false"
		states, err := s.app.FindRecordsByFilter("mail_thread_state", filter, "", 0, 0, params)
		if err == nil {
			n := uint32(len(states))
			data.NumUnseen = &n
		}
	}

	return data, nil
}

// selectedMessages returns all messages visible in the currently selected folder.
func (s *imapSession) selectedMessages() (map[int]*core.Record, error) {
	if s.selectedMailboxID == "" {
		return nil, &imap.Error{
			Type: imap.StatusResponseTypeNo,
			Text: "No mailbox selected",
		}
	}

	// Determine which IMAP folder is selected based on stored state
	// We use the mailbox + userOrg to get thread states, then load messages
	return s.messagesForSelectedFolder()
}

// messagesForSelectedFolder loads messages for whatever folder is currently
// selected. Routes through messagesForFolder so SELECT respects the
// mail_thread_state.folder filter (consistent with STATUS).
func (s *imapSession) messagesForSelectedFolder() (map[int]*core.Record, error) {
	msgs, err := s.messagesForFolder(s.selectedFolderName, s.selectedMailboxID, s.selectedOrgID, s.selectedUserOrgID)
	if err != nil {
		return nil, err
	}

	result := make(map[int]*core.Record)
	seqNum := 1
	for _, msg := range msgs {
		if msg.GetInt("imap_uid") > 0 {
			result[seqNum] = msg
			seqNum++
		}
	}
	return result, nil
}

// messagesForFolder loads messages for a specific IMAP folder name.
func (s *imapSession) messagesForFolder(imapName, mailboxID, orgID, userOrgID string) ([]*core.Record, error) {
	filter, params := folderToFilter(s.app, imapName, orgID, userOrgID)

	states, err := s.app.FindRecordsByFilter(
		"mail_thread_state",
		filter,
		"",
		0,
		0,
		params,
	)
	if err != nil {
		return nil, err
	}

	var messages []*core.Record
	for _, state := range states {
		threadID := state.GetString("thread")
		msgs, err := s.app.FindRecordsByFilter(
			"mail_messages",
			"thread = {:thread}",
			"imap_uid",
			0,
			0,
			map[string]any{"thread": threadID},
		)
		if err == nil {
			messages = append(messages, msgs...)
		}
	}

	return messages, nil
}

// resolveMessages converts an IMAP NumSet (seq nums or UIDs) to message records.
func (s *imapSession) resolveMessages(numSet imap.NumSet) (map[int]*core.Record, error) {
	allMsgs, err := s.selectedMessages()
	if err != nil {
		return nil, err
	}

	result := make(map[int]*core.Record)

	switch set := numSet.(type) {
	case imap.UIDSet:
		for seqNum, msg := range allMsgs {
			uid := imap.UID(msg.GetInt("imap_uid"))
			if set.Contains(uid) {
				result[seqNum] = msg
			}
		}
	case imap.SeqSet:
		for seqNum, msg := range allMsgs {
			if set.Contains(uint32(seqNum)) {
				result[seqNum] = msg
			}
		}
	}

	return result, nil
}

// writeMessage writes a single message to the FetchWriter.
func (s *imapSession) writeMessage(w *imapserver.FetchWriter, seqNum uint32, msg *core.Record, options *imap.FetchOptions) error {
	respWriter := w.CreateMessage(seqNum)

	uid := imap.UID(msg.GetInt("imap_uid"))
	respWriter.WriteUID(uid)

	if options.Flags {
		respWriter.WriteFlags(s.messageFlags(msg))
	}

	if options.InternalDate {
		respWriter.WriteInternalDate(parseDate(msg.GetString("date")))
	}

	if options.Envelope {
		respWriter.WriteEnvelope(s.buildEnvelope(msg))
	}

	if options.RFC822Size {
		// Estimate size — build the RFC 5322 to get accurate size
		rfc5322, err := buildRFC5322(s.app, msg)
		if err == nil {
			respWriter.WriteRFC822Size(int64(len(rfc5322)))
		}
	}

	// Handle body section fetches
	for _, section := range options.BodySection {
		s.writeBodySection(respWriter, msg, section)
	}

	return respWriter.Close()
}

// writeBodySection handles a BODY[] or BODY[HEADER] fetch.
func (s *imapSession) writeBodySection(respWriter *imapserver.FetchResponseWriter, msg *core.Record, section *imap.FetchItemBodySection) {
	rfc5322, err := buildRFC5322(s.app, msg)
	if err != nil {
		return
	}

	var data []byte
	if len(section.Part) == 0 && section.Specifier == imap.PartSpecifierNone {
		// BODY[] — full message
		data = rfc5322
	} else if section.Specifier == imap.PartSpecifierHeader {
		// BODY[HEADER] — headers only
		headerEnd := bytes.Index(rfc5322, []byte("\r\n\r\n"))
		if headerEnd < 0 {
			headerEnd = bytes.Index(rfc5322, []byte("\n\n"))
		}
		if headerEnd >= 0 {
			data = rfc5322[:headerEnd+4] // include \r\n\r\n
		} else {
			data = rfc5322
		}
	} else if section.Specifier == imap.PartSpecifierText {
		// BODY[TEXT] — body only
		headerEnd := bytes.Index(rfc5322, []byte("\r\n\r\n"))
		if headerEnd >= 0 {
			data = rfc5322[headerEnd+4:]
		}
	} else {
		data = rfc5322
	}

	// Apply partial fetch (octet range)
	if section.Partial != nil {
		offset := int64(section.Partial.Offset)
		if offset >= int64(len(data)) {
			data = nil
		} else {
			count := int64(section.Partial.Size)
			end := offset + count
			if end > int64(len(data)) {
				end = int64(len(data))
			}
			data = data[offset:end]
		}
	}

	wc := respWriter.WriteBodySection(section, int64(len(data)))
	wc.Write(data)
	wc.Close()

	// Mark as seen if not a peek
	if !section.Peek {
		s.markSeen(msg)
	}
}

// buildEnvelope constructs an IMAP Envelope from a message record.
func (s *imapSession) buildEnvelope(msg *core.Record) *imap.Envelope {
	env := &imap.Envelope{
		Date:      parseDate(msg.GetString("date")),
		Subject:   msg.GetString("subject"),
		MessageID: msg.GetString("message_id"),
		InReplyTo: []string{},
	}

	if irt := msg.GetString("in_reply_to"); irt != "" {
		env.InReplyTo = []string{irt}
	}

	env.From = []imap.Address{makeIMAPAddress(msg.GetString("sender_name"), msg.GetString("sender_email"))}
	env.Sender = env.From

	env.To = parseIMAPAddresses(msg.GetString("recipients_to"))
	env.Cc = parseIMAPAddresses(msg.GetString("recipients_cc"))

	return env
}

// messageFlags returns the IMAP flags for a message.
func (s *imapSession) messageFlags(msg *core.Record) []imap.Flag {
	var flags []imap.Flag

	threadID := msg.GetString("thread")
	states, _ := s.app.FindRecordsByFilter(
		"mail_thread_state",
		"thread = {:thread} && user_org = {:userOrg}",
		"",
		1,
		0,
		map[string]any{"thread": threadID, "userOrg": s.selectedUserOrgID},
	)

	if len(states) > 0 {
		if states[0].GetBool("is_read") {
			flags = append(flags, imap.FlagSeen)
		}
		if states[0].GetBool("is_starred") {
			flags = append(flags, imap.FlagFlagged)
		}
	}

	if msg.GetString("delivery_status") == "draft" {
		flags = append(flags, imap.FlagDraft)
	}

	if s.deleted[msg.Id] {
		flags = append(flags, imap.FlagDeleted)
	}

	return flags
}

// applyFlags modifies thread state based on IMAP flag operations.
func (s *imapSession) applyFlags(msg *core.Record, flags *imap.StoreFlags) {
	threadID := msg.GetString("thread")
	states, err := s.app.FindRecordsByFilter(
		"mail_thread_state",
		"thread = {:thread} && user_org = {:userOrg}",
		"",
		1,
		0,
		map[string]any{"thread": threadID, "userOrg": s.selectedUserOrgID},
	)
	if err != nil || len(states) == 0 {
		return
	}
	state := states[0]

	for _, flag := range flags.Flags {
		val := flags.Op == imap.StoreFlagsAdd || flags.Op == imap.StoreFlagsSet
		if flags.Op == imap.StoreFlagsDel {
			val = false
		}

		switch flag {
		case imap.FlagSeen:
			state.Set("is_read", val)
		case imap.FlagFlagged:
			state.Set("is_starred", val)
		case imap.FlagDeleted:
			if val {
				s.deleted[msg.Id] = true
			} else {
				delete(s.deleted, msg.Id)
			}
		}
	}

	s.app.Save(state)
}

// applyAppendFlags applies flags from an APPEND command.
func (s *imapSession) applyAppendFlags(threadID, userOrgID string, flags []imap.Flag) {
	states, err := s.app.FindRecordsByFilter(
		"mail_thread_state",
		"thread = {:thread} && user_org = {:userOrg}",
		"",
		1,
		0,
		map[string]any{"thread": threadID, "userOrg": userOrgID},
	)
	if err != nil || len(states) == 0 {
		return
	}
	state := states[0]

	for _, flag := range flags {
		switch flag {
		case imap.FlagSeen:
			state.Set("is_read", true)
		case imap.FlagFlagged:
			state.Set("is_starred", true)
		}
	}
	s.app.Save(state)
}

// markSeen marks the thread as read when a non-peek BODY fetch occurs.
func (s *imapSession) markSeen(msg *core.Record) {
	threadID := msg.GetString("thread")
	states, err := s.app.FindRecordsByFilter(
		"mail_thread_state",
		"thread = {:thread} && user_org = {:userOrg}",
		"",
		1,
		0,
		map[string]any{"thread": threadID, "userOrg": s.selectedUserOrgID},
	)
	if err != nil || len(states) == 0 {
		return
	}
	states[0].Set("is_read", true)
	s.app.Save(states[0])
}

// addLabelToThread tags a thread with a label by creating a label_assignments
// row (collection = "mail_thread_state", record_id = thread_state.id). This
// matches how the web UI writes labels, so IMAP tags are immediately visible
// there. The label lookup matches both org-level labels and the user's personal
// labels. Idempotent — a second tag of the same label is a no-op.
func (s *imapSession) addLabelToThread(threadID, userOrgID, orgID, imapName string) {
	labelName := extractLabelName(imapName)
	if labelName == "" {
		return
	}

	labels, err := s.app.FindRecordsByFilter(
		"labels",
		`org = {:org} && name = {:name} && (user_org = "" || user_org = {:userOrg})`,
		"",
		1,
		0,
		map[string]any{"org": orgID, "name": labelName, "userOrg": userOrgID},
	)
	if err != nil || len(labels) == 0 {
		return
	}

	states, err := s.app.FindRecordsByFilter(
		"mail_thread_state",
		"thread = {:thread} && user_org = {:userOrg}",
		"",
		1,
		0,
		map[string]any{"thread": threadID, "userOrg": userOrgID},
	)
	if err != nil || len(states) == 0 {
		return
	}

	labelID := labels[0].Id
	stateID := states[0].Id

	existing, err := s.app.FindRecordsByFilter(
		"label_assignments",
		`label = {:label} && record_id = {:recordId} && collection = "mail_thread_state" && user_org = {:userOrg}`,
		"",
		1,
		0,
		map[string]any{"label": labelID, "recordId": stateID, "userOrg": userOrgID},
	)
	if err == nil && len(existing) > 0 {
		return
	}

	collection, err := s.app.FindCollectionByNameOrId("label_assignments")
	if err != nil {
		return
	}
	record := core.NewRecord(collection)
	record.Set("label", labelID)
	record.Set("record_id", stateID)
	record.Set("collection", "mail_thread_state")
	record.Set("user_org", userOrgID)
	s.app.Save(record)
}

// storeRawHeaders saves original RFC 5322 headers to a message record.
func storeRawHeaders(app *pocketbase.PocketBase, record *core.Record, headers []byte) {
	f, err := filesystem.NewFileFromBytes(headers, "headers.txt")
	if err != nil {
		return
	}
	record.Set("raw_headers", f)
	app.Save(record)
}

// matchesCriteria checks if a message matches IMAP search criteria.
// ftsMatchIDs is a pre-computed set of message record IDs matching Body/Text
// criteria via FTS5. nil means no FTS criteria are present.
func matchesCriteria(app *pocketbase.PocketBase, msg *core.Record, criteria *imap.SearchCriteria, deleted map[string]bool, ftsMatchIDs map[string]bool) bool {
	if criteria == nil {
		return true
	}

	// Check flag criteria
	for _, flag := range criteria.Flag {
		switch flag {
		case imap.FlagSeen:
			// Would need thread state, simplified for now
		case imap.FlagDeleted:
			if !deleted[msg.Id] {
				return false
			}
		}
	}

	for _, flag := range criteria.NotFlag {
		switch flag {
		case imap.FlagDeleted:
			if deleted[msg.Id] {
				return false
			}
		}
	}

	// Check date criteria
	if !criteria.Since.IsZero() {
		msgDate := parseDate(msg.GetString("date"))
		if msgDate.Before(criteria.Since) {
			return false
		}
	}
	if !criteria.Before.IsZero() {
		msgDate := parseDate(msg.GetString("date"))
		if !msgDate.Before(criteria.Before) {
			return false
		}
	}

	// Check header criteria
	for _, hdr := range criteria.Header {
		switch strings.ToLower(hdr.Key) {
		case "subject":
			if !strings.Contains(strings.ToLower(msg.GetString("subject")), strings.ToLower(hdr.Value)) {
				return false
			}
		case "from":
			from := msg.GetString("sender_name") + " " + msg.GetString("sender_email")
			if !strings.Contains(strings.ToLower(from), strings.ToLower(hdr.Value)) {
				return false
			}
		}
	}

	// Check Body/Text criteria via pre-computed FTS match set.
	// If FTS criteria were present (ftsMatchIDs != nil), the message must
	// appear in the set. This uses the FTS5 index which has the full
	// body_text (not just the truncated snippet), giving accurate results.
	if ftsMatchIDs != nil && !ftsMatchIDs[msg.Id] {
		return false
	}

	// Check UID criteria
	if len(criteria.UID) > 0 {
		uid := imap.UID(msg.GetInt("imap_uid"))
		matched := false
		for _, uidSet := range criteria.UID {
			if uidSet.Contains(uid) {
				matched = true
				break
			}
		}
		if !matched {
			return false
		}
	}

	// Check OR criteria
	for _, pair := range criteria.Or {
		if !matchesCriteria(app, msg, &pair[0], deleted, ftsMatchIDs) && !matchesCriteria(app, msg, &pair[1], deleted, ftsMatchIDs) {
			return false
		}
	}

	// Check NOT criteria
	for _, sub := range criteria.Not {
		if matchesCriteria(app, msg, &sub, deleted, ftsMatchIDs) {
			return false
		}
	}

	return true
}

// makeIMAPAddress converts name/email to an imap.Address.
func makeIMAPAddress(name, email string) imap.Address {
	localPart, domain := splitAddress(email)
	return imap.Address{
		Name:    name,
		Mailbox: localPart,
		Host:    domain,
	}
}

// parseIMAPAddresses parses a JSON recipient list into IMAP addresses.
func parseIMAPAddresses(jsonStr string) []imap.Address {
	if jsonStr == "" || jsonStr == "[]" || jsonStr == "null" {
		return nil
	}
	var recipients []Recipient
	if err := json.Unmarshal([]byte(jsonStr), &recipients); err != nil {
		return nil
	}
	addrs := make([]imap.Address, 0, len(recipients))
	for _, r := range recipients {
		addrs = append(addrs, makeIMAPAddress(r.Name, r.Email))
	}
	return addrs
}
