package mail

import (
	"net/url"
	"regexp"
	"strings"

	"github.com/microcosm-cc/bluemonday"
)

var collapseWhitespace = regexp.MustCompile(`\s+`)

// stripHTMLToText removes all HTML tags and collapses whitespace,
// returning plain text suitable for FTS indexing.
func stripHTMLToText(html string) string {
	text := bluemonday.StrictPolicy().Sanitize(html)
	text = strings.ReplaceAll(text, "&nbsp;", " ")
	text = strings.ReplaceAll(text, "&#160;", " ")
	text = strings.ReplaceAll(text, "&amp;", "&")
	text = strings.ReplaceAll(text, "&lt;", "<")
	text = strings.ReplaceAll(text, "&gt;", ">")
	text = strings.ReplaceAll(text, "&#34;", `"`)
	text = strings.ReplaceAll(text, "&#39;", "'")
	text = collapseWhitespace.ReplaceAllString(text, " ")
	return strings.TrimSpace(text)
}

func sanitizeEmailHTML(raw string) string {
	p := bluemonday.UGCPolicy()
	p.AllowElements("table", "thead", "tbody", "tfoot", "tr", "td", "th",
		"caption", "col", "colgroup")
	p.AllowAttrs("style").OnElements("div", "span", "p", "td", "th", "table",
		"tr", "h1", "h2", "h3", "h4", "h5", "h6", "img", "a")
	p.AllowAttrs("width", "height", "cellpadding", "cellspacing", "border",
		"align", "valign", "bgcolor", "colspan", "rowspan").OnElements(
		"table", "td", "th", "tr", "img")
	p.AllowAttrs("src", "alt").OnElements("img")
	p.AllowURLSchemeWithCustomPolicy("cid", func(_ *url.URL) bool { return true })
	return p.Sanitize(raw)
}
