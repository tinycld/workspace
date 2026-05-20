import { getResolvedAddress } from './server-address'

function readAddress(): string {
    const addr = getResolvedAddress()
    if (!addr) {
        throw new Error(
            'PB_SERVER_ADDR accessed before server address was resolved. ' +
                'Ensure the _layout.tsx gate has run first.'
        )
    }
    return addr
}

export const PB_SERVER_ADDR = new Proxy(
    { [Symbol.toPrimitive]: () => readAddress() },
    {
        get(_target, prop) {
            if (prop === Symbol.toPrimitive) return () => readAddress()
            if (prop === 'toString' || prop === 'valueOf') return () => readAddress()
            const addr = readAddress()
            const value = (addr as unknown as Record<string | symbol, unknown>)[prop]
            return typeof value === 'function' ? value.bind(addr) : value
        },
    }
) as unknown as string
