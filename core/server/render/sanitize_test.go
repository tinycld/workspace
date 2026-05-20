package render

import (
	"strings"
	"testing"
)

// calcAllow is a representative spreadsheet-shaped allowlist mirroring
// the policy calc passes to Sanitize. Used to assert the shared
// sanitizer handles calc's narrow tag set correctly without keeping
// calc's tests in calc's repo.
var calcAllow = Allowlist{
	Tags: setOf("section", "article", "h2", "table", "thead", "tbody", "tr", "th", "td", "img", "colgroup", "col"),
	Attrs: map[string]map[string]struct{}{
		"img":      setOf("src", "alt", "width", "height", "loading", "decoding"),
		"th":       setOf("colspan", "rowspan", "scope"),
		"td":       setOf("colspan", "rowspan"),
		"col":      setOf("span"),
		"colgroup": setOf("span"),
	},
	ClassPrefix: "tinycld-",
}

// textAllow mirrors text's prose-tag policy.
var textAllow = Allowlist{
	Tags: setOf("article", "p", "h1", "h2", "h3", "h4", "h5", "h6",
		"ul", "ol", "li", "blockquote", "pre", "code", "hr", "br",
		"strong", "em", "u", "s", "a", "span", "img", "sup", "sub",
		"table", "thead", "tbody", "tr", "th", "td",
	),
	Attrs: map[string]map[string]struct{}{
		"a":   setOf("href", "rel"),
		"img": setOf("src", "alt", "title", "width", "height", "loading", "decoding"),
		"span": setOf("data-comment-id", "data-color", "data-font-size", "data-font-family"),
		"th":  setOf("colspan", "rowspan", "scope"),
		"td":  setOf("colspan", "rowspan"),
	},
	ClassPrefix:     "tinycld-",
	AllowHrefMailto: true,
}

func setOf(items ...string) map[string]struct{} {
	out := make(map[string]struct{}, len(items))
	for _, s := range items {
		out[s] = struct{}{}
	}
	return out
}

func TestSanitize_StripsScriptSubtree(t *testing.T) {
	out, err := Sanitize(`<section class="tinycld-calc"><script>alert(1)</script><p>hi</p></section>`, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "<script") || strings.Contains(out, "alert") {
		t.Fatalf("script leaked: %q", out)
	}
}

// TestSanitize_DropsHostileStyleValue exercises sanitizeStyle's
// rejection of declarations whose values carry javascript: URLs (and
// other dangerousStyleSubstrings). The whole style attribute is
// dropped when a hostile substring is present anywhere in the value.
func TestSanitize_DropsHostileStyleValue(t *testing.T) {
	out, err := Sanitize(`<table><tr><td class="tinycld-calc-cell" style="background:url(javascript:alert(1))">x</td></tr></table>`, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "style=") {
		t.Fatalf("hostile style attribute leaked: %q", out)
	}
}

// TestSanitize_AllowsSafeStyle verifies the loosened sanitizer keeps
// inline style declarations that only reference safe-property values.
// Calc and text both need this to project per-cell color / fill /
// font-size / font-family without paying the typed-attr() browser-
// compat tax.
func TestSanitize_AllowsSafeStyle(t *testing.T) {
	in := `<table><tr><td class="tinycld-calc-cell" style="color: #ff0000; background: #00ff00; font-size: 12pt; font-family: Arial">x</td></tr></table>`
	out, err := Sanitize(in, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	for _, want := range []string{
		"color: #ff0000",
		"background: #00ff00",
		"font-size: 12pt",
		"font-family: Arial",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("expected %q in output, got %q", want, out)
		}
	}
}

// TestSanitize_DropsUnknownStyleProperty confirms only properties in
// safeStyleProperties survive — `position` (and anything else) is
// silently filtered out at declaration level, preserving the rest of
// the style attribute.
func TestSanitize_DropsUnknownStyleProperty(t *testing.T) {
	in := `<table><tr><td style="color: #fff; position: fixed; font-size: 10pt">x</td></tr></table>`
	out, err := Sanitize(in, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "position") {
		t.Fatalf("unknown property leaked: %q", out)
	}
	if !strings.Contains(out, "color: #fff") || !strings.Contains(out, "font-size: 10pt") {
		t.Fatalf("safe declarations lost: %q", out)
	}
}

