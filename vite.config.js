import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.js',
        vite: {
          build: {
            rollupOptions: {
              external: ['webtorrent'],
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.js'),
      },
      // renderer: {}, // Disabled to prevent renderer_init iterator error
    }),
  ],
})
