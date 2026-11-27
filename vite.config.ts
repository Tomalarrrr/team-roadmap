import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { build as esbuild } from 'esbuild'

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

// Slugs imports 'phaser', and the package's only entry is the whole library prebuilt
// (1.4 MB minified), which cannot be tree-shaken. Its source is CommonJS switched by
// webpack-style `typeof FLAG` tests, so the parts Slugs uses are bundled from it here
// with the flags set as Phaser's own build sets them, less sound, which Slugs has none
// of. Dev and build both get this, so a part missing from phaserParts.js shows up in dev.
function phaserParts(): Plugin {
  const entry = fileURLToPath(new URL('src/components/slugs/phaserParts.js', import.meta.url))
  const flags: Record<string, boolean> = {
    CANVAS_RENDERER: true,
    WEBGL_RENDERER: true,
    WEBGL_DEBUG: false,
    FEATURE_SOUND: false,
    PLUGIN_CAMERA3D: false,
    PLUGIN_FBINSTANT: false,
  }
  const tests = new RegExp(`typeof (${Object.keys(flags).join('|')})\\b`, 'g')
  const id = '\0phaser-parts'
  return {
    name: 'phaser-parts',
    enforce: 'pre',
    resolveId(source) {
      return source === 'phaser' ? id : null
    },
    async load(loaded) {
      if (loaded !== id) return null
      this.addWatchFile(entry)
      const out = await esbuild({
        entryPoints: [entry],
        bundle: true,
        format: 'esm',
        // Without its doc comments and indentation the dev module is 5.1 MB, not 15.8; names stay for stack traces.
        minifyWhitespace: true,
        minifySyntax: true,
        write: false,
        plugins: [{
          name: 'phaser-flags',
          setup(build) {
            build.onLoad({ filter: /[\\/]phaser[\\/]src[\\/].*\.js$/ }, ({ path }) => ({
              contents: readFileSync(path, 'utf-8').replace(tests, (_, flag: string) => String(flags[flag])),
              loader: 'js',
            }))
          },
        }],
      })
      return out.outputFiles[0].text
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // The /api/db proxy (api/db/[...path].ts) only runs on Vercel, not under the
  // plain Vite dev server. To keep `npm run dev` working, mirror its behaviour
  // here by proxying /api/db/* straight to the Firebase REST API.
  const env = loadEnv(mode, process.cwd(), '')
  const dbUrl = (env.FIREBASE_DATABASE_URL || env.VITE_FIREBASE_DATABASE_URL || '').replace(/\/$/, '')

  return {
  plugins: [phaserParts(), react(), swVersionPlugin()],
  server: {
    // Prevent connection resets during development
    hmr: {
      overlay: true
    },
    proxy: dbUrl
      ? {
          // Rewrite /api/db/<path> → <db>/<path>.json so dev matches the
          // production Edge proxy. http-proxy forwards method + body natively.
          '^/api/db/.*': {
            target: dbUrl,
            changeOrigin: true,
            rewrite: (path: string) => {
              const sub = path.replace(/^\/api\/db\//, '').replace(/\/+$/, '')
              return `/${sub}.json`
            }
          }
        }
      : undefined
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
  }
})
