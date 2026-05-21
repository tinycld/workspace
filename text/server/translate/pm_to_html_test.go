package translate

import (
	"strings"
	"testing"
)

// TestPMJSONToHTML_EmptyDoc verifies the renderer handles the empty
// "no content" doc — a fresh document right after creation. Output is
// a bare article wrapper.
func TestPMJSONToHTML_EmptyDoc(t *testing.T) {
	in := `{"type":"doc","content":[]}`
	out, err := PMJSONToHTML([]byte(in), HTMLRenderOpts{})
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if out != `<article class="tinycld-text"></article>` {
		t.Fatalf("unexpected empty-doc output: %q", out)
	}
}

func TestPMJSONToHTML_RejectsNonDocRoot(t *testing.T) {
	_, err := PMJSONToHTML([]byte(`{"type":"paragraph"}`), HTMLRenderOpts{})
	if err == nil {
		t.Fatal("expected error for non-doc root")
	}
	if !strings.Contains(err.Error(), "type=doc") {
		t.Fatalf("expected type=doc error, got: %v", err)
	}
}

func TestPMJSONToHTML_RejectsMalformedJSON(t *testing.T) {
	_, err := PMJSONToHTML([]byte(`{not json`), HTMLRenderOpts{})
	if err == nil {
		t.Fatal("expected error for malformed json")
	}
}

func TestPMJSONToHTML_SimpleParagraph(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"paragraph","content":[{"type":"text","text":"Hello world"}]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	want := `<article class="tinycld-text"><p class="tinycld-text-p">Hello world</p></article>`
	if out != want {
		t.Fatalf("got %q\nwant %q", out, want)
	}
}

func TestPMJSONToHTML_HeadingLevels(t *testing.T) {
	for level := 1; level <= 6; level++ {
		in := `{"type":"doc","content":[{"type":"heading","attrs":{"level":` +
			itoaSimple(level) + `},"content":[{"type":"text","text":"Title"}]}]}`
		out := mustRender(t, in, HTMLRenderOpts{})
		wantTag := "<h" + itoaSimple(level) + ` class="tinycld-text-h` + itoaSimple(level) + `">Title</h` + itoaSimple(level) + ">"
		if !strings.Contains(out, wantTag) {
			t.Fatalf("level=%d: missing %q in %q", level, wantTag, out)
		}
	}
}

func TestPMJSONToHTML_HeadingClampsLevel(t *testing.T) {
	// Out-of-range levels clamp into 1..6 (level=8 → h6).
	in := `{"type":"doc","content":[{"type":"heading","attrs":{"level":8},"content":[{"type":"text","text":"X"}]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `<h6 class="tinycld-text-h6">X</h6>`) {
		t.Fatalf("expected h6 fallback, got %q", out)
	}
}

func TestPMJSONToHTML_AlignAndIndent(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"paragraph","attrs":{"textAlign":"center","indent":2},
         "content":[{"type":"text","text":"X"}]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, "tinycld-text-align--center") {
		t.Fatalf("missing center align class: %q", out)
	}
	if !strings.Contains(out, "tinycld-text-indent--2") {
		t.Fatalf("missing indent-2 class: %q", out)
	}
}

func TestPMJSONToHTML_TextMarks(t *testing.T) {
	tests := []struct {
		name string
		mark string
		want string
	}{
		{"bold", `{"type":"bold"}`, "tinycld-text-mark--bold"},
		{"italic", `{"type":"italic"}`, "tinycld-text-mark--italic"},
		{"underline", `{"type":"underline"}`, "tinycld-text-mark--underline"},
		{"strike", `{"type":"strike"}`, "tinycld-text-mark--strike"},
		{"code", `{"type":"code"}`, "tinycld-text-mark--code"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			in := `{"type":"doc","content":[{"type":"paragraph","content":[
                {"type":"text","text":"X","marks":[` + tc.mark + `]}
            ]}]}`
			out := mustRender(t, in, HTMLRenderOpts{})
			if !strings.Contains(out, tc.want) {
				t.Fatalf("missing %s class in %q", tc.want, out)
			}
		})
	}
}

func TestPMJSONToHTML_StrikeWithBold(t *testing.T) {
	// strike combined with bold should produce nested wrappers; bold
	// nests outside strike per markPriority (bold=3, strike=6).
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"X","marks":[
            {"type":"strike"},
            {"type":"bold"}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, "tinycld-text-mark--strike") {
		t.Fatalf("missing strike class: %q", out)
	}
	if !strings.Contains(out, "tinycld-text-mark--bold") {
		t.Fatalf("missing bold class: %q", out)
	}
	idxBold := strings.Index(out, "mark--bold")
	idxStrike := strings.Index(out, "mark--strike")
	if !(idxBold < idxStrike) {
		t.Fatalf("expected bold to nest outside strike, got %q", out)
	}
}

func TestPMJSONToHTML_StrikeWithTextStyle(t *testing.T) {
	// strike combined with textStyle (color/font) should both surface;
	// strike (6) nests outside textStyle (8) per markPriority.
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"X","marks":[
            {"type":"strike"},
            {"type":"textStyle","attrs":{"color":"#ff0000"}}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, "tinycld-text-mark--strike") {
		t.Fatalf("missing strike class: %q", out)
	}
	if !strings.Contains(out, `color: #ff0000`) {
		t.Fatalf("missing textStyle color: %q", out)
	}
	idxStrike := strings.Index(out, "mark--strike")
	idxStyle := strings.Index(out, "mark--text-style")
	if !(idxStrike < idxStyle) {
		t.Fatalf("expected strike to nest outside text-style, got %q", out)
	}
}

