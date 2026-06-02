import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'DatabaseToolModal.vue'), 'utf-8')

describe('DatabaseToolModal scope', () => {
  it('uses the active session scope so workspace extraction candidates remain visible', () => {
    expect(source).toContain("const databaseRecordScope = computed<'active' | 'group_library'>(() => 'active')")
    expect(source).toContain(':record-scope="databaseRecordScope"')
    expect(source).not.toContain('record-scope="group_library"')
    expect(source).toContain('searchRecords({}, 0, 1)')
    expect(source).not.toContain("searchRecords({}, 0, 1, { scope: 'group_library' })")
  })
})
