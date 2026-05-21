package text

import (
	"fmt"
	"log/slog"
	"sync"
	"time"

	ycrdt "github.com/skyterra/y-crdt"

	"tinycld.org/core/realtime"
	"tinycld.org/packages/text/translate"
)

// Janitor / TTL knobs. Package-level vars (not consts) so tests can
// drop them to milliseconds and observe eviction without slow sleeps.
//
// JanitorInterval — how often the janitor wakes to scan registries.
// MaxIdleDuration — docs with no ApplyUpdate / EncodeStateAsUpdate
// activity for this long are forcibly Close()d to bound memory.
// ImportWarningsTTL — bootstrap warnings that no joiner has popped
// after this long are dropped (otherwise a doc that's bootstrapped but
// never opened leaks a slice of warnings forever).
// MaxImportWarningRooms — hard ceiling on the warnings map; oldest
// entry is evicted on overflow.
var (
	JanitorInterval       = 5 * time.Minute
	MaxIdleDuration       = 30 * time.Minute
	ImportWarningsTTL     = 1 * time.Hour
	MaxImportWarningRooms = 256
)

// MaxApplyUpdateBytes bounds the size of a single MsgDocUpdate payload
// the broker is willing to fold into a room's Y.Doc. y-crdt's
// ApplyUpdate allocates per-message; a hostile or buggy client sending
// a 100 MiB frame would exhaust memory before the recover guard
// triggers. Real edits are kilobytes — even a paste of a long document
// rarely exceeds 100 KiB. 1 MiB leaves comfortable headroom for any
// legitimate edit while keeping a single frame's allocation bounded.
const MaxApplyUpdateBytes = 1 * 1024 * 1024

// now is the clock the runtime / janitor read. Replaced in tests to
// drive the TTL paths deterministically without sleeping.
var now = time.Now

// Runtime is the text package's server-side Y.Doc registry. One per
// process; the broker calls NewDoc once per active room and the
// returned handle owns the room's mirror until Close.
//
// Backed by github.com/skyterra/y-crdt (a native-Go yjs decoder /
// encoder). Operations on a single Y.Doc serialize through that doc's
// own internal state machine; the per-room mutex below only guards the
// docs map itself.
type Runtime struct {
	// bootstrap, when non-nil, runs synchronously inside NewDoc with
	// the freshly-minted Y.Doc. Production wires this to load the
	// drive_items docx and seed it into the doc, so the broker's
	// first SyncReply already carries populated content. Tests leave
	// it nil — they construct doc state via ApplyUpdate.
	bootstrap func(roomID string, doc *ycrdt.Doc) error

	mu      sync.Mutex
	docs    map[string]*ycrdt.Doc
	handles map[string]*textDocHandle

	// importWarnings holds per-room warnings produced during bootstrap
	// (e.g. tracked changes stripped, comments dropped). The OnConnect
	// ServerHelloFn pops the entry for a freshly-bootstrapping
	// connection's roomID and includes the warnings in MsgServerHello.
	//
	// Entries are time-stamped on insert so the janitor can evict
	// stale rooms whose first joiner never arrived (otherwise a
	// bootstrap-only doc would leak its warnings slice forever).
	importWarningsMu sync.Mutex
	importWarnings   map[string]importWarningEntry

	// janitor goroutine state. stop is closed by Stop() to break the
	// ticker loop; janitorDone signals the goroutine has exited so
	// Stop() can be synchronous. janitorStarted is set by StartJanitor
	// and read by Stop to know whether to wait on janitorDone.
	janitorOnce    sync.Once
	stopOnce       sync.Once
	stop           chan struct{}
	janitorDone    chan struct{}
	janitorStarted bool
	janitorStartMu sync.Mutex
}

// importWarningEntry pairs a warnings slice with the time it was
// inserted so the janitor can evict stale entries past ImportWarningsTTL.
type importWarningEntry struct {
	warnings []translate.Warning
	at       time.Time
}

// NewRuntime returns an empty Runtime. Cheap; no doc state is allocated
// until NewDoc is called. The janitor goroutine is not started here —
// call StartJanitor (production wires this from Register; tests opt
// in selectively).
func NewRuntime() *Runtime {
	return &Runtime{
		docs:           map[string]*ycrdt.Doc{},
		handles:        map[string]*textDocHandle{},
		importWarnings: map[string]importWarningEntry{},
		stop:           make(chan struct{}),
		janitorDone:    make(chan struct{}),
	}
}

