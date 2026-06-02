import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'IntegratedExplorerWorkspace.vue'), 'utf-8')

describe('IntegratedExplorerWorkspace scale lanes', () => {
  it('exposes compact Nano and Macro library lanes backed by experiment scale filtering', () => {
    expect(source).toContain('scaleLaneOptions')
    expect(source).toContain("label: 'All'")
    expect(source).toContain("label: 'Nano / AFM'")
    expect(source).toContain("label: 'Macro / Tribometer'")
    expect(source).toContain('setScaleLane')
    expect(source).toContain('selectedExperimentScale.value = canonicalExperimentScaleValue')
    expect(source).toContain('@click="setScaleLane(lane.value)"')
    expect(source).toContain('!props.fixedExperimentScale')
  })
})
