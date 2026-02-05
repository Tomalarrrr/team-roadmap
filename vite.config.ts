import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
