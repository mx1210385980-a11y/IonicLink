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
    expect(source).toContain('flex min-h-0 flex-1 flex-col overflow-hidden px-6 py-4')
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

  it('labels the COF dataset as Lubrication for users while keeping the internal tribology key', () => {
    expect(databaseModalSource).toContain("{ key: 'tribology' as const, label: 'Lubrication'")
    expect(databaseModalSource).not.toContain("label: 'Tribology'")
    expect(source).toContain('aria-label="Lubrication library lane"')
    expect(source).not.toContain('aria-label="Tribology library lane"')
  })

  it('updates and clears Database focus while the modal is already open', () => {
    expect(databaseModalSource).toContain('@clear-focused-record="emit(\'clearFocusedRecord\')"')
    expect(databaseModalSource).toContain('clearFocusedRecord')
    expect(databaseModalSource).toContain("watch(() => [props.show, props.focusDataset, props.entityTypeFilter, props.focusEntityType]")
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

  it('separates official Database records from the review queue', () => {
    expect(databaseModalSource).toContain("entityTypeFilter?: 'record' | 'candidate' | null")
    expect(databaseModalSource).toContain("searchRecords({ entityType: 'record' }, 0, 1")
    expect(databaseModalSource).toContain("searchRecords({ entityType: 'candidate' }, 0, 1")
    expect(databaseModalSource).toContain("type EntityTypeFilter = 'record' | 'candidate'")
    expect(databaseModalSource).toContain("const activeEntityTypeFilter = ref<EntityTypeFilter>('record')")
    expect(databaseModalSource).toContain("function selectEntityTypeFilter(entityType: 'record' | 'candidate')")
    expect(databaseModalSource).toContain("mode in entityTypeModes")
    expect(databaseModalSource).toContain("Official Database")
    expect(databaseModalSource).toContain("Review Queue")
    expect(databaseModalSource).toContain(':entity-type-filter="activeEntityTypeFilter"')
    expect(source).toContain("entityTypeFilter?: 'record' | 'candidate' | null")
    expect(source).toContain('const activeLibraryEntityType = computed')
    expect(source).toContain("entityTypeFilter: toRef(props, 'entityTypeFilter')")
    expect(recordSearchSource).toContain("entityTypeFilter?: Ref<'record' | 'candidate' | string | null | undefined>")
    expect(recordSearchSource).toContain("entityType: normalizeEntityTypeFilter(options.entityTypeFilter?.value)")
    expect(source).toContain("{{ activeLibraryEntityType === 'candidate' ? 'Review Queue' : 'Official Database' }}")
  })

  it('opens a candidate review sheet from the Review Queue and refreshes after approval', () => {
    expect(source).toContain("import CandidateReviewSheet from '@/components/integrated-explorer/CandidateReviewSheet.vue'")
    expect(source).toContain('const reviewSheetRecord = ref<RecordResponse | null>(null)')
    expect(source).toContain('const reviewSheetNextRecord = computed')
    expect(source).toContain('function openCandidateReviewSheet(record: RecordResponse)')
    expect(source).toContain('function openNextCandidateReviewSheet()')
    expect(source).toContain("if (databaseRecordEntityType(record) !== 'candidate') return")
    expect(source).toContain('reviewSheetRecord.value = record')
    expect(source).toContain('reviewSheetRecord.value = reviewSheetNextRecord.value')
    expect(source).toContain('async function handleCandidateReviewApproved()')
    expect(source).toContain('async function handleCandidateReviewRejected()')
    expect(source).toContain('function advancePastReviewedCandidate(reviewedRecord: RecordResponse | null)')
    expect(source).toContain('const nextRecord = reviewSheetNextRecord.value')
    expect(source).toContain('reviewSheetRecord.value = nextRecord ?? null')
    expect(source).toContain('optimisticallyRemoveApprovedCandidate(reviewedRecord)')
    expect(source).toContain('function optimisticallyRemoveApprovedCandidate(record: RecordResponse)')
    expect(source).toContain("window.dispatchEvent(new CustomEvent('ioniclink:review-data-changed'")
    expect(source).toContain('void fetchData()')
    expect(source).toContain(':show="Boolean(reviewSheetRecord)"')
    expect(source).toContain(':record="reviewSheetRecord"')
    expect(source).toContain(':next-record="reviewSheetNextRecord"')
    expect(source).toContain(':has-next-candidate="Boolean(reviewSheetNextRecord)"')
    expect(source).toContain('@next-candidate="openNextCandidateReviewSheet"')
    expect(source).toContain('@saved-and-approved="handleCandidateReviewApproved"')
    expect(source).toContain('@rejected="handleCandidateReviewRejected"')
  })

  it('matches numeric visual source labels to library figure preview labels', () => {
    expect(source).toContain("replace(/^(?:fig(?:ure)?|table)/, '')")
    expect(source).toContain('function databaseEvidenceFigureLabelCandidates')
    expect(source).toContain('extractDatabaseEvidenceFigureLabelsFromText')
    expect(source).toContain('databaseEvidenceFigureLabelKey(entry.evidence?.source_label)')
    expect(source).toContain('entry.evidence?.quote')
    expect(source).toContain('entry.evidence?.matched_text')
    expect(source).toContain('databaseEvidenceFigureLabelKey(preview.label)')
  })

  it('triages the review queue by confidence tier and missing field, client-side', () => {
    expect(source).toContain('const isReviewQueue = computed')
    expect(source).toContain("type ConfidenceTierFilter = 'all' | 'weak' | 'strong'")
    expect(source).toContain("type EvidenceQualityFilter = 'all' | CandidateEvidenceQuality")
    expect(source).toContain('const triageTierFilter = ref<ConfidenceTierFilter>')
    expect(source).toContain('const triageEvidenceQuality = ref<EvidenceQualityFilter>')
    expect(source).toContain('const triageMissingField = ref')
    expect(source).toContain('candidateTriageTier(record)')
    expect(source).toContain('candidateEvidenceQuality(record)')
    expect(source).toContain('candidateMissingFields(record)')
    expect(source).toContain('function candidateMatchesTriage(record: RecordResponse)')
    expect(source).toContain('const displayedRecords = computed')
    expect(source).toContain('v-if="isReviewQueue"')
    expect(source).toContain('data-testid="review-queue-triage"')
  })

  it('exposes triage chips as clickable filter entry points and a backlog sort', () => {
    expect(source).toContain('@click="setTriageTier(tier.key)"')
    expect(source).toContain('@click="setTriageEvidenceQuality(option.key)"')
    expect(source).toContain('@click="toggleTriageMissingField(option.key)"')
    expect(source).toContain('triageTierCounts')
    expect(source).toContain('triageEvidenceQualityOptions')
    expect(source).toContain('triageMissingFieldOptions')
    expect(source).toContain('const queueBacklogByLiterature = computed')
    expect(source).toContain('EVIDENCE_QUALITY_SORT_RANK[leftQuality] - EVIDENCE_QUALITY_SORT_RANK[rightQuality]')
    expect(source).toContain('return rightCount - leftCount')
    // queue navigation follows the displayed (filtered + sorted) order
    expect(source).toContain('displayedRecords.value.filter((record) => databaseRecordEntityType(record) === \'candidate\')')
    expect(source).toContain(':records="displayedRecords"')
  })

  it('adds a staleness (older-than-N-days) triage control over extractedAt', () => {
    expect(source).toContain('const STALE_DAY_PRESETS = [7, 30, 90] as const')
    expect(source).toContain('const triageStaleDays = ref(0)')
    expect(source).toContain('const triageStaleOptions = computed')
    expect(source).toContain('candidateAgeDays(record)')
    expect(source).toContain('function setTriageStaleDays(days: number)')
    // staleness participates in the shared client-side triage matcher + reset
    expect(source).toContain('if (triageStaleDays.value > 0)')
    expect(source).toContain('triageStaleDays.value > 0')
    expect(source).toContain('triageStaleDays.value = 0')
    expect(source).toContain('@click="setTriageStaleDays(option.days)"')
  })
})
