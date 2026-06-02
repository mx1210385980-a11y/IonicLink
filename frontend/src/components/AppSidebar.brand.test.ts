import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'AppSidebar.vue'), 'utf8')

describe('AppSidebar brand entry', () => {
  it('uses the supplied IonicLink logo image in the brand mark', () => {
    expect(source).toContain('/ioniclink.png')
  })

  it('routes the brand mark to Home', () => {
    expect(source).toContain("@click=\"emit('navigate', 'home')\"")
    expect(source).not.toContain("@click=\"emit('navigate', 'blog', 'articles')\"")
  })

  it('shows pointer cursor for Home brand navigation', () => {
    expect(source).toContain('cursor-pointer')
  })
})