func TestPMJSONToHTML_LinkMark_SafeHref(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"link","marks":[
            {"type":"link","attrs":{"href":"https://example.com/a"}}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `href="https://example.com/a"`) {
		t.Fatalf("missing href: %q", out)
	}
	if !strings.Contains(out, `rel="noopener noreferrer"`) {
		t.Fatalf("missing rel: %q", out)
	}
	if !strings.Contains(out, ">link</a>") {
		t.Fatalf("missing link text: %q", out)
	}
}

func TestPMJSONToHTML_LinkMark_RejectsJavascript(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"click","marks":[
            {"type":"link","attrs":{"href":"javascript:alert(1)"}}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	// The link wrapper is dropped at emit time; the text remains.
	if strings.Contains(out, "<a ") || strings.Contains(out, "<a>") {
		t.Fatalf("expected no <a> wrapper for javascript: href, got %q", out)
	}
	if strings.Contains(out, "javascript:") {
		t.Fatalf("javascript: must not leak into output: %q", out)
	}
	if !strings.Contains(out, ">click<") {
		t.Fatalf("expected text to survive: %q", out)
	}
}

func TestPMJSONToHTML_LinkMark_RejectsLeadingWhitespace(t *testing.T) {
	// "\tjavascript:" parses by url.Parse with an empty scheme; reject.
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"X","marks":[
            {"type":"link","attrs":{"href":"\tjavascript:alert(1)"}}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if strings.Contains(out, "<a ") || strings.Contains(out, "<a>") {
		t.Fatalf("expected no <a> for leading-whitespace js: href, got %q", out)
	}
}

func TestPMJSONToHTML_CommentMark_PreservesId(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"X","marks":[
            {"type":"comment","attrs":{"id":"c-42"}}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `data-comment-id="c-42"`) {
		t.Fatalf("missing data-comment-id: %q", out)
	}
}

func TestPMJSONToHTML_TextStyleMark(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"X","marks":[
            {"type":"textStyle","attrs":{
                "color":"#ff0000","fontSize":18,"fontFamily":"Arial"
            }}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	// font-family wraps the family name in single quotes; the
	// attribute-escaping pass converts those to &#39; before the
	// value lands in the HTML, so assert on the escaped form.
	if !strings.Contains(out, `color: #ff0000`) ||
		!strings.Contains(out, `font-size: 18px`) ||
		!strings.Contains(out, `font-family: &#39;Arial&#39;`) {
		t.Fatalf("missing textStyle inline-style declarations: %q", out)
	}
	if !strings.Contains(out, `class="tinycld-text-mark--text-style"`) {
		t.Fatalf("missing textStyle wrapper class: %q", out)
	}
}

func TestPMJSONToHTML_TextStyleMark_BackgroundColor(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"X","marks":[
            {"type":"textStyle","attrs":{"backgroundColor":"#FFFF00"}}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `background-color: #FFFF00`) {
		t.Fatalf("missing backgroundColor declaration: %q", out)
	}
	if !strings.Contains(out, `class="tinycld-text-mark--text-style"`) {
		t.Fatalf("missing textStyle wrapper class: %q", out)
	}
}

// TestPMJSONToHTML_TextStyleMark_BackgroundColor_RejectsUnsafe pins the
// safe-color gate for backgroundColor. The same isSafeColor allowlist
// that protects `color` also guards `background-color`; this test exists
// so a future refactor can't accidentally remove the check for one
// attr but not the other.
func TestPMJSONToHTML_TextStyleMark_BackgroundColor_RejectsUnsafe(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"X","marks":[
            {"type":"textStyle","attrs":{"backgroundColor":"url(javascript:1)"}}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if strings.Contains(out, "background-color:") {
		t.Fatalf("unsafe backgroundColor must be stripped: %q", out)
	}
	if strings.Contains(out, "javascript:") {
		t.Fatalf("javascript: must not leak: %q", out)
	}
}

func TestPMJSONToHTML_TextStyleMark_RejectsUnsafeColor(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"X","marks":[
            {"type":"textStyle","attrs":{"color":"red;background:url(javascript:1)"}}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	// Unsafe color must be rejected upstream of style emission — the
	// wrapper span has no `color:` declaration at all. (And with no
	// other safe attrs set, the wrapper itself is skipped entirely.)
	if strings.Contains(out, "color:") {
		t.Fatalf("unsafe color must be stripped: %q", out)
	}
	if strings.Contains(out, "javascript:") {
		t.Fatalf("javascript: must not leak: %q", out)
	}
}

// TestIsSafeColor pins the tightened color allowlist. Each adversarial
// input either embeds a CSS function call payload (url, var, etc.)
// or pads an otherwise-valid value with hostile content. The
// previous character-set check (alphanumerics + parens) accepted all
// of these.
func TestIsSafeColor(t *testing.T) {
	cases := []struct {
		in   string
		want bool
	}{
		// Hex, every supported width.
		{"#abc", true},
		{"#abcd", true},
		{"#abcdef", true},
		{"#abcdef12", true},
		{"#ABCDEF", true},
		{"#FFFFFF", true},
		// Hex, malformed.
		{"#ab", false},
		{"#abcde", false},
		{"#abcg12", false},
		{"#", false},
		// rgb/rgba happy path.
		{"rgb(255, 0, 0)", true},
		{"rgba(255, 0, 0, 0.5)", true},
		{"rgb(100%, 0%, 0%)", true},
		// rgb / rgba — hostile.
		{"rgb(0,0,0)/*", false},
		{"rgb(0;background:url(x))", false},
		{"url(javascript:1)", false},
		{"red;color:blue", false},
		// Named colors — whitelist.
		{"red", true},
		{"BLUE", true},
		{"transparent", true},
		// Named colors — outside whitelist.
		{"rebeccapurple", false},
		{"chartreuse", false},
		// Letters-only that pre-tightening allowed (no scheme, but a
		// hostile CSS function call shape).
		{"urlx", false},
		{"javascript", false},
		// Empty / oversized.
		{"", false},
		{strings.Repeat("a", 64), false},
	}
	for _, c := range cases {
		got := isSafeColor(c.in)
		if got != c.want {
			t.Errorf("isSafeColor(%q) = %v, want %v", c.in, got, c.want)
		}
	}
}

func TestPMJSONToHTML_BlockquoteAndCodeBlock(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"blockquote","content":[
            {"type":"paragraph","content":[{"type":"text","text":"quoted"}]}
        ]},
        {"type":"codeBlock","content":[{"type":"text","text":"fn main(){}"}]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `<blockquote class="tinycld-text-blockquote">`) {
		t.Fatalf("missing blockquote: %q", out)
	}
	if !strings.Contains(out, `<pre class="tinycld-text-pre"><code class="tinycld-text-code-block">fn main(){}</code></pre>`) {
		t.Fatalf("missing pre/code shape: %q", out)
	}
}

func TestPMJSONToHTML_NestedLists(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"bulletList","content":[
            {"type":"listItem","content":[
                {"type":"paragraph","content":[{"type":"text","text":"outer"}]},
                {"type":"orderedList","content":[
                    {"type":"listItem","content":[
                        {"type":"paragraph","content":[{"type":"text","text":"inner"}]}
                    ]}
                ]}
            ]}
        ]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `<ul class="tinycld-text-ul">`) {
		t.Fatalf("missing ul: %q", out)
	}
	if !strings.Contains(out, `<ol class="tinycld-text-ol">`) {
		t.Fatalf("missing nested ol: %q", out)
	}
	if !strings.Contains(out, "outer") || !strings.Contains(out, "inner") {
		t.Fatalf("missing list item text: %q", out)
	}
}

// Word emits an ordered list's resumption (after a nested bullet
// sub-list with a different numId interrupts it) with a `start` attr
// so the visual numbering continues — 1..5, bullets, 6. The renderer
// must surface that as the HTML `start` attribute on <ol>.
func TestPMJSONToHTML_OrderedListHonorsStart(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"orderedList","attrs":{"start":6},"content":[
            {"type":"listItem","content":[
                {"type":"paragraph","content":[{"type":"text","text":"Columns"}]}
            ]}
        ]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `<ol class="tinycld-text-ol" start="6">`) {
		t.Fatalf("missing start attribute on resumed ol: %q", out)
	}
}

// start=1 is the default for ordered lists; omit the attribute to
// keep the rendered HTML clean for the common case.
func TestPMJSONToHTML_OrderedListOmitsStartOne(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"orderedList","attrs":{"start":1},"content":[
            {"type":"listItem","content":[
                {"type":"paragraph","content":[{"type":"text","text":"a"}]}
            ]}
        ]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if strings.Contains(out, `start=`) {
		t.Fatalf("start=1 should be omitted, got: %q", out)
	}
}

// `start` is meaningless on <ul> and must never be emitted.
func TestPMJSONToHTML_BulletListIgnoresStart(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"bulletList","attrs":{"start":5},"content":[
            {"type":"listItem","content":[
                {"type":"paragraph","content":[{"type":"text","text":"x"}]}
            ]}
        ]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if strings.Contains(out, `start=`) {
		t.Fatalf("start must not appear on ul: %q", out)
	}
}

func TestPMJSONToHTML_TableWithMergedCells(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"table","content":[
            {"type":"tableRow","content":[
                {"type":"tableCell","attrs":{"isHeader":true,"colspan":2},
                 "content":[{"type":"paragraph","content":[{"type":"text","text":"Hdr"}]}]}
            ]},
            {"type":"tableRow","content":[
                {"type":"tableCell","attrs":{"rowspan":2},
                 "content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},
                {"type":"tableCell","content":[
                    {"type":"paragraph","content":[{"type":"text","text":"B"}]}
                ]}
            ]}
        ]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `<table class="tinycld-text-table">`) {
		t.Fatalf("missing table: %q", out)
	}
	if !strings.Contains(out, `<th class="tinycld-text-th" colspan="2">`) {
		t.Fatalf("missing th colspan: %q", out)
	}
	if !strings.Contains(out, `<td class="tinycld-text-td" rowspan="2">`) {
		t.Fatalf("missing td rowspan: %q", out)
	}
	if !strings.Contains(out, "Hdr") || !strings.Contains(out, "A") || !strings.Contains(out, "B") {
		t.Fatalf("missing cell text: %q", out)
	}
}

func TestPMJSONToHTML_TableWithColwidthEmitsColgroup(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"table","content":[
            {"type":"tableRow","content":[
                {"type":"tableCell","attrs":{"colwidth":[120]},
                 "content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},
                {"type":"tableCell","attrs":{"colwidth":[200]},
                 "content":[{"type":"paragraph","content":[{"type":"text","text":"B"}]}]}
            ]}
        ]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `<colgroup><col style="width: 120px"><col style="width: 200px"></colgroup>`) {
		t.Fatalf("missing or wrong colgroup: %q", out)
	}
}

// A cell with colspan>1 carries a colwidth array of length colspan;
// each entry must become its own <col>.
func TestPMJSONToHTML_TableColspanUnrollsColwidth(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"table","content":[
            {"type":"tableRow","content":[
                {"type":"tableCell","attrs":{"colspan":2,"colwidth":[80,140]},
                 "content":[{"type":"paragraph","content":[{"type":"text","text":"wide"}]}]},
                {"type":"tableCell","attrs":{"colwidth":[60]},
                 "content":[{"type":"paragraph","content":[{"type":"text","text":"narrow"}]}]}
            ]}
        ]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `<colgroup><col style="width: 80px"><col style="width: 140px"><col style="width: 60px"></colgroup>`) {
		t.Fatalf("colspan didn't unroll colwidth correctly: %q", out)
	}
}

// When no row carries colwidth on every cell, the renderer omits
// <colgroup> entirely so the table falls back to the CSS default.
func TestPMJSONToHTML_TableWithoutColwidthOmitsColgroup(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"table","content":[
            {"type":"tableRow","content":[
                {"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"A"}]}]},
                {"type":"tableCell","content":[{"type":"paragraph","content":[{"type":"text","text":"B"}]}]}
            ]}
        ]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if strings.Contains(out, "<colgroup>") {
		t.Fatalf("unexpected colgroup in width-less table: %q", out)
	}
}

// A paragraph containing a left/right-floated image gets a marker
// class so the preview CSS can `clear:` the paragraph and start a
// fresh BFC. Without this, sequential float-with-text paragraphs
// (Word's "image + caption" pattern repeated down a page) place the
// second image against the first float's edge instead of flush left.
func TestPMJSONToHTML_ParagraphWithFloatedImageGetsMarkerClass(t *testing.T) {
	in := `{"type":"doc","content":[
        {"type":"paragraph","content":[
            {"type":"image","attrs":{"src":"https://example/a.png","wrap":"left"}},
            {"type":"text","text":"text wrapping right"}
        ]},
        {"type":"paragraph","content":[
            {"type":"image","attrs":{"src":"https://example/b.png","wrap":"right"}},
            {"type":"text","text":"text wrapping left"}
        ]},
        {"type":"paragraph","content":[
            {"type":"image","attrs":{"src":"https://example/c.png","wrap":"break"}}
        ]},
        {"type":"paragraph","content":[{"type":"text","text":"plain"}]}
    ]}`
	out := mustRender(t, in, HTMLRenderOpts{Images: ImageModeURL})
	if !strings.Contains(out, `tinycld-text-p tinycld-text-p-with-float--left`) {
		t.Fatalf("missing left-float marker class: %q", out)
	}
	if !strings.Contains(out, `tinycld-text-p tinycld-text-p-with-float--right`) {
		t.Fatalf("missing right-float marker class: %q", out)
	}
	// "break"-wrapped images already clear themselves; no paragraph
	// marker class needed.
	if strings.Contains(out, `tinycld-text-p-with-float--break`) {
		t.Fatalf("break-wrapped image should not produce a paragraph marker class: %q", out)
	}
	// Plain text paragraphs stay clean.
	plainCount := strings.Count(out, `class="tinycld-text-p">plain</p>`)
	if plainCount != 1 {
		t.Fatalf("plain paragraph should keep just the base class, got: %q", out)
	}
}

func TestPMJSONToHTML_Image_URLMode_DataURI_Passthrough(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"image","attrs":{"src":"data:image/png;base64,iVBORw0KGgo=","alt":"x"}}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{Images: ImageModeURL})
	if !strings.Contains(out, `src="data:image/png;base64,iVBORw0KGgo="`) {
		t.Fatalf("data URI passthrough failed: %q", out)
	}
	if !strings.Contains(out, `alt="x"`) {
		t.Fatalf("alt attribute lost: %q", out)
	}
}

