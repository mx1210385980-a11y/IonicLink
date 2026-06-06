import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'BatchDataPreview.vue'), 'utf-8')

describe('BatchDataPreview database-style preview table', () => {
  it('uses the same visual cells as the Database record table', () => {
    expect(source).toContain('LubricantRecipeCell')
    expect(source).toContain('TribopairCapsule')
    expect(source).toContain('ConditionMicrobar')
    expect(source).toContain('cofDisplay(previewRecordResponse(item, index))')
    expect(source).toContain('compactRecordDisplayId(previewRecordResponse(item, index))')
    expect(source).toContain('COL_IONIC')
    expect(source).toContain('column-ruler-label')
  })

  it('removes the separate grouped preview mode and old extraction cards', () => {
    expect(source).not.toContain('previewViewMode')
    expect(source).not.toContain('groupTribologyRecordsByIonicLiquid')
    expect(source).not.toContain('By ionic liquid')
    expect(source).not.toContain('grouped-liquid-card')
    expect(source).not.toContain('system.controlStrips')
    expect(source).not.toContain('row.record.cof')
  })

  it('keeps extraction review actions in the unified row layout', () => {
    expect(source).toContain('@click.stop="verifyRecord(item.id!)"')
    expect(source).toContain("updateRecordField(item.id!, 'cof'")
    expect(source).toContain('expandedRows.has(item.id!)')
    expect(source).not.toContain('Conf:')
  })

  it('gives NoData previews an immediate re-extract path', () => {
    expect(source).toContain("['success', 'error', 'no_data'].includes(selectedFile.status)")
    expect(source).toContain('No extractable records were found for this mode.')
    expect(source).toContain('@click="handleReprocess()"')
  })

  it('keeps camelCase extraction preview probe fields out of the substrate fallback', () => {
    expect(source).toContain("previewField(record, 'probe_material', 'probeMaterial')")
    expect(source).toContain("previewField(record, 'substrate_material', 'substrateMaterial')")
    expect(source).toContain("previewField(record, 'material_name', 'materialName')")
  })
})
