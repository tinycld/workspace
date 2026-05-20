package realtime

// Journal is the durability contract for the realtime broker's
// write-ahead log. Each accepted MsgDocUpdate is appended via Append
// before being applied to the server-side Y.Doc and fanned out to
// peers. On room boot, Replay folds every previously-appended update
// (in seq order) into the freshly-bootstrapped Y.Doc, recovering edits
// the server never managed to snapshot. When SaveCoordinator flushes
// the room's content to durable form (e.g. drive_items.file for text /
// calc), it calls Truncate with the highest seq seen at flush start so
// rows whose state is now reflected in the snapshot can be dropped.
//
// Implementations must be safe for concurrent use across rooms. Append
// for a single (kind, id) is always serialized by the broker (one
// goroutine per room route path), so atomic seq minting inside the
// implementation is not required — the caller hands a pre-minted seq.
//
// Method semantics:
//
// Append persists the update bytes for (kind, id) at the caller-provided
// seq. Implementations must return an error if the row already exists
// at that seq (the unique index in PB enforces this); the caller treats
// a duplicate-seq error as a programming bug, not a recoverable state.
//
// Replay invokes apply once per stored entry for (kind, id), in
// ascending seq order. If apply returns an error, Replay stops and
// returns that error to the caller (typically aborts room bootstrap).
//
// Truncate deletes all entries for (kind, id) with seq <= throughSeq.
// Idempotent — calling with a throughSeq below the current floor is a
// no-op.
type Journal interface {
	Append(kind, id string, seq int64, update []byte) error
	Replay(kind, id string, apply func(seq int64, update []byte) error) error
	Truncate(kind, id string, throughSeq int64) error
}

// NoopJournal is the zero-durability implementation used by tests and
// by room kinds that have explicitly opted out of WAL semantics (e.g.
// pure-relay kinds with no server-side mirror). Append succeeds and
// returns nil; Replay calls apply zero times; Truncate is a no-op.
//
// Production room kinds with a RuntimeProvider MUST NOT use this — the
// broker assumes Append durably records every accepted update.
type NoopJournal struct{}

func (NoopJournal) Append(kind, id string, seq int64, update []byte) error {
	return nil
}

func (NoopJournal) Replay(kind, id string, apply func(seq int64, update []byte) error) error {
	return nil
}

func (NoopJournal) Truncate(kind, id string, throughSeq int64) error {
	return nil
}

// Compile-time check that NoopJournal satisfies Journal.
var _ Journal = NoopJournal{}
