package mail

import (
	"strings"
	"testing"
)

func TestSanitizeEmailHTML(t *testing.T) {
	tests := []struct {
		name     string
		input    string
		contains []string
		absent   []string
	}{
		{
			name:     "strips script tags",
			input:    `<p>Hello</p><script>alert(1)</script>`,
			contains: []string{"<p>Hello</p>"},
			absent:   []string{"<script>", "alert(1)"},
		},
		{
			name:     "strips event handlers",
			input:    `<p onclick="alert(1)">Click me</p>`,
			contains: []string{"<p>Click me</p>"},
			absent:   []string{"onclick"},
		},
		{
			name:     "strips iframes",
			input:    `<p>Before</p><iframe src="http://evil.com"></iframe><p>After</p>`,
			contains: []string{"<p>Before</p>", "<p>After</p>"},
			absent:   []string{"<iframe", "evil.com"},
		},
		{
			name:     "strips form elements",
			input:    `<form action="/steal"><input type="text"><button>Submit</button></form>`,
			absent:   []string{"<form", "<input", "<button", "/steal"},
		},
		{
			name:     "preserves basic formatting",
			input:    `<p>Hello <strong>world</strong> and <em>friends</em></p>`,
			contains: []string{"<p>Hello <strong>world</strong> and <em>friends</em></p>"},
		},
		{
			name:     "preserves links",
			input:    `<a href="https://example.com">Link</a>`,
			contains: []string{`<a href="https://example.com"`, "Link</a>"},
		},
		{
			name:     "preserves table structure",
			input:    `<table><tr><td>Cell</td></tr></table>`,
			contains: []string{"<table>", "<tr>", "<td>", "Cell"},
		},
		{
			name:     "preserves style attributes on allowed elements",
			input:    `<p style="color:red">Styled</p>`,
			contains: []string{`style="color:red"`},
		},
		{
			name:     "preserves cid URLs for inline images",
			input:    `<img src="cid:image001@example.com" alt="logo">`,
			contains: []string{"cid:image001@example.com", `alt="logo"`},
		},
		{
			name:     "preserves table layout attributes",
			input:    `<table width="600" cellpadding="0" border="0"><tr><td align="center" valign="top">Content</td></tr></table>`,
			contains: []string{`width="600"`, `cellpadding="0"`, `border="0"`, `align="center"`, `valign="top"`},
		},
		{
			name:     "strips object and embed",
			input:    `<object data="flash.swf"></object><embed src="flash.swf">`,
			absent:   []string{"<object", "<embed", "flash.swf"},
		},
		{
			name:     "handles empty input",
			input:    "",
			contains: []string{""},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := sanitizeEmailHTML(tt.input)
			for _, want := range tt.contains {
				if !strings.Contains(result, want) {
					t.Errorf("expected result to contain %q, got: %s", want, result)
				}
			}
			for _, unwanted := range tt.absent {
				if strings.Contains(result, unwanted) {
					t.Errorf("expected result NOT to contain %q, got: %s", unwanted, result)
				}
			}
		})
	}
}
