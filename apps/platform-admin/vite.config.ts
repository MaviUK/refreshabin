import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: '/platform-admin/',
  plugins: [react()],
  build: {
    outDir: '../restaurant/dist/platform-admin',
    emptyOutDir: false,
  },
})
