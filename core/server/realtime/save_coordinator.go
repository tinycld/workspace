package realtime

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/getsentry/sentry-go"
)

// Default trigger-policy intervals. Tests construct a coordinator
// with shorter values to keep their wall-clock cost down.
//
// DefaultDebounceInterval: time of inactivity (no new MsgDocUpdate) after
// which a save fires. Roughly the "user paused typing → save"
// experience.
//
// DefaultCeilingInterval: maximum time the saver will defer a save during
// continuous editing. This is the worst-case durability window for
// active typing — server crash mid-edit loses up to this much work.
//
// DefaultTeardownTimeout: how long OnRoomEmpty waits for the final
// synchronous save to complete before giving up. Above this the
// broker continues teardown anyway; the save will retry from the
// in-memory state on the *next* room open if it ever happens, but
// otherwise the edits are lost. Pick a value generous enough that
// even a slow flush (e.g. serializing a large document and writing
// it to PocketBase) completes.
const (
	DefaultDebounceInterval = 3 * time.Second
	DefaultCeilingInterval  = 15 * time.Second
	DefaultTeardownTimeout  = 30 * time.Second
)

// DefaultMaxSaveAttempts caps how many consecutive times the coordinator
// retries a failing flush for one room before giving up the automatic
// retry loop. A deterministic flush failure (e.g. a document the .docx
// exporter structurally can't represent) would otherwise retry every
// 30s forever, burning a save attempt per room indefinitely and never
// surfacing the problem. After this many attempts the coordinator
// reports the failure to Sentry and stops scheduling retries; the room
// stays dirty so a subsequent edit re-arms the timers and tries again,
// which recovers transient failures without the runaway loop.
const DefaultMaxSaveAttempts = 8

// RetryBackoff returns the delay before retrying after a save failure
// number `attempt` (0-indexed). Caps at 30s.
func RetryBackoff(attempt int) time.Duration {
	switch attempt {
	case 0:
		return 1 * time.Second
	case 1:
		return 2 * time.Second
	case 2:
		return 4 * time.Second
	case 3:
		return 8 * time.Second
	case 4:
		return 16 * time.Second
	default:
		return 30 * time.Second
	}
}

// FlushFn is the unit of work the SaveCoordinator schedules: persist
// the current state of the room identified by driveItemID. Returning
// an error triggers an exponential-backoff retry; returning nil ends
// the dirty cycle (until the next OnDocUpdate flips it again).
//
// Implementations must be safe to call concurrently with other
// methods on the same coordinator (the coordinator never invokes
// FlushFn for the same room twice in parallel — see saveInFlight).
type FlushFn func(driveItemID string, handle DocHandle) error

// SaveCoordinator owns the per-room debounce/ceiling/teardown state
// machine that drives persistence in package consumers. One instance
// per process, shared across all rooms of a given kind.
type SaveCoordinator struct {
	flush           FlushFn
	debounceEvery   time.Duration
	ceilingEvery    time.Duration
	teardownTimeout time.Duration
	maxAttempts     int
	logger          *slog.Logger

	// backoff maps a 0-indexed attempt number to the delay before the
	// next retry. Injectable so tests can collapse the wait. Defaults to
	// RetryBackoff.
	backoff func(attempt int) time.Duration

	// captureGiveUp reports a give-up to Sentry. Injectable so tests can
	// observe the give-up without hitting the real SDK. Defaults to
	// captureGiveUpToSentry.
	captureGiveUp func(detail giveUpDetail)

	mu    sync.Mutex
	rooms map[string]*roomSaver

	// kind names the room kind this coordinator drives. Used as the
	// (kind, id) tuple key when journal-truncating after a successful
	// flush. Set via SetJournal.
	kind string

	// journal is the WAL backend whose rows describe edits accepted
	// since the last successful snapshot. nil disables truncation —
	// useful for tests and pure-relay kinds.
	journal Journal
}

// roomSaver is the per-room state. All access is guarded by mu.
type roomSaver struct {
	mu sync.Mutex

	handle DocHandle

	dirty         bool
	firstDirtyAt  time.Time
	debounceTimer *time.Timer
	ceilingTimer  *time.Timer

	saveInFlight bool
	resaveQueued bool
	failures     int

	// lastSeq is the highest seq observed via NoteSeq since the last
	// successful truncate. Captured atomically into snapshotSeq when
	// a flush starts; on success, the coordinator truncates the
	// journal through snapshotSeq.
	lastSeq     int64
	snapshotSeq int64

	// closed flips true the moment OnRoomEmpty's synchronous flush
	// returns. After that, no more save attempts may be scheduled
	// for this room (the broker is releasing the DocHandle).
	closed bool
}

