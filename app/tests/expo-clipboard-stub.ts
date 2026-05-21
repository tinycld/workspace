// Test-only stub for expo-clipboard. The real package transitively
// imports expo-modules-core, which has too many side effects to load
// under a Node test environment (it touches several globals expected
// to be set up by Metro/RN). Tests get a minimal in-memory shim that
// records the last-written text and returns it on read.

let text = ''

export async function setStringAsync(s: string): Promise<void> {
    text = s
}

export async function getStringAsync(): Promise<string> {
    return text
}

// Test-only escape hatch: reset the in-memory clipboard between tests.
export function __resetClipboardTextForTest(): void {
    text = ''
}
