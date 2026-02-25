import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    // ✅ Must be FIRST — intercepts the import before load-fallback runs
    {
      name: 'node-polyfills-shim',
      resolveId(id) {
        if (id === 'vite-plugin-node-polyfills/shims/buffer') return '\0buffer-shim';
        if (id === 'buffer') return '\0buffer-shim';
      },
      load(id) {
        if (id === '\0buffer-shim') {
          return `
            import { Buffer as _Buffer } from 'node:buffer';
            export { _Buffer as Buffer };
            export default { Buffer: _Buffer };
          `;
        }
      },
    },
    react(),
    nodePolyfills({
      globals: { Buffer: true, global: true },
    }),
  ],
  envDir: '..',
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
    dedupe: ['@stellar/stellar-sdk']
  },
  optimizeDeps: {
    include: ['@stellar/stellar-sdk', 'buffer'],
  },
  build: {
    commonjsOptions: { transformMixedEsModules: true }
  },
  server: { port: 3000, open: true }
})