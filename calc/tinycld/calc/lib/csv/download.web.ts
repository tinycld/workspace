// downloadCsv (web) triggers a "save file" UX by building a Blob,
// allocating an object URL, and clicking a synthetic anchor tag with the
// `download` attribute. Releases the URL after the click.
//
// Async-shaped to mirror the native variant (which awaits a file write
// and the share sheet); the web body itself returns synchronously after
// the click.

export async function downloadCsv(filename: string, text: string): Promise<void> {
    if (typeof document === 'undefined') return
    // Prepend a UTF-8 BOM so Excel on Windows opens UTF-8 CSVs correctly
    // (without the BOM it falls back to the system codepage and mangles
    // non-ASCII characters). Other tools tolerate the BOM.
    const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.style.display = 'none'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    // Defer revocation a tick so Firefox's download dialog has time to
    // read the URL.
    setTimeout(() => URL.revokeObjectURL(url), 0)
}
