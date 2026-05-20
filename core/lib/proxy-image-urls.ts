export function proxyImageUrls(html: string, token: string): string {
    if (!html) return html
    const encodedToken = encodeURIComponent(token)
    return html.replace(
        /(<img[^>]+src=["'])(?!cid:)(?!data:)(https?:\/\/[^"']+)(["'])/gi,
        (_, prefix, url, suffix) =>
            `${prefix}/api/mail/image-proxy?url=${encodeURIComponent(url)}&token=${encodedToken}${suffix}`
    )
}
