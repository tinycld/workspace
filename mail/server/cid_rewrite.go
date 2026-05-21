package mail

import "strings"

// normalizeCID strips angle brackets and a leading "cid:" prefix, lowercasing
// the result. Inbound providers vary: Postmark may pass "cid:foo", "<foo>",
// or bare "foo" for the same Content-ID, and HTML bodies always reference
// just the bare ID. Normalizing both sides lets us match reliably.
func normalizeCID(s string) string {
	s = strings.TrimSpace(s)
	s = strings.TrimPrefix(strings.ToLower(s), "cid:")
	s = strings.Trim(s, "<>")
	return s
}

// buildCIDMap zips each attachment's Content-ID with its stored filename so
// the client can rewrite <img src="cid:foo"> to a real file URL at render
// time. attachments and storedFilenames come from the same input order in
// storeMessage, so attachments[i].ContentID corresponds to
// storedFilenames[i]. Attachments with empty Content-ID are skipped (plain
// attachments, no inline reference).
func buildCIDMap(attachments []InboundAttachment, storedFilenames []string) map[string]string {
	out := make(map[string]string)
	for i, att := range attachments {
		cid := normalizeCID(att.ContentID)
		if cid == "" || i >= len(storedFilenames) {
			continue
		}
		out[cid] = storedFilenames[i]
	}
	return out
}
