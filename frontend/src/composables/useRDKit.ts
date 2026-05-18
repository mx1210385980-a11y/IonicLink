import type { RDKitLoader, RDKitModule } from '@rdkit/rdkit'
import { recoverFromChunkLoadError } from '@/lib/lazyComponent'

let rdkitInstance: RDKitModule | null = null
let initPromise: Promise<RDKitModule> | null = null
let loaderPromise: Promise<{ loader: RDKitLoader; wasmUrl: string }> | null = null

function resolveRDKitLoader(moduleValue: unknown): RDKitLoader {
  const candidate = moduleValue as RDKitLoader & { default?: RDKitLoader }
  const loader = candidate.default ?? candidate

  if (typeof loader !== 'function') {
    throw new Error('RDKit loader is not available')
  }

  return loader
}

async function loadRDKitRuntime() {
  if (loaderPromise) return loaderPromise

  loaderPromise = Promise.all([
    import('@rdkit/rdkit'),
    import('@rdkit/rdkit/dist/RDKit_minimal.wasm?url'),
  ]).then(([loaderModule, wasmModule]) => {
    return {
      loader: resolveRDKitLoader(loaderModule),
      wasmUrl: String((wasmModule as { default?: string }).default || ''),
    }
  }).catch((error) => {
    loaderPromise = null
    recoverFromChunkLoadError(error)
    throw error
  })

  return loaderPromise
}

/**
 * Composable for managing RDKit.js initialization
 * Uses singleton pattern to ensure WASM module is loaded only once
 */
export function useRDKit() {
  /**
   * Initialize RDKit.js WASM module
   * Returns cached instance if already initialized
   */
  const initRDKit = async (): Promise<RDKitModule> => {
    if (rdkitInstance) {
      return rdkitInstance
    }

    if (initPromise) {
      return initPromise
    }

    try {
      const { loader: initRDKitModule, wasmUrl } = await loadRDKitRuntime()
      initPromise = initRDKitModule({
        locateFile: () => wasmUrl,
      })
      const module = await initPromise
      rdkitInstance = module
      return module
    } catch (error) {
      initPromise = null
      throw new Error(`Failed to initialize RDKit: ${error}`)
    }
  }

  /**
   * Check if RDKit is already initialized
   */
  const isInitialized = (): boolean => {
    return rdkitInstance !== null
  }

  /**
   * Get the current RDKit instance (may be null)
   */
  const getInstance = (): RDKitModule | null => {
    return rdkitInstance
  }

  return {
    initRDKit,
    isInitialized,
    getInstance,
  }
}