// StartJanitor spins up the background goroutine that evicts idle docs
// and stale import warnings. Idempotent — subsequent calls are no-ops,
// so it's safe for both Register and tests to call.
func (r *Runtime) StartJanitor() {
	r.janitorOnce.Do(func() {
		r.janitorStartMu.Lock()
		r.janitorStarted = true
		r.janitorStartMu.Unlock()
		go r.janitorLoop()
	})
}

// Stop signals the janitor goroutine to exit and blocks until it has.
// Safe to call even if StartJanitor was never invoked. Idempotent —
// subsequent calls are no-ops.
func (r *Runtime) Stop() {
	r.stopOnce.Do(func() {
		close(r.stop)
	})
	r.janitorStartMu.Lock()
	started := r.janitorStarted
	r.janitorStartMu.Unlock()
	if started {
		<-r.janitorDone
	}
}

// janitorLoop is the background reaper. It wakes on JanitorInterval,
// evicts idle docs (lastActivity older than MaxIdleDuration) and
// import warnings older than ImportWarningsTTL. The loop exits when
// Stop() closes the `stop` channel.
func (r *Runtime) janitorLoop() {
	defer close(r.janitorDone)
	ticker := time.NewTicker(JanitorInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.stop:
			return
		case <-ticker.C:
			r.evictIdleDocs()
			r.evictStaleImportWarnings()
		}
	}
}

// evictIdleDocs closes every handle whose lastActivity is older than
// MaxIdleDuration.
//
// Lock ordering matters: Close acquires h.mu and then calls
// closeDoc, which acquires r.mu — so taking r.mu first and then
// h.mu (the natural shape for "scan handles") would deadlock.
// Instead we snapshot the handle pointers under r.mu, release it,
// and only then read lastActivity / call Close per handle.
func (r *Runtime) evictIdleDocs() {
	cutoff := now().Add(-MaxIdleDuration)
	r.mu.Lock()
	snapshot := make([]*textDocHandle, 0, len(r.handles))
	for _, h := range r.handles {
		snapshot = append(snapshot, h)
	}
	r.mu.Unlock()
	for _, h := range snapshot {
		if h.LastActivity().Before(cutoff) {
			_ = h.Close()
		}
	}
}

// evictStaleImportWarnings removes entries past ImportWarningsTTL.
// Called by the janitor on the JanitorInterval tick; SetImportWarnings
// also expires entries inline so insertions never see a stale view.
func (r *Runtime) evictStaleImportWarnings() {
	r.importWarningsMu.Lock()
	defer r.importWarningsMu.Unlock()
	r.expireStaleImportWarningsLocked()
}

// SetBootstrap registers a per-room bootstrap hook. NewDoc invokes the
// hook (if set) inside the same critical section that creates the doc,
// so MsgSyncRequest replies are guaranteed to see the populated state.
//
// A nil hook disables bootstrap (for tests). Passing nil after a hook
// has been registered clears it.
func (r *Runtime) SetBootstrap(hook func(roomID string, doc *ycrdt.Doc) error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.bootstrap = hook
}

// NewDoc satisfies realtime.DocRuntime: mints a fresh server-side
// Y.Doc identified by the broker's roomID and returns an opaque
// handle the broker calls into for the room's lifetime.
//
// If a bootstrap hook is registered, it runs synchronously after the
// doc is created. Bootstrap failures are logged but do not abort the
// room creation — a partially-bootstrapped (or empty) doc is preferable
// to refusing the connection, since a peer-driven SyncRequest path
// can still recover.
func (r *Runtime) NewDoc(roomID string) (realtime.DocHandle, error) {
	r.mu.Lock()
	if _, exists := r.docs[roomID]; exists {
		r.mu.Unlock()
		return nil, fmt.Errorf("text: room %s already has a Y.Doc", roomID)
	}
	doc := ycrdt.NewDoc(roomID, false, nil, nil, false)
	installYXmlElementPatcher(doc)
	r.docs[roomID] = doc
	handle := &textDocHandle{runtime: r, id: roomID, doc: doc, lastActivity: now()}
	r.handles[roomID] = handle
	hook := r.bootstrap
	r.mu.Unlock()

	if hook != nil {
		if err := hook(roomID, doc); err != nil {
			slog.Warn("text: bootstrap hook failed; room continues with empty doc",
				"roomID", roomID, "err", err)
		}
	}
	return handle, nil
}

