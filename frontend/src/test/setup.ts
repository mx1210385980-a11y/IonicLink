import { afterEach, vi } from 'vitest'

afterEach(() => {
  vi.restoreAllMocks()
  window.localStorage.clear()
})
