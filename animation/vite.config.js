import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// Builds a SINGLE self-contained index.html (three.js, Rapier physics, the GLB
// card and every texture inlined as base64). That one file gets pinned to IPFS
// and used as the NFT's animation_url, so it cannot depend on any external
// request succeeding.
export default defineConfig({
  plugins: [react(), viteSingleFile()],
  assetsInclude: ['**/*.glb'],
  build: {
    target: 'es2020',
    assetsInlineLimit: 100000000,
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  }
})