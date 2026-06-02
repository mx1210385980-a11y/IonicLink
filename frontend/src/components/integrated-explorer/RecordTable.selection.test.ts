import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const tableSource = readFileSync(resolve(__dirname, 'RecordTable.vue'), 'utf-8')
const workspaceSource = readFileSync(resolve(__dirname, 'IntegratedExplorerWorkspace.vue'), 'utf-8')

describe('RecordTable selection controls', () => {
  it('renders row and page selection controls inside the table white area', () => {
    expect(tableSource).toContain('selectedIds: Set<number>')
    expect(tableSource).toContain("defineEmits<{")
    expect(tableSource).toContain("'toggle-select': [recordId: number]")
    expect(tableSource).toContain("'toggle-select-page': [select: boolean]")
    expect(tableSource).toContain('aria-label="Select all records on this page"')
    expect(tableSource).toContain('aria-label="Select record"')
  })

  it('keeps bulk deletion in the white table action strip and wires it to selected rows', () => {
    expect(workspaceSource).toContain('handleBatchDelete')
    expect(workspaceSource).toContain('Delete selected')
    expect(workspaceSource).toContain('Selected {{ visibleSelectedIds.size }}')
    expect(workspaceSource).toContain(':selected-ids="selectedIds"')
    expect(workspaceSource).toContain('@toggle-select="toggleSelectOne"')
    expect(workspaceSource).toContain('@toggle-select-page="toggleSelectPage"')
  })

  it('keeps bulk actions scoped to the currently visible database page', () => {
    expect(workspaceSource).toContain('visibleRecordIds')
    expect(workspaceSource).toContain('visibleSelectedIds')
    expect(workspaceSource).toContain('visibleRecordSelectionKey')
    expect(workspaceSource).toContain('Array.from(visibleSelectedIds.value)')
    expect(workspaceSource).toContain('Selected {{ visibleSelectedIds.size }}')
    expect(workspaceSource).toContain(':disabled="visibleSelectedIds.size === 0 || batchActionPending"')
    expect(workspaceSource).toContain('selectedIds.value = visibleSelectedIds.value')
  })

  it('keeps candidate rows out of select-all state in the parent workspace', () => {
    expect(workspaceSource).toContain('selectablePageRecordIds')
    expect(workspaceSource).toContain("filter((record) => databaseRecordEntityType(record) !== 'candidate')")
    expect(workspaceSource).toContain('for (const id of selectablePageRecordIds.value)')
    expect(workspaceSource).not.toContain('for (const r of result.value.items) {\n    const id = Number(r.id)\n    if (select) next.add(id)')
  })
})
