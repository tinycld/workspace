// Package render provides a shared HTML-fragment sanitizer for the
// per-package server-side renderers (currently calc and text).
//
// The sanitizer enforces a defense-in-depth allowlist on HTML fragments
// emitted by package-specific renderers (calc/server/render/render.go,
// text/server/translate/pm_to_html.go). Each caller passes its own
// Allowlist defining which tags + attributes survive; the strip-with-
// children list (script/style/iframe/svg/math/…) and the URL allowlist
// (raster-only data: URIs; reject javascript:/vbscript:) are
// SAFETY CRITICAL and hardcoded inside the sanitizer regardless of
// caller configuration.
//
// Defense in depth: each renderer already escapes leaf text and only
// emits its own allowlisted structure. The sanitizer exists so a
// future regression (or a careless addition that hand-builds HTML
// from imported document content) can't accidentally smuggle a
// `<script>` into a preview.
package render

import (
	"fmt"
	"strings"

	"golang.org/x/net/html"
)

// Allowlist is the per-caller policy controlling which tags, attributes,
// and class-prefix tokens survive a Sanitize pass. The strip-with-
// children list and URL scheme allowlist live inside Sanitize itself
// because they are safety-critical and must apply uniformly across
// every caller.
//
// Empty Tags / Attrs are valid and mean "no tags / no per-tag attrs
// permitted" — the sanitizer's unknown-tag policy still applies, so
// the fragment renders as plain text.
type Allowlist struct {
	// Tags is the set of element names permitted in the output. An
	// element whose name is not present here is dropped, but its
	// children are still rendered inline (matching the unknown-tag
	// fallback). The strip-with-children list overrides this for the
	// safety-critical tags regardless of what Tags contains.
	Tags map[string]struct{}
	// Attrs maps each permitted tag name to the set of attribute names
	// allowed on it. `class` is universally allowed and filtered
	// separately (see ClassPrefix). Inline `style`, every `on*`
	// handler, and any namespaced attr are always dropped.
	Attrs map[string]map[string]struct{}
	// ClassPrefix restricts the `class="…"` attribute values to tokens
	// starting with this prefix. Tokens lacking the prefix are dropped.
	// The empty string means "permit any class token" — callers
	// supply "tinycld-" to bind to the project's CSS namespace.
	ClassPrefix string
	// AllowHrefMailto opts the policy into accepting mailto: hrefs in
	// addition to http(s). The renderer's emit-time check controls
	// what's actually emitted; this flag lets sanitization match.
	// Calc emits no <a> tags so the flag is irrelevant there; text
	// emits links and needs mailto allowed.
	AllowHrefMailto bool
}

// stripWithChildren names tags whose subtree is dropped entirely
// (children + content). These render as raw script bodies / URL
// references / vector content that can carry script payloads, so
// "drop the wrapper, keep the children" — the default unknown-tag
// policy — is unsafe here.
//
// SAFETY CRITICAL: hardcoded here rather than exposed on Allowlist so
// no caller can accidentally widen the policy. Adding entries is
// always safe; removing them requires a security review.
var stripWithChildren = map[string]struct{}{
	"script":   {},
	"style":    {},
	"iframe":   {},
	"object":   {},
	"embed":    {},
	"link":     {},
	"meta":     {},
	"base":     {},
	"form":     {},
	"input":    {},
	"button":   {},
	"select":   {},
	"textarea": {},
	"svg":      {},
	"math":     {},
}

// voidElements is the set of HTML void elements (no closing tag, no
// children) that can appear in renderer output. Listed callers' tag
// sets are the union: calc emits <img> and <col>; text emits <img>,
// <br>, <hr>. Anything not in this map gets a paired close tag.
var voidElements = map[string]struct{}{
	"img":  {},
	"br":   {},
	"hr":   {},
	"col":  {},
	"area": {},
	"base": {},
	"wbr":  {},
}

