package translate

import (
	"encoding/json"
	"testing"
)

// TestRenestInterruptingBulletSubLists pins down the post-pass that
// re-merges Word's "ordered list interrupted by a bullet sub-list" split
// (three sibling list nodes) back into one nested structure.
func TestRenestInterruptingBulletSubLists(t *testing.T) {
	t.Run("merges the canonical pattern", func(t *testing.T) {
		// Pattern: orderedList(5 items, last item is "Tables")
		// followed by bulletList(2 items)
		// followed by orderedList(1 item "Columns", start=6).
		blocks := []PMNode{
			orderedListWithTexts("Headings", "Lists", "Links", "Images", "Tables"),
			bulletListWithTexts("Simple Tables", "Complex Tables"),
			orderedListWithTextsStart(6, "Columns"),
		}
		got := renestInterruptingBulletSubLists(blocks)
		if len(got) != 1 {
			t.Fatalf("expected 1 merged list, got %d: %s", len(got), debugJSON(got))
		}
		if got[0].Type != NodeTypeOrderedList {
			t.Fatalf("expected merged outer list to be orderedList, got %s", got[0].Type)
		}
		if n := topLevelItemCount(got[0]); n != 6 {
			t.Fatalf("expected 6 top-level items, got %d: %s", n, debugJSON(got))
		}
		// The 5th item ("Tables") must now contain a nested bulletList.
		tablesItem := got[0].Content[4]
		var nested *PMNode
		for i := range tablesItem.Content {
			if tablesItem.Content[i].Type == NodeTypeBulletList {
				nested = &tablesItem.Content[i]
				break
			}
		}
		if nested == nil {
			t.Fatalf("Tables item lacks nested bulletList: %s", debugJSON(tablesItem))
		}
		if len(nested.Content) != 2 {
			t.Fatalf("nested bulletList should have 2 items, got %d", len(nested.Content))
		}
		// `start` on the second-half ordered list should not survive
		// the merge (numbering flows naturally through the merged list).
		if _, hasStart := got[0].Attrs["start"]; hasStart {
			t.Errorf("merged list should not carry a start attribute")
		}
	})

	t.Run("leaves unrelated sibling lists alone", func(t *testing.T) {
		// Two unrelated lists with no `start` resumption — bullets in
		// between should NOT get re-nested.
		blocks := []PMNode{
			orderedListWithTexts("A", "B"),
			bulletListWithTexts("X"),
			orderedListWithTexts("C", "D"), // no start attribute
		}
		got := renestInterruptingBulletSubLists(blocks)
		if len(got) != 3 {
			t.Fatalf("expected 3 sibling lists (no merge), got %d", len(got))
		}
	})

	t.Run("leaves second list alone when start doesn't match item count", func(t *testing.T) {
		blocks := []PMNode{
			orderedListWithTexts("A", "B", "C"), // 3 items
			bulletListWithTexts("X"),
			orderedListWithTextsStart(99, "D"), // start=99, not 4
		}
		got := renestInterruptingBulletSubLists(blocks)
		if len(got) != 3 {
			t.Fatalf("mismatched start should not merge, got %d siblings", len(got))
		}
	})

	t.Run("no-op when the sandwich is absent", func(t *testing.T) {
		blocks := []PMNode{
			orderedListWithTexts("A"),
			{Type: NodeTypeParagraph, Content: []PMNode{{Type: NodeTypeText, Text: "between"}}},
			orderedListWithTextsStart(2, "B"),
		}
		got := renestInterruptingBulletSubLists(blocks)
		if len(got) != 3 {
			t.Fatalf("expected 3 untouched blocks, got %d", len(got))
		}
	})
}

func orderedListWithTexts(items ...string) PMNode {
	return listWithTexts(NodeTypeOrderedList, 0, items...)
}

func orderedListWithTextsStart(start int, items ...string) PMNode {
	return listWithTexts(NodeTypeOrderedList, start, items...)
}

func bulletListWithTexts(items ...string) PMNode {
	return listWithTexts(NodeTypeBulletList, 0, items...)
}

func listWithTexts(kind string, start int, items ...string) PMNode {
	list := PMNode{Type: kind}
	if start > 1 {
		list.Attrs = map[string]any{"start": start}
	}
	for _, txt := range items {
		list.Content = append(list.Content, PMNode{
			Type: NodeTypeListItem,
			Content: []PMNode{
				{Type: NodeTypeParagraph, Content: []PMNode{
					{Type: NodeTypeText, Text: txt},
				}},
			},
		})
	}
	return list
}

func debugJSON(v any) string {
	b, _ := json.MarshalIndent(v, "", "  ")
	return string(b)
}