// installYXmlElementPatcher subscribes a `beforeObserverCalls` listener
// on the doc that walks the transaction's Changed / ChangedParentTypes
// maps and patches any YXmlElement (and its embedded YXmlFragment)
// whose EH/DEH/Map are nil. This works around a y-crdt v0.0.0 quirk:
// the library's NewYXmlElement constructor — invoked from
// content_type.go::readYXmlElement during ApplyUpdate decoding —
// returns an element with PrelimAttrs set but EH/DEH/Map left nil.
// When the transaction cleanup then fires observers on the newly
// inserted YXmlElement (e.g. because text was inserted into it),
// CallTypeObservers → CallEventHandlerListeners panics dereferencing
// nil EH.
//
// `beforeObserverCalls` runs after the read phase has populated the
// transaction's Changed map and BEFORE the loop that calls
// CallObserver on each modified type, so patching here ensures every
// observer-firing path sees a valid EventHandler. The seed path
// (translate.SeedFromPMJSON → newXmlElement) already patches the same
// fields for elements it creates explicitly; this hook covers the
// elements y-crdt mints on its own during inbound update decoding.
func installYXmlElementPatcher(doc *ycrdt.Doc) {
	handler := ycrdt.NewObserverHandler(func(args ...interface{}) {
		if len(args) == 0 {
			return
		}
		trans, ok := args[0].(*ycrdt.Transaction)
		if !ok || trans == nil {
			return
		}
		for t := range trans.Changed {
			patchAbstractType(t)
		}
		for t := range trans.ChangedParentTypes {
			patchAbstractType(t)
		}
	})
	doc.On("beforeObserverCalls", handler)
}

// patchAbstractType walks an IAbstractType-shaped value and initializes
// EH/DEH/Map on the embedded AbstractType if they're nil. Type-switches
// over every concrete Y* type readYXmlElement / readYXmlFragment etc.
// might mint during ApplyUpdate decoding. The branch list mirrors the
// typeRefs table in y-crdt's content_type.go.
func patchAbstractType(t interface{}) {
	switch v := t.(type) {
	case *ycrdt.YXmlElement:
		ensureAbstractTypeInitialized(&v.AbstractType)
	case *ycrdt.YXmlFragment:
		ensureAbstractTypeInitialized(&v.AbstractType)
	case *ycrdt.YXmlText:
		ensureAbstractTypeInitialized(&v.AbstractType)
	case *ycrdt.YText:
		ensureAbstractTypeInitialized(&v.AbstractType)
	case *ycrdt.YArray:
		ensureAbstractTypeInitialized(&v.AbstractType)
	case *ycrdt.YMap:
		ensureAbstractTypeInitialized(&v.AbstractType)
	case *ycrdt.YXmlHook:
		ensureAbstractTypeInitialized(&v.AbstractType)
	}
}

func ensureAbstractTypeInitialized(at *ycrdt.AbstractType) {
	if at.EH == nil {
		at.EH = ycrdt.NewEventHandler()
	}
	if at.DEH == nil {
		at.DEH = ycrdt.NewEventHandler()
	}
	if at.Map == nil {
		at.Map = make(map[string]*ycrdt.Item)
	}
}

// closeDoc removes the doc from the registry. Returns true if the
// doc was registered. Safe to call multiple times.
func (r *Runtime) closeDoc(roomID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.docs[roomID]; !ok {
		return false
	}
	delete(r.docs, roomID)
	delete(r.handles, roomID)
	return true
}

// SetImportWarnings records the warnings produced while bootstrapping
// the given room's Y.Doc. Stored on the runtime (not the handle) so the
// OnConnect ServerHelloFn can pop them by roomID without needing the
// broker to thread the handle through.
//
// Called from the bootstrap closure once parse finishes. A subsequent
// PopImportWarnings drains the entry; the janitor evicts entries past
// ImportWarningsTTL to bound the map for rooms whose first joiner
// never arrives. On overflow past MaxImportWarningRooms we drop the
// oldest entry to keep the map size deterministic.
func (r *Runtime) SetImportWarnings(roomID string, warnings []translate.Warning) {
	r.importWarningsMu.Lock()
	defer r.importWarningsMu.Unlock()
	r.expireStaleImportWarningsLocked()
	r.importWarnings[roomID] = importWarningEntry{warnings: warnings, at: now()}
	if len(r.importWarnings) > MaxImportWarningRooms {
		r.evictOldestImportWarningLocked()
	}
}

