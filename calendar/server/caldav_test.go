package calendar

import (
	"strings"
	"testing"
)

// TestOrEqualsFilterSingle confirms one value produces one equality
// clause with a uniquely-keyed placeholder. The shape matters because
// PB's FindRecordsByFilter substitutes {:key} before parsing — getting
// the placeholder syntax wrong is what produced the "expected a sign
// operator" error in the first place.
func TestOrEqualsFilterSingle(t *testing.T) {
	filter, params := orEqualsFilter("user_org", []string{"abc"}, nil)

	if filter != "user_org = {:user_org_0}" {
		t.Errorf("filter mismatch: %q", filter)
	}
	if got, want := params["user_org_0"], "abc"; got != want {
		t.Errorf("param mismatch: got %v, want %v", got, want)
	}
}

// TestOrEqualsFilterMultiple confirms N values produce N OR-joined
// equality clauses with distinct placeholder keys. Distinct keys matter:
// if two clauses shared a key, only the last value would bind, and the
// query would silently miss N-1 of the values.
func TestOrEqualsFilterMultiple(t *testing.T) {
	filter, params := orEqualsFilter("user_org", []string{"a", "b", "c"}, nil)

	want := "user_org = {:user_org_0} || user_org = {:user_org_1} || user_org = {:user_org_2}"
	if filter != want {
		t.Errorf("filter:\n  got:  %q\n  want: %q", filter, want)
	}

	for i, v := range []string{"a", "b", "c"} {
		key := "user_org_" + string(rune('0'+i))
		if got := params[key]; got != v {
			t.Errorf("params[%q]: got %v, want %v", key, got, v)
		}
	}
	if len(params) != 3 {
		t.Errorf("expected 3 params, got %d: %+v", len(params), params)
	}
}

// TestOrEqualsFilterMergesExtraParams confirms callers can pass a
// pre-populated params map (e.g. for "calId" alongside the user_org
// expansion) and the helper merges its own keys in without clobbering.
func TestOrEqualsFilterMergesExtraParams(t *testing.T) {
	extra := map[string]any{"calId": "cal_xyz"}
	_, params := orEqualsFilter("user_org", []string{"a", "b"}, extra)

	if params["calId"] != "cal_xyz" {
		t.Errorf("calId not preserved: %v", params["calId"])
	}
	if params["user_org_0"] != "a" || params["user_org_1"] != "b" {
		t.Errorf("user_org keys not merged: %+v", params)
	}
}

// TestOrEqualsFilterFieldNamesArentReused makes sure the helper key
// scheme uses the field name as a prefix — calling it twice for two
// different fields shouldn't collide on user_X / calendar_X numbering.
func TestOrEqualsFilterFieldNamesArentReused(t *testing.T) {
	_, p1 := orEqualsFilter("user_org", []string{"a", "b"}, nil)
	_, p2 := orEqualsFilter("calendar", []string{"x", "y"}, p1)

	for _, k := range []string{"user_org_0", "user_org_1", "calendar_0", "calendar_1"} {
		if _, ok := p2[k]; !ok {
			t.Errorf("expected key %q in merged params, got %+v", k, p2)
		}
	}
}

// TestOrEqualsFilterEmptyInput documents behavior when called with zero
// values: empty filter string, zero clauses, params untouched. Callers
// (caldav.go) already guard against zero user_orgs upstream, but the
// helper itself shouldn't panic if that guard is missed. An empty filter
// passed to PB would match all records, so callers MUST guard.
func TestOrEqualsFilterEmptyInput(t *testing.T) {
	filter, params := orEqualsFilter("user_org", nil, nil)
	if filter != "" {
		t.Errorf("expected empty filter, got %q", filter)
	}
	if len(params) != 0 {
		t.Errorf("expected empty params, got %+v", params)
	}
}

// TestOrEqualsFilterNoIN proves the helper output does not contain the
// fexpr-incompatible "IN" keyword that triggered the original prod 500.
// A literal grep is intentional — it's the cheapest possible regression
// guard against someone "simplifying" the helper back to a single IN.
func TestOrEqualsFilterNoIN(t *testing.T) {
	filter, _ := orEqualsFilter("user_org", []string{"a", "b", "c"}, nil)
	if strings.Contains(filter, " IN ") {
		t.Errorf("filter contains forbidden IN operator: %q", filter)
	}
}

// TestRecordIDsNil is a thin smoke test for the helper's nil handling.
func TestRecordIDsNil(t *testing.T) {
	if got := recordIDs(nil); len(got) != 0 {
		t.Errorf("expected empty slice, got %+v", got)
	}
}