// Sanitize walks an HTML fragment string and emits a cleaned copy
// containing only allowlisted tags, attributes, class tokens, and
// URLs (per allow). Anything outside the allowlist is dropped —
// children of dropped tags are preserved where doing so makes
// structural sense (unknown tags), otherwise the entire subtree is
// removed (script / style / iframe / svg / math / etc.).
func Sanitize(input string, allow Allowlist) (string, error) {
	doc, err := html.Parse(strings.NewReader("<!doctype html><html><body>" + input + "</body></html>"))
	if err != nil {
		return "", fmt.Errorf("parse: %w", err)
	}
	body := findBody(doc)
	if body == nil {
		return "", fmt.Errorf("no body in parsed document")
	}
	var b strings.Builder
	for c := body.FirstChild; c != nil; c = c.NextSibling {
		walk(c, &b, allow)
	}
	return b.String(), nil
}

func findBody(n *html.Node) *html.Node {
	if n.Type == html.ElementNode && n.Data == "body" {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if got := findBody(c); got != nil {
			return got
		}
	}
	return nil
}

func walk(n *html.Node, b *strings.Builder, allow Allowlist) {
	switch n.Type {
	case html.TextNode:
		b.WriteString(escapeHTML(n.Data))
		return
	case html.ElementNode:
		if _, drop := stripWithChildren[n.Data]; drop {
			return
		}
		if _, ok := allow.Tags[n.Data]; !ok {
			// Unknown tag: render children inline (preserve content).
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				walk(c, b, allow)
			}
			return
		}
		writeStartTag(n, b, allow)
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c, b, allow)
		}
		if _, void := voidElements[n.Data]; !void {
			b.WriteString(`</`)
			b.WriteString(n.Data)
			b.WriteString(`>`)
		}
	default:
		// Comments, doctype, etc. are skipped at the fragment level.
	}
}

func writeStartTag(n *html.Node, b *strings.Builder, allow Allowlist) {
	b.WriteString(`<`)
	b.WriteString(n.Data)
	for _, attr := range n.Attr {
		if attr.Namespace != "" {
			continue
		}
		name := strings.ToLower(attr.Key)
		// on* event handlers are always dropped regardless of the
		// per-tag allowlist — they're the largest XSS surface and no
		// renderer in this codebase has a legitimate reason to emit
		// one.
		if strings.HasPrefix(name, "on") {
			continue
		}
		if !attrAllowed(n.Data, name, allow) {
			continue
		}
		value := attr.Val
		switch name {
		case "class":
			value = filterClasses(value, allow.ClassPrefix)
			if value == "" {
				continue
			}
		case "src":
			if !imgURLAllowed(value) {
				continue
			}
		case "href":
			if !linkURLAllowed(value, allow.AllowHrefMailto) {
				continue
			}
		case "style":
			value = sanitizeStyle(value)
			if value == "" {
				continue
			}
		case "data-color", "data-bg":
			// data-color / data-bg carry CSS color values surfaced as
			// attributes. Renderers that prefer inline `style=` can
			// skip these; those that still emit them get value
			// validation here so a hostile cell value can't smuggle
			// CSS that breaks out of the attribute.
			if !sanitizerSafeColor(value) {
				continue
			}
		case "data-font-size":
			if !sanitizerSafeFontSize(value) {
				continue
			}
		case "data-font-family":
			if !sanitizerSafeFontFamily(value) {
				continue
			}
		}
		b.WriteString(` `)
		b.WriteString(name)
		b.WriteString(`="`)
		b.WriteString(escapeHTML(value))
		b.WriteString(`"`)
	}
	b.WriteString(`>`)
}

// sanitizerSafeColor accepts #hex (3/4/6/8 digits) or rgb()/rgba()
// with strictly numeric content. Anything else (named colors,
// gradients, `url(...)`, etc.) is rejected — the renderers we own
// only ever emit these two shapes.
func sanitizerSafeColor(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 32 {
		return false
	}
	if s[0] == '#' {
		hex := s[1:]
		switch len(hex) {
		case 3, 4, 6, 8:
		default:
			return false
		}
		for i := 0; i < len(hex); i++ {
			c := hex[i]
			switch {
			case c >= '0' && c <= '9',
				c >= 'a' && c <= 'f',
				c >= 'A' && c <= 'F':
			default:
				return false
			}
		}
		return true
	}
	lower := strings.ToLower(s)
	if !(strings.HasPrefix(lower, "rgb(") || strings.HasPrefix(lower, "rgba(")) {
		return false
	}
	if !strings.HasSuffix(s, ")") {
		return false
	}
	open := strings.IndexByte(s, '(')
	inner := s[open+1 : len(s)-1]
	for i := 0; i < len(inner); i++ {
		c := inner[i]
		switch {
		case c >= '0' && c <= '9',
			c == ',', c == ' ', c == '.', c == '%':
		default:
			return false
		}
	}
	return true
}

