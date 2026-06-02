import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const componentPath = resolve(__dirname, 'ConditionMicrobar.vue')
const recordTableSource = readFileSync(resolve(__dirname, 'RecordTable.vue'), 'utf-8')
const virtualRowSource = readFileSync(resolve(__dirname, 'VirtualRecordRow.vue'), 'utf-8')

describe('ConditionMicrobar source', () => {
  it('renders a single condition seal without reintroducing roughness chips', () => {
    expect(existsSync(componentPath)).toBe(true)
    const source = readFileSync(componentPath, 'utf-8')

    expect(source).toContain('conditionSealDisplay')
    expect(source).toContain('condition-seal')
    expect(source).toContain('seal.primary')
    expect(source).toContain('satelliteItems')
    expect(source).toContain('seal.value.meta')
    expect(source).toContain('overflowItems')
    expect(source).toContain('+{{ overflowItems.length }}')
    expect(source).toContain('@click.stop')
    expect(source).toContain('type="button"')
    expect(source).not.toContain('surfaceRoughnessBadge')
    expect(source).not.toContain('ROUGH')
  })

  it('abandons crowded inline badges in favor of a compact symbolic condition ruler with expandable overflow', () => {
    const source = readFileSync(componentPath, 'utf-8')

    expect(source).toContain('satelliteItems')
    expect(source).toContain('passiveItems')
    expect(source).toContain('expanded')
    expect(source).toContain('condition-ruler')
    expect(source).toContain('condition-strip')
    expect(source).toContain('condition-main')
    expect(source).toContain('condition-tick-rail')
    expect(source).toContain('condition-tick')
    expect(source).toContain('condition-readout')
    expect(source).toContain('formatConditionReadout')
    expect(source).toContain('condition-tick--muted')
    expect(source).toContain('max-w-[296px]')
    expect(source).toContain('formatCompactConditionReadout')
    expect(source).toContain('condition-readout--tick')
    expect(source).toContain('min-h-[74px]')
    expect(source).toContain('condition-main-glyph')
    expect(source).toContain('conditionIcon')
    expect(source).toContain('lucide-vue-next')
    expect(source).toContain('SIGNAL')
    expect(source).not.toContain('no signal')
    expect(source).not.toContain('condition-constellation')
    expect(source).not.toContain('condition-sky')
    expect(source).not.toContain('condition-core')
    expect(source).not.toContain('condition-orbit-node')
    expect(source).not.toContain('h-[68px]')
    expect(source).not.toContain('absolute right')
    expect(source).not.toContain('pr-[4.35rem]')
    expect(source).not.toContain('min-w-[222px]')
    expect(source).not.toContain('condition-score')
    expect(source).not.toContain('grid-cols-[minmax')
    expect(source).not.toContain('auto-fit')
    expect(source).not.toContain('truncate')
    expect(source).not.toContain('CORE')
  })

  it('replaces old table condition chips in both row renderers', () => {
    expect(recordTableSource).toContain('ConditionMicrobar')
    expect(virtualRowSource).toContain('ConditionMicrobar')
    expect(recordTableSource).not.toContain('conditionGroups(record)')
    expect(virtualRowSource).not.toContain('conditionGroups(record)')
    expect(recordTableSource).not.toContain('ROUGH')
    expect(virtualRowSource).not.toContain('ROUGH')
  })

  it('gives virtual rows enough vertical space for the larger condition tile', () => {
    expect(recordTableSource).toContain('const ROW_HEIGHT = 160')
  })
})
