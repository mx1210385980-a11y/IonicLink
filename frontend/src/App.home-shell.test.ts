import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'App.vue'), 'utf8')
const sourceSlice = (start: string, end: string) => source.slice(source.indexOf(start), source.indexOf(end))
const sourceSliceAfter = (start: string, end: string) => {
  const startIndex = source.indexOf(start)
  expect(startIndex).toBeGreaterThanOrEqual(0)
  const endIndex = source.indexOf(end, startIndex)
  expect(endIndex).toBeGreaterThan(startIndex)
  return source.slice(startIndex, endIndex)
}

describe('App home shell', () => {
  it('uses one compact no-login shell for extraction and review', () => {
    expect(source).not.toContain('LoginScreen')
    expect(source).not.toContain('v-else-if="!sessionState.user"')
    expect(source).not.toContain('handleLogin')
    expect(source).toContain("const elicitShellViews = ['home', 'library']")
    expect(source).toContain("const chromeHiddenViews = ['home', 'library']")
    expect(source).toContain('elicitShellViews.includes(currentView)')
    expect(source).toContain('/ioniclink.png')
    expect(source).toContain("{ label: 'Home', icon: Clock3, view: 'home', section: 'today' }")
    expect(source).toContain("{ label: 'Extract', icon: Upload, modal: 'upload' }")
    expect(source).toContain("{ label: 'Database', icon: Database, modal: 'database' }")
    expect(source).toContain('Library')
    expect(source).not.toContain("{ label: 'Monitor', icon: Activity, view: 'admin', section: 'runtime' }")
    expect(source.indexOf("{ label: 'Extract', icon: Upload, modal: 'upload' }")).toBeLessThan(source.indexOf("{ label: 'Library', icon: BookOpen"))
    expect(source.indexOf("{ label: 'Database', icon: Database, modal: 'database' }")).toBeLessThan(source.indexOf("{ label: 'Library', icon: BookOpen"))
    expect(source).toContain('openElicitTopNavItem')
    expect(source).toContain('v-else-if="currentView === \'library\'"')
    expect(source).not.toContain('elicitWorkflowItems')
    expect(source).not.toContain('elicitToolItems')
    expect(source).not.toContain('isElicitItemLocked')
    expect(source).not.toContain("{ label: 'Research agent', icon: LayoutGrid, active: false, locked: false }")
    expect(source).not.toContain("{ label: 'Extract data', icon: Upload, modal: 'upload', locked: false }")
    expect(source).not.toContain("{ label: 'Alerts', icon: Bell, view: 'review', section: 'inbox' }")
  })

  it('does not expose a Help page or Help navigation target', () => {
    expect(source).not.toContain("import('@/pages/help/HelpPage.vue')")
    expect(source).not.toContain('<HelpPage')
    expect(source).not.toContain("navigateTo('help'")
    expect(source).not.toContain('aria-label="Help"')
  })

  it('removes account chrome so extraction is the front door', () => {
    expect(source).not.toContain('accountMenuOpen')
    expect(source).not.toContain('Account settings')
    expect(source).not.toContain('Log out')
    expect(source).not.toContain('aria-label="Account menu"')
    expect(source).not.toContain('logoutFromAccountMenu')
    expect(source).not.toContain('openAccountSettings')
  })

  it('opens the database tool as a table modal from the top navigation', () => {
    expect(source).toContain('DatabaseToolModal')
    expect(source).toContain("modal: 'database'")
    expect(source).toContain('openElicitTopNavItem')
    expect(source).toContain('databaseToolOpen')
    expect(source).toContain('databaseToolFocus')
    expect(source).toContain('databaseToolFocus.value = null')
    expect(source).toContain('function openLibraryExtractionDatabase')
    expect(source).toContain('@open-database="openLibraryExtractionDatabase"')
    expect(source).toContain("dataset: payload?.dataset === 'diffusion' ? 'diffusion' : 'tribology'")
    expect(source).toContain('key="database-tool-global-v2"')
    expect(source).toContain('openPdfUploadResultsInDatabase')
    expect(source).toContain('selectedFileId.value = target.id')
    expect(source).toContain('explorerDoi.value = target.doi || \'\'')
    expect(source).toContain('databaseToolFocus.value = {')
    expect(source).toContain('fileId: target.id')
    expect(source).toContain('dataset: pdfUploadDatabaseFocusDataset(target)')
    expect(source).toContain('const focusTarget = pdfUploadDatabaseFocusTarget(target)')
    expect(source).toContain('recordId: focusTarget.recordId')
    expect(source).toContain('entityType: focusTarget.entityType')
    expect(source).toContain(':focus-dataset="databaseToolFocus?.dataset || null"')
    expect(source).toContain(':selected-file-id="selectedFileId"')
    expect(source).toContain(':explorer-doi="explorerDoi"')
    expect(source).toContain(':focus-file-id="databaseToolFocus?.fileId || null"')
    expect(source).toContain(':focus-doi="databaseToolFocus?.doi || \'\'"')
    expect(source).toContain(':focus-record-id="databaseToolFocus?.recordId || null"')
    expect(source).toContain(':focus-entity-type="databaseToolFocus?.entityType || null"')
    expect(source).not.toContain(':selected-file-id="null"')
    expect(source).not.toContain(':explorer-doi="\'\'"')
    expect(source).not.toContain('openElicitTool')
  })

  it('opens completed PDF upload extraction directly in Database instead of the results preview', () => {
    const startExtractionSource = sourceSlice('async function startPdfUploadExtraction()', 'function pdfUploadJournalYearLine')

    expect(source).toContain('async function openCompletedPdfUploadItemsInDatabase')
    expect(startExtractionSource).toContain('await openCompletedPdfUploadItemsInDatabase(completedItems)')
    expect(startExtractionSource).not.toContain("pdfUploadModalStep.value = 'results'")
    expect(source).toContain('pdfUploadModalOpen.value = false')
    expect(source).toContain('databaseToolOpen.value = true')
  })

  it('opens the Extract tool as a fresh upload entry after previous extraction results exist', () => {
    const openModalSource = sourceSlice('function openPdfUploadModal()', 'function resetPdfUploadForFreshUpload()')

    expect(openModalSource).toContain('resetPdfUploadForFreshUpload()')
    expect(openModalSource).not.toContain('openCompletedPdfUploadItemsInDatabase')
    expect(openModalSource).not.toContain("pdfUploadModalStep.value = 'results'")
  })

  it('routes database evidence clicks into the source grounding overlay', () => {
    expect(source).toContain("mode?: 'training-blockers' | 'grounding' | null")
    expect(source).toContain('SourceGroundingView')
    expect(source).toContain('sourceGroundingOpen')
    expect(source).toContain("if (payload?.mode === 'grounding')")
    expect(source).toContain('openSourceGroundingTarget')
    expect(source).not.toContain('ReviewPage')
  })

  it('submits uploaded text extractions in parallel and treats transient status errors as retryable', () => {
    expect(source).toContain('submitPdfUploadExtractionJobs')
    expect(source).toContain('trackPdfUploadExtractionRuns')
    expect(source).toContain('Promise.allSettled(selected.map')
    expect(source).toContain("const PDF_UPLOAD_EXTRACTION_PROFILE: ExtractionProfile = 'auto'")
    expect(source).toContain("updatePdfUploadExtractionItem(paper.id, { status: 'extracting'")
    expect(source).toContain('cancelPdfUploadExtraction')
    expect(source).toContain('cancelExtraction(String(item.id), extractorType)')
    expect(source).toContain('pdfUploadCancelResultSucceeded')
    expect(source).toContain('pdfUploadCancelResultStatus')
    expect(source).toContain('pdfUploadCancelTerminalReleaseStatuses')
    expect(source).toContain("['completed', 'no_data', 'failed', 'error', 'cancelled']")
    expect(source).toContain('cancelFailedCount')
    expect(source).toContain('PDF_UPLOAD_CANCEL_TIMEOUT_MS')
    expect(source).toContain("status: 'timeout'")
    expect(source).toContain('Stop request timed out locally')
    expect(source).toContain('Stop request failed on')
    expect(source).toContain('Stopping took too long')
    expect(source).toContain('pdfUploadExtractionAbortRequested')
    expect(source).toContain("{{ pdfUploadExtractionCancelling ? 'Stopping...' : 'Stop' }}")
    expect(source).toContain('Continue in background')
    expect(source).not.toContain('Stop and upload new PDF')
    expect(source).not.toContain('stopPdfUploadExtractionAndUploadNew')
    expect(source).toContain('resetPdfUploadForFreshUpload')
    expect(source).toContain('pdfUploadExtractionRunToken')
    expect(source).toContain('nextPdfUploadExtractionRunToken')
    expect(source).toContain('isCurrentPdfUploadExtractionRun')
    expect(source).toContain('if (!isCurrentPdfUploadExtractionRun(runToken)) return')
    expect(source).toContain('await trackPdfUploadExtractionRuns(uncachedSelections, runToken)')
    expect(source).toContain('if (pdfUploadExtracting.value || activePdfUploadExtractionItems().length > 0)')
    expect(source).toContain('pdfUploadRecoverableExtractionItems')
    expect(source).toContain('retryPdfUploadRecoverableExtraction')
    expect(source).toContain('Retry failed')
    expect(source).toContain('changePdfUploadExtractionType')
    expect(source).toContain('Change mode')
    expect(source).toContain('uploadAnotherPdfAfterExtraction')
    expect(source).toContain('Upload another PDF')
    expect(source).toContain('pdfUploadRecoverableSummaryLabel')
    expect(source).toContain('need retry or a new upload')
    expect(source).toContain('markStalledPdfUploadExtractionItems')
    expect(source).toContain('cancelStalledPdfUploadExtractionItems')
    expect(source).toContain('PDF_UPLOAD_STALLED_HEARTBEAT_MS')
    expect(source).toContain('extractionRunActivitySignature')
    expect(source).toContain('await cancelStalledPdfUploadExtractionItems(stalledSelected)')
    expect(source).toContain('Background worker stopped sending progress updates')
    expect(source).toContain('refreshActivePdfUploadServerRuns')
    expect(source).toContain("['no_data', 'failed', 'cancelled'].includes(item.status)")
    expect(source).toContain('Status check delayed, retrying')
    expect(source).toContain('isRetryablePdfUploadRunMessage')
    expect(source).toContain('Previous extraction run stalled')
    expect(source).toContain('Fresh extraction run is being queued')
    expect(source).toContain('pdfUploadRunReviewableCount')
    expect(source).toContain('summary?.diffusion_artifacts?.reviewable_count')
    expect(source).toContain("preset === 'diffusion'")
    expect(source).toContain("if (normalizedStage.startsWith('stage_c.fast_text_start')) return 36")
    expect(source).toContain("if (normalizedStage.startsWith('stage_c.fast_text_done')) return 78")
    expect(source).toContain("if (normalizedStage.startsWith('stage_b.fast_table_prepare')) return 22")
    expect(source).toContain("if (normalizedStage.startsWith('stage_c.fast_table_wait'))")
    expect(source).toContain("if (normalizedStage.startsWith('stage_d.fast_table_clean')) return 86")
    expect(source).toContain("if (normalizedStage.startsWith('stage_b.chunk') && chunkIndex > 0 && chunkTotal > 0)")
    expect(source).toContain('friendlyPdfUploadExtractionMessage')
    expect(source).toContain('Reading the paper text and figure captions.')
    expect(source).not.toContain('sending document to')
    expect(source).toContain('pdfUploadExtractionLatestMessage(active)')
    expect(source).toContain('Latest: ${latestMessage}')
    expect(source).toContain("no_data: 'status.no_data'")
    expect(source).not.toContain("no_data: 'status.completed'")
    expect(source).toContain("const initialHasNoReviewableData = initialRecords === 0 && (initialStatus === 'no_data' || initialStatus === 'completed')")
    expect(source).toContain("status: initialHasNoReviewableData ? 'no_data' : 'completed'")
    expect(source).toContain('Math.max(weakCandidateCount, candidateCount)')
    expect(source).toContain("status: records > 0 ? 'completed' : 'no_data'")
    expect(source).toMatch(/if \(\['no_data', 'completed'\]\.includes\(normalizedStatus\) && !pdfUploadRunHasReviewableData\(run\)\)[\s\S]*summary\?\.no_data_reason/)
    expect(source).toContain('<ReadingReportPanel')
    expect(source).toContain('@click="generatePdfUploadCandidateDraft"')
    expect(source).toContain('@click="startPdfUploadExtraction"')
    expect(source).not.toContain('const result = await waitForPdfUploadExtractionRun')
  })

  it('uses backend progress percent and elapsed timing in the top-nav Extract modal', () => {
    const progressSource = sourceSlice('function pdfUploadRunProgress', 'function pdfUploadInitialResponseProgress')
    const modalSource = sourceSliceAfter(
      'v-else-if="pdfUploadModalStep === \'extracting\'"',
      'v-if="pdfUploadCompletedExtractionItems.length > 0 && !pdfUploadExtracting"',
    )

    expect(progressSource).toContain('typeof summary?.progress_percent === \'number\'')
    expect(progressSource).toContain('return clampPdfUploadProgress(summary.progress_percent)')
    expect(source).toContain('pdfUploadElapsedMs')
    expect(source).toContain('pdfUploadEtaMs')
    expect(modalSource).toContain('formatDuration(pdfUploadElapsedMs)')
    expect(modalSource).toContain('formatDuration(pdfUploadEtaMs)')
  })

  it('keeps PDF upload progress and failed files visible without duplicating successful uploads', () => {
    expect(source).toContain('pdfUploadFileKey(file)')
    expect(source).toContain('pdfUploadUploadProgress')
    expect(source).toContain('pdfUploadUploadErrors')
    expect(source).toContain('pdfUploadHasQueuedFiles')
    expect(source).toContain('if (pdfUploadHasQueuedFiles.value)')
    expect(source).toContain('Upload queued PDFs before continuing, or remove them.')
    expect(source).toContain(':disabled="pdfUploadUploading || !pdfUploadCanContinueFromUpload"')
    expect(source).toContain("uploadFile(file, 'tribology',")
    expect(source).toContain('updatePdfUploadUploadProgress(file, progress)')
    expect(source).toContain('pdfUploadUploadErrorMessage(error)')
    expect(source).toContain('failedFileKeys.add(fileKey)')
    expect(source).toContain('queuedPdfUploadFiles.value = queuedPdfUploadFiles.value.filter((file) => failedFileKeys.has(pdfUploadFileKey(file)))')
    expect(source).toContain('Failed:')
    expect(source).toContain('Upload progress')
  })

  it('keeps the upload modal open when continuing without uploaded PDFs', () => {
    expect(source).toContain('pdfUploadCanContinueFromUpload')
    expect(source).toContain("if (!pdfUploadCanContinueFromUpload.value)")
    expect(source).toContain("pdfUploadStatusMessage.value = 'Add PDFs before continuing.'")
    expect(source).toContain(':disabled="pdfUploadUploading || !pdfUploadCanContinueFromUpload"')
  })

  it('loads cached uploaded literature and forces a fresh extraction for uncached papers', () => {
    expect(source).toContain('type UploadedPdfPaper')
    expect(source).toContain('cachedRecordCount')
    expect(source).toContain('cachedExtractorType')
    expect(source).toContain('cachedExtractor === selectedExtractor')
    expect(source).toContain('isCachedPdfUploadPaper')
    expect(source).toContain('const cachedSelections = selected.filter(isCachedPdfUploadPaper)')
    expect(source).toContain('const uncachedSelections = selected.filter((paper) => !isCachedPdfUploadPaper(paper))')
    expect(source).toContain('buildPdfUploadExtractionItems(selected, pdfUploadExtractionItems.value')
    expect(source).toContain('extractData(String(paper.id), true')
    expect(source).not.toContain('extractData(String(paper.id), false')
  })

  it('hydrates diffusion upload results from the literature details endpoint', () => {
    expect(source).toContain("presetForPdfUploadedPaper(paper) === 'diffusion'")
    expect(source).toContain('const details = await getLiteratureDetails(Number(paper.id))')
    expect(source).toContain('details.diffusionData')
    expect(source).toContain('getLatestExtractionRun(Number(paper.id), \'diffusion\')')
    expect(source).toContain('getExtractionRunCandidates(latestRun.run_id')
    expect(source).toContain('normalizeExtractionRunCandidate(item, \'diffusion\')')
    expect(source).toContain('normalizeReviewRecord(row)')
    expect(source).toContain('getData(String(paper.id)) as TribologyData[]')
  })

  it('does not infer unsupported conductivity extraction or send unsupported jobs as NoData', () => {
    expect(source).not.toContain("return 'conductivity'")
    expect(source).toContain('disabled?: boolean')
    expect(source).toContain(":disabled=\"Boolean(option.disabled)\"")
    expect(source).toContain('pdfUploadSelectionHasUnsupportedPreset')
    expect(source).toContain("status: 'failed'")
    expect(source).toContain('Choose Lubrication or Diffusion')
  })

  it('presents PDF extraction as a minimal add mode run review flow', () => {
    const modalSource = sourceSliceAfter(
      'v-if="pdfUploadModalOpen"',
      '<!-- Workspace top bar -->',
    )

    expect(source).toContain("const pdfUploadStepLabels = ['Add papers', 'Read', 'Review']")
    expect(source).toContain('const pdfUploadVisibleExtractionPresetOptions')
    expect(modalSource).toContain('Extract papers')
    // Step indicator renders the labels data-driven from pdfUploadStepLabels (asserted above)
    // with a single shared active-state helper instead of duplicated inline conditions.
    expect(modalSource).toContain('v-for="label in pdfUploadStepLabels"')
    expect(modalSource).toContain('isPdfUploadStepActive(label)')
    // Completion hands off straight to Database from the extracting step (no separate results step).
    expect(modalSource).toContain('Open Database')
    expect(source).not.toContain("pdfUploadModalStep === 'results'")
    expect(modalSource).not.toContain('Explore the scientific literature')
    expect(modalSource).not.toContain('Find papers')
    expect(modalSource).not.toContain('List of concepts')
  })

  it('only exposes supported extraction modes in the public PDF extraction flow', () => {
    const modalSource = sourceSliceAfter(
      'v-if="pdfUploadModalOpen"',
      '<!-- Workspace top bar -->',
    )

    expect(source).toContain('pdfUploadVisibleExtractionPresetOptions = computed')
    expect(source).toContain("option.value !== 'conductivity'")
    expect(modalSource).toContain('pdfUploadVisibleExtractionPresetOptions')
    expect(modalSource).not.toContain('Conductivity')
    expect(modalSource).not.toContain('Coming soon')
    expect(modalSource).not.toContain('Choose Lubrication or Diffusion')
  })

  it('keeps failed and empty extraction outcomes actionable without a table-first results page', () => {
    const extractingSource = sourceSliceAfter(
      'v-else-if="pdfUploadModalStep === \'extracting\'"',
      '<!-- Workspace top bar -->',
    )

    expect(extractingSource).toContain('Open Database')
    expect(extractingSource).toContain('Retry failed')
    expect(extractingSource).toContain('Change mode')
    expect(extractingSource).toContain('Upload another PDF')
    expect(extractingSource).not.toContain('<table')
    expect(extractingSource).not.toContain('Extracted table')
    expect(extractingSource).not.toContain('Review status')
  })

  it('keeps the home shell unframed without the legacy Elicit sidebar', () => {
    expect(source).toContain('<HomePage')
    expect(source).toContain('v-if="currentView === \'home\'"')
    expect(source).not.toContain('<Transition name="elicit-sidebar-slide">')
    expect(source).not.toContain('elicit-sidebar-slide-leave-active')
    expect(source).not.toContain('transform: translateX(-100%);')
    expect(source).not.toContain('elicitWorkflowItems')
    expect(source).not.toContain('elicitToolItems')
    expect(source).not.toContain('No recent home searches yet.')
  })

  it('hands upload results to Database review instead of showing publish controls in the modal', () => {
    const extractingSource = sourceSliceAfter(
      'v-else-if="pdfUploadModalStep === \'extracting\'"',
      '<!-- Workspace top bar -->',
    )

    expect(extractingSource).toContain('Open Database')
    expect(extractingSource).toContain('openPdfUploadResultsInDatabase()')
    expect(extractingSource).not.toContain('Publish ready records')
    expect(extractingSource).not.toContain('Confirm')
    expect(extractingSource).not.toContain('Flag')
    expect(extractingSource).not.toContain('Review status')
    expect(source).not.toContain('publishReadyPdfUploadRecords')
    expect(source).not.toContain('approveReviewRecord')
    expect(source).not.toContain('approveDiffusionReviewRecord')
    expect(source).not.toContain('confirmRecordFieldEvidence')
    expect(source).not.toContain('confirmCandidateFieldEvidence')
    expect(source).not.toContain('flagRecordFieldEvidence')
    expect(source).not.toContain('flagCandidateFieldEvidence')
    expect(source).not.toContain('pdfUploadEvidenceContextualHighlights')
  })

  it('removes the old upload-modal evidence popover from the compact results handoff', () => {
    expect(source).not.toContain('type PdfUploadEvidenceSlide')
    expect(source).not.toContain('openPdfUploadCellEvidence')
    expect(source).not.toContain('getPdfBboxPreview')
    expect(source).not.toContain('hydratePdfUploadEvidencePreviews')
    expect(source).not.toContain('Highlighted PDF evidence')
    expect(source).not.toContain('aria-label="Previous upload evidence"')
    expect(source).not.toContain('aria-label="Next upload evidence"')
  })

  it('uses Database focus to choose the official upload review destination', () => {
    expect(source).toContain('function pdfUploadDatabaseFocusTarget')
    expect(source).toContain('resolveCandidatePublishTarget(row, extractorType)')
    expect(source).toContain("entityType: focusTarget.entityType")
    expect(source).toContain("dataset: pdfUploadDatabaseFocusDataset(target)")
  })

  it('keeps upload results free of publish failure handling copy', () => {
    expect(source).not.toContain('pdfUploadReviewActionErrorMessage(error: unknown)')
    expect(source).not.toContain('Candidate cannot be approved')
    expect(source).not.toContain('database sync failed')
  })

  it('opens Review evidence as the candidate library while Database remains official records', () => {
    expect(source).toContain('function openReviewQueue()')
    expect(source).toContain("entityType: 'candidate'")
    expect(source).toContain("if (action.target === 'review-evidence')")
    expect(source).toContain(":entity-type-filter=\"databaseToolFocus?.entityType === 'candidate' ? 'candidate' : 'record'\"")
  })

  it('does not publish records directly from the upload results modal', () => {
    expect(source).toContain('openPdfUploadResultsInDatabase')
    expect(source).not.toContain('syncPublishedPdfUploadRecordsToDatabase')
    expect(source).not.toContain('Published ${publishedCount} of ${readyRows.length}')
  })
})