// NewSaveCoordinator returns a SaveCoordinator with production
// defaults. Override intervals (e.g. for tests) by mutating the
// returned value's fields before any room is created.
//
// flush is called whenever a save fires. It receives the room
// identifier (whatever ID space the room kind uses — for calc and
// text it's a drive_items.id; other kinds may key differently) and
// the DocHandle the broker handed us at room creation. A nil flush
// is a programmer error; the coordinator panics on first save attempt.
func NewSaveCoordinator(flush FlushFn) *SaveCoordinator {
	return &SaveCoordinator{
		flush:           flush,
		debounceEvery:   DefaultDebounceInterval,
		ceilingEvery:    DefaultCeilingInterval,
		teardownTimeout: DefaultTeardownTimeout,
		maxAttempts:     DefaultMaxSaveAttempts,
		logger:          slog.Default(),
		backoff:         RetryBackoff,
		captureGiveUp:   captureGiveUpToSentry,
		rooms:           map[string]*roomSaver{},
	}
}

// SetLogger swaps the slog.Logger the coordinator uses for failure
// reporting. Tests use a discarding logger to keep output clean.
func (c *SaveCoordinator) SetLogger(l *slog.Logger) {
	c.logger = l
}

// SetJournal installs a WAL backend on the coordinator. On every
// successful flush, the coordinator calls journal.Truncate(kind, id,
// snapshotSeq) where snapshotSeq is the highest seq observed via
// NoteSeq at the moment the flush kicked off. Pass an empty kind and
// nil journal to disable truncation entirely.
func (c *SaveCoordinator) SetJournal(kind string, journal Journal) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.kind = kind
	c.journal = journal
}

// NoteSeq records the highest seq the broker has minted for the room.
// Called from the broker's route path after each successful journal
// Append. Idempotent: a NoteSeq with a value below the current lastSeq
// is a no-op.
func (c *SaveCoordinator) NoteSeq(driveItemID string, seq int64) {
	c.mu.Lock()
	rs := c.rooms[driveItemID]
	c.mu.Unlock()
	if rs == nil {
		return
	}
	rs.mu.Lock()
	defer rs.mu.Unlock()
	if seq > rs.lastSeq {
		rs.lastSeq = seq
	}
}

// OnRoomCreate is the realtime.RoomKindOptions.OnRoomCreate hook.
// Records the room's DocHandle so we can pass it to flush later.
// The room argument is unused here — SaveCoordinator only needs the
// handle — but it's part of the hook signature.
func (c *SaveCoordinator) OnRoomCreate(driveItemID string, handle DocHandle, _ *Room) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if existing, ok := c.rooms[driveItemID]; ok {
		// Should never happen — the broker only fires create
		// once per (kind, id). Log and overwrite anyway so the
		// process keeps running.
		c.logger.Warn("realtime: OnRoomCreate fired twice for the same room; overwriting", "driveItemID", driveItemID)
		existing.mu.Lock()
		existing.closed = true
		existing.mu.Unlock()
	}
	c.rooms[driveItemID] = &roomSaver{handle: handle}
}

// OnDocUpdate is the realtime.RoomKindOptions.OnDocUpdate hook.
// Marks the room dirty and arms the debounce/ceiling timers. Cheap;
// safe to call from the broker route path.
func (c *SaveCoordinator) OnDocUpdate(driveItemID string) {
	c.mu.Lock()
	rs := c.rooms[driveItemID]
	c.mu.Unlock()
	if rs == nil {
		// MsgDocUpdate arrived for a room we didn't see created.
		// Either NewDoc failed (and the broker fell back to pure
		// relay — no server doc to save) or OnRoomCreate hasn't
		// run yet. Either way, we have nothing to do.
		return
	}

	rs.mu.Lock()
	defer rs.mu.Unlock()
	if rs.closed {
		return
	}

	now := time.Now()
	if !rs.dirty {
		rs.dirty = true
		rs.firstDirtyAt = now
		// Arm the ceiling timer on the first edit of a clean
		// cycle. The debounce timer is reset on every edit; the
		// ceiling fires unconditionally after ceilingEvery so a
		// constant typist still gets a save.
		if rs.ceilingTimer != nil {
			rs.ceilingTimer.Stop()
		}
		rs.ceilingTimer = time.AfterFunc(c.ceilingEvery, func() {
			c.triggerSave(driveItemID, "ceiling")
		})
	}
	// Reset debounce on every edit.
	if rs.debounceTimer != nil {
		rs.debounceTimer.Stop()
	}
	rs.debounceTimer = time.AfterFunc(c.debounceEvery, func() {
		c.triggerSave(driveItemID, "debounce")
	})
}

