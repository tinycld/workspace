# Print parity: old vs. new path

Phase 2 of the server-side HTML rendering plan replaces the
`editor.getHTML()` print path with a fetch from
`/api/text/render?images=embed`. This document records the
intentional differences in the produced HTML so the print output's
visual parity can be reviewed at a glance.

## Pipelines

**Old (replaced)**
```
editor.getHTML()         → renderPrintHtml(body)         → handlePrint
  ↓ ProseMirror HTML       ↓ wrap in <article            ↓ window.print or
    serializer               class="print-document">       expo-print
```

**New**
```
fetchRenderedHtml(source,  → renderPrintEnvelope(html,    → handlePrint
  { images: 'embed' })       buildTextPrintCss())
  ↓ server PMJSONToHTML +    ↓ wrap in <!doctype html>     ↓ same handler
    sanitize + ETag           <html><head><style>...</style></head>
                              <body>...</body></html>
```

## Intentional structural differences

| Aspect              | Old output                                  | New output                                                  | Why                                                              |
| ------------------- | ------------------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------- |
| Outer wrapper       | `<article class="print-document">…</article>` | `<article class="tinycld-text">…</article>`                  | Class vocabulary unified with preview path; print CSS targets it |
| Paragraph           | `<p>…</p>`                                  | `<p class="tinycld-text-p">…</p>`                            | Same — class enables targeted styling                            |
| Heading             | `<h1>…</h1>`                                | `<h1 class="tinycld-text-h1">…</h1>`                         | Same                                                             |
| Bold                | `<strong>…</strong>`                        | `<span class="tinycld-text-mark--bold">…</span>`             | Mark-based class; semantic boldness conveyed via `font-weight: 700` rule |
| Italic              | `<em>…</em>`                                | `<span class="tinycld-text-mark--italic">…</span>`           | Same                                                             |
| Link                | `<a href="…">…</a>`                         | `<a class="tinycld-text-mark--link" href="…" rel="noopener noreferrer">…</a>` | `rel` added for security; class targets link styling             |
| Code (inline)       | `<code>…</code>`                            | `<code class="tinycld-text-mark--code">…</code>`             | Class differentiates inline code from code block                 |
| Code block          | `<pre><code>…</code></pre>`                 | `<pre class="tinycld-text-pre"><code class="tinycld-text-code-block">…</code></pre>` | Same                                                             |
| Image               | `<img src="data:…">`                        | `<img class="tinycld-text-img" src="data:…" loading="lazy" decoding="async">` | Same image transport (data URI), with native browser hints       |
| Table cell border   | inline `style="border-top: 1px solid;"`     | base `.tinycld-text-td { border: 1px solid }` (sanitizer drops inline `style=`) | Inline `style=` is dropped by the sanitizer; default cell border drawn by the print CSS rule |
| Color (text)        | inline `style="color: #ff0000"`             | `<span class="tinycld-text-mark--text-style" data-color="#ff0000">` | Inline `style=` is dropped; `data-color` attribute available for future CSS attribute selectors |

## Lost / changed: items the new print path no longer reproduces

- **Per-cell `<td style="border-top: …">` inline borders** are dropped
  by the sanitizer. The print CSS gives every cell a uniform 1px
  border; documents that authored deliberate per-cell border treatments
  via the in-editor border tool will look more uniform on print.
  Restoring this is a follow-up: the BorderedTableCell extension
  encodes the border state in a `data-borders="…"` attribute alongside
  the inline style, and the server renderer can be extended to surface
  it via class modifiers or sanitizer-permitted data attributes.

- **Arbitrary `<span style="color: …">` runs from old documents** lose
  the inline color. Documents that previously typed `<span style>` are
  not affected (the editor's textStyle extension emits these as PM
  marks, which the new renderer surfaces as `data-color="…"` attrs).
  Old serialized HTML with raw `<span style>` from imports would
  display in default color; the source docx is the canonical store and
  the renderer reads it directly, so this only affects export paths.

## How to verify

Run a representative docx (`tests/assets/feature-test.docx` plus the
docx-fidelity fixtures with images / tables / lists) through both
the old commit (`git checkout <pre-migration commit>`) and the new
commit:

```sh
# Old path: editor mounted, getHTML() returns raw PM serialization
curl 'http://localhost:7100/print-debug-old' > old.html

# New path: API returns sanitized fragment
curl -H "Authorization: Bearer $TOKEN" \
    'http://127.0.0.1:7200/api/text/render/<itemId>?images=embed' > new-fragment.html
```

The unit tests `tests/print-render-html.test.ts` codify the print
envelope's shape; the HTTP-level integration tests
`tests/preview.spec.ts` verify the server fragment carries the right
class vocabulary end-to-end.
