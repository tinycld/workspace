import { Platform } from 'react-native'

const inserted = new Set<string>()

export function useWebStyles(id: string, css: string) {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    if (inserted.has(id)) return
    inserted.add(id)

    const style = document.createElement('style')
    style.id = id
    style.textContent = css
    document.head.appendChild(style)
}

export function useWebStylesheet(id: string, href: string) {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    if (inserted.has(id)) return
    inserted.add(id)

    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = href
    document.head.appendChild(link)
}
