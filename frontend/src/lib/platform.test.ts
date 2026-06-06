import { describe, expect, it } from 'vitest'

import { DEFAULT_SECTION_BY_VIEW, resolveRoute } from './platform'

describe('platform routing', () => {
  it('opens the platform home view by default instead of collapsing to library', () => {
    expect(DEFAULT_SECTION_BY_VIEW.home).toBe('today')
    expect(resolveRoute()).toEqual({
      view: 'home',
      section: 'today',
    })
  })

  it('routes the retired pipeline view to the library', () => {
    expect(resolveRoute('pipeline', 'upload')).toEqual({
      view: 'library',
      section: 'explorer',
    })
  })

  it('keeps canonical workspaces addressable', () => {
    expect(resolveRoute('home')).toEqual({ view: 'home', section: 'today' })
    expect(resolveRoute('library')).toEqual({ view: 'library', section: 'explorer' })
    expect(resolveRoute('knowledge')).toEqual({ view: 'knowledge', section: 'explorer' })
    expect(resolveRoute('modeling')).toEqual({ view: 'modeling', section: 'training' })
    expect(resolveRoute('admin')).toEqual({ view: 'admin', section: 'runtime' })
  })

  it('retires the old review routes into the library workspace', () => {
    expect(resolveRoute('review')).toEqual({ view: 'home', section: 'today' })
    expect(resolveRoute('literature')).toEqual({ view: 'library', section: 'explorer' })
    expect(resolveRoute('grounding')).toEqual({ view: 'library', section: 'explorer' })
  })

  it('removes help as a routable workspace and sends old guide links home', () => {
    expect(DEFAULT_SECTION_BY_VIEW).not.toHaveProperty('help')
    expect(resolveRoute('help')).toEqual({ view: 'home', section: 'today' })
    expect(resolveRoute('guide')).toEqual({ view: 'home', section: 'today' })
  })
})
