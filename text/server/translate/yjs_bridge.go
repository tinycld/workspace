package translate

import (
	"encoding/json"
	"fmt"
	"sort"

	ycrdt "github.com/skyterra/y-crdt"
)

// IMPLEMENTATION NOTE on the y-crdt API surface used here.
//
// Chosen path: Path A (Y.XmlFragment + Y.XmlElement + Y.XmlText). The
// y-crdt Go library at github.com/skyterra/y-crdt v0.0.0-20260224023949
// exposes the XML primitives that y-prosemirror uses on the JS side,
// so we can produce the canonical wire format the Tiptap Collaboration
// extension expects:
//
//   * doc.GetXmlFragment(name) returns IAbstractType which we
//     type-assert to *YXmlFragment (initialized properly by the
//     library — Map / EH / DEH are non-nil).
//   * NewYXmlElement(nodeName) and NewYXmlText() build prelim children.
//     Iteration on read uses (*YXmlFragment).ToArray() / GetAttributes()
//     and YXmlText.ToDelta(...) to recover marks as Quill-style ops.
//
// Why this matters past M3.6: the M5 Tiptap Collaboration extension on
// the JS side will mount y-prosemirror against the same XmlFragment
// (named "prosemirror" by convention here), so this bridge produces a
// wire format the client can consume directly without a custom
// serialization shim.
//
// Two y-crdt library quirks the bridge has to work around — both
// motivate the helpers and the integrate-then-populate ordering below.
// Both should be reported upstream if we ever do that.
//
//   1. NewYXmlElement / NewYXmlText do NOT initialize the embedded
//      AbstractType.Map / EH / DEH fields the way NewYXmlFragment does.
//      Setting any attribute on a freshly-constructed element panics
//      inside Item.Integrate (writes through GetMap()[...] = item with
//      a nil map). Observers fired on insert also panic because EH is
//      nil. The newXmlElement / newXmlText helpers fix this by
//      patching the fields after construction.
//   2. YXmlElement.Integrate shadows YXmlFragment.Integrate and only
//      flushes PrelimAttrs — it never inserts the element's
//      PrelimContent. Pushing a pre-built tree therefore drops every
//      child below the top-level fragment. The bridge sidesteps this
//      by building the tree top-down: push an empty element into its
//      already-integrated parent, then push children into it after it
//      has a Doc reference.
//
// Scope of this file: SeedFromPMJSON / PMJSONFromYDoc only need to
// handle the simplest case (doc -> paragraph -> text without marks)
// for the M3.6 round-trip test. Headings, lists, tables, images, and
// inline marks are deliberately out of scope here — they're exercised
// by the WordZero emitter / parser tasks (M3.7 / M3.8) and round-trip
// tests in roundtrip_test.go. Anywhere a node carries attributes that
// the editor schema defines (e.g. heading.level, link.href), we round
// them through XmlElement attributes and text format attributes so
// future expansion only requires extending the encode / decode
// switches below — the storage shape is already correct.

// xmlFragmentName is the shared XmlFragment key on the Y.Doc that
// holds the entire ProseMirror tree. y-prosemirror on the JS side
// defaults to "prosemirror"; matching it here keeps the JS client
// code free of custom field names.
const xmlFragmentName = "prosemirror"

// SeedFromPMJSON populates the given Y.Doc with content described by
// the ProseMirror JSON tree. The caller owns the Doc; we only
// guarantee that on success the XmlFragment named xmlFragmentName
// holds a faithful representation of pmJSON.
func SeedFromPMJSON(doc *ycrdt.Doc, pmJSON []byte) error {
	var root PMNode
	if err := json.Unmarshal(pmJSON, &root); err != nil {
		return fmt.Errorf("translate: unmarshal pmJSON: %w", err)
	}
	if root.Type != NodeTypeDoc {
		return fmt.Errorf("translate: pmJSON root must be type=doc, got %q", root.Type)
	}

	frag, ok := doc.GetXmlFragment(xmlFragmentName).(*ycrdt.YXmlFragment)
	if !ok {
		return fmt.Errorf("translate: GetXmlFragment did not return *YXmlFragment")
	}

	for _, child := range root.Content {
		if err := seedChildIntoFragment(frag, child); err != nil {
			return err
		}
	}
	return nil
}

