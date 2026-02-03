import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Split chunks for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate Firebase into its own chunk (lazy loaded)
          firebase: ['firebase/app', 'firebase/database'],
          // Separate PDF export libs into their own chunk (lazy loaded)
          'pdf-export': ['html2canvas', 'jspdf'],
          // Separate DnD kit into its own chunk
          dnd: ['@dnd-kit/core', '@dnd-kit/sortable', '@dnd-kit/utilities'],
          // Separate date-fns
          'date-fns': ['date-fns']
        }
      }
    },
    // Target modern browsers for smaller bundle
    target: 'es2020',
    // Reduce chunk size warnings threshold
    chunkSizeWarningLimit: 500
  }
})
