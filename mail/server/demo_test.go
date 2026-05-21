package mail

import (
	"strings"
	"testing"
)

// TestDemoMessageID_HasPrefix locks in the contract used by audit/forensic
// queries: every simulated send writes a message_id starting with "demo-"
// so it's easy to filter in the database.
func TestDemoMessageID_HasPrefix(t *testing.T) {
	id := demoMessageID()
	if !strings.HasPrefix(id, "demo-") {
		t.Errorf("expected demo- prefix, got %q", id)
	}
	if !strings.HasSuffix(id, "@tinycld.local") {
		t.Errorf("expected @tinycld.local suffix, got %q", id)
	}
}

// TestDemoMessageID_Unique guards against an accidental refactor that drops
// the random component (e.g. swapping rand.Read for a fixed buffer). Two
// successive calls must produce different IDs — otherwise concurrent demo
// sends would collide on message_id and break thread storage.
func TestDemoMessageID_Unique(t *testing.T) {
	seen := make(map[string]bool, 100)
	for i := 0; i < 100; i++ {
		id := demoMessageID()
		if seen[id] {
			t.Fatalf("duplicate ID after %d calls: %q", i, id)
		}
		seen[id] = true
	}
}

// TestDemoMessageID_Length keeps the synthesized IDs roughly comparable to
// real RFC-5322 Message-IDs so storage paths that index or display them
// don't behave surprisingly. 8 random bytes hex-encoded = 16 chars; with
// "demo-" + "@tinycld.local" the total is 35.
func TestDemoMessageID_Length(t *testing.T) {
	id := demoMessageID()
	const want = len("demo-") + 16 + len("@tinycld.local")
	if len(id) != want {
		t.Errorf("expected length %d, got %d (%q)", want, len(id), id)
	}
}