// OnRoomEmpty is the realtime.RoomKindOptions.OnEmpty hook. Fires
// the final synchronous save and waits up to teardownTimeout for it
// to complete. Returns when (a) the save finished or (b) the timeout
// elapsed; in both cases the broker is free to close the DocHandle.
func (c *SaveCoordinator) OnRoomEmpty(driveItemID string) {
	c.mu.Lock()
	rs := c.rooms[driveItemID]
	if rs != nil {
		delete(c.rooms, driveItemID)
	}
	c.mu.Unlock()
	if rs == nil {
		return
	}

	rs.mu.Lock()
	if rs.debounceTimer != nil {
		rs.debounceTimer.Stop()
		rs.debounceTimer = nil
	}
	if rs.ceilingTimer != nil {
		rs.ceilingTimer.Stop()
		rs.ceilingTimer = nil
	}
	wasDirty := rs.dirty
	rs.dirty = false
	handle := rs.handle
	rs.mu.Unlock()

	if !wasDirty {
		// Nothing to save; mark closed and return immediately.
		rs.mu.Lock()
		rs.closed = true
		rs.mu.Unlock()
		return
	}

	done := make(chan error, 1)
	go func() {
		done <- c.flush(driveItemID, handle)
	}()
	select {
	case err := <-done:
		if err != nil {
			c.logger.Error("realtime: teardown save failed", "driveItemID", driveItemID, "err", err)
		}
	case <-time.After(c.teardownTimeout):
		c.logger.Error("realtime: teardown save timed out", "driveItemID", driveItemID, "timeout", c.teardownTimeout)
	}

	rs.mu.Lock()
	rs.closed = true
	rs.mu.Unlock()
}