func TestPMJSONToHTML_Image_URLMode_HTTPPassthrough(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"image","attrs":{"src":"https://example/file.png","width":300,"height":200}}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{Images: ImageModeURL})
	if !strings.Contains(out, `src="https://example/file.png"`) {
		t.Fatalf("http URL passthrough failed: %q", out)
	}
	if !strings.Contains(out, `width="300"`) || !strings.Contains(out, `height="200"`) {
		t.Fatalf("dimensions lost: %q", out)
	}
}

func TestPMJSONToHTML_Image_EmbedMode_FetchesBytes(t *testing.T) {
	fetched := []string{}
	fetcher := func(src string) (string, []byte, error) {
		fetched = append(fetched, src)
		return "image/png", []byte{0x89, 0x50, 0x4e, 0x47}, nil
	}
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"image","attrs":{"src":"https://example/file.png"}}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{
		Images:       ImageModeEmbed,
		EmbedFetcher: fetcher,
	})
	if !strings.Contains(out, `src="data:image/png;base64,iVBORw==`) {
		t.Fatalf("expected base64-encoded data URI, got %q", out)
	}
	if len(fetched) != 1 || fetched[0] != "https://example/file.png" {
		t.Fatalf("unexpected fetcher calls: %v", fetched)
	}
}

func TestPMJSONToHTML_Image_EmbedMode_DataURI_Untouched(t *testing.T) {
	called := false
	fetcher := func(src string) (string, []byte, error) {
		called = true
		return "", nil, nil
	}
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"image","attrs":{"src":"data:image/png;base64,AAA="}}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{
		Images:       ImageModeEmbed,
		EmbedFetcher: fetcher,
	})
	if called {
		t.Fatal("fetcher should not be called for data: URIs")
	}
	if !strings.Contains(out, `src="data:image/png;base64,AAA="`) {
		t.Fatalf("data URI lost: %q", out)
	}
}

