import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const frontendRoot = resolve(__dirname, '..', '..')

function source(path: string) {
  return readFileSync(resolve(frontendRoot, path), 'utf8')
}

describe('fixed frontend surface', () => {
  it('does not depend on the retired guide video asset', () => {
    expect(existsSync(resolve(frontendRoot, 'public/guide.mp4'))).toBe(false)
    expect(source('src/components/GettingStarted.vue')).not.toContain('guide.mp4')
    expect(source('src/components/GettingStarted.vue')).not.toContain('<video')
  })

  it('does not keep Vite scaffold files in the active frontend tree', () => {
    expect(existsSync(resolve(frontendRoot, 'src/components/HelloWorld.vue'))).toBe(false)
    expect(existsSync(resolve(frontendRoot, 'public/vite.svg'))).toBe(false)
  })
})
