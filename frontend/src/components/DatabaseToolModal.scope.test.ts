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

  it('keeps the Database modal as a compact tool shell with icon-first actions', () => {
    expect(source).toContain('DatabaseIcon')
    expect(source).toContain('Download')
    expect(source).toContain('SlidersHorizontal')
    expect(source).toContain('data-testid="database-tool-shell"')
    expect(source).toContain('h-[88vh] w-[min(96vw,1360px)]')
    expect(source).toContain('rounded-[14px]')
    expect(source).toContain('text-[1rem] font-semibold')
    expect(source).toContain('aria-label="Export database as CSV"')
    expect(source).toContain('aria-label="Open database filters"')
    expect(source).not.toContain('rounded-[1.25rem]')
    expect(source).not.toContain('text-[1.38rem]')
  })
})
