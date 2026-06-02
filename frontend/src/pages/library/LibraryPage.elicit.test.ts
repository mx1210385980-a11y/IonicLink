import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'LibraryPage.vue'), 'utf-8')
const apiSource = readFileSync(resolve(__dirname, '../../lib/api.ts'), 'utf-8')
const sourceSlice = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end))

describe('LibraryPage Elicit-style extract workflow', () => {
  it('keeps Extract data embedded in the Library selection panel', () => {
    expect(source).toContain('New from selection')
    expect(source).toContain('Extract data')
    expect(source).toContain('Start systematic review')
    expect(source).toContain('extractMode')
    expect(source).toContain('selectedPaperIds')
  })

  it('opens extraction workflow as a modal over Library', () => {
    expect(source).toContain('role="dialog"')
    expect(source).toContain('aria-modal="true"')
    expect(source).toContain('aria-labelledby="extract-data-modal-title"')
    expect(source).toContain('Extraction setup')
    expect(source).toContain('Run extraction')
    expect(source).toContain('Add custom column')
    expect(source).toContain('Save extraction table')
    expect(source).not.toContain('<main v-else')
  })

  it('opens Extract data directly into the column extraction table', () => {
    expect(source).toContain('function openExtractData()')
    expect(source).toContain('extractMode.value = true')
    expect(source).not.toContain('function openExtractData() {\n  openUploadModal()')
    expect(source).toContain('presetExtractionColumns')
    expect(source).toContain("'Tribology'")
    expect(source).toContain("'Diffusion'")
    expect(source).toContain("'Conductivity'")
    expect(source).toContain('extractionTableColumns')
    expect(source).toContain('addExtractionColumn')
    expect(source).toContain('saveExtractionTable')
    expect(source).toContain("'open-database'")
    expect(source).toContain('libraryExtractionDatabaseTarget')
    expect(source).toContain("dataset: extractionDisplayTemplate.value === 'diffusion' ? 'diffusion' : 'tribology'")
  })

  it('uses Lubrication as the default extraction template with only COF preset', () => {
    expect(source).toContain("const selectedTemplate = ref<ExtractTemplateKey>('lubrication')")
    expect(source).toContain("columns: ['COF']")
    expect(source).not.toContain("columns: ['COF', 'COF type'")
    expect(source).toContain("key: 'diffusion'")
    expect(source).toContain("columns: ['Diffusion coefficient', 'System', 'Temperature', 'Method', 'Medium', 'Evidence']")
    expect(source).toContain("key: 'conductivity'")
    expect(source).toContain("columns: ['Ionic conductivity', 'Material', 'Temperature', 'Method', 'Transference number', 'Evidence']")
  })

  it('starts extraction through the background queue and polls run progress', () => {
    expect(source).toContain('extractData(')
    expect(source).toContain("extractData(String(paper.id), true")
    expect(source).toContain('for (const paper of papersToExtract)')
    expect(source).toContain("const UPLOAD_EXTRACTION_PROFILE: ExtractionProfile = 'auto'")
    expect(source).toContain('uploadModalStep.value = \'extracting\'')
    expect(source).toContain('getLatestExtractionRun')
    expect(source).toContain('extractionProgress')
    expect(source).toContain('Extraction progress')
    expect(source).toContain('startExtractionPoll')
    expect(source).not.toContain('reprocessLiterature')
  })

  it('uses the selected template as the extraction lane instead of preset display columns', () => {
    expect(source).toContain("import {")
    expect(source).toContain("extractorTypesForTemplate")
    expect(source).toContain("extractorTypesForTemplate(selectedTemplate.value)")
    expect(source).not.toContain("if (labels.has('Tribology')) extractors.push('tribology')")
    expect(source).not.toContain("if (labels.has('Diffusion')) extractors.push('diffusion')")
    expect(source).toContain("Conductivity extraction is not connected yet")
  })

  it('makes unsupported Conductivity extraction visibly unavailable before users click run', () => {
    expect(source).toContain('availabilityNote')
    expect(source).toContain('extractionTemplateBlocker')
    expect(source).toContain("selectedTemplate.value === 'conductivity'")
    expect(source).toContain('Coming soon')
    expect(source).toContain('{{ extractionTemplateBlocker }}')
    expect(source).toContain(':disabled="runningExtraction || cancellingExtraction || selectedPaperIds.length === 0 || Boolean(extractionTemplateBlocker)"')
  })

  it('blocks Save extraction table until real extracted records exist', () => {
    expect(source).toContain('extractionSaveStatus')
    expect(source).toContain('const extractionSave = computed(() => extractionSaveStatus')
    expect(source).toContain('if (!extractionSave.value.canSave)')
    expect(source).toContain(':disabled="!extractionSave.canSave"')
    expect(source).toContain('{{ extractionSave.message }}')
  })

  it('releases the Run extraction button after repeated status polling failures', () => {
    expect(source).toContain('pollFailureCounts')
    expect(source).toContain('MAX_EXTRACTION_POLL_FAILURES')
    expect(source).toContain('nextPollFailureState')
    expect(source).toContain('markExtractionFailed(item.paperId, failure.message)')
    expect(source).toContain('resetPollFailures(item.paperId)')
  })

  it('lets users cancel a mistaken extraction instead of waiting for the worker to finish', () => {
    expect(source).toContain('cancelExtraction')
    expect(source).toContain('cancellingExtraction')
    expect(source).toContain('cancelLibraryExtraction')
    expect(source).toContain('clearExtractionPollTimer()')
    expect(source).toContain("status: 'cancelled'")
    expect(source).toContain('Cancel extraction')
    expect(source).toContain('cancelUploadedPaperExtraction')
    expect(source).toContain('uploadCancelRequested')
    expect(source).toContain("if (uploadCancelRequested.value) break")
    expect(source).toContain("runStatus === 'cancelled'")
  })

  it('moves upload immediately to the paper selection screen and streams parsed papers in', () => {
    expect(source).toContain('uploadPendingFileNames')
    expect(source).toContain("uploadModalStep.value = 'select'")
    expect(source).not.toContain('v-for="fileName in uploadPendingFileNames"')
    expect(source).toContain('Parsing metadata in the background')
  })

  it('does not let the upload continue arrow discard queued PDFs', () => {
    expect(source).toContain('uploadHasQueuedFiles')
    expect(source).toContain('if (uploadHasQueuedFiles.value)')
    expect(source).toContain('Upload queued PDFs before continuing, or remove them.')
    expect(source).toContain(':disabled="uploadUploading || uploadHasQueuedFiles"')
  })

  it('shows a clear uploaded-paper parsing progress bar for multi-file uploads', () => {
    expect(source).toContain('uploadBatchTotal')
    expect(source).toContain('uploadBatchFinished')
    expect(source).toContain('uploadBatchProgressPercent')
    expect(source).toContain('aria-label="Upload parsing progress"')
    expect(source).toContain('{{ uploadBatchFinished }} / {{ uploadBatchTotal }}')
  })

  it('stores uploaded papers into the Library list as each upload succeeds', () => {
    expect(source).toContain('upsertUploadedPaperInLibrary')
    expect(source).toContain('items.value = [libraryPaper, ...items.value]')
  })

  it('keeps only failed uploads in the retry queue and shows per-file failure reasons', () => {
    expect(source).toContain('summarizeUploadBatch')
    expect(source).toContain('const uploadResults')
    expect(source).toContain('uploadErrorMessage(error)')
    expect(source).toContain('queuedUploadFiles.value = uploadSummary.retryFiles')
    expect(source).toContain('uploadStatusMessage.value = uploadSummary.message')
    expect(source).not.toContain('queuedUploadFiles.value = failCount > 0 ? queuedUploadFiles.value : []')
  })

  it('starts uploaded-paper extraction from a single intelligent mode without text or visual choices', () => {
    expect(source).toContain("'setup'")
    expect(source).toContain('Start extraction')
    expect(source).toContain("const UPLOAD_EXTRACTION_PROFILE: ExtractionProfile = 'auto'")
    expect(source).not.toContain('Fast text')
    expect(source).not.toContain('Visual Pro')
    expect(source).not.toContain("selectedUploadExtractionProfile.value === 'standard'")
    expect(source).not.toContain("selectedUploadExtractionProfile.value === 'high_accuracy'")
    expect(source).not.toContain('!canUseVisualExtraction')
  })

  it('opens newly uploaded extraction results directly in Database after completion', () => {
    const uploadExtractionSource = sourceSlice('async function startUploadedPaperExtraction()', 'async function cancelUploadedPaperExtraction()')

    expect(source).toContain('function uploadExtractionDatabaseTarget')
    expect(uploadExtractionSource).toContain("emit('open-database', uploadExtractionDatabaseTarget(completedUploadItems))")
    expect(uploadExtractionSource).toContain('uploadModalOpen.value = false')
  })

  it('lets each uploaded paper choose the correct extraction preset before starting', () => {
    expect(source).toContain("type UploadExtractionPreset = 'tribology' | 'diffusion' | 'conductivity'")
    expect(source).toContain('uploadedPaperExtractionPresets')
    expect(source).toContain('inferUploadExtractionPreset')
    expect(source).toContain('presetForUploadedPaper(paper)')
    expect(source).toContain('uploadExtractionSetupBlocker')
    expect(source).toContain(':disabled="!extractorForUploadPreset(option.value)"')
    expect(source).toContain('if (uploadExtractionSetupBlocker.value)')
    expect(source).toContain('{{ uploadExtractionSetupBlocker }}')
    expect(source).toContain('@change="setUploadedPaperExtractionPreset')
    expect(source).toContain("extractData(String(paper.id), true, UPLOAD_EXTRACTION_PROFILE, undefined, extractorType)")
    expect(source).not.toContain("extractData(String(paper.id), true, extractionProfile, strictCofMode, 'tribology')")
  })

  it('waits for the background extraction run before declaring no data', () => {
    expect(source).toContain('waitForUploadExtractionRun')
    expect(source).toContain("['queued', 'running', 'processing', 'extracting'].includes")
    expect(source).toContain('getLatestExtractionRun(Number(paperId), extractorType)')
    expect(source).toContain('run.final_count')
    expect(source).toContain('current_message')
    expect(source).not.toContain("const status: UploadExtractionStatus = records > 0 ? 'completed' : 'no_data'")
  })

  it('marks immediate completed zero-record uploaded extraction responses as no data', () => {
    expect(source).toContain("const initialHasNoReviewableData = initialRecords === 0 && (initialStatus === 'no_data' || initialStatus === 'completed')")
    expect(source).toContain("status: initialHasNoReviewableData ? 'no_data' : 'completed'")
    expect(source).toContain('Math.max(weakCandidateCount, candidateCount)')
    expect(source).toContain("status: records > 0 ? 'completed' : 'no_data'")
    expect(source).not.toContain("status: initialRecords > 0 || initialStatus === 'completed' ? 'completed' : 'no_data'")
  })

  it('does not fail uploaded-paper extraction on one transient status polling error', () => {
    expect(source).toContain('let uploadPollFailureCount = 0')
    expect(source).toContain('let run: ExtractionRunDetail')
    expect(source).toContain('try {')
    expect(source).toContain('run = await getLatestExtractionRun(Number(paperId), extractorType)')
    expect(source).toContain('uploadPollFailureCount = 0')
    expect(source).toContain('uploadPollFailureCount += 1')
    expect(source).toContain('Temporary status check failed, retrying')
    expect(source).toContain('if (uploadPollFailureCount >= MAX_EXTRACTION_POLL_FAILURES)')
    expect(source).toContain('continue')
  })

  it('releases cancel UI locally if backend cancellation does not answer', () => {
    expect(source).toContain('const LIBRARY_CANCEL_TIMEOUT_MS = 8000')
    expect(source).toContain('cancelExtractionWithLocalTimeout')
    expect(source).toContain('Promise.race([')
    expect(source).toContain("status: 'timeout'")
    expect(source).toContain('uploadCancelling.value = false')
    expect(source).toContain('cancellingExtraction.value = false')
    expect(source).toContain('finally {')
  })

  it('does not label completed candidate-only extraction runs as no data', () => {
    expect(source).toContain("totalFinal > 0 || totalCandidates > 0 ? 'completed' : 'no_data'")
    expect(source).toContain('candidateCount: totalCandidates')
    expect(source).toContain('finalCount: totalFinal')
  })

  it('allows saving extraction tables that contain reviewable candidates but no final records yet', () => {
    expect(source).toContain('candidateCount: totalCandidates')
    expect(source).toContain('progressItems: progressItems.value')
    expect(source).toContain('selectedPapers: selectedPapers.value')
  })

  it('shows no-data uploaded extractions as a warning state instead of a completed checkmark', () => {
    expect(source).toContain("item.status === 'no_data' ? 'bg-amber-50 text-amber-700'")
    expect(source).toContain('<HelpCircle v-else-if="item.status === \'no_data\'" class="h-5 w-5" />')
    expect(source).not.toContain("item.status === 'completed' || item.status === 'no_data'")
  })

  it('keeps polling when the backend replaces a stalled extraction run', () => {
    expect(source).toContain('isRetryableExtractionRun')
    expect(source).toContain('Previous extraction run stalled')
    expect(source).toContain('Fresh extraction run is being queued')
    expect(source).toContain('failedRun = runs.find((run) =>')
  })

  it('releases selected-library extraction polling when successful status checks stay active too long', () => {
    expect(source).toContain('const MAX_ACTIVE_EXTRACTION_POLLS = 120')
    expect(source).toContain('activePollCounts')
    expect(source).toContain('nextActivePollState')
    expect(source).toContain('Background worker did not finish in time')
    expect(source).toContain('Some extraction runs stalled and were released')
  })

  it('pins extraction polling to the run selection so closing the modal cannot orphan active workers', () => {
    expect(source).toContain('extractionActivePaperIds')
    expect(source).toContain('extractionActivePaperIds.value = [...selectedPaperIds.value]')
    expect(source).toContain('const progressScopeIds = computed(() => extractionActivePaperIds.value.length ? extractionActivePaperIds.value : selectedPaperIds.value)')
    expect(source).toContain('progressScopeIds.value.map((id) => extractionProgress.value[id])')
    expect(source).toContain('if (runningExtraction.value || cancellingExtraction.value) return')
    expect(source).toContain('const done = progressScopeIds.value.length - remaining')
  })

  it('freezes the selected extraction template while a run is active', () => {
    expect(source).toContain('const activeExtractionTemplate = ref<ExtractTemplateKey | null>(null)')
    expect(source).toContain('const extractionDisplayTemplate = computed(() => activeExtractionTemplate.value || selectedTemplate.value)')
    expect(source).toContain('activeExtractionTemplate.value = selectedTemplate.value')
    expect(source).toContain('activeExtractionTemplate.value = null')
    expect(source).toContain("dataset: extractionDisplayTemplate.value === 'diffusion' ? 'diffusion' : 'tribology'")
    expect(source).toContain(':disabled="runningExtraction || cancellingExtraction"')
    expect(source).toContain('setExtractionTemplate(template.key)')
  })

  it('does not clear active extraction tracking on scope changes while workers are running', () => {
    expect(source).toContain("if (runningExtraction.value || cancellingExtraction.value) {")
    expect(source).toContain("statusMessage.value = 'Extraction is still running. Cancel it or wait for it to finish before switching library scope.'")
    expect(source).toContain('return')
    expect(source).toContain('extractionActivePaperIds.value = []')
  })

  it('counts summary and weak candidates as reviewable extracted data', () => {
    expect(source).toContain('runReviewableCounts')
    expect(source).toContain('const counts = runReviewableCounts(run)')
    expect(source).toContain('sum + counts.finalCount')
    expect(source).toContain('sum + counts.candidateCount')
    expect(source).toContain('Number(paper.diffusionCandidateCount || paper.candidateCount || 0)')
  })

  it('routes extraction evidence cells into the unified Database workspace', () => {
    expect(source).toContain('function libraryExtractionEvidenceDatabaseTarget')
    expect(source).toContain("emit('open-database', libraryExtractionEvidenceDatabaseTarget(row))")
    expect(source).toContain("dataset: extractionDisplayTemplate.value === 'diffusion' ? 'diffusion' : 'tribology'")
    expect(source).not.toContain("emit('open-review', { literatureId: row.id })")
    expect(source).not.toContain("emit('select-source', String(row.id))")
  })

  it('does not make Needs extraction evidence cells clickable', () => {
    expect(source).toContain('evidenceAvailable: hasExtractedEvidence(paper)')
    expect(source).toContain('v-if="column.label === \'Evidence\' && row.evidenceAvailable"')
    expect(source).toContain('<span v-else>{{ row.cells[column.label] }}</span>')
  })

  it('uses Elicit-like collection labels instead of old review buckets', () => {
    expect(source).toContain('Recently deleted')
    expect(source).toContain('Lubrication')
    expect(source).toContain('Diffusion')
    expect(source).toContain('Conductivity')
    expect(source).not.toContain('Awaiting Review')
    expect(source).not.toContain('Approved')
  })

  it('shows multi-extractor literature in every matching collection', () => {
    expect(source).toContain('function matchesCollection(item: Literature, collection: CollectionKey)')
    expect(source).toContain("items.value.filter((item) => matchesCollection(item, 'lubrication')).length")
    expect(source).toContain("items.value.filter((item) => matchesCollection(item, 'diffusion')).length")
    expect(source).toContain("items.value.filter((item) => matchesCollection(item, 'conductivity')).length")
    expect(source).toContain('!matchesCollection(item, selectedCollection.value)')
    expect(source).not.toContain("collectionFor(item) === 'diffusion'")
    expect(source).not.toContain('collectionFor(item) !== selectedCollection.value')
  })

  it('keeps the author column compact', () => {
    expect(source).toContain('function primaryAuthors')
    expect(source).toContain('tokens.slice(0, 3)')
    expect(source).toContain('primaryAuthors(item.authors)')
    expect(source).toContain('(?:[A-Z]\\.\\s*){1,3}')
  })

  it('keeps Library as a sidebar-led paper shelf instead of the Database filter deck', () => {
    expect(source).toContain('Collections')
    expect(source).toContain('grid-cols-[270px_minmax(680px,1fr)_462px]')
    expect(source).toContain('placeholder="Search papers"')
    expect(source).toContain('@click="selectedCollection = collection.key"')
    expect(source).toContain("libraryViewMode === 'detail'")
    expect(source).not.toContain('library-filter-trigger')
    expect(source).not.toContain('library-filter-panel')
    expect(source).not.toContain('activeLibraryFilterCount')
    expect(source).not.toContain('setLibraryCollection')
  })

  it('opens a literature detail when Database passes a selected literature id', () => {
    expect(source).toContain('function selectedLiteratureIdFromRoute()')
    expect(source).toContain('async function openSelectedPaperFromRoute()')
    expect(source).toContain('await openSelectedPaperFromRoute()')
    expect(source).toContain("watch(() => props.selectedFileId")
  })

  it('embeds admin crop correction into the figures list without a separate review page', () => {
    expect(source).toContain('canAdjustCrops')
    expect(source).toContain('openCropEditor(figure)')
    expect(source).toContain('aria-label="Adjust crop"')
    expect(source).toContain('cropEditorFigure')
    expect(source).toContain('Crop data sample')
    expect(source).toContain('saveFigureCropOverride')
    expect(source).toContain('resetFigureCropOverride')
    expect(source).not.toContain('Crop Review')
    expect(apiSource).toContain('FigureCropOverridePayload')
    expect(apiSource).toContain('/figure-overrides')
    expect(apiSource).toContain('getPdfPageImage')
  })

  it('lets the PDF reader span the paper detail width so the search rail sits at the far right', () => {
    expect(source).toContain('data-testid="paper-detail-pdf-pane"')
    expect(source).toContain('class="h-full min-h-[calc(100vh-18.5rem)] w-full"')
    expect(source).not.toContain('class="mx-auto h-full min-h-[calc(100vh-18.5rem)] max-w-5xl"')
  })
})
