import { copyFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const publicLogo = fileURLToPath(new URL('./public/ordered-food-logo.jpg', import.meta.url))
const distDir = fileURLToPath(new URL('./dist/', import.meta.url))
const distLogo = fileURLToPath(new URL('./dist/ordered-food-logo.jpg', import.meta.url))

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'ensure-ordered-food-logo',
      closeBundle() {
        mkdirSync(distDir, { recursive: true })
        copyFileSync(publicLogo, distLogo)
      },
    },
  ],
})
