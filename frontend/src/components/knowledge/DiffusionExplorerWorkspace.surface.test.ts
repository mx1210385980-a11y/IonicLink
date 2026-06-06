import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const source = readFileSync(resolve(__dirname, 'DiffusionExplorerWorkspace.vue'), 'utf-8')
const databaseModalSource = readFileSync(resolve(__dirname, '../DatabaseToolModal.vue'), 'utf-8')

describe('DiffusionExplorerWorkspace database surface', () => {
  it('loads the group diffusion library instead of only selected file rows', () => {
    expect(source).toContain('listDiffusionLibrary')
    expect(source).toContain('const libraryRecords = ref<DiffusionLibraryRecord[]>([])')
    expect(source).toContain('await listDiffusionLibrary')
    expect(source).toContain("recordScope?: 'active' | 'all_visible'")
    expect(source).toContain('const diffusionLibraryScope = computed')
    expect(source).toContain("props.recordScope || 'all_visible'")
    expect(source).toContain('scope: diffusionLibraryScope.value')
    expect(source).not.toContain("'group_library'")
    expect(source).not.toContain('props.selectedFile?.records || []')
  })

  it('accepts Database focus props and loads only the focused diffusion literature when present', () => {
    expect(source).toContain('focusFileId?: string | null')
    expect(source).toContain('focusDoi?: string')
    expect(source).toContain('focusRecordId?: number | null')
    expect(source).toContain('focusEntityType?:')
    expect(source).toContain("literatureId: props.focusFileId || undefined")
    expect(source).toContain("recordId: props.focusRecordId ?? undefined")
    expect(source).toContain("entityType: activeLibraryEntityType.value")
    expect(source).toContain("watch(() => [props.focusFileId, props.focusRecordId, props.focusEntityType, props.entityTypeFilter, props.focusDoi]")
    expect(databaseModalSource).toContain(':focus-file-id="focusFileId || null"')
    expect(databaseModalSource).toContain(':focus-doi="focusDoi || \'\'"')
    expect(databaseModalSource).toContain(':focus-record-id="focusRecordId ?? null"')
    expect(databaseModalSource).toContain(':focus-entity-type="focusEntityType || null"')
    expect(databaseModalSource).toContain(':entity-type-filter="activeEntityTypeFilter"')
  })

  it('keeps diffusion official records separate from the review queue', () => {
    expect(source).toContain("entityTypeFilter?: 'record' | 'candidate' | null")
    expect(source).toContain('const activeLibraryEntityType = computed')
    expect(source).toContain("{{ activeLibraryEntityType === 'candidate' ? 'Review Queue' : 'Official Database' }}")
  })

  it('opens an evidence-first review sheet for diffusion candidates before approval', () => {
    expect(source).toContain('approveDiffusionReviewCandidate')
    expect(source).toContain("import DiffusionReviewSheet from '@/components/knowledge/DiffusionReviewSheet.vue'")
    expect(source).toContain('<DiffusionReviewSheet')
    expect(source).toContain('function openDiffusionReviewSheet(record: DiffusionLibraryRecord)')
    expect(source).toContain("recordReviewEntityType(record) === 'candidate'")
    expect(source).toContain('@click.stop="openDiffusionReviewSheet(record)"')
    expect(source).toContain('const reviewSheetNextRecord = computed')
    expect(source).toContain('@approved="handleDiffusionReviewResolved"')
    expect(source).toContain('@rejected="handleDiffusionReviewResolved"')
    expect(source).toContain('await loadLibrary()')
  })

  it('supports bulk approve/reject and a weak-only triage in the candidate queue', () => {
    expect(source).toContain('rejectDiffusionReviewCandidate')
    expect(source).toContain('data-testid="diffusion-triage"')
    expect(source).toContain('const weakOnly = ref(false)')
    expect(source).toContain('const selectedDiffusionCandidateIds = ref<Set<number>>')
    expect(source).toContain("async function runBulkDiffusionReview(action: 'approve' | 'reject')")
    expect(source).toContain("@click=\"runBulkDiffusionReview('approve')\"")
    expect(source).toContain("@click=\"runBulkDiffusionReview('reject')\"")
    expect(source).toContain('function toggleSelectDiffusionCandidate(record: DiffusionLibraryRecord)')
  })

  it('uses the diffusion architecture columns with coefficient as the target metric', () => {
    expect(source).toContain('Ionic Liquid')
    expect(source).toContain('Diffusion System')
    expect(source).toContain('Environment')
    expect(source).toContain('Diffusion Coefficient')
    expect(source).toContain('Dtot')
    expect(source).toContain('D+')
    expect(source).toContain('D-')
  })

  it('shows layer-wise diffusion rows without forcing an empty Dtot card', () => {
    expect(source).toContain('function layerDiffusionRows')
    expect(source).toContain('v-if="record.D_total !== null && record.D_total !== undefined"')
    expect(source).toContain('Layer {{ layer.layer }}')
  })

  it('uses the same ion-pair recipe cell as the tribology database', () => {
    expect(source).toContain('LubricantRecipeCell')
    expect(source).toContain('function diffusionRecipeRecord(record: DiffusionLibraryRecord)')
    expect(source).toContain(':record="diffusionRecipeRecord(record)"')
    expect(source).toContain('@open-structure="openStructurePreview"')
    expect(source).not.toContain('<Atom')
  })

  it('gives the ion-pair recipe column enough room for cation and anion labels', () => {
    expect(source).toContain('min-w-[1320px] table-fixed')
    expect(source).toContain('w-[31%] px-5 py-4">Ionic Liquid')
    expect(source).toContain('min-w-[23rem]')
  })

  it('receives the shared Database filter trigger like tribology', () => {
    expect(databaseModalSource).toContain(':external-filter-request-id="filterRequestId"')
    expect(source).toContain('externalFilterRequestId')
    expect(source).toContain('showFilters.value = true')
  })

  it('opens diffusion literature cards as PDF evidence locators like tribology', () => {
    expect(source).toContain('openLiterature: [payload?: { literatureId?: number | null, recordId?: number | null }]')
    expect(source).toContain('async function openRecordPdf(record: DiffusionLibraryRecord)')
    expect(source).toContain('getDiffusionRecordEvidence')
    expect(source).toContain('getDiffusionCandidateEvidence')
    expect(source).toContain('@click="openRecordPdf(record)"')
    expect(source).toContain('PdfViewerWithHighlight')
    expect(source).toContain('buildHighlightRect')
    expect(databaseModalSource).toContain('@open-literature="(payload) => emit(\'openLiterature\', payload)"')
  })

  it('does not show a fallback source-page warning in the diffusion locator', () => {
    expect(source).not.toContain('Only source page is available for this diffusion record')
  })

  it('inflates thin table-row evidence boxes so PDF highlights are visible', () => {
    expect(source).toContain('const minWidth = 96')
    expect(source).toContain('const minHeight = 32')
    expect(source).toContain('const padX = 6')
    expect(source).toContain('const padY = 8')
    expect(source).toContain('coords: { x: 36, y: 36, w: 220, h: 46 }')
  })

  it('keeps row parameters compact and explains icons in a table legend', () => {
    expect(source).not.toContain('Ruler')
    expect(source).toContain('class="font-black italic">D</span>')
    expect(source).toContain('function formatScale')
    expect(source).toContain('diffusion-legend')
    expect(source).toContain('Confinement scale')
    expect(source).not.toContain('scale ${formatNumber(record.confinement_scale_value)}')
    expect(source).not.toContain('Waves')
  })

  it('does not fall back to stale stored bbox after live diffusion evidence loads', () => {
    expect(source).toContain('const bbox = evidence ? evidenceBbox(evidence) : parseRecordBbox(record)')
  })
})
