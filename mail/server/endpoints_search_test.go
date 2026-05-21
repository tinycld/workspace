package mail

import "testing"

func TestMapResults_PropagatesHasAttachments(t *testing.T) {
	rows := []searchResultRow{
		{ThreadID: "t1", HasAttachments: true},
		{ThreadID: "t2", HasAttachments: false},
	}

	items := mapResults(rows)
	if len(items) != 2 {
		t.Fatalf("expected 2 items, got %d", len(items))
	}
	if !items[0].HasAttachments {
		t.Errorf("expected items[0].HasAttachments=true, got false")
	}
	if items[1].HasAttachments {
		t.Errorf("expected items[1].HasAttachments=false, got true")
	}
}