// sanitizerSafeFontSize accepts a number with optional decimal and
// `pt` or `px` suffix.
func sanitizerSafeFontSize(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 16 {
		return false
	}
	// Strip trailing unit.
	for _, unit := range []string{"pt", "px", "em", "rem"} {
		if strings.HasSuffix(s, unit) {
			s = s[:len(s)-len(unit)]
			break
		}
	}
	hasDot := false
	hasDigit := false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= '0' && c <= '9':
			hasDigit = true
		case c == '.':
			if hasDot {
				return false
			}
			hasDot = true
		default:
			return false
		}
	}
	return hasDigit
}

// sanitizerSafeFontFamily accepts a comma-separated list of family
// names made of letters, digits, spaces, hyphens, underscores, and
// quotes. Rejects parens, semicolons, slashes, anything that could
// break out of the attribute or invite a parser quirk.
func sanitizerSafeFontFamily(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" || len(s) > 128 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c >= 'a' && c <= 'z',
			c >= 'A' && c <= 'Z',
			c >= '0' && c <= '9',
			c == ' ', c == '-', c == '_',
			c == ',', c == '"', c == '\'':
		default:
			return false
		}
	}
	return true
}

// safeStyleProperties lists the CSS property names the sanitizer
// allows inside an inline `style="…"` attribute. The renderers (calc,
// text) emit a subset of these for legitimate per-cell / per-span
// styling — color, fill, font, alignment, sizing, borders, padding,
// margin. Properties outside this list (most notably `position`,
// `behavior`, `-moz-binding`, anything with a vendor prefix the
// browser still honors) are silently dropped.
//
// Adding entries widens the renderer's visual vocabulary; removing
// entries is safe but may regress a feature. SAFETY CRITICAL — every
// addition needs a security review.
var safeStyleProperties = map[string]struct{}{
	"color":              {},
	"background":         {},
	"background-color":   {},
	"font":               {},
	"font-size":          {},
	"font-family":        {},
	"font-weight":        {},
	"font-style":         {},
	"text-decoration":    {},
	"text-align":         {},
	"vertical-align":     {},
	"white-space":        {},
	"width":              {},
	"min-width":          {},
	"max-width":          {},
	"height":             {},
	"min-height":         {},
	"max-height":         {},
	"padding":            {},
	"padding-top":        {},
	"padding-right":      {},
	"padding-bottom":     {},
	"padding-left":       {},
	"margin":             {},
	"margin-top":         {},
	"margin-right":       {},
	"margin-bottom":      {},
	"margin-left":        {},
	"border":             {},
	"border-top":         {},
	"border-right":       {},
	"border-bottom":      {},
	"border-left":        {},
	"border-color":       {},
	"border-style":       {},
	"border-width":       {},
	"border-top-color":   {},
	"border-right-color": {},
	"border-bottom-color":{},
	"border-left-color":  {},
	"border-top-style":   {},
	"border-right-style": {},
	"border-bottom-style":{},
	"border-left-style":  {},
	"border-top-width":   {},
	"border-right-width": {},
	"border-bottom-width":{},
	"border-left-width":  {},
	"line-height":        {},
}

// dangerousStyleSubstrings names CSS fragments that always indicate
// either a known XSS vector (legacy or current) or a scheme an
// attribute value should never reach. Matched case-insensitively as
// substrings inside the raw `style=` value before per-declaration
// parsing. SAFETY CRITICAL.
var dangerousStyleSubstrings = []string{
	"javascript:",
	"vbscript:",
	"expression(",
	"behavior:",
	"-moz-binding",
	"@import",
}