// triggerSave is the central save scheduler. Runs on a timer
// goroutine (or recursively via resave) and is therefore concurrent
// with OnDocUpdate calls.
func (c *SaveCoordinator) triggerSave(driveItemID, reason string) {
	c.mu.Lock()
	rs := c.rooms[driveItemID]
	c.mu.Unlock()
	if rs == nil {
		// Room torn down between timer fire and dispatch. The
		// teardown path runs the final save itself.
		return
	}

	rs.mu.Lock()
	if rs.closed {
		rs.mu.Unlock()
		return
	}
	if rs.saveInFlight {
		// Coalesce: just mark the queue and let the in-flight
		// save scheduler pick this up when it finishes.
		rs.resaveQueued = true
		rs.mu.Unlock()
		return
	}
	if !rs.dirty {
		// Nothing to flush — possibly an awareness storm, or a
		// debounce/ceiling fire that raced with a teardown.
		rs.mu.Unlock()
		return
	}
	rs.saveInFlight = true
	rs.dirty = false
	rs.snapshotSeq = rs.lastSeq
	if rs.debounceTimer != nil {
		rs.debounceTimer.Stop()
		rs.debounceTimer = nil
	}
	if rs.ceilingTimer != nil {
		rs.ceilingTimer.Stop()
		rs.ceilingTimer = nil
	}
	handle := rs.handle
	rs.mu.Unlock()

	err := c.flush(driveItemID, handle)

	rs.mu.Lock()
	rs.saveInFlight = false

	if err != nil {
		// Save failed: re-mark dirty so the work isn't forgotten.
		rs.dirty = true
		rs.failures++

		if rs.failures >= c.maxAttempts {
			// Give up the automatic retry loop. A deterministic
			// failure (e.g. a doc the exporter can't represent)
			// would otherwise retry forever. We DON'T clear dirty:
			// a future OnDocUpdate re-arms the timers and retries,
			// recovering transient failures. We just stop the
			// self-perpetuating loop and report it.
			detail := giveUpDetail{
				DriveItemID: driveItemID,
				Kind:        c.kind,
				Reason:      reason,
				Attempts:    rs.failures,
				LastSeq:     rs.lastSeq,
				SnapshotSeq: rs.snapshotSeq,
				Err:         err,
			}
			if rs.debounceTimer != nil {
				rs.debounceTimer.Stop()
				rs.debounceTimer = nil
			}
			rs.mu.Unlock()
			c.logger.Error("realtime: save failed; giving up after max attempts",
				"driveItemID", driveItemID, "kind", c.kind, "reason", reason,
				"attempts", detail.Attempts, "lastSeq", detail.LastSeq,
				"snapshotSeq", detail.SnapshotSeq, "err", err)
			if c.captureGiveUp != nil {
				c.captureGiveUp(detail)
			}
			return
		}

		// Schedule a retry with exponential backoff. The next
		// OnDocUpdate would also re-arm timers, but we want to retry
		// even if no further edits arrive.
		backoff := c.backoff(rs.failures - 1)
		c.logger.Warn("realtime: save failed; scheduling retry",
			"driveItemID", driveItemID, "reason", reason,
			"attempt", rs.failures, "backoff", backoff, "err", err)
		// Use the debounce slot for the retry timer; if the
		// user types in the meantime, OnDocUpdate will reset
		// it to its normal debounce window.
		if rs.debounceTimer != nil {
			rs.debounceTimer.Stop()
		}
		rs.debounceTimer = time.AfterFunc(backoff, func() {
			c.triggerSave(driveItemID, "retry")
		})
		rs.mu.Unlock()
		return
	}

	// Success.
	rs.failures = 0
	resave := rs.resaveQueued
	rs.resaveQueued = false
	snapshotSeq := rs.snapshotSeq
	rs.mu.Unlock()

	c.mu.Lock()
	journal, kind := c.journal, c.kind
	c.mu.Unlock()
	if snapshotSeq > 0 && journal != nil && kind != "" {
		if err := journal.Truncate(kind, driveItemID, snapshotSeq); err != nil {
			c.logger.Warn("realtime: journal truncate failed after flush",
				"driveItemID", driveItemID, "through", snapshotSeq, "err", err)
		}
	}

	if resave {
		// Edits arrived during the in-flight save; immediately
		// re-fire so they don't sit until the next debounce.
		go c.triggerSave(driveItemID, "coalesced")
	}
}

// giveUpDetail is the full set of facts captured when the coordinator
// abandons the automatic retry loop for a room. Everything here goes to
// Sentry so an operator can identify the stuck document and the failing
// flush without correlating log lines by hand.
type giveUpDetail struct {
	DriveItemID string
	Kind        string
	Reason      string
	Attempts    int
	LastSeq     int64
	SnapshotSeq int64
	Err         error
}

// captureGiveUpToSentry reports a save give-up to Sentry as an exception,
// tagged and contextualized with the room identity and retry state.
// Capturing the underlying flush error (rather than a synthetic message)
// preserves Sentry's grouping by error value, so all give-ups sharing a
// root cause (e.g. one unrepresentable document) collapse into a single
// issue. No-op when the Sentry SDK has no DSN configured (dev).
func captureGiveUpToSentry(d giveUpDetail) {
	hub := sentry.CurrentHub().Clone()
	hub.WithScope(func(scope *sentry.Scope) {
		scope.SetLevel(sentry.LevelError)
		scope.SetTag("realtime.give_up", "true")
		scope.SetTag("realtime.kind", d.Kind)
		scope.SetTag("realtime.drive_item_id", d.DriveItemID)
		scope.SetContext("realtime_save", map[string]any{
			"driveItemID": d.DriveItemID,
			"kind":        d.Kind,
			"reason":      d.Reason,
			"attempts":    d.Attempts,
			"lastSeq":     d.LastSeq,
			"snapshotSeq": d.SnapshotSeq,
			"error":       fmt.Sprintf("%v", d.Err),
		})
		if d.Err != nil {
			hub.CaptureException(d.Err)
		} else {
			hub.CaptureMessage(fmt.Sprintf(
				"realtime: gave up saving %s/%s after %d attempts",
				d.Kind, d.DriveItemID, d.Attempts))
		}
	})
}
