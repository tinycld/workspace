package translate

// DocxToHTML parses .docx bytes and emits an HTML content fragment in
// a single in-process pass — no PM JSON intermediate. Used by the
// `/api/text/render/{id}` endpoint where the bytes never leave the
// goroutine, so the JSON marshal/unmarshal round-trip that
// DocxToPMJSON + PMJSONToHTML perform is pure waste.
//
// Returns the unsanitized fragment (always wrapped in
// `<article class="tinycld-text">…</article>`) and the parser's
// soft-degradation warnings (tracked changes, content controls,
// unknown styles). Callers are responsible for running
// render.Sanitize() before writing the response — same contract
// PMJSONToHTML uses.
//
// Hard errors (malformed zip, missing word/document.xml, malformed
// XML) return errors. Soft degradations land in warnings.
//
// This function does NOT replace DocxToPMJSON. The bootstrap path
// (text/server/bootstrap.go) still uses DocxToPMJSON to seed the
// Y.Doc — that path *wants* a JSON-shaped tree because Y.Doc seeding
// reads PM JSON. Only the render path skips JSON.
func DocxToHTML(docx []byte, opts HTMLRenderOpts) (string, []Warning, error) {
	root, warnings, err := parseDocxToPMNode(docx)
	if err != nil {
		return "", nil, err
	}
	fragment, err := pmNodeToHTML(root, opts)
	if err != nil {
		return "", nil, err
	}
	return fragment, warnings, nil
}
