import { afterEach, describe, expect, it } from 'vitest'
import { createApp, nextTick, type App } from 'vue'

import type { RecordResponse } from '@/lib/api'
import ConditionMicrobar from './ConditionMicrobar.vue'

let mountedApp: App<Element> | null = null

function createRecord(overrides: Partial<RecordResponse> = {}): RecordResponse {
  return {
    id: 1,
    materialName: 'Au(111)',
    lubricant: '[BMIM][AOT]',
    cofValue: 0.312,
    cofOperator: null,
    cofRaw: null,
    loadValue: '30 nN',
    loadRaw: '30 nN',
    speedValue: '6 μm/s',
    shearRate: '195-1300 s^-1',
    temperature: '298 K',
    potential: 'OCP',
    waterContent: 'dry',
    probeMaterial: 'Silicon',
    probeGeometry: 'Tip',
    probeRadius: null,
    probeRoughness: null,
    substrateMaterial: 'Au(111)',
    substrateCoating: null,
    substrateRoughness: null,
    tribopairLabel: null,
    surfaceRoughness: null,
    residualFilmThicknessD: null,
    layerSpacingDelta: null,
    filmThickness: null,
    molRatio: null,
    cation: null,
    anion: null,
    cationSmiles: null,
    anionSmiles: null,
    ilSmiles: null,
    ilInchikey: null,
    alkylChainLength: null,
    confidence: 0.89,
    confidenceDetails: {
      base_score: 0.89,
      base_percent: 89,
      score: 0.89,
      percent: 89,
      penalties: [],
      boosts: [],
      penalty_total: 0,
      penalty_percent: 0,
      boost_total: 0,
      boost_percent: 0,
    },
    literatureId: 11,
    literature: null,
    evidence: null,
    evidencePage: null,
    evidenceBbox: null,
    source: null,
    sourcePage: null,
    sourceFigure: null,
    ...overrides,
  }
}

afterEach(() => {
  mountedApp?.unmount()
  mountedApp = null
  document.body.innerHTML = ''
})

describe('ConditionMicrobar interactions', () => {
  it('emits field-specific evidence targets from visible and overflow condition items', async () => {
    const emitted: string[] = []
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountedApp = createApp(ConditionMicrobar, {
      record: createRecord(),
      onOpenEvidence: (fieldKey: string) => emitted.push(fieldKey),
    })
    mountedApp.mount(root)
    await nextTick()

    ;(root.querySelector('button[aria-label="Open load evidence"]') as HTMLButtonElement | null)?.click()
    ;(root.querySelector('button[aria-label="Open speed evidence"]') as HTMLButtonElement | null)?.click()

    const overflowButton = root.querySelector('button[aria-expanded="false"]') as HTMLButtonElement | null
    overflowButton?.click()
    await nextTick()
    ;(root.querySelector('button[aria-label="Open water evidence"]') as HTMLButtonElement | null)?.click()

    expect(emitted).toEqual(['load', 'speed', 'water_content'])
  })

  it('opens the compact overflow popover when the +N button is clicked', async () => {
    const root = document.createElement('div')
    document.body.appendChild(root)
    mountedApp = createApp(ConditionMicrobar, {
      record: createRecord(),
    })
    mountedApp.mount(root)
    await nextTick()

    const overflowButton = root.querySelector('button[aria-expanded="false"]') as HTMLButtonElement | null
    expect(overflowButton?.textContent?.trim()).toBe('+2')
    expect(root.querySelector('.condition-overflow-popover')).toBeNull()

    overflowButton?.click()
    await nextTick()

    expect(overflowButton?.getAttribute('aria-expanded')).toBe('true')
    expect(root.querySelector('.condition-overflow-popover')).not.toBeNull()
  })
})
