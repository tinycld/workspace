// Side-effect import: installs globalThis.crypto.getRandomValues on RN.
// No-op on web (the browser already provides it).
import 'react-native-get-random-values'
import { randomUUID } from 'expo-crypto'

// react-native-get-random-values doesn't install randomUUID, and Hermes
// has no built-in crypto.randomUUID. Add it from expo-crypto so callers
// (e.g. @tanstack/db's collection constructor) can rely on the standard
// Web Crypto API on every platform.
//
// On web the browser already provides crypto.randomUUID — and expo-crypto's
// web implementation of randomUUID delegates back to globalThis.crypto, so
// re-assigning would create infinite recursion on first use. The guard
// makes this a no-op when the host already has its own.
const cryptoGlobal = (globalThis as { crypto?: Partial<Crypto> }).crypto
if (cryptoGlobal && !cryptoGlobal.randomUUID) {
    cryptoGlobal.randomUUID = randomUUID as Crypto['randomUUID']
}
