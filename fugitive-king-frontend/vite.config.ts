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
    'vite-plugin-node-polyfills/shims/buffer': path.resolve(__dirname, './node_modules/buffer/index.js'),
  },
  dedupe: ['@stellar/stellar-sdk']
},
optimizeDeps: {
    include: ['@stellar/stellar-sdk', 'buffer'],
    exclude: ['vite-plugin-node-polyfills'],
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