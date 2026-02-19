import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'

// Stamp the service worker with a build-time version so old caches are busted on deploy
function swVersionPlugin() {
  return {
    name: 'sw-version',
    writeBundle() {
      const swPath = resolve('dist', 'sw.js')
      try {
        const content = readFileSync(swPath, 'utf-8')
        writeFileSync(swPath, content.replace('__BUILD_TIME__', Date.now().toString()))
      } catch {
        // sw.js may not exist in dist if public folder is empty
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), swVersionPlugin()],
  server: {
    // Prevent connection resets during development
    hmr: {
      overlay: true
    }
  },
  build: {
    // Split chunks for better caching and faster loads
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Separate large dependencies for better caching
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom') || id.includes('scheduler')) {
              return 'vendor-react'
            }
            if (id.includes('firebase')) {
              return 'firebase'
            }
            if (id.includes('html2canvas') || id.includes('jspdf')) {
              return 'pdf-export'
            }
            if (id.includes('@dnd-kit')) {
              return 'dnd'
            }
            if (id.includes('date-fns')) {
              return 'date-fns'
            }
          }
        }
      }
    },
    // Target modern browsers for smaller bundle
    target: 'es2020',
    // Minify with aggressive settings
    minify: 'esbuild',
    // CSS code splitting for faster first paint
    cssCodeSplit: true,
    // Generate source maps only for production debugging (can disable for smaller files)
    sourcemap: false,
    // Reduce chunk size warnings threshold
    chunkSizeWarningLimit: 500,
    // Inline small assets for fewer requests
    assetsInlineLimit: 4096
  },
  // Optimize dependency pre-bundling for faster dev and build
  optimizeDeps: {
    include: ['react', 'react-dom', '@dnd-kit/core', '@dnd-kit/sortable', 'date-fns']
  }
})