func TestPMJSONToHTML_Image_EmbedMode_FailureDropsSilently(t *testing.T) {
	fetcher := func(src string) (string, []byte, error) {
		return "", nil, fmtError("boom")
	}
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"image","attrs":{"src":"https://example/missing.png"}}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{
		Images:       ImageModeEmbed,
		EmbedFetcher: fetcher,
	})
	if strings.Contains(out, "<img") {
		t.Fatalf("expected no <img> for failed fetch, got %q", out)
	}
}

func TestPMJSONToHTML_Image_WrapMode(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"image","attrs":{"src":"data:image/png;base64,AAA=","wrap":"left"}}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, "tinycld-text-img-wrap--left") {
		t.Fatalf("missing wrap--left class: %q", out)
	}
}

func TestPMJSONToHTML_PageBreak(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"pageBreak"}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `<hr class="tinycld-text-hr">`) {
		t.Fatalf("missing page break <hr>: %q", out)
	}
}

func TestPMJSONToHTML_FootnoteReference(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"see"},
        {"type":"footnoteReference","attrs":{"id":"3"}}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `<sup class="tinycld-text-footnote-ref">[3]</sup>`) {
		t.Fatalf("missing footnote ref: %q", out)
	}
}

func TestPMJSONToHTML_TextEscapes(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"<script>alert('x')</script>"}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if strings.Contains(out, "<script>") {
		t.Fatalf("script tag must be escaped, got %q", out)
	}
	if !strings.Contains(out, "&lt;script&gt;") {
		t.Fatalf("expected escaped script, got %q", out)
	}
}