// TestSanitize_DropsLegacyXSSStyleVectors covers the dead-but-still-
// worth-blocking legacy CSS XSS vectors. Each should drop the entire
// style attribute (any one of these substrings poisons the value).
func TestSanitize_DropsLegacyXSSStyleVectors(t *testing.T) {
	cases := []string{
		`<table><tr><td style="color: expression(alert(1))">x</td></tr></table>`,
		`<table><tr><td style="behavior: url(xss.htc)">x</td></tr></table>`,
		`<table><tr><td style="-moz-binding: url(xss.xml)">x</td></tr></table>`,
		`<table><tr><td style="background: url(vbscript:msgbox(1))">x</td></tr></table>`,
		`<table><tr><td style="background: url('javascript:alert(1)')">x</td></tr></table>`,
		`<table><tr><td style="@import url(evil.css); color: red">x</td></tr></table>`,
	}
	for _, in := range cases {
		t.Run(in, func(t *testing.T) {
			out, err := Sanitize(in, calcAllow)
			if err != nil {
				t.Fatalf("sanitize: %v", err)
			}
			if strings.Contains(out, "style=") {
				t.Fatalf("hostile style survived: %q", out)
			}
		})
	}
}

// TestSanitize_StyleURLOnlyAllowsSafeSchemes asserts that a url(...)
// reference inside an allowed property (e.g. background-image) is
// permitted only when the wrapped URL is http(s) or data:image/raster
// — same predicate as <img src>. A relative URL or off-scheme URL
// drops the declaration.
func TestSanitize_StyleURLOnlyAllowsSafeSchemes(t *testing.T) {
	cases := map[string]bool{
		`<table><tr><td style="background: url(https://x/y.png)">x</td></tr></table>`:           true,
		`<table><tr><td style="background: url(data:image/png;base64,abc)">x</td></tr></table>`: true,
		`<table><tr><td style="background: url(/local/x.png)">x</td></tr></table>`:              false,
		`<table><tr><td style="background: url(data:image/svg+xml,...)">x</td></tr></table>`:    false,
	}
	for in, wantSurvives := range cases {
		t.Run(in, func(t *testing.T) {
			out, err := Sanitize(in, calcAllow)
			if err != nil {
				t.Fatalf("sanitize: %v", err)
			}
			got := strings.Contains(out, "background:")
			if got != wantSurvives {
				t.Fatalf("survival mismatch (want %v): %q", wantSurvives, out)
			}
		})
	}
}

func TestSanitize_StripsEventHandlers(t *testing.T) {
	out, err := Sanitize(`<table><tr><td class="tinycld-calc-cell" onclick="alert(1)">x</td></tr></table>`, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "onclick") {
		t.Fatalf("event handler leaked: %q", out)
	}
}

// TestSanitize_StripsEveryDangerousTag exercises every entry in the
// stripWithChildren list. Adding a new entry without a corresponding
// case here is fine but discourages drive-by removals.
func TestSanitize_StripsEveryDangerousTag(t *testing.T) {
	cases := map[string]string{
		"script":   `<script>alert(1)</script>x`,
		"style":    `<style>body{display:none}</style>x`,
		"iframe":   `<iframe src="https://evil"></iframe>x`,
		"object":   `<object data="https://evil"></object>x`,
		"embed":    `<embed src="https://evil">x`,
		"link":     `<link rel=stylesheet href="https://evil">x`,
		"meta":     `<meta http-equiv="refresh" content="0;url=https://evil">x`,
		"base":     `<base href="https://evil">x`,
		"form":     `<form action="https://evil"><button>go</button></form>x`,
		"input":    `<input value="x">x`,
		"button":   `<button>x</button>y`,
		"select":   `<select><option>x</option></select>y`,
		"textarea": `<textarea>x</textarea>y`,
		"svg":      `<svg onload="alert(1)"><script>1</script></svg>x`,
		"math":     `<math><mtext>x</mtext></math>y`,
	}
	for tag, input := range cases {
		t.Run(tag, func(t *testing.T) {
			out, err := Sanitize(input, textAllow)
			if err != nil {
				t.Fatalf("sanitize: %v", err)
			}
			if strings.Contains(strings.ToLower(out), "<"+tag) {
				t.Fatalf("%s tag leaked: %q", tag, out)
			}
		})
	}
}

