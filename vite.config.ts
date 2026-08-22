import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { scraperPlugin } from './scripts/vite-scraper-plugin.mjs'

export default defineConfig({
  plugins: [react(), tailwindcss(), scraperPlugin()],
  server: {
    proxy: {
      '/sleeper': {
        target: 'https://api.sleeper.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sleeper/, ''),
      },
    },
  },
  preview: {
    proxy: {
      '/sleeper': {
        target: 'https://api.sleeper.app',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/sleeper/, ''),
      },
    },
  },
})