func TestPMJSONToHTML_UnsupportedNode_SilentInProd(t *testing.T) {
	// Default (TINYCLD_DEV unset) drops unknown nodes silently.
	in := `{"type":"doc","content":[{"type":"someThingWeird"}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if strings.Contains(out, "TODO") || strings.Contains(out, "someThingWeird") {
		t.Fatalf("expected silent drop in prod, got %q", out)
	}
}

func TestPMJSONToHTML_UnsupportedNode_TodoInDev(t *testing.T) {
	t.Setenv("TINYCLD_DEV", "1")
	in := `{"type":"doc","content":[{"type":"someThingWeird"}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, "TODO: unsupported block 'someThingWeird'") {
		t.Fatalf("expected dev-mode TODO, got %q", out)
	}
}

func TestPMJSONToHTML_MarkOrdering_Deterministic(t *testing.T) {
	// Marks come in randomized order from the source; output should
	// always nest link outermost, formatting innermost. Snapshot the
	// expected nesting.
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"X","marks":[
            {"type":"italic"},
            {"type":"link","attrs":{"href":"https://a.example/"}},
            {"type":"bold"}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	// link wraps everything; then bold (3); then italic (4).
	idxA := strings.Index(out, "<a")
	idxBold := strings.Index(out, "mark--bold")
	idxItalic := strings.Index(out, "mark--italic")
	if !(idxA < idxBold && idxBold < idxItalic) {
		t.Fatalf("expected link > bold > italic nesting, got %q", out)
	}
}

func TestPMJSONToHTML_LinkMark_AllowsMailto(t *testing.T) {
	in := `{"type":"doc","content":[{"type":"paragraph","content":[
        {"type":"text","text":"mail","marks":[
            {"type":"link","attrs":{"href":"mailto:a@example.com"}}
        ]}
    ]}]}`
	out := mustRender(t, in, HTMLRenderOpts{})
	if !strings.Contains(out, `href="mailto:a@example.com"`) {
		t.Fatalf("mailto link dropped: %q", out)
	}
}

// Round-trip pairing: every fixture that pm_to_docx_test.go round-trips
// is asserted to also render cleanly here. The Go test runner discovers
// these alongside the rest of the package's tests. We don't compare the
// HTML output byte-for-byte against a golden — round-trip parity is
// asserted in roundtrip_test.go on the docx side, and the structural
// assertions above cover renderer correctness — but rendering every
// fixture without panic / error gives us a smoke test that the renderer
// keeps up with the supported-node set as new fixtures are added.
func TestPMJSONToHTML_FixtureSmokeTest(t *testing.T) {
	fixtures := []string{
		// Empty body
		`{"type":"doc","content":[]}`,
		// Paragraph with rich marks
		`{"type":"doc","content":[{"type":"paragraph","content":[
            {"type":"text","text":"Bold and italic","marks":[
                {"type":"bold"},{"type":"italic"}
            ]}
        ]}]}`,
		// Heading + alignment
		`{"type":"doc","content":[
            {"type":"heading","attrs":{"level":2,"textAlign":"right"},
             "content":[{"type":"text","text":"Right"}]}
        ]}`,
		// Mixed list
		`{"type":"doc","content":[
            {"type":"bulletList","content":[
                {"type":"listItem","content":[
                    {"type":"paragraph","content":[{"type":"text","text":"a"}]}
                ]}
            ]},
            {"type":"orderedList","content":[
                {"type":"listItem","content":[
                    {"type":"paragraph","content":[{"type":"text","text":"1"}]}
                ]}
            ]}
        ]}`,
	}
	for i, fx := range fixtures {
		if _, err := PMJSONToHTML([]byte(fx), HTMLRenderOpts{}); err != nil {
			t.Errorf("fixture %d: %v", i, err)
		}
	}
}

// mustRender renders the input and fails the test on error.
func mustRender(t *testing.T, in string, opts HTMLRenderOpts) string {
	t.Helper()
	out, err := PMJSONToHTML([]byte(in), opts)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	return out
}

// itoaSimple — keep tests dependency-free; strconv.Itoa works but
// importing it just for the heading test is busywork.
func itoaSimple(n int) string {
	if n < 0 || n > 9 {
		return ""
	}
	return string(rune('0' + n))
}

type fmtErr struct{ s string }

func (e *fmtErr) Error() string { return e.s }
func fmtError(s string) error   { return &fmtErr{s} }