func TestSanitize_RejectsJavascriptImgSrc(t *testing.T) {
	out, err := Sanitize(`<img src="javascript:alert(1)">`, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(strings.ToLower(out), "javascript:") {
		t.Fatalf("javascript: url leaked: %q", out)
	}
}

func TestSanitize_AllowsHttpsImageUrl(t *testing.T) {
	out, err := Sanitize(`<img src="https://example.test/x.png?token=abc">`, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if !strings.Contains(out, `src="https://example.test/x.png?token=abc"`) {
		t.Fatalf("expected http src to survive: %q", out)
	}
}

func TestSanitize_AllowsDataImagePng(t *testing.T) {
	out, err := Sanitize(`<img src="data:image/png;base64,iVBORw0KGgo=">`, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if !strings.Contains(out, "data:image/png") {
		t.Fatalf("expected data:image/png to survive: %q", out)
	}
}

func TestSanitize_RejectsDataImageSvgXml(t *testing.T) {
	out, err := Sanitize(`<img src="data:image/svg+xml;utf8,<svg onload=alert(1)/>">`, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "svg+xml") {
		t.Fatalf("svg data URL leaked: %q", out)
	}
}

func TestSanitize_RejectsDataTextHtmlImgSrc(t *testing.T) {
	out, err := Sanitize(`<img class="tinycld-doc-img" src="data:text/html,<script>alert(1)</script>">`, textAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "data:text/html") || strings.Contains(out, "script") {
		t.Fatalf("data:text/html leaked: %q", out)
	}
}

func TestSanitize_FiltersClassPrefix(t *testing.T) {
	out, err := Sanitize(`<table><tr><td class="tinycld-calc-cell evil-class bootstrap-bs">x</td></tr></table>`, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "evil-class") || strings.Contains(out, "bootstrap-bs") {
		t.Fatalf("non-tinycld class leaked: %q", out)
	}
	if !strings.Contains(out, "tinycld-calc-cell") {
		t.Fatalf("expected tinycld class to survive: %q", out)
	}
}

func TestSanitize_EmptyClassPrefixKeepsAllTokens(t *testing.T) {
	// Caller-defined: a zero ClassPrefix passes every class token
	// through unchanged. Confirms the prefix path doesn't double-
	// filter when off.
	allow := Allowlist{
		Tags: setOf("p"),
		// no ClassPrefix
	}
	out, err := Sanitize(`<p class="anything goes">x</p>`, allow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if !strings.Contains(out, `class="anything goes"`) {
		t.Fatalf("expected class to survive verbatim: %q", out)
	}
}

func TestSanitize_DropsUnknownTagButKeepsChildren(t *testing.T) {
	out, err := Sanitize(`<section class="tinycld-calc"><blink>hi</blink></section>`, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "<blink") {
		t.Fatalf("blink tag leaked: %q", out)
	}
	if !strings.Contains(out, "hi") {
		t.Fatalf("blink content dropped: %q", out)
	}
}

func TestSanitize_DropsJavascriptHref(t *testing.T) {
	out, err := Sanitize(`<a class="tinycld-doc-mark--link" href="javascript:alert(1)">x</a>`, textAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "javascript:") {
		t.Fatalf("javascript href leaked: %q", out)
	}
}

func TestSanitize_DropsVbscriptHref(t *testing.T) {
	out, err := Sanitize(`<a href="vbscript:msgbox(1)">x</a>`, textAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(strings.ToLower(out), "vbscript:") {
		t.Fatalf("vbscript href leaked: %q", out)
	}
}

func TestSanitize_AllowsSafeHref(t *testing.T) {
	out, err := Sanitize(`<a class="tinycld-doc-mark--link" href="https://example.com/page">x</a>`, textAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if !strings.Contains(out, `href="https://example.com/page"`) {
		t.Fatalf("safe href stripped: %q", out)
	}
}

// TestSanitize_AllowsInDocumentAnchorHref guards in-document fragment
// navigation. href="#anchor" never issues a network request and is
// essential for TOC / footnote / back-to-top links in rendered docs.
// The original allowlist (http/https/mailto only) silently dropped
// these.
func TestSanitize_AllowsInDocumentAnchorHref(t *testing.T) {
	in := `<a class="tinycld-doc-mark--link" href="#section-2">go</a>`
	out, err := Sanitize(in, textAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if !strings.Contains(out, `href="#section-2"`) {
		t.Fatalf("in-document anchor href stripped: %q", out)
	}
}

func TestSanitize_MailtoHrefHonorsAllowlistFlag(t *testing.T) {
	// textAllow has AllowHrefMailto = true; calcAllow does not.
	in := `<a href="mailto:a@b.com">x</a>`
	outText, err := Sanitize(in, textAllow)
	if err != nil {
		t.Fatalf("text sanitize: %v", err)
	}
	if !strings.Contains(outText, `href="mailto:a@b.com"`) {
		t.Fatalf("mailto stripped in text allowlist: %q", outText)
	}
	// calcAllow has no <a> in Tags, but even if it did the mailto
	// flag is off — assert the URL allowlist independently using a
	// minimal allowlist that includes <a> but no mailto flag.
	noMailto := Allowlist{
		Tags:        setOf("a"),
		Attrs:       map[string]map[string]struct{}{"a": setOf("href", "rel")},
		ClassPrefix: "tinycld-",
	}
	outCalc, err := Sanitize(in, noMailto)
	if err != nil {
		t.Fatalf("noMailto sanitize: %v", err)
	}
	if strings.Contains(outCalc, "mailto:") {
		t.Fatalf("mailto leaked without flag: %q", outCalc)
	}
}

func TestSanitize_PreservesTableColspanRowspan(t *testing.T) {
	in := `<table class="tinycld-doc-table"><tbody><tr><td class="tinycld-doc-td" colspan="2" rowspan="3">x</td></tr></tbody></table>`
	out, err := Sanitize(in, textAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if !strings.Contains(out, `colspan="2"`) || !strings.Contains(out, `rowspan="3"`) {
		t.Fatalf("colspan/rowspan stripped: %q", out)
	}
}

func TestSanitize_PreservesSpanDataAttrs(t *testing.T) {
	in := `<span class="tinycld-doc-mark--comment" data-comment-id="c-42">x</span>`
	out, err := Sanitize(in, textAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if !strings.Contains(out, `data-comment-id="c-42"`) {
		t.Fatalf("data-comment-id stripped: %q", out)
	}
}

func TestSanitize_DropsUnknownAttrsOnAllowedTag(t *testing.T) {
	// onclick is not in the per-tag allowlist and must drop; the tag
	// itself stays.
	in := `<p class="tinycld-doc-p" onclick="alert(1)" data-evil="x">y</p>`
	out, err := Sanitize(in, textAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "onclick") || strings.Contains(out, "data-evil") {
		t.Fatalf("unknown attrs leaked: %q", out)
	}
	if !strings.Contains(out, ">y</p>") {
		t.Fatalf("legit content lost: %q", out)
	}
}

func TestSanitize_FuzzAdversarial(t *testing.T) {
	cases := []string{
		`<script>alert(document.cookie)</script>`,
		`<img src=x onerror=alert(1)>`,
		`<a href="javascript:alert(1)">link</a>`,
		`<svg><script>alert(1)</script></svg>`,
		`<math><mtext><img src=x onerror=alert(1)></mtext></math>`,
		`<details ontoggle="alert(1)" open>`,
		`<iframe src="data:text/html,<script>alert(1)</script>"></iframe>`,
		`<style>body{background:url(javascript:alert(1))}</style>`,
		`<meta http-equiv="refresh" content="0;url=javascript:alert(1)">`,
		`<base href="javascript:alert(1)//">`,
		`<form action="javascript:alert(1)"><input></form>`,
		`<a href=" javascript:alert(1)">x</a>`,
		`<a href="\tjavascript:alert(1)">x</a>`,
	}
	for _, input := range cases {
		t.Run(input, func(t *testing.T) {
			for _, allow := range []Allowlist{calcAllow, textAllow} {
				out, err := Sanitize(input, allow)
				if err != nil {
					t.Fatalf("sanitize(%q): %v", input, err)
				}
				lower := strings.ToLower(out)
				for _, banned := range []string{
					"<script", "<iframe", "<style", "<meta", "<form",
					"<svg", "<math", "<base", "javascript:", "vbscript:",
					"onerror=", "onload=", "ontoggle=", "alert(",
				} {
					if strings.Contains(lower, banned) {
						t.Errorf("input %q produced dangerous %q in %q", input, banned, out)
					}
				}
			}
		})
	}
}

func TestSanitize_PreservesGridStructure(t *testing.T) {
	input := `<section class="tinycld-calc"><article class="tinycld-calc-sheet"><table class="tinycld-calc-grid"><thead><tr><th class="tinycld-calc-corner"></th><th class="tinycld-calc-col-h">A</th></tr></thead><tbody><tr><th class="tinycld-calc-row-h">1</th><td class="tinycld-calc-cell">x</td></tr></tbody></table></article></section>`
	out, err := Sanitize(input, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	for _, want := range []string{
		"tinycld-calc-corner",
		"tinycld-calc-col-h",
		"tinycld-calc-row-h",
		"tinycld-calc-cell",
		"<thead>",
		"<tbody>",
	} {
		if !strings.Contains(out, want) {
			t.Errorf("expected %q to survive, got %q", want, out)
		}
	}
}

func TestSanitize_PassThroughClean(t *testing.T) {
	in := `<article class="tinycld-doc"><p class="tinycld-doc-p">Hello <span class="tinycld-doc-mark--bold">bold</span></p></article>`
	out, err := Sanitize(in, textAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if out != in {
		t.Fatalf("expected pass-through for clean input.\n got: %q\nwant: %q", out, in)
	}
}

// TestSanitize_AdversarialStyle_UnicodeSeparator: U+2028 (LINE
// SEPARATOR) and U+2029 (PARAGRAPH SEPARATOR) are CSS whitespace in
// some contexts. Verify they can't smuggle a hostile substring past
// the lowercase-contains check.
func TestSanitize_AdversarialStyle_UnicodeSeparator(t *testing.T) {
	cases := []string{
		"<td style=\"x:y; javascript:alert(1)\">x</td>",
		"<td style=\"x:y; javascript:alert(1)\">x</td>",
	}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			out, err := Sanitize("<table><tr>"+raw+"</tr></table>", calcAllow)
			if err != nil {
				t.Fatalf("sanitize: %v", err)
			}
			if strings.Contains(strings.ToLower(out), "javascript") {
				t.Fatalf("javascript: must not leak: %q", out)
			}
		})
	}
}

// TestSanitize_AdversarialStyle_CSSEscapes: `\6a avascript:` is the
// six-digit CSS escape form of "javascript:". The lowercase-contains
// check won't see "javascript:" literally; verify it still fails to
// produce a working hostile style. (We accept the *fragment* surviving
// in a benign property like `font-family` — what matters is that no
// `expression()` / `url(javascript:…)` etc. is reconstructed.)
func TestSanitize_AdversarialStyle_CSSEscapes(t *testing.T) {
	in := `<table><tr><td style="font-family: '\6a avascript:alert(1)'">x</td></tr></table>`
	out, err := Sanitize(in, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	// font-family is allowlisted; the escape sequence stays as text
	// inside the quoted family name and the browser's CSS parser
	// resolves it to a (broken) font name. There's no path from this
	// to script execution — verify by checking the value didn't get
	// promoted into a url() or expression() form.
	if strings.Contains(strings.ToLower(out), "url(") ||
		strings.Contains(strings.ToLower(out), "expression(") {
		t.Fatalf("CSS escape promoted to active form: %q", out)
	}
}

// TestSanitize_AdversarialStyle_VendorPrefixedFunctions: drop styles
// using vendor-prefixed function values (image-set, cross-fade, etc.)
// that could embed url() with hostile schemes. The property is not on
// safeStyleProperties, so the declaration should drop regardless.
func TestSanitize_AdversarialStyle_VendorPrefixedFunctions(t *testing.T) {
	cases := []string{
		`<td style="background: -webkit-image-set(url(javascript:alert(1)) 1x)">x</td>`,
		`<td style="background: -webkit-cross-fade(url(javascript:alert(1)), url(b.png), 50%)">x</td>`,
	}
	for _, raw := range cases {
		t.Run(raw, func(t *testing.T) {
			out, err := Sanitize("<table><tr>"+raw+"</tr></table>", calcAllow)
			if err != nil {
				t.Fatalf("sanitize: %v", err)
			}
			if strings.Contains(strings.ToLower(out), "javascript") {
				t.Fatalf("javascript: must not leak: %q", out)
			}
		})
	}
}

// TestSanitize_AdversarialStyle_NestedParens: confirm
// splitStyleDeclarations doesn't lose its `depth` counter when a
// hostile value uses mismatched parens — a `(` without a matching
// `)` could leave depth > 0 and cause subsequent semicolons to be
// swallowed, smuggling further declarations through unparsed.
func TestSanitize_AdversarialStyle_NestedParens(t *testing.T) {
	in := `<table><tr><td style="color: red; font-family: foo(((; expression: alert(1)">x</td></tr></table>`
	out, err := Sanitize(in, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(strings.ToLower(out), "expression") {
		t.Fatalf("expression(...) must not leak even with mismatched parens: %q", out)
	}
}

// TestSanitize_AdversarialStyle_SafeDeclarationsLostOnPoison: when a
// dangerous substring appears anywhere in the style value, the ENTIRE
// attribute drops — including any safe declarations earlier in the
// value. Defense-in-depth: avoids the case where a malformed
// `splitStyleDeclarations` lets the safe ones through but loses the
// scope of the poison.
func TestSanitize_AdversarialStyle_SafeDeclarationsLostOnPoison(t *testing.T) {
	in := `<table><tr><td style="color: red; font-size: 12pt; behavior: url(xss.htc)">x</td></tr></table>`
	out, err := Sanitize(in, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	if strings.Contains(out, "style=") {
		t.Fatalf("dangerous substring must drop entire style attribute, got %q", out)
	}
}

// TestSanitize_AdversarialStyle_EmptyUrl: url() with no value passes
// the substring scan; styleURLSafe should still tolerate it (an
// empty url reference can't execute, but should also not crash).
func TestSanitize_AdversarialStyle_EmptyUrl(t *testing.T) {
	in := `<table><tr><td style="background: url()">x</td></tr></table>`
	out, err := Sanitize(in, calcAllow)
	if err != nil {
		t.Fatalf("sanitize: %v", err)
	}
	// Either drop the declaration (preferred) or keep it but ensure
	// no script execution path. The browser treats empty url() as
	// invalid; we don't care which way it goes as long as nothing
	// hostile makes it through.
	if strings.Contains(strings.ToLower(out), "javascript") ||
		strings.Contains(strings.ToLower(out), "expression(") {
		t.Fatalf("empty url() promoted to hostile form: %q", out)
	}
}

// TestSanitize_AdversarialStyle_StyleOnEveryTag: the universal
// style-allow path should be tested across multiple tags, not just
// <td>. A hostile style on <span>, <p>, <a> etc. should be filtered
// the same way.
func TestSanitize_AdversarialStyle_StyleOnEveryTag(t *testing.T) {
	tags := []string{"span", "p", "a", "h1", "li"}
	for _, tag := range tags {
		t.Run(tag, func(t *testing.T) {
			in := `<` + tag + ` style="color: red; behavior: url(xss)">x</` + tag + `>`
			out, err := Sanitize(in, textAllow)
			if err != nil {
				t.Fatalf("sanitize: %v", err)
			}
			if strings.Contains(out, "style=") {
				t.Fatalf("hostile style on <%s> survived: %q", tag, out)
			}
		})
	}
}

// TestSanitize_AdversarialStyle_EventHandlerCaseInsensitive: event-
// handler attributes are matched case-insensitively. <td onCLICK=…>
// (or other mixed-case spellings) should drop just like onclick.
func TestSanitize_AdversarialStyle_EventHandlerCaseInsensitive(t *testing.T) {
	cases := []string{
		`<table><tr><td OnClick="alert(1)">x</td></tr></table>`,
		`<table><tr><td ONCLICK="alert(1)">x</td></tr></table>`,
		`<table><tr><td onMouseOver="alert(1)">x</td></tr></table>`,
		`<table><tr><td onerror="alert(1)">x</td></tr></table>`,
	}
	for _, in := range cases {
		t.Run(in, func(t *testing.T) {
			out, err := Sanitize(in, calcAllow)
			if err != nil {
				t.Fatalf("sanitize: %v", err)
			}
			if strings.Contains(strings.ToLower(out), "alert(1)") {
				t.Fatalf("event handler leaked: %q", out)
			}
		})
	}
}

// TestSanitize_AdversarialStyle_EventHandlerOnVariousTags: same as
// above but across multiple tags, confirming the on-prefix strip is
// tag-agnostic.
func TestSanitize_AdversarialStyle_EventHandlerOnVariousTags(t *testing.T) {
	tags := []string{"span", "p", "a", "img", "td"}
	for _, tag := range tags {
		t.Run(tag, func(t *testing.T) {
			in := `<` + tag + ` onclick="alert(1)">x</` + tag + `>`
			out, err := Sanitize(in, textAllow)
			if err != nil {
				t.Fatalf("sanitize: %v", err)
			}
			if strings.Contains(out, "onclick") {
				t.Fatalf("<%s onclick=…> survived: %q", tag, out)
			}
		})
	}
}
