import { gzipSync, constants as zlibConstants } from 'node:zlib'
import type { Plugin } from 'vite'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

function gzipCompressionPlugin(): Plugin {
  return {
    name: 'ioniclink:gzip-compression',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const [fileName, chunk] of Object.entries(bundle)) {
        if (!/\.(js|mjs|css|html|json|svg|txt|xml)$/.test(fileName)) {
          continue
        }

        const source =
          chunk.type === 'asset'
            ? chunk.source
            : chunk.type === 'chunk'
              ? chunk.code
              : null

        if (source == null) {
          continue
        }

        const buffer = Buffer.isBuffer(source) ? source : Buffer.from(String(source))
        this.emitFile({
          type: 'asset',
          fileName: `${fileName}.gz`,
          source: gzipSync(buffer, { level: zlibConstants.Z_BEST_COMPRESSION })
        })
      }
    }
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), gzipCompressionPlugin()],
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
