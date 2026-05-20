import AsyncStorage from '@react-native-async-storage/async-storage'
import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'

export { create }
export const asyncStorage = createJSONStorage(() => AsyncStorage)
export { persist }
