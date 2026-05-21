// buildTextPrintCssWeb returns the body of a <style> block (no outer
// <style> tags). The print envelope embeds this between
// <head><style> and </style></head>, and the server-rendered
// fragment provides the `tinycld-text*` class names this CSS targets.
//
// Web printing flow: the host browser fetches external images
// itself during print preview, so `images=url` would work too —
// but we still use `images=embed` from the print path because it
// keeps the web + native paths sharing one envelope. Either way,
// nothing here needs to strip remote assets.
export function buildTextPrintCssWeb(): string {
    return `
@page { size: portrait; margin: 0.75in; }
html, body { margin: 0; padding: 0; background: #fff; }
body {
    font-family: -apple-system, system-ui, 'Segoe UI', Roboto, sans-serif;
    font-size: 11pt;
    line-height: 1.4;
    color: #000;
}
.tinycld-text {
    width: 100%;
}
.tinycld-text-p {
    margin: 0 0 0.5em 0;
    orphans: 3;
    widows: 3;
}
.tinycld-text-h1, .tinycld-text-h2, .tinycld-text-h3,
.tinycld-text-h4, .tinycld-text-h5, .tinycld-text-h6 {
    font-weight: 700;
    margin: 0.6em 0 0.3em;
    break-after: avoid;
    clear: both;
}
.tinycld-text-h1 { font-size: 18pt; }
.tinycld-text-h2 { font-size: 15pt; }
.tinycld-text-h3 { font-size: 13pt; }
.tinycld-text-h4,
.tinycld-text-h5,
.tinycld-text-h6 { font-size: 11pt; }
.tinycld-text-align--left { text-align: left; }
.tinycld-text-align--center { text-align: center; }
.tinycld-text-align--right { text-align: right; }
.tinycld-text-align--justify { text-align: justify; }
.tinycld-text-indent--1 { padding-left: 0.4in; }
.tinycld-text-indent--2 { padding-left: 0.8in; }
.tinycld-text-indent--3 { padding-left: 1.2in; }
.tinycld-text-indent--4 { padding-left: 1.6in; }
.tinycld-text-indent--5 { padding-left: 2in; }
.tinycld-text-indent--6 { padding-left: 2.4in; }
.tinycld-text-indent--7 { padding-left: 2.8in; }
.tinycld-text-indent--8 { padding-left: 3.2in; }
.tinycld-text-ul,
.tinycld-text-ol {
    padding-left: 1.6em;
    margin: 0 0 0.5em 0;
}
.tinycld-text-ul {
    padding-left: 3.2em;
}
.tinycld-text-li { margin: 0.1em 0; }
.tinycld-text-li > .tinycld-text-p { margin: 0; }
.tinycld-text-blockquote {
    border-left: 3px solid #888;
    padding-left: 0.75em;
    margin: 0 0 0.5em 0;
    color: #333;
}
.tinycld-text-pre {
    background: #f4f4f5;
    padding: 8px 10px;
    margin: 0 0 0.5em 0;
    border-radius: 4px;
}
.tinycld-text-code-block,
.tinycld-text-mark--code {
    font-family: 'Courier New', monospace;
    font-size: 0.9em;
}
.tinycld-text-mark--code {
    background: #f4f4f5;
    padding: 0 4px;
    border-radius: 2px;
}
.tinycld-text-mark--bold { font-weight: 700; }
.tinycld-text-mark--italic { font-style: italic; }
.tinycld-text-mark--underline { text-decoration: underline; }
.tinycld-text-mark--strike { text-decoration: line-through; }
.tinycld-text-mark--link {
    color: #000;
    text-decoration: underline;
}
.tinycld-text-mark--comment {
    background: rgba(250, 204, 21, 0.18);
}
.tinycld-text-table {
    border-collapse: collapse;
    margin: 0 0 0.5em 0;
    table-layout: fixed;
    max-width: 100%;
    clear: both;
}
.tinycld-text-th,
.tinycld-text-td {
    border: 1px solid #888;
    padding: 4px 6px;
    text-align: left;
    vertical-align: top;
}
.tinycld-text-th { background: #f0f0f0; font-weight: 700; }
.tinycld-text-img {
    max-width: 100%;
    height: auto;
}
.tinycld-text-img-wrap--left {
    float: left;
    margin: 0.25em 1em 0.5em 0;
}
.tinycld-text-img-wrap--right {
    float: right;
    margin: 0.25em 0 0.5em 1em;
}
.tinycld-text-p-with-float--left { clear: left; }
.tinycld-text-p-with-float--right { clear: right; }
.tinycld-text-img-wrap--break {
    display: block;
    clear: both;
    margin: 0.5em 0;
}
.tinycld-text-hr {
    border: none;
    border-top: 1px solid #ccc;
    margin: 1em 0;
    page-break-after: always;
    break-after: page;
}
.tinycld-text-tr,
.tinycld-text-h1,
.tinycld-text-h2,
.tinycld-text-h3,
.tinycld-text-h4,
.tinycld-text-blockquote,
.tinycld-text-table,
.tinycld-text-img,
.tinycld-text-pre {
    break-inside: avoid;
}
`
}
