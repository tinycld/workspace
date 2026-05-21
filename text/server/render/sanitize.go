// Package render holds the text package's renderer-version constant
// and the per-package sanitizer policy. The actual sanitizer
// implementation lives in tinycld.org/core/render; this package
// configures it with text's allowlist (prose tag set + textStyle
// data-* attrs on <span> + mailto-allowed hrefs) and re-exports a
// no-argument Sanitize wrapper so the endpoint can call
// render.Sanitize(fragment) without threading the allowlist through.
//
// RendererVersion is bumped whenever the emitted HTML structure or
// class vocabulary changes. ETags include this constant so cached
// previews invalidate cleanly across deploys.
package render

import (
	coreRender "tinycld.org/core/render"
)

// RendererVersion is the text renderer's ETag-cache-buster. Bump on
// any change to the emitted HTML structure, class vocabulary, or
// sanitizer allowlist.
const RendererVersion = "v5"

// allowlist is text's policy for the shared sanitizer. The prose tag
// set is wide: text fragments include <article>, every heading level,
// lists, tables, inline marks via <span>/<a>/<code>, sup/sub for
// footnote references, and the image / line-break primitives. The
// class allowlist binds to the project's "tinycld-" CSS namespace;
// mailto links are permitted because the editor's link extension
// allows users to insert them.
var allowlist = coreRender.Allowlist{
	Tags: map[string]struct{}{
		"article":    {},
		"p":          {},
		"h1":         {},
		"h2":         {},
		"h3":         {},
		"h4":         {},
		"h5":         {},
		"h6":         {},
		"ul":         {},
		"ol":         {},
		"li":         {},
		"blockquote": {},
		"pre":        {},
		"code":       {},
		"hr":         {},
		"br":         {},
		"strong":     {},
		"em":         {},
		"u":          {},
		"s":          {},
		"a":          {},
		"span":       {},
		"img":        {},
		"sup":        {},
		"sub":        {},
		"table":      {},
		"thead":      {},
		"tbody":      {},
		"tr":         {},
		"th":         {},
		"td":         {},
		"colgroup":   {},
		"col":        {},
	},
	Attrs: map[string]map[string]struct{}{
		"a": {
			"href": {},
			"rel":  {},
		},
		"ol": {
			"start": {},
		},
		"img": {
			"src":      {},
			"alt":      {},
			"title":    {},
			"width":    {},
			"height":   {},
			"loading":  {},
			"decoding": {},
		},
		"span": {
			"data-comment-id":  {},
			"data-color":       {},
			"data-font-size":   {},
			"data-font-family": {},
		},
		"th": {
			"colspan": {},
			"rowspan": {},
			"scope":   {},
		},
		"td": {
			"colspan": {},
			"rowspan": {},
		},
	},
	ClassPrefix:     "tinycld-",
	AllowHrefMailto: true,
}

// Sanitize wraps the shared sanitizer with text's allowlist. The
// endpoint calls this after PMJSONToHTML emits the fragment so any
// stray HTML in imported run text is stripped before the response is
// written.
func Sanitize(input string) (string, error) {
	return coreRender.Sanitize(input, allowlist)
}
