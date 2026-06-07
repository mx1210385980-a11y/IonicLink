import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'IntegratedExplorerWorkspace.vue'), 'utf-8')

describe('IntegratedExplorerWorkspace field evidence popover', () => {
  it('keeps field evidence popovers readable near the bottom of the viewport', () => {
    expect(source).toContain('database-field-evidence-popover fixed inset-0')
    expect(source).toContain('items-center justify-center')
    expect(source).toContain('max-h-[88vh]')
    expect(source).toContain('database-evidence-image-pane')
    expect(source).toContain('database-evidence-content-scroll')
    expect(source).toContain('overflow-y-auto')
    expect(source).not.toContain('window.innerHeight - 300')
    expect(source).not.toContain('const width = 430')
  })

  it('offers direct condition evidence switching without reopening the table row', () => {
    expect(source).toContain('databaseEvidenceConditionSwitchKeys')
    expect(source).toContain('switchDatabaseEvidenceConditionKey')
    expect(source).toContain('database-evidence-condition-switcher')
    expect(source).toContain('databaseEvidenceConditionSwitchActive')
  })

  it('does not let focused field evidence fall back to record-level term hits', () => {
    expect(source).toContain('if (databaseEvidenceFocusedFieldKey.value) return []')
    expect(source).toContain('databaseEvidenceTermHits(record)')
  })

  it('does not let untrusted long context replace the field quote', () => {
    expect(source).toContain('databaseEvidenceTrustedContext')
    expect(source).toContain('const quote = trustedContext || normalizeDatabaseEvidenceText(entry.evidence?.quote)')
    expect(source).not.toContain('const quote = context || normalizeDatabaseEvidenceText(entry.evidence?.quote)')
  })

  it('shows cation alias explanations in ionic-liquid evidence popovers', () => {
    expect(source).toContain('ionicLiquidCationAliasNote')
    expect(source).toContain('databaseEvidenceCationAliasNote')
    expect(source).toContain('activeDatabaseEvidenceSlide(evidenceModalRecord)?.aliasNote')
    expect(source).toContain('Cation note')
  })
})
