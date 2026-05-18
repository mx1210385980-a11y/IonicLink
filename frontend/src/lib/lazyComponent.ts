import { defineAsyncComponent, h, type Component } from 'vue'

const CHUNK_RELOAD_KEY = 'ioniclink-chunk-reload-at'
const CHUNK_RELOAD_WINDOW_MS = 30_000

function errorText(error: unknown) {
  const value = error as any
  return [
    value?.message,
    value?.stack,
    String(value || ''),
  ].filter(Boolean).join('\n').toLowerCase()
}

export function isChunkLoadError(error: unknown) {
  const text = errorText(error)
  return text.includes('failed to fetch dynamically imported module')
    || text.includes('error loading dynamically imported module')
    || text.includes('importing a module script failed')
    || text.includes('chunkloaderror')
    || text.includes('loading chunk')
    || text.includes('dynamically imported module')
}

export function recoverFromChunkLoadError(error: unknown) {
  if (!isChunkLoadError(error) || typeof window === 'undefined') return false

  const now = Date.now()
  const previous = Number(window.sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0)
  if (previous && now - previous < CHUNK_RELOAD_WINDOW_MS) {
    return false
  }

  window.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
  window.location.reload()
  return true
}

export function installChunkLoadRecovery() {
  if (typeof window === 'undefined') return

  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault()
    recoverFromChunkLoadError((event as any).payload || event)
  })

  window.addEventListener('unhandledrejection', (event) => {
    if (recoverFromChunkLoadError(event.reason)) {
      event.preventDefault()
    }
  })

  window.addEventListener('error', (event) => {
    if (recoverFromChunkLoadError(event.error || event.message)) {
      event.preventDefault()
    }
  })
}

type AsyncComponentModule<T extends Component> = T | { default: T }

export function lazyComponent<T extends Component>(loader: () => Promise<AsyncComponentModule<T>>): T {
  const component = defineAsyncComponent({
    loader,
    delay: 0,
    timeout: 30_000,
    suspensible: false,
    errorComponent: {
      render() {
        return h(
          'div',
          {
            class: 'flex h-full min-h-[12rem] items-center justify-center px-6 text-center text-sm font-medium text-slate-500',
          },
          'Page resources are updating. Refreshing the workspace...',
        )
      },
    },
    onError(error, retry, fail, attempts) {
      if (recoverFromChunkLoadError(error)) {
        fail()
        return
      }

      if (attempts <= 2) {
        retry()
        return
      }
      fail()
    },
  })
  return component as unknown as T
}