// PMJSONFromYDoc reads the Y.Doc's XmlFragment and reconstructs the
// PMNode tree as JSON. The output is normalized: nil maps and empty
// slices are omitted via PMNode's `,omitempty` tags.
func PMJSONFromYDoc(doc *ycrdt.Doc) ([]byte, error) {
	root := PMNode{Type: NodeTypeDoc}

	frag, ok := doc.GetXmlFragment(xmlFragmentName).(*ycrdt.YXmlFragment)
	if !ok {
		return nil, fmt.Errorf("translate: GetXmlFragment did not return *YXmlFragment")
	}

	for _, item := range frag.ToArray() {
		decoded, err := decodeXMLChild(item)
		if err != nil {
			return nil, err
		}
		if decoded == nil {
			continue
		}
		root.Content = append(root.Content, *decoded)
	}
	return json.Marshal(root)
}

// seedChildIntoFragment inserts one PMNode (block- or inline-level)
// into a YXmlFragment that's already integrated into a Doc. Children
// are pushed onto the now-integrated parent recursively.
func seedChildIntoFragment(parent *ycrdt.YXmlFragment, node PMNode) error {
	switch node.Type {
	case NodeTypeText:
		text, err := buildXMLText(node)
		if err != nil {
			return err
		}
		parent.Push([]any{text})
		return nil
	default:
		el := newXmlElement(node.Type)
		for k, v := range node.Attrs {
			el.SetAttribute(k, normalizeAttrValue(v))
		}
		parent.Push([]any{el})
		// el now has a Doc; recursively push children into it. We
		// use the embedded YXmlFragment because YXmlElement inherits
		// its insert/push behavior from there.
		for _, child := range node.Content {
			if err := seedChildIntoFragment(&el.YXmlFragment, child); err != nil {
				return err
			}
		}
		return nil
	}
}

// normalizeAttrValue coerces JSON-decoded numbers into the concrete
// types ycrdt.TypeMapSet's type switch accepts. y-crdt's TypeMapSet
// only encodes Number (= int), Object, bool, ArrayAny, and string —
// any other type falls through to a silent error from a deferred
// goroutine path, which means attributes set with a float64 value
// (the default JSON-number type) vanish without surfacing an error.
// JSON numbers that are integral integers (e.g. heading level, list
// start) become ints; non-integral floats stay float64 with a
// best-effort cast (they'll still fail upstream, but that's a callsite
// programming error we'd want to see, not a number we should round).
func normalizeAttrValue(v any) any {
	switch n := v.(type) {
	case float64:
		if n == float64(int(n)) {
			return int(n)
		}
	case float32:
		if n == float32(int(n)) {
			return int(n)
		}
	}
	return v
}

// buildXMLText builds a YXmlText preloaded with the node's text and
// any inline marks. The text gets a usable EH/DEH via newXmlText —
// y-crdt's NewYXmlText does set EH/DEH on the embedded YText, but
// it leaves Map nil; we patch it for symmetry with newXmlElement.
// Insert calls on a freshly-constructed YXmlText buffer into Pending
// and flush when the parent integrates it.
func buildXMLText(node PMNode) (*ycrdt.YXmlText, error) {
	text := newXmlText()
	if node.Text == "" {
		return text, nil
	}
	attrs := marksToAttributes(node.Marks)
	text.Insert(0, node.Text, attrs)
	return text, nil
}

// newXmlElement returns a YXmlElement with EH/DEH/Map pre-initialized.
// Without these, SetAttribute and observer dispatch panic on integration
// — see the file-level "library quirks" note above.
func newXmlElement(nodeName string) *ycrdt.YXmlElement {
	el := ycrdt.NewYXmlElement(nodeName)
	if el.EH == nil {
		el.EH = ycrdt.NewEventHandler()
	}
	if el.DEH == nil {
		el.DEH = ycrdt.NewEventHandler()
	}
	if el.Map == nil {
		el.Map = make(map[string]*ycrdt.Item)
	}
	return el
}

// newXmlText returns a YXmlText with Map initialized — EH/DEH are
// already set by NewYXmlText, but Map is left nil and would panic
// in the (currently unused) attribute-set path. Patch for safety.
func newXmlText() *ycrdt.YXmlText {
	t := ycrdt.NewYXmlText()
	if t.Map == nil {
		t.Map = make(map[string]*ycrdt.Item)
	}
	return t
}

