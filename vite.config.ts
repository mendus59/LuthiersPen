import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { alphaTab } from '@coderline/alphatab-vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// The version shown in the app: package.json version, the commit it was built from and the build date.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }
function commit(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7)
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

// Served from https://mendus59.github.io/LuthiersPen/
export default defineConfig({
  base: '/LuthiersPen/',
  plugins: [react(), alphaTab()],
  build: { chunkSizeWarningLimit: 2500 },
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_COMMIT__: JSON.stringify(commit()),
    __APP_BUILT__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
})