// sanitizeStyle filters an inline `style="…"` value to only the
// safe-property declarations. Returns the cleaned value (empty if
// nothing survived). Implementation is deliberately simple: a hostile
// value with `javascript:` / `expression(` / `behavior:` / `@import`
// anywhere drops the whole attribute; otherwise each `prop: value;`
// declaration is checked against safeStyleProperties and rebuilt.
//
// The browser's CSS parser is the second line of defense — even when
// the sanitizer lets a declaration through, modern engines refuse to
// resolve `javascript:` URLs from `style` context. But "the browser
// would have rejected it" is not enough on its own; a future content
// transform (export-to-PDF, save-as-HTML) might not have the same
// browser behind it.
func sanitizeStyle(value string) string {
	lower := strings.ToLower(value)
	for _, danger := range dangerousStyleSubstrings {
		if strings.Contains(lower, danger) {
			return ""
		}
	}
	var b strings.Builder
	for _, decl := range splitStyleDeclarations(value) {
		decl = strings.TrimSpace(decl)
		if decl == "" {
			continue
		}
		colon := strings.IndexByte(decl, ':')
		if colon <= 0 {
			continue
		}
		prop := strings.ToLower(strings.TrimSpace(decl[:colon]))
		val := strings.TrimSpace(decl[colon+1:])
		if val == "" {
			continue
		}
		if _, ok := safeStyleProperties[prop]; !ok {
			continue
		}
		// Reject any value whose parentheses don't balance — a
		// declaration like `font-family: foo(((` left over from a
		// poison-then-truncate attempt could otherwise carry
		// arbitrary later text (the splitStyleDeclarations walker
		// glues subsequent declarations into the same one because
		// paren depth never returns to zero). Browsers would refuse
		// the CSS anyway, but the raw value would still land in
		// the DOM. Defense-in-depth.
		if !parensBalanced(val) {
			continue
		}
		// `url(...)` is allowed only when the wrapped scheme is
		// http(s) or a data: image — same policy as <img src>. A
		// declaration with any other url() (or with quoting tricks
		// that confuse the substring check) is dropped wholesale.
		if strings.Contains(strings.ToLower(val), "url(") && !styleURLSafe(val) {
			continue
		}
		if b.Len() > 0 {
			b.WriteString("; ")
		}
		b.WriteString(prop)
		b.WriteString(": ")
		b.WriteString(val)
	}
	return b.String()
}

// parensBalanced reports whether `(` and `)` occur in matched pairs
// inside the value, ignoring characters inside single- or double-
// quoted strings. Used to refuse declarations like `foo(((` that
// would otherwise corrupt splitStyleDeclarations' depth tracking
// and let later declarations slip through unparsed.
func parensBalanced(value string) bool {
	depth := 0
	var quote byte
	for i := 0; i < len(value); i++ {
		c := value[i]
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'':
			quote = c
		case c == '(':
			depth++
		case c == ')':
			depth--
			if depth < 0 {
				return false
			}
		}
	}
	return depth == 0 && quote == 0
}

// splitStyleDeclarations splits a CSS declaration block on `;` but
// preserves semicolons that appear inside `url(...)` (data URIs
// commonly carry them, e.g. `url(data:image/png;base64,…)`). Quoted
// strings are similarly preserved.
func splitStyleDeclarations(value string) []string {
	var out []string
	depth := 0
	var quote byte
	start := 0
	for i := 0; i < len(value); i++ {
		c := value[i]
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			}
		case c == '"' || c == '\'':
			quote = c
		case c == '(':
			depth++
		case c == ')':
			if depth > 0 {
				depth--
			}
		case c == ';' && depth == 0:
			out = append(out, value[start:i])
			start = i + 1
		}
	}
	out = append(out, value[start:])
	return out
}

