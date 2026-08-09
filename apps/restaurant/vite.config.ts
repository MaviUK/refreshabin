import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const publicLogo = fileURLToPath(new URL('./public/ordered-food-logo.jpg', import.meta.url))
const logoDataUrl = `data:image/jpeg;base64,${readFileSync(publicLogo).toString('base64')}`

export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.ORDERED_FOOD_LOGO': JSON.stringify(logoDataUrl),
  },
})
