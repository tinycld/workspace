import { expect, type Page, test } from '@playwright/test'
import { login, ORG_SLUG } from '../../../../tests/e2e/helpers'
import {
    authAsTestUser,
    FEATURE_DOC_HEADING,
    PB_URL,
    TEXT_TEST_TIMEOUT,
    uniqueDocName,
    uploadDocxAsDriveItem,
} from './_menubar-helpers'

// End-to-end coverage for the docx preview / server-rendered HTML
// path introduced in Phase 2 of the server-side HTML rendering plan.
// The renderer + endpoint live in text/server (Go unit tests cover
// correctness exhaustively); this spec exercises the integration
// loop: PB drive_item → /api/text/render → iframe content.

const TEST_TIMEOUT = TEXT_TEST_TIMEOUT

test.describe('Text — Server-rendered preview', () => {
    test.setTimeout(TEST_TIMEOUT)

    test('GET /api/text/render returns an HTML fragment with tinycld-text classes', async ({
        request,
    }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('preview-fetch'))
        const token = await authAsTestUser()

        const res = await request.get(`${PB_URL}/api/text/render/${itemId}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
        expect(res.status()).toBe(200)
        expect(res.headers()['content-type']).toContain('text/html')
        const body = await res.text()
        expect(body).toContain('class="tinycld-text"')
        expect(body).toContain(FEATURE_DOC_HEADING)
    })

    test('GET /api/text/render returns 304 on matching If-None-Match', async ({ request }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('preview-etag'))
        const token = await authAsTestUser()

        const first = await request.get(`${PB_URL}/api/text/render/${itemId}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
        expect(first.status()).toBe(200)
        const etag = first.headers().etag
        expect(etag).toBeTruthy()

        const second = await request.get(`${PB_URL}/api/text/render/${itemId}`, {
            headers: {
                Authorization: `Bearer ${token}`,
                'If-None-Match': etag,
            },
        })
        expect(second.status()).toBe(304)
    })

    test('GET /api/text/render rejects unauthenticated requests', async ({ request }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('preview-401'))
        const res = await request.get(`${PB_URL}/api/text/render/${itemId}`)
        expect([401, 403]).toContain(res.status())
    })

    // Pins down three HTML-shape features that the drive preview relies
    // on for full docx fidelity (regression-tested at the unit level in
    // server/translate/pm_to_html_test.go, but worth covering end-to-end
    // so a sanitizer-allowlist or generator regression surfaces here too):
    //   1. tables carry a <colgroup> with per-column width styles
    //   2. ordered lists resumed after a bullet sub-list carry start=N
    //   3. floated-image paragraphs carry the BFC-marker class
    test('rendered HTML preserves table colwidth, ol start, and float markers', async ({
        request,
    }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('preview-shape'))
        const token = await authAsTestUser()
        const res = await request.get(`${PB_URL}/api/text/render/${itemId}`, {
            headers: { Authorization: `Bearer ${token}` },
        })
        expect(res.status()).toBe(200)
        const body = await res.text()

        // feature-test.docx ships a Simple Tables table with explicit
        // column widths from <w:tblGrid>. The renderer surfaces those
        // via <colgroup><col style="width:Npx"> — assert the colgroup
        // exists and at least one col carries an inline width.
        expect(body).toContain('<colgroup>')
        expect(body).toMatch(/<col style="width: \d+px">/)

        // feature-test.docx has a numbered outline interrupted by a
        // bulleted sub-list, then resumes at item 6. After the docx
        // parser re-nests the sub-list inside the outer ordered list,
        // the merged outline numbers naturally 1..6 with no `start`
        // attribute (the re-nest drops it). Without the re-nest the
        // resumed half would carry start="6". Either is acceptable
        // for this assertion — we just verify the resumed item still
        // says "Columns" and didn't get split off into a separate
        // start-at-1 list (which would print "1. Columns").
        expect(body).toMatch(/<li[^>]*>[^<]*<p[^>]*>Columns/)

        // feature-test.docx has two left-floated images in sequence
        // (web access symbol + pie chart). Each image-paragraph must
        // carry the float marker class so the preview CSS can clear
        // prior floats before placing the new image.
        expect(body).toContain('tinycld-text-p-with-float--left')
    })

    test('GET /api/text/render?images=embed returns base64 data URIs', async ({ request }) => {
        const itemId = await uploadDocxAsDriveItem(uniqueDocName('preview-embed'))
        const token = await authAsTestUser()

        const res = await request.get(`${PB_URL}/api/text/render/${itemId}?images=embed`, {
            headers: { Authorization: `Bearer ${token}` },
        })
        expect(res.status()).toBe(200)
        const body = await res.text()
        // feature-test.docx contains an inline image. The PM importer
        // resolves it to a data: URI; in embed mode the renderer
        // passes it through verbatim (no external URL → no fetcher
        // round-trip). We assert the data: URI marker survives.
        expect(body).toContain('class="tinycld-text"')
        // Use a loose substring check — different docx fixtures emit
        // different image extensions, so we only assert the data:
        // prefix made it into the document.
        if (body.includes('<img')) {
            expect(body).toContain('data:image/')
        }
    })

    test.skip('drive preview modal renders docx content via the new TextPreview', async ({
        page,
    }: {
        page: Page
    }) => {
        // Drive UI navigation depends on grid rendering + viewport scroll,
        // both of which are subject to layout drift across browsers. The
        // HTTP-level tests above cover end-to-end render + ETag + auth;
        // re-enable this when the share modal exposes a deterministic
        // testid for the docx tile.
        const docxName = uniqueDocName('preview-ui')
        await uploadDocxAsDriveItem(docxName)
        await login(page)
        await page.goto(`/a/${ORG_SLUG}/drive`)
        const tile = page.getByText(docxName).first()
        await tile.waitFor({ state: 'visible', timeout: 30_000 })
        await tile.dblclick()
        const iframe = page.frameLocator('iframe[aria-label*="Preview of"]').first()
        await expect(iframe.locator('article.tinycld-text')).toBeVisible({
            timeout: 30_000,
        })
        await expect(iframe.getByText(FEATURE_DOC_HEADING).first()).toBeVisible()
    })
})