// styleURLSafe parses url(...) occurrences inside a CSS declaration
// value and confirms each wrapped reference passes imgURLAllowed.
// Returns true when every url(...) in the value is safe (or there are
// no url(...) occurrences). The caller already checked the value
// against dangerousStyleSubstrings, so this is just the residual
// scheme check.
func styleURLSafe(val string) bool {
	rest := val
	for {
		idx := strings.Index(strings.ToLower(rest), "url(")
		if idx < 0 {
			return true
		}
		rest = rest[idx+len("url("):]
		end := strings.IndexByte(rest, ')')
		if end < 0 {
			return false
		}
		raw := strings.TrimSpace(rest[:end])
		raw = strings.Trim(raw, `"'`)
		if !imgURLAllowed(raw) {
			return false
		}
		rest = rest[end+1:]
	}
}

func attrAllowed(tag, name string, allow Allowlist) bool {
	// class and style are universally permitted; their values pass
	// through dedicated filters (filterClasses, sanitizeStyle) before
	// emit. Per-tag Attrs entries control everything else.
	if name == "class" || name == "style" {
		return true
	}
	tagAttrs, ok := allow.Attrs[tag]
	if !ok {
		return false
	}
	_, ok = tagAttrs[name]
	return ok
}

// filterClasses keeps only the tokens that match the caller's class
// prefix. Anything else (bootstrap, tailwind, attacker-supplied) is
// dropped. An empty prefix passes every token through unchanged.
func filterClasses(value, prefix string) string {
	tokens := strings.Fields(value)
	kept := tokens[:0]
	for _, t := range tokens {
		if prefix == "" || strings.HasPrefix(t, prefix) {
			kept = append(kept, t)
		}
	}
	return strings.Join(kept, " ")
}

// imgURLAllowed permits http(s) URLs and data:image/raster URIs only
// on <img src>. Hardcoded list — SAFETY CRITICAL.
//
// data:image/svg+xml is rejected because SVG can carry script
// payloads. Relative paths are rejected because every URL the
// renderers emit is absolute (pb.files.getURL / pre-generated data
// URI); allowing relative paths opens an XSS surface (e.g.
// "//attacker.example").
func imgURLAllowed(raw string) bool {
	s := strings.TrimSpace(raw)
	if s == "" {
		return false
	}
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return true
	}
	if strings.HasPrefix(lower, "data:image/") {
		raster := []string{"data:image/png", "data:image/jpeg", "data:image/jpg", "data:image/gif", "data:image/webp"}
		for _, prefix := range raster {
			if strings.HasPrefix(lower, prefix) {
				return true
			}
		}
		return false
	}
	return false
}

// linkURLAllowed permits http(s) for every caller; mailto: is enabled
// only when the caller's Allowlist.AllowHrefMailto is true. SAFETY
// CRITICAL — keep this list narrow.
//
// Same-document fragment anchors (`href="#section-2"`) are always
// permitted: they cannot navigate cross-origin and they're needed for
// in-document TOC / footnote navigation in rendered text docs.
func linkURLAllowed(raw string, allowMailto bool) bool {
	s := strings.TrimSpace(raw)
	if s == "" {
		return false
	}
	// In-document anchor: starts with '#'. The browser resolves this
	// against the current document URL and never issues a network
	// request, so the scheme allowlist doesn't apply.
	if s[0] == '#' {
		return true
	}
	lower := strings.ToLower(s)
	if strings.HasPrefix(lower, "http://") || strings.HasPrefix(lower, "https://") {
		return true
	}
	if allowMailto && strings.HasPrefix(lower, "mailto:") {
		return true
	}
	return false
}

// escapeHTML is the five-char HTML escape used inside writeStartTag
// for attribute values. Renderers do their own escaping on emit; this
// covers the case where the parsed input carried already-decoded
// characters that need re-escaping on output.
func escapeHTML(s string) string {
	if !needsEscape(s) {
		return s
	}
	var b strings.Builder
	b.Grow(len(s) + 8)
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '&':
			b.WriteString("&amp;")
		case '<':
			b.WriteString("&lt;")
		case '>':
			b.WriteString("&gt;")
		case '"':
			b.WriteString("&quot;")
		case '\'':
			b.WriteString("&#39;")
		default:
			b.WriteByte(s[i])
		}
	}
	return b.String()
}

func needsEscape(s string) bool {
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case '&', '<', '>', '"', '\'':
			return true
		}
	}
	return false
}
