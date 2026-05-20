// renderPrintEnvelope wraps a server-emitted HTML fragment in a
// printable HTML document. The fragment carries semantic class names
// (`tinycld-*`); the CSS arg supplies the package's print styling
// (page rules, font, table grid, etc.). The envelope itself is
// deliberately minimal — no headers/footers, no scaffolding markup —
// so the package print CSS can lay out the page freely.
//
// Used by both the calc print path and the text print path. Output is
// handed to the platform-specific handlePrint (web injects it into a
// print container; native passes it to expo-print).
//
// Pure function. Unit tests snapshot the string.
export function renderPrintEnvelope(fragment: string, css: string): string {
    return [
        '<!doctype html>',
        '<html lang="en">',
        '<head>',
        '<meta charset="utf-8">',
        '<title>Print</title>',
        '<style>',
        css,
        '</style>',
        '</head>',
        '<body>',
        fragment,
        '</body>',
        '</html>',
    ].join('\n')
}
