import { create } from '@tinycld/core/lib/store'

export type ToastVariant = 'info' | 'success' | 'warning' | 'error'

export interface Toast {
    id: string
    title: string
    body?: string
    variant: ToastVariant
    duration: number
    action?: { label: string; onPress: () => void }
}

interface ToastStoreState {
    toasts: Toast[]
    addToast: (toast: Omit<Toast, 'id'>) => void
    removeToast: (id: string) => void
}

let nextId = 0

export const useToastStore = create<ToastStoreState>()(set => ({
    toasts: [],
    addToast: toast => {
        const id = `toast-${++nextId}`
        set(s => ({ toasts: [...s.toasts, { ...toast, id }] }))
    },
    removeToast: id => {
        set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
    },
}))
