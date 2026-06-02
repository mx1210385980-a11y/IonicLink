import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'IntegratedExplorerWorkspace.vue'), 'utf-8')
const databaseModalSource = readFileSync(resolve(__dirname, '../DatabaseToolModal.vue'), 'utf-8')
const recordSearchSource = readFileSync(resolve(__dirname, '../../composables/useRecordSearch.ts'), 'utf-8')

describe('IntegratedExplorerWorkspace filters surface', () => {
	  it('keeps the Database header as the only visible Filters entry', () => {
	    expect(databaseModalSource).toContain('function requestFilters')
	    expect(databaseModalSource).toContain('@click="requestFilters"')
	    expect(databaseModalSource).toContain(':external-filter-request-id="filterRequestId"')
	    expect(databaseModalSource).not.toContain("'conductivity'")
	    expect(databaseModalSource).not.toContain('openReview')
	    expect(source).toContain('externalFilterRequestId')
    expect(source).toContain('showAdvancedFilters.value = true')
    expect(source).toContain('filter-lens-panel')
    expect(source).toContain('filter-deck')
    expect(source).toContain('Search DOI, title, ion, surface...')
    expect(source).toContain('Facet map')
    expect(source).toContain('filter-field-card')
    expect(source).toContain('filter-candidate-stage')
    expect(source).toContain('filter-slice-panel')
    expect(source).toContain('option-river')
    expect(source).not.toContain('filter-trigger')
    expect(source).not.toContain('高级筛选')
    expect(source).not.toContain('高级筛选检索台')
  })

  it('keeps the toolbar in one compact row without the helper sentence', () => {
    expect(source).toContain('flex-[0_1_38rem]')
    expect(source).toContain('filter-scale-strip inline-flex h-10')
    expect(source).toContain('Selected {{ visibleSelectedIds.size }}')
    expect(source).toContain('Delete selected')
    expect(source).not.toContain('Search broadly, then use Filters')
  })

  it('keeps active chips inside the Filters panel instead of duplicating them in the toolbar', () => {
    expect(source).toContain('Active slice')
    expect(source).toContain('manualFilterChips.length')
    expect(source).not.toContain('v-for="chip in manualFilterChips"\\n                :key="chip.id"\\n                type="button"')
  })

  it('uses a single vertical scroller for the database table', () => {
    expect(source).toContain('flex-1 overflow-hidden px-6 py-4')
    expect(source).not.toContain('flex-1 overflow-auto px-6 py-4')
  })

  it('removes scale and shear-rate facets from the Filters deck', () => {
    expect(source).not.toContain("key: 'scale',")
    expect(source).not.toContain("key: 'shearRate',")
    expect(source).not.toContain('options: scaleFilterOptions.value')
    expect(source).not.toContain('options: filterOptions.value.shearRateValues')
    expect(recordSearchSource).not.toContain('selectedShearRateValue')
    expect(recordSearchSource).not.toContain('shear_rate_values')
  })

  it('supports multi-select facets and submits selected values as arrays', () => {
    expect(source).toContain('function toggleSelectedValue(values: string[], value: string): string[]')
    expect(source).toContain('selectedCation.value = toggleSelectedValue(selectedCation.value, value)')
    expect(source).toContain('activeAdvancedSelectedValues.includes(option)')
    expect(source).toContain("{{ field.selected.length ? field.selected.join(', ') : field.description }}")
    expect(recordSearchSource).toContain('const selectedCation = ref<string[]>([])')
    expect(recordSearchSource).toContain('cations: selectedCation.value.length ? selectedCation.value : undefined')
    expect(recordSearchSource).toContain('speed_values: selectedSpeedValue.value.length ? selectedSpeedValue.value : undefined')
  })

  it('sends the main database search box as a broad query instead of an exact DOI filter', () => {
    expect(recordSearchSource).toContain('query: searchDoi.value || undefined')
    expect(recordSearchSource).not.toContain('doi: searchDoi.value || undefined')
  })

  it('provides an explicit button to apply the main Database search', () => {
    expect(source).toContain('aria-label="Apply database search"')
    expect(source).toContain('@click="applyAdvancedFilters"')
    expect(source).toContain('Search records')
  })

  it('keeps the normal Database dataset global but allows extraction result focus', () => {
    expect(databaseModalSource).toContain('globalTribologyExplorerKey')
    expect(databaseModalSource).toContain(':key="globalTribologyExplorerKey"')
    expect(databaseModalSource).toContain(':initial-doi="globalTribologyInitialDoi"')
    expect(databaseModalSource).toContain(':selected-file-id="globalTribologySelectedFileId"')
    expect(databaseModalSource).toContain('focusFileId?: string | null')
    expect(databaseModalSource).toContain('focusDoi?: string')
    expect(databaseModalSource).toContain('focusRecordId?: number | null')
    expect(databaseModalSource).toContain("focusDataset?: 'tribology' | 'diffusion' | null")
    expect(databaseModalSource).toContain("activeDataset.value = props.focusDataset === 'diffusion' ? 'diffusion' : 'tribology'")
    expect(databaseModalSource).toContain('const globalTribologyInitialDoi = computed(() => props.focusDoi || \'\')')
    expect(databaseModalSource).toContain('const globalTribologySelectedFileId = computed(() => props.focusFileId || null)')
    expect(databaseModalSource).toContain(':focus-record-id="focusRecordId ?? null"')
    expect(databaseModalSource).not.toContain(':initial-doi="explorerDoi"')
    expect(databaseModalSource).not.toContain(':selected-file-id="selectedFileId"')
    expect(databaseModalSource).not.toContain('`database-tribology-${selectedFileId || \'scope\'}`')
  })

  it('updates and clears Database focus while the modal is already open', () => {
    expect(databaseModalSource).toContain('@clear-focused-record="emit(\'clearFocusedRecord\')"')
    expect(databaseModalSource).toContain('clearFocusedRecord')
    expect(databaseModalSource).toContain("watch(() => [props.show, props.focusDataset]")
    expect(databaseModalSource).toContain("activeDataset.value = props.focusDataset === 'diffusion' ? 'diffusion' : 'tribology'")
  })

  it('rejects malformed manual numeric ranges instead of truncating them with parseFloat', () => {
    expect(recordSearchSource).toContain('const RANGE_NUMBER_PATTERN')
    expect(recordSearchSource).not.toContain('Number.parseFloat(normalized)')
  })

  it('ignores stale database search responses so older filters cannot overwrite newer ones', () => {
    expect(recordSearchSource).toContain('let latestFetchRequestId = 0')
    expect(recordSearchSource).toContain('const requestId = ++latestFetchRequestId')
    expect(recordSearchSource).toContain('if (requestId !== latestFetchRequestId) return')
    expect(recordSearchSource).toContain('if (requestId === latestFetchRequestId) loading.value = false')
  })

  it('surfaces database search failures with a retry path instead of empty-results silence', () => {
    expect(recordSearchSource).toContain('const error = ref(\'\')')
    expect(recordSearchSource).toContain("error.value = ''")
    expect(recordSearchSource).toContain("error.value = err?.message || 'Database records could not be loaded.'")
    expect(recordSearchSource).toContain('error,')
    expect(source).toContain('error: searchError')
    expect(source).toContain('Database records could not be loaded')
    expect(source).toContain('@click="fetchData"')
    expect(source).toContain('Retry')
  })

  it('drops generic material slides when tribopair role-specific evidence is available', () => {
    expect(source).toContain("entries.filter(({ fieldKey }) => !['material', 'material_name'].includes(fieldKey))")
    expect(source).not.toContain("entries.filter(({ fieldKey, entry }) => databaseEvidenceEntryHasContent(fieldKey, entry) || !['material', 'material_name'].includes(fieldKey))")
  })

  it('keeps focus highlighting separate from the database search filter context', () => {
    expect(recordSearchSource).toContain('const targetRecordId = parseTargetRecordId(options.targetRecordId?.value)')
    expect(recordSearchSource).toContain('void targetRecordId')
    expect(recordSearchSource).not.toContain('return { recordId: targetRecordId, entityType: entityType || undefined }')
    expect(recordSearchSource).toContain('fileId: options.selectedFileId.value || undefined')
    expect(source).toContain('focusHopsRemaining.value = 12')
    expect(source).toContain("emit('clear-focused-record')")
  })
})
