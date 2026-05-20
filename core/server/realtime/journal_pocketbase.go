package realtime

import (
	"encoding/base64"
	"fmt"

	"github.com/pocketbase/pocketbase/core"
)

// JournalCollection is the name of the PocketBase collection that
// stores the WAL rows. Exported so tests and migrations can reference
// the same string.
const JournalCollection = "realtime_doc_updates"

// PocketBaseJournal is the production Journal implementation: it stores
// updates as rows in the realtime_doc_updates collection (one row per
// accepted MsgDocUpdate). The collection lives in the same SQLite
// database the rest of the app uses, so writes are durable against
// SIGKILL via SQLite's WAL journal-mode fsync. The `update` field is
// base64-encoded so the bytes survive PB's text-field encoding; we
// trade ~33% storage overhead for not having to introduce file-typed
// fields on a hot-path collection.
//
// Storage is the only thing PocketBase gives us here — there is no
// REST/API path: realtime_doc_updates rules are all admin-only and the
// broker reads/writes via the Go SDK.
//
// Safe for concurrent use across rooms; the broker serializes Append
// for any single (kind, id) so the implementation does no per-room
// locking.
type PocketBaseJournal struct {
	app core.App
}

// NewPocketBaseJournal returns a journal backed by the realtime_doc_updates
// PocketBase collection in app. The collection must exist (the core
// migration 1860000000_create_realtime_doc_updates.js handles it).
func NewPocketBaseJournal(app core.App) *PocketBaseJournal {
	return &PocketBaseJournal{app: app}
}

// Append persists a single update row. The caller hands a pre-minted
// seq that is strictly monotonic per (kind, id); a duplicate seq
// triggers the collection's unique index and returns an error.
func (j *PocketBaseJournal) Append(kind, id string, seq int64, update []byte) error {
	col, err := j.app.FindCollectionByNameOrId(JournalCollection)
	if err != nil {
		return fmt.Errorf("realtime journal: load collection: %w", err)
	}
	rec := core.NewRecord(col)
	rec.Set("room_kind", kind)
	rec.Set("room_id", id)
	rec.Set("seq", seq)
	rec.Set("update", base64.StdEncoding.EncodeToString(update))
	if err := j.app.Save(rec); err != nil {
		return fmt.Errorf("realtime journal: append kind=%s id=%s seq=%d: %w", kind, id, seq, err)
	}
	return nil
}

// Replay invokes apply once per row stored for (kind, id), in
// ascending seq order. If apply returns a non-nil error, Replay stops
// and returns it — typical use is to abort room bootstrap so the room
// either fully replays or refuses to open. A room with no journal
// rows calls apply zero times and returns nil.
func (j *PocketBaseJournal) Replay(kind, id string, apply func(seq int64, update []byte) error) error {
	records, err := j.app.FindRecordsByFilter(
		JournalCollection,
		"room_kind = {:k} && room_id = {:id}",
		"seq",
		0,
		0,
		map[string]any{"k": kind, "id": id},
	)
	if err != nil {
		return fmt.Errorf("realtime journal: replay query kind=%s id=%s: %w", kind, id, err)
	}
	for _, rec := range records {
		seq := int64(rec.GetInt("seq"))
		encoded := rec.GetString("update")
		decoded, err := base64.StdEncoding.DecodeString(encoded)
		if err != nil {
			return fmt.Errorf("realtime journal: replay decode kind=%s id=%s seq=%d: %w", kind, id, seq, err)
		}
		if err := apply(seq, decoded); err != nil {
			return err
		}
	}
	return nil
}

// Truncate deletes every row for (kind, id) whose seq is <=
// throughSeq. Idempotent: a throughSeq below the current floor is a
// no-op. Called by SaveCoordinator after a successful snapshot flush,
// passing the maxSeq it observed at flush start.
//
// We delete one row at a time via app.Delete rather than a raw SQL
// `DELETE WHERE seq <= ?` because PocketBase's hook layer must see
// each deletion (potentially adding audit / cascade hooks later).
// At the expected scale (<= 1000 rows per truncate per active room
// flush) this is fine; if it becomes a bottleneck, swap to a Dao
// raw-SQL path.
func (j *PocketBaseJournal) Truncate(kind, id string, throughSeq int64) error {
	records, err := j.app.FindRecordsByFilter(
		JournalCollection,
		"room_kind = {:k} && room_id = {:id} && seq <= {:s}",
		"", 0, 0,
		map[string]any{"k": kind, "id": id, "s": throughSeq},
	)
	if err != nil {
		return fmt.Errorf("realtime journal: truncate query kind=%s id=%s through=%d: %w", kind, id, throughSeq, err)
	}
	for _, rec := range records {
		if err := j.app.Delete(rec); err != nil {
			return fmt.Errorf("realtime journal: truncate delete kind=%s id=%s seq=%d: %w", kind, id, int64(rec.GetInt("seq")), err)
		}
	}
	return nil
}

// Compile-time check that *PocketBaseJournal satisfies Journal.
var _ Journal = (*PocketBaseJournal)(nil)
