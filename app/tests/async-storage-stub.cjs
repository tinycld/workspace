'use strict'

// Stub for @react-native-async-storage/async-storage in unit tests.
// Provides a minimal in-memory implementation so tests that exercise
// code pulling in core/lib/pocketbase can run without the native bridge.
const store = new Map()

const api = {
    getItem: async (key) => store.get(key) ?? null,
    setItem: async (key, value) => {
        store.set(key, value)
    },
    removeItem: async (key) => {
        store.delete(key)
    },
    clear: async () => {
        store.clear()
    },
    getAllKeys: async () => Array.from(store.keys()),
    multiGet: async (keys) => keys.map((k) => [k, store.get(k) ?? null]),
    multiSet: async (pairs) => {
        for (const [k, v] of pairs) store.set(k, v)
    },
    multiRemove: async (keys) => {
        for (const k of keys) store.delete(k)
    },
}

module.exports = { default: api, ...api }
