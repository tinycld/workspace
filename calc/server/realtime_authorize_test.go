package calc

import (
	"errors"
	"testing"

	"github.com/pocketbase/pocketbase"

	"tinycld.org/core/realtime"
)

// TestRegisterRealtimeRegisters confirms registerRealtime plugs the
// "calc" kind into the core realtime registry, and that the
// registered closure rejects nil auth without touching the DB.
//
// The share-grant / share-denied paths require a real PocketBase test
// app with drive_items + drive_shares + user_org schemas populated —
// that integration coverage is owned by the end-to-end Playwright spec
// (phase 9 of the plan).
func TestRegisterRealtimeRegisters(t *testing.T) {
	t.Cleanup(realtime.ResetRegistryForTest)

	app := pocketbase.New()
	registerRealtime(app)

	authorize := realtime.LookupForTest("calc")
	if authorize == nil {
		t.Fatal("registerRealtime did not register the 'calc' room kind")
	}

	if err := authorize(nil, "any-drive-item-id"); !errors.Is(err, errNoShare) {
		t.Fatalf("nil auth: expected errNoShare, got %v", err)
	}
}

// TestRegisterRealtimeDuplicatePanics confirms calling registerRealtime
// twice surfaces as a panic from realtime.RegisterRoomKind. This
// guards against accidental double-init at startup.
func TestRegisterRealtimeDuplicatePanics(t *testing.T) {
	t.Cleanup(realtime.ResetRegistryForTest)

	app := pocketbase.New()
	registerRealtime(app)

	defer func() {
		if r := recover(); r == nil {
			t.Fatal("expected panic on duplicate RegisterRoomKind")
		}
	}()
	registerRealtime(app)
}
