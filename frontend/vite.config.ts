import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteStaticCopy } from 'vite-plugin-static-copy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), viteStaticCopy({
    targets: ['cmaps', 'standard_fonts', 'wasm'].map(directory => ({
      src: `node_modules/pdfjs-dist/${directory}`,
      dest: 'pdfjs',
    })),
  })],
})
