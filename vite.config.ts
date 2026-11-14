import { alphaTab } from '@coderline/alphatab-vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Served from https://mendus59.github.io/LuthiersPen/
export default defineConfig({
  base: '/LuthiersPen/',
  plugins: [react(), alphaTab()],
  build: { chunkSizeWarningLimit: 2500 },
})
