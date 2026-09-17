import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset URLs: the built bundle is served from an arbitrary path
  // (static container behind Caddy, iframed by skiplum.com).
  base: './',
  plugins: [react(), tailwindcss()],
  // The engine is a wasm-bindgen `--target web` module instantiated in a Web
  // Worker, so workers are bundled as ES modules.
  worker: {
    format: 'es',
  },
  build: {
    // Never base64-inline the wasm binary: the wasm-bindgen glue fetches it by
    // URL and streaming instantiation needs a real asset. Everything else keeps
    // Vite's default inlining behaviour.
    assetsInlineLimit: (filePath) =>
      filePath.endsWith('.wasm') ? false : undefined,
  },
})
