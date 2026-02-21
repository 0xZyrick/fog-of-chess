import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    nodePolyfills({
      globals: {
        Buffer: true,
        global: true,
      },
    }),
  ],
  envDir: '..',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Fixed the incomplete path here
    },
    dedupe: ['@stellar/stellar-sdk']
  },
  optimizeDeps: {
    include: ['@stellar/stellar-sdk', 'buffer'],
  },
  build: {
    commonjsOptions: {
      transformMixedEsModules: true
    }
  },
  server: {
    port: 3000,
    open: true
  }
})