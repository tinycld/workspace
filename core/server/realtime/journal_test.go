package realtime

import (
	"testing"
)

func TestNoopJournalAppendReturnsNil(t *testing.T) {
	j := NoopJournal{}
	if err := j.Append("text-doc", "room-1", 1, []byte("payload")); err != nil {
		t.Fatalf("Append: %v", err)
	}
}

func TestNoopJournalReplayCallsApplyZeroTimes(t *testing.T) {
	j := NoopJournal{}
	calls := 0
	apply := func(seq int64, payload []byte) error {
		calls++
		return nil
	}
	if err := j.Replay("text-doc", "room-1", apply); err != nil {
		t.Fatalf("Replay: %v", err)
	}
	if calls != 0 {
		t.Fatalf("apply called %d times; want 0", calls)
	}
}

func TestNoopJournalTruncateNoop(t *testing.T) {
	j := NoopJournal{}
	if err := j.Truncate("text-doc", "room-1", 999); err != nil {
		t.Fatalf("Truncate: %v", err)
	}
}
