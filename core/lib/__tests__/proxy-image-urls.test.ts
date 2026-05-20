import { describe, expect, it } from 'vitest'
import { proxyImageUrls } from '../proxy-image-urls'

const TOKEN = 'test-auth-token'

describe('proxyImageUrls', () => {
    it('rewrites https image URLs with token', () => {
        const html = '<img src="https://example.com/photo.jpg" alt="test">'
        const result = proxyImageUrls(html, TOKEN)
        expect(result).toBe(
            '<img src="/api/mail/image-proxy?url=https%3A%2F%2Fexample.com%2Fphoto.jpg&token=test-auth-token" alt="test">'
        )
    })

    it('rewrites http image URLs', () => {
        const html = '<img src="http://example.com/photo.jpg">'
        const result = proxyImageUrls(html, TOKEN)
        expect(result).toContain(
            '/api/mail/image-proxy?url=http%3A%2F%2Fexample.com%2Fphoto.jpg&token=test-auth-token'
        )
    })

    it('preserves cid: URLs', () => {
        const html = '<img src="cid:image001@example.com">'
        const result = proxyImageUrls(html, TOKEN)
        expect(result).toBe(html)
    })

    it('preserves data: URLs', () => {
        const html = '<img src="data:image/png;base64,abc123">'
        const result = proxyImageUrls(html, TOKEN)
        expect(result).toBe(html)
    })

    it('handles multiple images', () => {
        const html =
            '<img src="https://a.com/1.jpg"><img src="cid:x"><img src="https://b.com/2.png">'
        const result = proxyImageUrls(html, TOKEN)
        expect(result).toContain('/api/mail/image-proxy?url=https%3A%2F%2Fa.com%2F1.jpg&token=')
        expect(result).toContain('src="cid:x"')
        expect(result).toContain('/api/mail/image-proxy?url=https%3A%2F%2Fb.com%2F2.png&token=')
    })

    it('handles single and double quotes', () => {
        const html = `<img src='https://example.com/photo.jpg'>`
        const result = proxyImageUrls(html, TOKEN)
        expect(result).toContain(
            '/api/mail/image-proxy?url=https%3A%2F%2Fexample.com%2Fphoto.jpg&token='
        )
    })

    it('returns empty string for empty input', () => {
        expect(proxyImageUrls('', TOKEN)).toBe('')
    })

    it('passes through HTML with no images', () => {
        const html = '<p>Hello world</p>'
        expect(proxyImageUrls(html, TOKEN)).toBe(html)
    })
})