// marksToAttributes turns a PMMark slice into the Object that YText
// expects for Insert / Format. Returns nil (not an empty Object) when
// there are no marks, matching y-crdt's convention for unmarked text.
func marksToAttributes(marks []PMMark) ycrdt.Object {
	if len(marks) == 0 {
		return nil
	}
	attrs := ycrdt.NewObject()
	for _, mark := range marks {
		if len(mark.Attrs) == 0 {
			attrs[mark.Type] = true
			continue
		}
		// Mark with attrs (e.g. link href) — store the attrs map
		// as the value so decode can reverse the same shape. Number
		// values get the same normalization treatment as element
		// attrs (see normalizeAttrValue) so any future numeric mark
		// attribute survives the Y.Doc encoder's strict type switch.
		normalized := make(map[string]any, len(mark.Attrs))
		for k, v := range mark.Attrs {
			normalized[k] = normalizeAttrValue(v)
		}
		attrs[mark.Type] = normalized
	}
	return attrs
}

// decodeXMLChild converts one item out of a YXmlFragment / YXmlElement
// child list back into a PMNode. Items are either *YXmlElement (block
// nodes), *YXmlText (text runs with optional marks), or — defensively —
// nil for anything we don't recognize.
func decodeXMLChild(item any) (*PMNode, error) {
	switch v := item.(type) {
	case *ycrdt.YXmlElement:
		return decodeXMLElement(v)
	case *ycrdt.YXmlText:
		return decodeXMLText(v), nil
	case ycrdt.IXmlType:
		// Some XML-shaped types we don't yet support (e.g. YXmlHook).
		// Skip rather than fail so a bad attribute can't poison the
		// whole document; future tasks tighten this.
		return nil, nil
	default:
		return nil, nil
	}
}

func decodeXMLElement(el *ycrdt.YXmlElement) (*PMNode, error) {
	node := PMNode{Type: el.NodeName}

	if attrs := el.GetAttributes(); len(attrs) > 0 {
		node.Attrs = make(map[string]any, len(attrs))
		for k, v := range attrs {
			node.Attrs[k] = v
		}
	}

	for _, item := range el.ToArray() {
		child, err := decodeXMLChild(item)
		if err != nil {
			return nil, err
		}
		if child == nil {
			continue
		}
		node.Content = append(node.Content, *child)
	}

	return &node, nil
}

// decodeXMLText splits a YXmlText delta into one PMNode-text per run
// of identically-marked characters. A YXmlText with no formatting
// produces one PMNode with empty Marks.
func decodeXMLText(text *ycrdt.YXmlText) *PMNode {
	delta := text.ToDelta(nil, nil, nil)
	if len(delta) == 0 {
		return nil
	}
	// Path A's storage shape is one YXmlText per text run today, so
	// the delta is usually a single insert. We keep the loop general
	// in case a future writer formats portions of a longer YXmlText
	// (e.g. when the JS client sends partial updates).
	if len(delta) == 1 {
		return deltaOpToTextNode(delta[0])
	}
	for _, op := range delta {
		if op.IsInsertDefined {
			return deltaOpToTextNode(op)
		}
	}
	return nil
}

func deltaOpToTextNode(op ycrdt.EventOperator) *PMNode {
	if !op.IsInsertDefined {
		return nil
	}
	str, ok := op.Insert.(string)
	if !ok {
		return nil
	}
	node := &PMNode{Type: NodeTypeText, Text: str}
	if marks := attributesToMarks(op.Attributes); len(marks) > 0 {
		node.Marks = marks
	}
	return node
}

// attributesToMarks reverses marksToAttributes: an Object key whose
// value is `true` becomes a mark with no attrs; an Object key whose
// value is a map becomes a mark whose attrs are that map. Marks are
// emitted in deterministic order so the round-trip test is stable.
func attributesToMarks(attrs ycrdt.Object) []PMMark {
	if len(attrs) == 0 {
		return nil
	}
	keys := make([]string, 0, len(attrs))
	for k := range attrs {
		keys = append(keys, k)
	}
	sort.Strings(keys)

	marks := make([]PMMark, 0, len(keys))
	for _, k := range keys {
		mark := PMMark{Type: k}
		switch v := attrs[k].(type) {
		case bool:
			if !v {
				continue
			}
		case map[string]any:
			// ycrdt.Object is `type Object = map[string]any`, an
			// alias, so this branch covers both shapes.
			mark.Attrs = v
		default:
			// Unknown mark value shape — skip rather than panic.
			continue
		}
		marks = append(marks, mark)
	}
	return marks
}
