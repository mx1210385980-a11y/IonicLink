import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'DatabaseToolModal.vue'), 'utf-8')

describe('DatabaseToolModal scope', () => {
  it('uses the admin-visible scope so admin sees library records and workspace candidates together', () => {
    expect(source).toContain("const databaseRecordScope = computed<'active' | 'all_visible'")
    expect(source).toContain(':record-scope="databaseRecordScope"')
    expect(source).not.toContain('record-scope="group_library"')
    expect(source).toContain("searchRecords({ entityType: 'record' }, 0, 1, { scope: databaseRecordScope.value })")
    expect(source).toContain("searchRecords({ entityType: 'candidate' }, 0, 1, { scope: databaseRecordScope.value })")
    expect(source).toContain("listDiffusionLibrary('', 0, 1, { scope: databaseRecordScope.value, entityType: 'record' })")
    expect(source).toContain("listDiffusionLibrary('', 0, 1, { scope: databaseRecordScope.value, entityType: 'candidate' })")
    expect(source).not.toContain("searchRecords({}, 0, 1, { scope: 'group_library' })")
  })
})
