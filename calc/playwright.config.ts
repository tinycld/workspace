import path from 'node:path'
import { defineConfig } from '@playwright/test'
import appConfig from '../app/playwright.config'

const WS_ROOT = path.resolve(import.meta.dirname, '..')
const TEST_DIR = path.join(WS_ROOT, 'node_modules', '@tinycld', 'calc', 'tests')

export default defineConfig({ ...appConfig, testDir: TEST_DIR })
