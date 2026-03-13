import * as RDKitLoaderModule from '@rdkit/rdkit'
import rdkitWasmUrl from '@rdkit/rdkit/dist/RDKit_minimal.wasm?url'
import type { RDKitLoader, RDKitModule } from '@rdkit/rdkit'

let rdkitInstance: RDKitModule | null = null
let initPromise: Promise<RDKitModule> | null = null

function getRDKitLoader(): RDKitLoader {
  const moduleValue = RDKitLoaderModule as unknown as RDKitLoader & { default?: RDKitLoader }
  const loader = moduleValue.default ?? moduleValue

  if (typeof loader !== 'function') {
    throw new Error('RDKit loader is not available')
  }

  return loader
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
      const initRDKitModule = getRDKitLoader()
      initPromise = initRDKitModule({
        locateFile: () => rdkitWasmUrl,
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
