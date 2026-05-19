import { gzipSync, constants as zlibConstants } from 'node:zlib'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

function gzipCompressionPlugin(): Plugin {
  let outputDir = ''

  return {
    name: 'ioniclink:gzip-compression',
    apply: 'build',
    configResolved(config) {
      outputDir = resolve(config.root, config.build.outDir)
    },
    writeBundle(_, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (!/\.(js|mjs|css|html|json|svg|txt|xml|wasm)$/.test(fileName)) {
          continue
        }

        const sourcePath = resolve(outputDir, fileName)
        if (!existsSync(sourcePath)) {
          continue
        }

        const compressedPath = resolve(dirname(sourcePath), `${fileName.split('/').pop()}.gz`)
        writeFileSync(
          compressedPath,
          gzipSync(readFileSync(sourcePath), { level: zlibConstants.Z_BEST_COMPRESSION })
        )
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), gzipCompressionPlugin()],
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('/@vue/') || id.includes('/vue/') || id.includes('/vue-router/')) return 'vendor-vue'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/lucide-react/')) return 'vendor-react'
          if (id.includes('/axios/')) return 'vendor-http'
          if (id.includes('/echarts/') || id.includes('/zrender/')) return 'vendor-echarts'
          if (id.includes('/chart.js/') || id.includes('/vue-chartjs/')) return 'vendor-charts'
          if (id.includes('/pdfjs-dist/')) return 'vendor-pdf'
          if (id.includes('/@rdkit/rdkit/')) return 'vendor-rdkit'
          if (id.includes('/@tanstack/vue-virtual/')) return 'vendor-virtual'
          return undefined
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true
      }
    }
  }
})