// expireStaleImportWarningsLocked drops every entry older than
// ImportWarningsTTL. Caller must hold importWarningsMu.
func (r *Runtime) expireStaleImportWarningsLocked() {
	cutoff := now().Add(-ImportWarningsTTL)
	for id, entry := range r.importWarnings {
		if entry.at.Before(cutoff) {
			delete(r.importWarnings, id)
		}
	}
}

// evictOldestImportWarningLocked drops the single oldest entry from
// importWarnings. Caller must hold importWarningsMu.
func (r *Runtime) evictOldestImportWarningLocked() {
	var oldestID string
	var oldestAt time.Time
	first := true
	for id, entry := range r.importWarnings {
		if first || entry.at.Before(oldestAt) {
			oldestID = id
			oldestAt = entry.at
			first = false
		}
	}
	if oldestID != "" {
		delete(r.importWarnings, oldestID)
	}
}

// PopImportWarnings returns and clears the warnings for the given room.
// Returns nil if no warnings were recorded, the entry has already been
// popped, or it expired past ImportWarningsTTL.
//
// The OnConnect handler calls this once per connection. The first
// connection in a freshly-bootstrapped room sees the warnings; later
// joiners see nil — by design, since the warnings describe an import
// event that happened once at room start.
func (r *Runtime) PopImportWarnings(roomID string) []translate.Warning {
	r.importWarningsMu.Lock()
	defer r.importWarningsMu.Unlock()
	entry, ok := r.importWarnings[roomID]
	if !ok {
		return nil
	}
	delete(r.importWarnings, roomID)
	if now().Sub(entry.at) > ImportWarningsTTL {
		return nil
	}
	return entry.warnings
}

// textDocHandle is the broker's handle on one room's server-side Y.Doc.
type textDocHandle struct {
	runtime *Runtime
	id      string

	mu           sync.Mutex
	doc          *ycrdt.Doc // nil after Close
	closed       bool
	lastActivity time.Time // updated on every ApplyUpdate / EncodeStateAsUpdate
}

// LastActivity returns the timestamp of the most recent ApplyUpdate /
// EncodeStateAsUpdate call. Used by the janitor to decide whether to
// evict the doc as idle. Read under the handle mutex so it's safe
// against concurrent activity updates.
func (h *textDocHandle) LastActivity() time.Time {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.lastActivity
}

// ApplyUpdate folds an inbound MsgDocUpdate payload into the server's
// mirror of the room's Y.Doc.
//
// y-crdt's ApplyUpdate logs and silently returns on malformed bytes
// rather than surfacing a decode error. The defer/recover guards
// against that contract regressing — a future panic-on-bad-input
// change in the library would otherwise take down the broker
// goroutine on hostile client input.
func (h *textDocHandle) ApplyUpdate(payload []byte) error {
	if len(payload) > MaxApplyUpdateBytes {
		return fmt.Errorf(
			"text: ApplyUpdate payload %d bytes exceeds cap %d for room %s",
			len(payload), MaxApplyUpdateBytes, h.id,
		)
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.doc == nil {
		return fmt.Errorf("text: ApplyUpdate on closed room %s", h.id)
	}
	h.lastActivity = now()
	var applyErr error
	func() {
		defer func() {
			if r := recover(); r != nil {
				applyErr = fmt.Errorf("text: ApplyUpdate panic for room %s: %v", h.id, r)
			}
		}()
		ycrdt.ApplyUpdate(h.doc, payload, nil)
	}()
	return applyErr
}

// EncodeStateAsUpdate returns the bytes a new joiner needs to catch
// up to the room's current state. Wrapped by the broker in a
// MsgSyncReply frame.
func (h *textDocHandle) EncodeStateAsUpdate() ([]byte, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed || h.doc == nil {
		return nil, fmt.Errorf("text: EncodeStateAsUpdate on closed room %s", h.id)
	}
	h.lastActivity = now()
	return ycrdt.EncodeStateAsUpdate(h.doc, nil), nil
}

// Close releases the room's Y.Doc so it can be garbage-collected.
func (h *textDocHandle) Close() error {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.closed {
		return nil
	}
	h.closed = true
	h.doc = nil
	h.runtime.closeDoc(h.id)
	return nil
}
