package mail

import "testing"

func TestNormalizeCID(t *testing.T) {
	cases := map[string]string{
		"cid:foo":     "foo",
		"CID:Foo":     "foo",
		"<bar>":       "bar",
		"  cid:baz  ": "baz",
		"":            "",
		"plain":       "plain",
	}
	for in, want := range cases {
		if got := normalizeCID(in); got != want {
			t.Errorf("normalizeCID(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestBuildCIDMap(t *testing.T) {
	atts := []InboundAttachment{
		{ContentID: "cid:hippo-inline"},
		{ContentID: ""},
		{ContentID: "<angle-id>"},
	}
	stored := []string{"hippo_abc.jpg", "hippo_def.jpg", "logo_ghi.png"}
	got := buildCIDMap(atts, stored)

	if got["hippo-inline"] != "hippo_abc.jpg" {
		t.Errorf("expected hippo-inline → hippo_abc.jpg, got %q", got["hippo-inline"])
	}
	if got["angle-id"] != "logo_ghi.png" {
		t.Errorf("expected angle-id → logo_ghi.png, got %q", got["angle-id"])
	}
	if _, ok := got[""]; ok {
		t.Error("expected empty cid to be skipped")
	}
	if len(got) != 2 {
		t.Errorf("expected 2 entries, got %d: %v", len(got), got)
	}
}

func TestBuildCIDMap_NoAttachments(t *testing.T) {
	if got := buildCIDMap(nil, nil); len(got) != 0 {
		t.Errorf("expected empty map, got %v", got)
	}
}

func TestBuildCIDMap_LengthMismatch(t *testing.T) {
	atts := []InboundAttachment{{ContentID: "cid:a"}, {ContentID: "cid:b"}}
	stored := []string{"a.jpg"}
	got := buildCIDMap(atts, stored)
	if len(got) != 1 || got["a"] != "a.jpg" {
		t.Errorf("expected only first entry to map, got %v", got)
	}
}
