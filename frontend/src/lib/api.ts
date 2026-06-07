import axios from 'axios'

import {
    authFetch,
    clearSession,
    getAuthHeaders,
    getSessionToken,
    type AuthUser,
} from './session'
import type { ManualDiffusionCandidatePayload } from './manualDiffusionEstimate'

export const API_BASE_URL = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '')
export type ExtractorType = 'tribology' | 'diffusion'

function normalizeApiPath(path: string) {
    const normalizedPath = path.startsWith('/') ? path : `/${path}`
    const basePath = (() => {
        try {
            if (!API_BASE_URL) return ''
            if (/^https?:\/\//i.test(API_BASE_URL)) {
                return new URL(API_BASE_URL).pathname.replace(/\/$/, '')
            }
            return API_BASE_URL.replace(/\/$/, '')
        } catch {
            return API_BASE_URL.replace(/\/$/, '')
        }
    })()

    if (basePath === '/api' && normalizedPath.startsWith('/api/')) {
        return normalizedPath.slice(4)
    }

    return normalizedPath
}

export function resolveApiUrl(path: string) {
    if (/^https?:\/\//i.test(path)) return path
    const normalizedPath = normalizeApiPath(path)
    return `${API_BASE_URL}${normalizedPath}`
}

export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
})

api.interceptors.request.use((config) => {
    if (config.url) {
        config.url = normalizeApiPath(config.url)
    }
    const authHeaders = getAuthHeaders()
    if (!config.headers) {
        config.headers = {} as any
    }
    const getHeader = (key: string) => {
        const headers = config.headers as any
        if (typeof headers.get === 'function') return headers.get(key)
        return headers[key] ?? headers[key.toLowerCase()]
    }
    const setHeader = (key: string, value: string) => {
        const headers = config.headers as any
        if (typeof headers.set === 'function') {
            headers.set(key, value)
        } else {
            headers[key] = value
        }
    }
    const deleteHeader = (key: string) => {
        const headers = config.headers as any
        if (typeof headers.delete === 'function') {
            headers.delete(key)
        } else {
            delete headers[key]
            delete headers[key.toLowerCase()]
        }
    }
    const forcedScopeType = getHeader('X-Scope-Type')
    Object.entries(authHeaders).forEach(([key, value]) => {
        if (forcedScopeType && (key === 'X-Scope-Type' || key === 'X-Workspace-Id')) return
        if (getHeader(key) == null) setHeader(key, value)
    })
    if (String(forcedScopeType || '').toLowerCase() === 'group_library') {
        deleteHeader('X-Workspace-Id')
    }
    return config
})

api.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error?.response?.status === 401) {
            clearSession()
        }
        return Promise.reject(error)
    },
)

export interface LoginResponse {
    accessToken: string
    tokenType: string
    user: AuthUser
}

export async function login(username: string, password: string) {
    const response = await api.post('/api/auth/login', { username, password }, {
        timeout: 15000,
    })
    return response.data as LoginResponse
}

export async function startPublicSession() {
    const response = await api.post('/api/auth/public-session', {}, {
        timeout: 15000,
    })
    return response.data as LoginResponse
}

export async function getCurrentUser() {
    const response = await api.get('/api/auth/me', {
        timeout: 8000,
    })
    return response.data as AuthUser
}

// File Upload
export type UploadProgressSnapshot = {
    loaded: number
    total: number | null
    percent: number | null
}

export type UploadFileOptions = {
    signal?: AbortSignal
    timeoutMs?: number
}

export async function uploadFile(
    file: File,
    extractorType: ExtractorType = 'tribology',
    onProgress?: (progress: UploadProgressSnapshot) => void,
    options: UploadFileOptions = {},
) {
    const formData = new FormData()
    formData.append('file', file)

    const query = new URLSearchParams()
    query.set('extractor_type', extractorType)
    const response = await api.post(`/api/upload?${query.toString()}`, formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
        onUploadProgress: (event) => {
            const total = event.total || file.size || null
            const percent = total ? Math.round((event.loaded / total) * 100) : null
            onProgress?.({
                loaded: event.loaded,
                total,
                percent,
            })
        },
        signal: options.signal,
        timeout: options.timeoutMs ?? 120000,
    })
    return response.data
}

// Extract Data
export type ExtractionProfile = 'auto' | 'high_accuracy' | 'standard' | 'review_figure_estimate'

export async function extractData(
    fileId: string,
    force: boolean = false,
    profile: ExtractionProfile = 'auto',
    strictCofMode?: boolean,
    extractorType: ExtractorType = 'tribology',
): Promise<ExtractionResponse> {
    const query = new URLSearchParams()
    if (force) query.set('force', 'true')
    query.set('profile', profile)
    if (strictCofMode !== undefined) query.set('strict_cof_mode', strictCofMode ? 'true' : 'false')
    query.set('extractor_type', extractorType)
    const url = `/api/extract/${fileId}${query.toString() ? `?${query.toString()}` : ''}`
    const response = await api.post(url)
    return response.data
}

export async function cancelExtraction(
    fileId: string,
    extractorType: ExtractorType = 'tribology',
): Promise<ExtractionResponse> {
    const response = await api.post(`/api/extract/${fileId}/cancel?extractor_type=${extractorType}`)
    return response.data
}

// Get Extracted Data
export async function getData(fileId?: string) {
    const url = fileId ? `/api/data/${fileId}` : '/api/data'
    const response = await api.get(url)
    return response.data
}

// Chat
export interface ChatSource {
    index: number
    source_type?: 'record' | 'literature' | string
    literature_id: number
    record_id?: number | null
    title: string
    doi?: string | null
    journal?: string | null
    year?: number | null
    page?: number | null
    summary?: string | null
    snippet?: string | null
}

export interface ChatResponse {
    success: boolean
    response: string
    sources?: ChatSource[]
    retrieval?: {
        query_terms?: string[]
        source_count?: number
    }
}

export async function chat(message: string, context?: string): Promise<ChatResponse> {
    const response = await api.post('/api/chat', { message, context })
    return response.data
}

// Sync data to Database
export async function syncData(fileId: string, records: TribologyData[]) {
    const response = await api.post(`/api/sync/${fileId}`, {
        records: records.map(mapRecordForLegacySync)
    })
    return response.data
}

// PDF Highlight coordinates from backend text search
export interface PdfHighlight {
    id: string
    page: number
    x: number
    y: number
    w: number
    h: number
    matched_text: string | null
}

export async function getPdfHighlights(literatureId: string): Promise<PdfHighlight[]> {
    const response = await api.get(`/api/pdf/${literatureId}/highlights`)
    return response.data
}

export interface PdfPlainTextResponse {
    literature_id: number
    page_count: number
    text: string
}

export interface PdfFigurePreview {
    id: string
    label: string
    page: number
    caption: string
    image_b64: string
    clip_bbox?: number[] | null
    algorithm_bbox?: number[] | null
    page_width?: number | null
    page_height?: number | null
    algorithm_version?: string | null
    has_override?: boolean
    override_id?: number | null
}

export interface PdfFigurePreviewResponse {
    literature_id: number
    items: PdfFigurePreview[]
    can_adjust_crops?: boolean
}

export interface PdfPageImageResponse {
    literature_id: number
    page: number
    page_width: number
    page_height: number
    scale: number
    image_b64: string
}

export interface PdfBboxPreviewResponse {
    literature_id: number
    page: number
    bbox: number[]
    mode: 'region' | 'page'
    context?: 'normal' | 'wide'
    image_b64: string
}

export interface FigureCropOverridePayload {
    label: string
    page: number
    bbox: number[]
    caption?: string | null
    algorithmBbox?: number[] | null
    algorithmVersion?: string | null
}

export interface FigureCropOverrideResponse {
    success: boolean
    override: {
        id: number
        literature_id: number
        label: string
        normalized_label: string
        page: number
        caption?: string | null
        bbox: number[]
        algorithm_bbox?: number[] | null
        algorithm_version?: string | null
        created_by_user_id?: number | null
        updated_by_user_id?: number | null
        created_at?: string | null
        updated_at?: string | null
    }
    image_b64: string
}

export async function getPdfPlainText(literatureId: number): Promise<PdfPlainTextResponse> {
    const response = await api.get(`/api/pdf/${literatureId}/text`)
    return response.data as PdfPlainTextResponse
}

export async function getPdfFigurePreviews(literatureId: number): Promise<PdfFigurePreviewResponse> {
    const response = await api.get(`/api/pdf/${literatureId}/figures`)
    return response.data as PdfFigurePreviewResponse
}

export async function getPdfPageImage(literatureId: number, page: number, scale: number = 1.6): Promise<PdfPageImageResponse> {
    const response = await api.get(`/api/pdf/${literatureId}/page-image`, {
        params: { page, scale },
    })
    return response.data as PdfPageImageResponse
}

export async function getPdfBboxPreview(
    literatureId: number,
    page: number,
    bbox: number[],
    mode: 'region' | 'page' = 'region',
    context: 'normal' | 'wide' = 'normal',
): Promise<PdfBboxPreviewResponse> {
    const response = await api.get(`/api/pdf/${literatureId}/bbox-preview`, {
        params: { page, bbox: bbox.join(','), mode, context },
    })
    return response.data as PdfBboxPreviewResponse
}

export async function saveFigureCropOverride(
    literatureId: number,
    payload: FigureCropOverridePayload,
): Promise<FigureCropOverrideResponse> {
    const response = await api.post(`/api/pdf/${literatureId}/figure-overrides`, payload)
    return response.data as FigureCropOverrideResponse
}

export async function resetFigureCropOverride(literatureId: number, overrideId: number) {
    const response = await api.delete(`/api/pdf/${literatureId}/figure-overrides/${overrideId}`)
    return response.data as { success: boolean }
}

// Evidence result for Source Evidence panel
export interface EvidenceResult {
    record_id: number
    evidence_text: string | null
    text_snippet?: string | null
    source_type?: 'text' | 'visual' | 'unknown'
    highlight_terms?: string[]
    term_hits?: Array<{
        term: string
        page: number
        bbox: number[]
        matched_text?: string | null
        semantic_type?: string | null
        inferred?: boolean
        snippet_text?: string | null
        image_b64?: string | null
    }>
    source: string | null
    page: number | null
    bbox: number[] | null
    image_b64: string | null
    page_preview_b64?: string | null
    has_image: boolean
    has_pdf: boolean
}

export interface FieldEvidenceSource {
    source_type?: string | null
    page?: number | null
    source_label?: string | null
    quote?: string | null
    context?: string | null
    matched_text?: string | null
    matchedText?: string | null
    bbox?: number[] | null
    sample_id?: string | null
}

export interface FieldEvidenceEntry {
    value?: string | null
    confidence?: number | null
    evidence?: FieldEvidenceSource | null
    status?: 'grounded' | 'partial' | 'missing' | string
    grounding_mode?: 'explicit' | 'derived' | 'inferred' | string | null
    grounding_note?: string | null
    review_state?: 'confirmed' | 'flagged' | string | null
    review_note?: string | null
}

export interface RecordFieldEvidenceResponse {
    record_id: number
    literature_id: number
    sample_id?: string | null
    series_id?: string | null
    extractor_type?: ExtractorType | string | null
    review_entity_type?: 'record' | 'candidate' | string | null
    reviewEntityType?: 'record' | 'candidate' | string | null
    promoted_record_id?: number | null
    promotedRecordId?: number | null
    promoted_at?: string | null
    promotedAt?: string | null
    review_status?: string | null
    record_origin?: string | null
    assembly_notes?: string | null
    confidence?: number | null
    confidence_details?: ConfidenceDetails | null
    confidenceDetails?: ConfidenceDetails | null
    diffusion_standard_fields?: DiffusionStandardFields
    diffusionStandardFields?: DiffusionStandardFields
    diffusion_normalization?: DiffusionNormalizationPayload
    diffusionNormalization?: DiffusionNormalizationPayload
    required_fields: string[]
    fields: Record<string, FieldEvidenceEntry>
}

export interface ReviewFieldEvidencePatchPayload {
    page: number
    bbox: number[]
    matchedText: string
    quote?: string | null
    sourceLabel?: string | null
    sourceType?: string | null
    note?: string | null
}

export interface ExtractionRunDetail {
    run_id: string | null
    literature_id: number
    extractor_type?: ExtractorType
    profile: string
    status: string
    candidate_count: number
    final_count: number
    dropped_by_reason: Record<string, number>
    page_coverage: Record<string, any>
    page_candidate_counts?: Record<string, {
        total: number
        figure: number
        text: number
        other: number
        kept_after_validation: number
        dropped_after_validation: number
    }>
    progress_log?: Array<{
        stage: string
        message: string
        page?: number
    }>
    summary: Record<string, any>
    error_message?: string | null
    created_at?: string
    updated_at?: string
}

export interface ExtractionRunCandidatesResponse {
    run_id: string
    total: number
    skip: number
    limit: number
    items: Array<{
        id: number
        stage: string
        modality: string
        page: number | null
        source_figure: string | null
        panel_label: string | null
        raw: any
        normalized: any
        drop_reason: string | null
        merged_into: string | null
    }>
}

export async function getRecordEvidence(litId: number, recordId: number): Promise<EvidenceResult> {
    const response = await api.get(`/api/pdf/${litId}/evidence/${recordId}`)
    return response.data
}

export async function getCandidateEvidence(litId: number, candidateId: number): Promise<EvidenceResult> {
    const response = await api.get(`/api/pdf/${litId}/candidates/${candidateId}/evidence`)
    return response.data
}

export async function getDiffusionCandidateEvidence(litId: number, candidateId: number): Promise<EvidenceResult> {
    const response = await api.get(`/api/pdf/${litId}/diffusion-candidates/${candidateId}/evidence`)
    return response.data
}

export async function getDiffusionRecordEvidence(litId: number, recordId: number): Promise<EvidenceResult> {
    const response = await api.get(`/api/pdf/${litId}/diffusion-records/${recordId}/evidence`)
    return response.data
}

export async function getRecordFieldEvidence(recordId: number): Promise<RecordFieldEvidenceResponse> {
    const response = await api.get(`/api/review/records/${recordId}/field-evidence`)
    return response.data
}

export async function getCandidateFieldEvidence(candidateId: number, literatureId?: number): Promise<RecordFieldEvidenceResponse> {
    const response = await api.get(`/api/review/candidates/${candidateId}/field-evidence`, {
        params: literatureId ? { literature_id: literatureId } : undefined,
    })
    return response.data
}

export async function getDiffusionCandidateFieldEvidence(candidateId: number): Promise<RecordFieldEvidenceResponse> {
    const response = await api.get(`/api/review/diffusion-candidates/${candidateId}/field-evidence`)
    return response.data
}

export async function getDiffusionRecordFieldEvidence(recordId: number): Promise<RecordFieldEvidenceResponse> {
    const response = await api.get(`/api/review/diffusion-records/${recordId}/field-evidence`)
    return response.data
}

export async function confirmRecordFieldEvidence(recordId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/records/${recordId}/fields/${fieldKey}/confirm`, {
        note: note ?? null,
    })
    return response.data
}

export async function confirmCandidateFieldEvidence(candidateId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/candidates/${candidateId}/fields/${fieldKey}/confirm`, {
        note: note ?? null,
    })
    return response.data
}

export async function confirmDiffusionCandidateFieldEvidence(candidateId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/diffusion-candidates/${candidateId}/fields/${fieldKey}/confirm`, {
        note: note ?? null,
    })
    return response.data
}

export async function confirmDiffusionRecordFieldEvidence(recordId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/diffusion-records/${recordId}/fields/${fieldKey}/confirm`, {
        note: note ?? null,
    })
    return response.data
}

export async function patchDiffusionCandidateFieldEvidence(
    candidateId: number,
    fieldKey: string,
    payload: ReviewFieldEvidencePatchPayload,
): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/diffusion-candidates/${candidateId}/fields/${fieldKey}/evidence`, payload)
    return response.data
}

export async function patchDiffusionRecordFieldEvidence(
    recordId: number,
    fieldKey: string,
    payload: ReviewFieldEvidencePatchPayload,
): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/diffusion-records/${recordId}/fields/${fieldKey}/evidence`, payload)
    return response.data
}

export async function flagRecordFieldEvidence(recordId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/records/${recordId}/fields/${fieldKey}/flag`, {
        note: note ?? null,
    })
    return response.data
}

export async function flagCandidateFieldEvidence(candidateId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/candidates/${candidateId}/fields/${fieldKey}/flag`, {
        note: note ?? null,
    })
    return response.data
}

export async function flagDiffusionCandidateFieldEvidence(candidateId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/diffusion-candidates/${candidateId}/fields/${fieldKey}/flag`, {
        note: note ?? null,
    })
    return response.data
}

export async function flagDiffusionRecordFieldEvidence(recordId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/diffusion-records/${recordId}/fields/${fieldKey}/flag`, {
        note: note ?? null,
    })
    return response.data
}

export async function unflagRecordFieldEvidence(recordId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/records/${recordId}/fields/${fieldKey}/unflag`, {
        note: note ?? null,
    })
    return response.data
}

export async function unflagCandidateFieldEvidence(candidateId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/candidates/${candidateId}/fields/${fieldKey}/unflag`, {
        note: note ?? null,
    })
    return response.data
}

export async function unflagDiffusionCandidateFieldEvidence(candidateId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/diffusion-candidates/${candidateId}/fields/${fieldKey}/unflag`, {
        note: note ?? null,
    })
    return response.data
}

export async function unflagDiffusionRecordFieldEvidence(recordId: number, fieldKey: string, note?: string | null): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/diffusion-records/${recordId}/fields/${fieldKey}/unflag`, {
        note: note ?? null,
    })
    return response.data
}

export async function approveReviewRecord(recordId: number): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/records/${recordId}/approve`)
    return response.data
}

export async function approveReviewCandidate(candidateId: number): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/candidates/${candidateId}/approve`)
    return response.data
}

export async function rejectReviewCandidate(candidateId: number, note?: string): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/candidates/${candidateId}/reject`, { note: note ?? null })
    return response.data
}

export async function updateReviewCandidateFields(
    candidateId: number,
    fields: Record<string, string | number | null>,
): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/candidates/${candidateId}/fields`, { fields })
    return response.data
}

export async function approveDiffusionReviewCandidate(candidateId: number): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/diffusion-candidates/${candidateId}/approve`)
    return response.data
}

export async function rejectDiffusionReviewCandidate(candidateId: number, note?: string): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/diffusion-candidates/${candidateId}/reject`, { note: note ?? null })
    return response.data
}

export async function approveDiffusionReviewRecord(recordId: number): Promise<RecordFieldEvidenceResponse> {
    const response = await api.post(`/api/review/diffusion-records/${recordId}/approve`)
    return response.data
}

export async function createManualDiffusionCandidate(
    literatureId: number,
    payload: ManualDiffusionCandidatePayload,
): Promise<TribologyData> {
    const response = await api.post(`/api/review/literature/${literatureId}/diffusion-candidates/manual`, payload)
    return response.data
}

export async function updateReviewRecordCofExtracted(recordId: number, cofExtracted: CofExtracted): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/records/${recordId}/cof-extracted`, {
        cofExtracted,
    })
    return response.data
}

export async function updateReviewCandidateCofExtracted(candidateId: number, cofExtracted: CofExtracted): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/candidates/${candidateId}/cof-extracted`, {
        cofExtracted,
    })
    return response.data
}

export async function updateReviewRecordLoadConditions(recordId: number, loadConditions: LoadConditions): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/records/${recordId}/load-conditions`, {
        loadConditions,
    })
    return response.data
}

export async function updateReviewCandidateLoadConditions(candidateId: number, loadConditions: LoadConditions): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/candidates/${candidateId}/load-conditions`, {
        loadConditions,
    })
    return response.data
}

export async function updateReviewRecordSpeedConditions(recordId: number, speedConditions: SpeedConditions): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/records/${recordId}/speed-conditions`, {
        speedConditions,
    })
    return response.data
}

export async function updateReviewCandidateSpeedConditions(candidateId: number, speedConditions: SpeedConditions): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/candidates/${candidateId}/speed-conditions`, {
        speedConditions,
    })
    return response.data
}

export async function updateReviewRecordTribologicalSystem(recordId: number, tribologicalSystem: TribologicalSystem): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/records/${recordId}/tribological-system`, {
        tribologicalSystem,
    })
    return response.data
}

export async function updateReviewCandidateTribologicalSystem(candidateId: number, tribologicalSystem: TribologicalSystem): Promise<RecordFieldEvidenceResponse> {
    const response = await api.patch(`/api/review/candidates/${candidateId}/tribological-system`, {
        tribologicalSystem,
    })
    return response.data
}

export async function getExtractionRun(runId: string): Promise<ExtractionRunDetail> {
    const response = await api.get(`/api/extraction-runs/${runId}`)
    return response.data
}

export async function getLatestExtractionRun(literatureId: number, extractorType: ExtractorType = 'tribology'): Promise<ExtractionRunDetail> {
    const response = await api.get(`/api/extraction-runs/latest/${literatureId}?extractor_type=${extractorType}`)
    return response.data
}

export async function getExtractionRunCandidates(
    runId: string,
    skip: number = 0,
    limit: number = 200,
): Promise<ExtractionRunCandidatesResponse> {
    const response = await api.get(`/api/extraction-runs/${runId}/candidates?skip=${skip}&limit=${limit}`)
    return response.data
}


// --- Search API ---

export type ApiScopeOption = {
    scope?: 'active' | 'group_library' | 'all_visible'
}

function scopeHeaders(options?: ApiScopeOption) {
    return options?.scope === 'group_library'
        ? { 'X-Scope-Type': 'group_library' }
        : undefined
}

function scopeParams(options?: ApiScopeOption): Record<string, string> {
    return options?.scope === 'all_visible'
        ? { scope_mode: 'all_visible' }
        : {}
}

// Search Records (Paginated)
export async function searchRecords(
    filter: SearchFilter,
    skip: number = 0,
    limit: number = 20,
    options?: ApiScopeOption,
): Promise<PaginatedRecordResponse> {
    const params = new URLSearchParams({
        skip: String(skip),
        limit: String(limit),
        ...scopeParams(options),
    })
    const response = await api.post(`/api/records/search?${params.toString()}`, filter, {
        headers: scopeHeaders(options),
    })
    return response.data
}

export interface DiffusionLibrarySummary {
    finalRecordCount: number
    candidateCount: number
    literatureCount: number
    speciesCounts: Record<string, number>
}

export interface DiffusionNormalizationCoefficient {
    field?: 'd_total' | 'd_cation' | 'd_anion' | string
    source_field?: string
    sourceField?: string
    label?: string
    status?: 'normalized' | 'unit_warning' | 'missing' | string
    source?: 'evidence' | 'stored_value' | string
    original_value?: string | number | null
    originalValue?: string | number | null
    original_unit?: string | null
    originalUnit?: string | null
    original_label?: string | null
    originalLabel?: string | null
    canonical_value?: number | null
    canonicalValue?: number | null
    canonical_unit?: string | null
    canonicalUnit?: string | null
    canonical_label?: string | null
    canonicalLabel?: string | null
    value_10e12_m2_s?: number | null
    value10e12M2S?: number | null
    value_m2_s?: number | null
    valueM2S?: number | null
    value_a2_ps?: number | null
    valueA2Ps?: number | null
    note?: string | null
}

export interface DiffusionNormalizationPayload {
    schema_version?: string
    schemaVersion?: string
    status?: 'ready' | 'partial' | 'missing' | string
    canonical_unit?: string
    canonicalUnit?: string
    canonical_unit_si?: string
    canonicalUnitSi?: string
    coefficients?: Record<string, DiffusionNormalizationCoefficient>
    primary_field?: string | null
    primaryField?: string | null
    primary?: DiffusionNormalizationCoefficient | null
    ready_count?: number
    readyCount?: number
    warning_count?: number
    warningCount?: number
    warnings?: string[]
}

export interface DiffusionStandardFields {
    schema_version?: string
    cation?: string | null
    anion?: string | null
    diffusing_ion?: string | null
    diffusingIon?: string | null
    side_chain_label?: string | null
    sideChainLabel?: string | null
    side_chain_carbons?: number | null
    sideChainCarbons?: number | null
    side_chain_name?: string | null
    sideChainName?: string | null
    water_uptake_value?: number | string | null
    waterUptakeValue?: number | string | null
    water_uptake_unit?: string | null
    waterUptakeUnit?: string | null
    water_uptake_label?: string | null
    waterUptakeLabel?: string | null
    coefficient_kind?: string | null
    coefficientKind?: string | null
    coefficient_value?: number | null
    coefficientValue?: number | null
    coefficient_unit?: string | null
    coefficientUnit?: string | null
    coefficient_m2_s?: number | null
    coefficientM2S?: number | null
    coefficient_a2_ps?: number | null
    coefficientA2Ps?: number | null
    data_type?: string | null
    dataType?: string | null
}

export interface DiffusionLibraryRecord extends TribologyData {
    library_id?: string
    libraryId?: string
    literature_id?: number
    literatureId?: number
    literature?: Partial<Literature> | null
    literature_title?: string
    literatureTitle?: string
    literature_doi?: string
    literatureDoi?: string
    diffusing_species?: string
    diffusingSpecies?: string
    diffusion_standard_fields?: DiffusionStandardFields
    diffusionStandardFields?: DiffusionStandardFields
    reviewEntityType?: 'record' | 'candidate' | string
}

export interface DiffusionLibraryResponse {
    total: number
    skip: number
    limit: number
    items: DiffusionLibraryRecord[]
    summary: DiffusionLibrarySummary
}

export async function listDiffusionLibrary(
    query: string = '',
    skip: number = 0,
    limit: number = 500,
    options: ApiScopeOption & { literatureId?: string | number | null, recordId?: string | number | null, entityType?: 'record' | 'candidate' | string | null } = {},
): Promise<DiffusionLibraryResponse> {
    const response = await api.get('/api/records/diffusion-library', {
        params: {
            q: query || undefined,
            skip,
            limit,
            ...scopeParams(options),
            literature_id: options.literatureId || undefined,
            record_id: options.recordId || undefined,
            entity_type: options.entityType || undefined,
        },
        headers: scopeHeaders(options),
    })
    return response.data
}

export interface RelationshipGraphDimensionSummary {
    type: string
    label: string
    nodeCount: number
    coveragePct: number
    nonEmptyCount: number
    distinctCount: number
    reason?: string | null
}

export interface RelationshipGraphNode {
    id: string
    type: string
    label: string
    count: number
    coveragePct: number
    avgCof: number | null
    minCof: number | null
    maxCof: number | null
}

export interface RelationshipGraphEdge {
    id: string
    source: string
    target: string
    sourceType: string
    sourceLabel: string
    targetType: string
    targetLabel: string
    count: number
    avgCof: number | null
    minCof: number | null
    maxCof: number | null
}

export interface RelationshipGraphSummary {
    totalRecords: number
    totalLiterature: number
    avgCof: number | null
    activeDimensions: RelationshipGraphDimensionSummary[]
    hiddenDimensions: RelationshipGraphDimensionSummary[]
}

export interface RelationshipGraphResponse {
    title: string
    state: 'ready' | 'empty' | 'insufficient_data' | string
    summary: RelationshipGraphSummary
    nodes: RelationshipGraphNode[]
    edges: RelationshipGraphEdge[]
}

export interface RelationshipGraphSelection {
    kind: 'node' | 'edge'
    nodeType?: string
    nodeValue?: string
    sourceType?: string
    sourceValue?: string
    targetType?: string
    targetValue?: string
}

export interface RelationshipGraphDrilldownSummary {
    label: string
    count: number
    avgCof: number | null
    minCof: number | null
    maxCof: number | null
}

export interface RelationshipGraphLiteratureSummary {
    id: number
    doi: string
    title: string
    journal: string
    year: number | null
    hitCount: number
}

export interface RelationshipGraphDrilldownResponse {
    selection: RelationshipGraphSelection
    summary: RelationshipGraphDrilldownSummary
    total: number
    skip: number
    limit: number
    items: RecordResponse[]
    literatureSummaries: RelationshipGraphLiteratureSummary[]
}

export async function getRelationshipGraph(filter: SearchFilter): Promise<RelationshipGraphResponse> {
    const response = await api.post('/api/records/relationship-graph', filter)
    return response.data
}

export async function getRelationshipGraphDrilldown(
    filter: SearchFilter,
    selection: RelationshipGraphSelection,
    skip: number = 0,
    limit: number = 20,
): Promise<RelationshipGraphDrilldownResponse> {
    const response = await api.post(`/api/records/relationship-graph/drilldown?skip=${skip}&limit=${limit}`, {
        filter,
        selection,
    })
    return response.data
}

// Get Filter Options
export async function getFilterOptions(options?: ApiScopeOption): Promise<RecordFilterOptions> {
    const response = await api.get('/api/records/options', {
        params: scopeParams(options),
        headers: scopeHeaders(options),
    })
    return response.data
}

// Update single data record (save inline edit)
export async function updateTribologyRecord(recordId: number, data: Partial<RecordUpdatePayload>) {
    const response = await api.put(`/api/records/${recordId}`, data)
    return response.data
}

export interface PromoteConfidencePayload {
    confidence: number
    evidence?: string | null
    evidencePage?: number | null
    evidenceBbox?: string | null
    source?: string | null
    sourcePage?: number | null
    sourceFigure?: string | null
}

export async function promoteTribologyRecordConfidence(recordId: number, data: PromoteConfidencePayload) {
    const response = await api.post(`/api/records/${recordId}/promote-confidence`, data)
    return response.data as {
        success: boolean
        id: number
        confidence: number
        confidenceDetails?: {
            base_score?: number
            base_percent?: number
            score: number
            percent: number
            penalties: { reason: string, value: number }[]
            boosts?: { reason: string, value: number }[]
            penalty_total?: number
            penalty_percent?: number
            boost_total?: number
            boost_percent?: number
        }
    }
}

// Delete single data record
export async function deleteTribologyRecord(recordId: number) {
    const response = await api.delete(`/api/records/${recordId}`)
    return response.data
}

export interface BatchDeleteResult {
    success: boolean
    requested: number
    deletedCount: number
    deleted: number[]
    failed: Array<{ id: number; reason: string }>
}

export interface RecordCorrectionResult {
    success: boolean
    id: number
    committed: boolean
    dryRun: boolean
    diff: Record<string, { before: unknown; after: unknown }>
    candidateIds: number[]
    confidence: number | null
}

export async function correctRecord(
    recordId: number,
    payload: { fields: Record<string, unknown>; linkCandidateIds?: number[] },
    options?: { dryRun?: boolean },
): Promise<RecordCorrectionResult> {
    const query = options?.dryRun ? '?dryRun=true' : ''
    const response = await api.post(`/api/records/${recordId}/correct${query}`, payload)
    return response.data
}

export async function batchDeleteTribologyRecords(ids: number[]): Promise<BatchDeleteResult> {
    const response = await api.post('/api/records/batch-delete', { ids })
    return response.data
}

export interface ReviewBacklogPaper {
    literatureId: number
    literatureIds?: number[]
    title: string
    journal: string
    year: number | null
    doi: string
    pendingCount: number
}

export interface ReviewBacklogResponse {
    papers: ReviewBacklogPaper[]
    totalPending: number
    paperCount: number
}

export async function getReviewBacklog(options?: ApiScopeOption): Promise<ReviewBacklogResponse> {
    const params = new URLSearchParams({ ...scopeParams(options) })
    const qs = params.toString()
    const response = await api.get(`/api/records/review-backlog${qs ? `?${qs}` : ''}`, {
        headers: scopeHeaders(options),
    })
    return response.data
}

// --- Types ---

export type ValidationStatus = 'unverified' | 'verified' | 'modified' | 'warning'

export interface ConfidenceDetails {
    base_score?: number
    base_percent?: number
    score: number
    percent?: number
    band?: string
    components?: Record<string, number>
    required_slots?: Array<{
        name: string
        completeness?: number
        grounding?: number
    }>
    penalties?: { reason: string, value: number }[]
    boosts?: { reason: string, value: number }[]
    penalty_total?: number
    penalty_percent?: number
    boost_total?: number
    boost_percent?: number
}

export interface LubricantComponent {
    compound: string
    fraction?: number | null
    unit?: string | null
    role?: string | null
}

export interface CofExtracted {
    raw_text?: string | null
    rawText?: string | null
    value_type?: 'single' | 'range' | 'conditional' | string | null
    valueType?: 'single' | 'range' | 'conditional' | string | null
    cof_min?: number | null
    cofMin?: number | null
    cof_max?: number | null
    cofMax?: number | null
    cof_average?: number | null
    cofAverage?: number | null
    dependent_variable?: string | null
    dependentVariable?: string | null
    test_condition_value?: string | null
    testConditionValue?: string | null
    note?: string | null
    segments?: CofExtracted[]
}

export interface LoadConditions {
    raw_text?: string | null
    rawText?: string | null
    value_type?: 'single' | 'range' | 'composite' | 'unstated' | string | null
    valueType?: 'single' | 'range' | 'composite' | 'unstated' | string | null
    system_total_load_N?: number | null
    systemTotalLoadN?: number | null
    contact_load_per_unit_N?: number | null
    contactLoadPerUnitN?: number | null
    contact_unit_type?: string | null
    contactUnitType?: string | null
    load_min_N?: number | null
    loadMinN?: number | null
    load_max_N?: number | null
    loadMaxN?: number | null
    note?: string | null
}

export interface SpeedConditions {
    raw_text?: string | null
    rawText?: string | null
    value_type?: 'linear' | 'derived' | 'scan_rate' | 'unknown' | string | null
    valueType?: 'linear' | 'derived' | 'scan_rate' | 'unknown' | string | null
    sliding_velocity_um_s?: number | null
    slidingVelocityUmS?: number | null
    scan_rate_hz?: number | null
    scanRateHz?: number | null
    scan_length_um?: number | null
    scanLengthUm?: number | null
    unit_warning?: boolean | null
    unitWarning?: boolean | null
    calculation?: string | null
    note?: string | null
}

export interface TribologicalSystem {
    raw_text?: string | null
    rawText?: string | null
    friction_regime?: string | null
    frictionRegime?: string | null
    contact_geometry?: string | null
    contactGeometry?: string | null
    scale?: string | null
    method?: string | null
    instrument?: string | null
    measurement_type?: string | null
    measurementType?: string | null
    profile?: string | null
    training_view?: string | null
    trainingView?: string | null
    training_views?: string[] | null
    trainingViews?: string[] | null
    note?: string | null
}

export interface ExperimentProfile {
    scale: 'macroscale' | 'microscale' | 'nanoscale' | 'unknown' | string
    method: string
    instrument: string
    contact_geometry?: string | null
    contactGeometry?: string | null
    measurement_type: string
    measurementType?: string
    profile: string
    training_view: string
    trainingView?: string
    training_views?: string[]
    trainingViews?: string[]
}

export interface TribologyData {
    id?: string
    extractor_type?: ExtractorType
    material_name: string
    ionic_liquid: string
    lubricant_components?: LubricantComponent[]
    lubricant_alias?: string | null
    ionic_liquid_display?: string | null
    lubricant_tooltip?: string | null
    base_oil?: string
    concentration?: string
    load?: string
    load_conditions?: LoadConditions | null
    speed?: string
    speed_conditions?: SpeedConditions | null
    shear_rate?: string
    temperature?: string
    cof?: string
    cof_extracted?: CofExtracted | null
    wear_rate?: string
    test_duration?: string
    contact_type?: string
    // Environmental variables
    potential?: string  // Electrochemical potential/voltage (e.g. '+1.5V', 'OCP')
    water_content?: string  // Water content or humidity (e.g. '50 ppm', 'Dry')
    probe_material?: string
    probe_geometry?: string
    probe_radius?: string
    probe_roughness?: string
    substrate_material?: string
    substrate_coating?: string
    substrate_roughness?: string
    surface_roughness?: string  // Derived/composite roughness for display/export (e.g. RMS Rq)
    residual_film_thickness_d?: string
    layer_spacing_delta?: string
    film_thickness?: string // Film thickness
    regime?: string
    tribological_system?: TribologicalSystem | null
    experiment_profile?: ExperimentProfile | null
    experiment_scale?: string
    experiment_method?: string
    measurement_type?: string
    training_view?: string
    mol_ratio?: string // Mol ratio
    cation?: string // Cation
    anion?: string // Anion
    cation_smiles?: string
    anion_smiles?: string
    il_smiles?: string
    il_inchikey?: string
    alkyl_chain_length?: number
    source?: string
    display_source?: Record<string, unknown> | null
    displaySource?: Record<string, unknown> | null
    source_page?: number
    source_bbox?: number[] | null
    source_figure?: string
    notes?: string
    evidence?: string
    sample_id?: string
    series_id?: string
    semantic_key?: string
    semanticKey?: string
    evidence_score?: number | null
    evidenceScore?: number | null
    evidence_grade?: 'strong' | 'adequate' | 'weak' | 'missing' | string | null
    evidenceGrade?: 'strong' | 'adequate' | 'weak' | 'missing' | string | null
    evidence_summary?: Record<string, unknown> | null
    evidenceSummary?: Record<string, unknown> | null
    entity_type?: 'candidate' | 'record' | string | null
    entityType?: 'candidate' | 'record' | string | null
    entity_id?: number | string | null
    entityId?: number | string | null
    confidence_tier?: 'low' | 'medium' | 'high' | string | null
    confidenceTier?: 'low' | 'medium' | 'high' | string | null
    admission_reason?: string | null
    admissionReason?: string | null
    missing_fields?: string[] | null
    missingFields?: string[] | null
    quality_notes?: string | null
    qualityNotes?: string | null
    fields?: Record<string, unknown> | null
    field_evidence_json?: Record<string, FieldEvidenceEntry>
    review_status?: string
    record_origin?: string
    review_entity_type?: 'record' | 'candidate' | string
    reviewEntityType?: 'record' | 'candidate' | string
    promoted_record_id?: number | null
    promotedRecordId?: number | null
    promoted_at?: string | null
    promotedAt?: string | null
    assembly_notes?: string
    confidence?: number | null
    confidence_details?: ConfidenceDetails | null
    confidenceDetails?: ConfidenceDetails | null
    system_name?: string
    confinement_material_class?: string
    confinement_geometry_class?: string
    surface_functional_groups?: string
    confinement_dimensionality?: string
    D_total?: number | null
    D_cation?: number | null
    D_anion?: number | null
    D_unit?: string
    temperature_value?: number | null
    confinement_scale_value?: number | null
    confinement_scale_unit?: string
    diffusion_standard_fields?: DiffusionStandardFields
    diffusionStandardFields?: DiffusionStandardFields
    diffusion_normalization?: DiffusionNormalizationPayload
    diffusionNormalization?: DiffusionNormalizationPayload
    smiles?: string
    novel_features_json?: Record<string, any>
    rdkit_features_json?: Record<string, any>

    // Validation fields
    validationStatus?: ValidationStatus
    originalValue?: Partial<TribologyData> // Store AI-extracted values for rollback
    validationMessage?: string // Error or warning messages
    isEditable?: boolean // UI state control

    // Metadata for COF calculation
    friction_force?: string // For calculated COF
    normal_load?: string // For calculated COF  
    cof_source?: 'extracted' | 'calculated' // How COF was obtained
}

export interface UploadResponse {
    success: boolean
    file_id: string
    filename: string
    preview: string
    status?: string
    extractor_type?: ExtractorType
    record_count?: number
    candidate_count?: number
    cached_record_count?: number
    cache_hit?: boolean
    metadata?: LiteratureMetadata & { id?: number | string | null }
}

// Literature Metadata Interface
export interface LiteratureMetadata {
    title: string
    authors: string
    doi: string
    journal: string
    issn?: string | null
    year: number
    volume?: string | null
    issue?: string | null
    pages?: string | null
}

export interface ExtractionResponse {
    success: boolean
    status?: string
    metadata?: LiteratureMetadata
    data: TribologyData[]
    extractor_type?: ExtractorType
    extraction_summary?: ExtractionSummary
    agent_workflow?: AgentWorkflow
    message?: string
}

export interface ExtractionSummary {
    extractor_type?: ExtractorType
    run_id?: string | null
    candidate_count: number
    final_count: number
    dropped_by_reason: Record<string, number>
    page_coverage: Record<string, any>
    current_stage?: string
    current_message?: string
    progress_percent?: number
    no_data_reason?: string
    review_status?: string
    weak_candidate_count?: number
    admission_reason?: string
    page_candidate_counts?: Record<string, {
        total: number
        figure: number
        text: number
        other: number
        kept_after_validation: number
        dropped_after_validation: number
    }>
    progress_log?: Array<{
        stage: string
        message: string
        page?: number
    }>
}

export interface ChatResponse {
    success: boolean
    response: string
}

export interface AgentMessage {
    sender: string
    receiver: string
    task_id: string
    message_type: string
    payload: Record<string, any>
    timestamp: string
}

export interface AgentStatusItem {
    name: string
    capabilities: string[]
    handled_tasks: number
    last_task_type?: string | null
    last_task_at?: string | null
}

export interface AgentWorkflow {
    validation?: {
        record_count?: number
        missing_material_count?: number
        missing_lubricant_count?: number
        missing_cof_count?: number
        duplicate_count?: number
        quality_gate_passed?: boolean
        warnings?: string[]
    }
    insight?: {
        title?: string
        record_count?: number
        top_materials?: Array<{ name: string, count: number }>
        top_lubricants?: Array<{ name: string, count: number }>
        warnings?: string[]
    }
    messages: AgentMessage[]
}

export interface AgentStatusResponse {
    agents: AgentStatusItem[]
    recent_messages: AgentMessage[]
}

export interface UsageMetricEvent {
    timestamp: string
    category: string
    action: string
    detail?: Record<string, any>
}

export interface UsageMetricsResponse {
    started_at: string
    uptime_seconds: number
    totals: {
        agent_calls: number
        db_queries: number
        api_calls: number
    }
    agent_calls_by_receiver: Record<string, number>
    agent_calls_by_task: Record<string, number>
    db_queries_by_operation: Record<string, number>
    recent_events: UsageMetricEvent[]
}

export interface SyncResult {
    success: boolean
    literatureId: number
    syncedCount: number
    message?: string
    literature_id?: number
    synced_count?: number
}

function cleanLegacyTribopairRole(value: string) {
    return value.replace(/\s+/g, ' ').trim()
}

function looksLikeIonicLiquidSegment(value: string) {
    const text = value.toLowerCase()
    return Boolean(
        /[\[\]]/.test(value)
        || /\b(?:ionic\s+liquid|il|mim|imidazolium|phosphonium|pyridinium)\b/.test(text)
        || /\b(?:bmim|emim|hmim|tfsi|ntf2|bf4|pf6|fap|bmb|aot)\b/.test(text),
    )
}

function looksLikeContactPairSide(value: string) {
    return /\b(?:afm|tip|probe|ball|bead|pin|disk|disc|plate|electrode|substrate|surface|mica|hopg|graphite|steel|silica|sio2|alumina|ptfe|au)\b/i.test(value)
}

export function parseLegacyTribopairLabel(materialName?: string | null) {
    const legacy = cleanLegacyTribopairRole(String(materialName || ''))
    if (!legacy || !legacy.includes('/')) return null
    const parts = legacy.split(/\s+\/\s+/).map(cleanLegacyTribopairRole).filter(Boolean)
    const middle = parts[1] || ''
    if (parts.length >= 3 && looksLikeIonicLiquidSegment(middle)) {
        return {
            probe: parts[0],
            substrate: parts.slice(2).join(' / '),
        }
    }
    if (parts.length === 2 && parts.every(looksLikeContactPairSide)) {
        return {
            probe: parts[0],
            substrate: parts[1],
        }
    }
    return null
}

export function formatTribopairLabel(input: {
    probeMaterial?: string | null
    substrateMaterial?: string | null
    substrateCoating?: string | null
    materialName?: string | null
}) {
    const probe = String(input.probeMaterial || '').trim()
    const substrate = String(input.substrateMaterial || '').trim()
    const coating = String(input.substrateCoating || '').trim()
    const legacy = String(input.materialName || '').trim()

    if (probe && substrate) {
        return coating && coating.toLowerCase() !== 'none'
            ? `${probe} vs. ${substrate} (${coating})`
            : `${probe} vs. ${substrate}`
    }
    const legacyPair = parseLegacyTribopairLabel(legacy)
    if (legacyPair) return `${legacyPair.probe} vs. ${legacyPair.substrate}`
    if (substrate) return substrate
    if (probe) return probe
    return legacy || '--'
}

function parseNumericValue(raw: string | undefined, stripPattern: RegExp) {
    if (!raw) return null
    const parsed = parseFloat(raw.replace(stripPattern, ''))
    return Number.isFinite(parsed) ? parsed : null
}

function mapRecordForLegacySync(record: TribologyData) {
    return {
        id: record.id,
        materialName: record.material_name,
        lubricant: record.ionic_liquid,
        lubricantComponents: record.lubricant_components,
        lubricantAlias: record.lubricant_alias,
        cofExtracted: record.cof_extracted,
        cofRaw: record.cof,
        loadRaw: record.load,
        loadConditions: record.load_conditions,
        speedRaw: record.speed,
        speedConditions: record.speed_conditions,
        shearRate: record.shear_rate,
        probeMaterial: record.probe_material,
        probeGeometry: record.probe_geometry,
        probeRadius: record.probe_radius,
        probeRoughness: record.probe_roughness,
        substrateMaterial: record.substrate_material,
        substrateCoating: record.substrate_coating,
        substrateRoughness: record.substrate_roughness,
        regime: record.regime,
        tribologicalSystem: record.tribological_system,
        experimentScale: record.experiment_scale,
        experimentMethod: record.experiment_method,
        measurementType: record.measurement_type,
        validationStatus: record.validationStatus,
        adminComment: record.notes,
    }
}

export function mapRecordToPayload(record: TribologyData) {
    return {
        materialName: record.material_name,
        lubricant: record.ionic_liquid,
        lubricantComponents: record.lubricant_components,
        lubricantAlias: record.lubricant_alias,
        cofExtracted: record.cof_extracted,
        cofValue: parseNumericValue(record.cof, /[<>~=]/g),
        cofOperator: record.cof?.match(/[<>~=]/)?.[0] || null,
        cofRaw: record.cof,
        loadValue: parseNumericValue(record.load, /[^0-9.]/g),
        loadRaw: record.load,
        loadConditions: record.load_conditions,
        speedValue: record.speed || null,
        speedRaw: record.speed,
        speedConditions: record.speed_conditions,
        shearRate: record.shear_rate,
        temperature: record.temperature,
        temperatureValue: parseNumericValue(record.temperature, /[^0-9.]/g),
        potential: record.potential,
        waterContent: record.water_content,
        probeMaterial: record.probe_material,
        probeGeometry: record.probe_geometry,
        probeRadius: record.probe_radius,
        probeRoughness: record.probe_roughness,
        substrateMaterial: record.substrate_material,
        substrateCoating: record.substrate_coating,
        substrateRoughness: record.substrate_roughness,
        surfaceRoughness: record.surface_roughness,
        residualFilmThicknessD: record.residual_film_thickness_d,
        layerSpacingDelta: record.layer_spacing_delta,
        filmThickness: record.film_thickness,
        regime: record.regime,
        tribologicalSystem: record.tribological_system,
        experimentScale: record.experiment_scale,
        experimentMethod: record.experiment_method,
        measurementType: record.measurement_type,
        molRatio: record.mol_ratio,
        cation: record.cation,
        anion: record.anion,
        cationSmiles: record.cation_smiles,
        anionSmiles: record.anion_smiles,
        ilSmiles: record.il_smiles,
        ilInchikey: record.il_inchikey,
        alkylChainLength: record.alkyl_chain_length,
        evidence: record.evidence,
        source: record.source,
        sourcePage: record.source_page,
        sourceFigure: record.source_figure,
        sampleId: record.sample_id,
        seriesId: record.series_id,
        fieldEvidenceJson: record.field_evidence_json,
        reviewStatus: record.review_status,
        recordOrigin: record.record_origin,
        assemblyNotes: record.assembly_notes,
        confidence: 0.9,
    }
}
// Sync data to DB (New version: includes literature metadata)
export async function syncWithLiterature(metadata: LiteratureMetadata, records: TribologyData[]): Promise<SyncResult> {
    // Build SyncPayload format
    const payload = {
        metadata: {
            doi: metadata.doi || `temp-${Date.now()}`,
            title: metadata.title,
            authors: metadata.authors,
            journal: metadata.journal,
            issn: metadata.issn,
            year: metadata.year,
            volume: metadata.volume,
            issue: metadata.issue,
            pages: metadata.pages,
            filePath: ""  // To be filled by backend
        },
        records: records.map(mapRecordToPayload)
    }

    const response = await api.post('/api/sync/', payload)
    return response.data
}

// Batch sync data (includes metadata)
export async function syncBatchData(metadata: LiteratureMetadata, records: TribologyData[]): Promise<SyncResult> {
    const payload = {
        metadata: {
            ...metadata,
            // Ensure all required fields are included; provide defaults if missing
            doi: metadata.doi || '',
            title: metadata.title || 'Untitled',
            authors: metadata.authors || '',
            journal: metadata.journal || '',
            year: metadata.year || new Date().getFullYear()
        },
        records: records.map(mapRecordToPayload)
    }

    const response = await api.post('/api/sync/', payload)
    return response.data
}

// Batch processing related types
export type FileExtractionStatus = 'uploading' | 'uploaded' | 'processing' | 'success' | 'error' | 'no_data' | 'cancelled'

export interface BatchFile {
    id: string
    name: string
    disablePdfPreview?: boolean
    scopeKey?: string
    extractor_type?: ExtractorType
    submissionStatus?: SubmissionStatus | string | null
    submissionNote?: string | null
    submittedAt?: string | null
    reviewNote?: string | null
    reviewedAt?: string | null
    promotedLiteratureId?: number | null
    status: FileExtractionStatus
    progress: number // 0-100
    progressMessage?: string
    metadata?: LiteratureMetadata  // Literature Metadata
    records: TribologyData[]
    errorMessage?: string
    hasWarnings?: boolean // Whether it contains missing values (e.g. COF is null)
}

export type SearchFilter = {
    recordId?: number
    entityType?: 'record' | 'candidate' | string
    query?: string
    materials?: string[]
    probe_materials?: string[]
    substrate_materials?: string[]
    substrate_coatings?: string[]
    lubricants?: string[]
    cations?: string[]
    anions?: string[]
    speed_values?: string[]
    shear_rate_values?: string[]
    temperature_values?: string[]
    potential_values?: string[]
    water_content_values?: string[]
    load_min?: number
    load_max?: number
    cof_min?: number
    cof_max?: number
    reviewStatuses?: string[]
    experiment_scales?: string[]
    experiment_methods?: string[]
    measurement_types?: string[]
    training_views?: string[]
    doi?: string
    fileId?: string
    sortBy?: RecordSortColumn
    sortDir?: 'asc' | 'desc'
}

export type RecordSortColumn = 'id' | 'cof' | 'load' | 'confidence' | 'date'

export interface RecordFilterOptions {
    materials: string[]
    lubricants: string[]
    cations: string[]
    anions: string[]
    probeMaterials: string[]
    substrateMaterials: string[]
    substrateCoatings: string[]
    speedValues: string[]
    shearRateValues: string[]
    temperatureValues: string[]
    potentialValues: string[]
    waterContentValues: string[]
    experimentScales?: string[]
    experimentMethods?: string[]
    measurementTypes?: string[]
    trainingViews?: string[]
}

export interface SourceFileDTO {
    id: string
    filename: string
}

export interface RecordLiteratureDTO {
    id: number
    doi: string
    title: string
    authors?: string | null
    journal: string
    year?: number | null
}

export interface RecordResponse {
    id: number
    displayId?: string | null
    entityType?: 'candidate' | 'record' | string | null
    entityId?: number | string | null
    reviewEntityType?: 'candidate' | 'record' | string | null
    confidenceTier?: 'low' | 'medium' | 'high' | string | null
    admissionReason?: string | null
    missingFields?: string[] | null
    qualityNotes?: string | null
    recordOrigin?: string | null
    assemblyNotes?: string | null
    fieldEvidenceJson?: Record<string, FieldEvidenceEntry> | null
    materialName: string
    lubricant: string
    lubricantComponents?: LubricantComponent[] | null
    lubricantAlias?: string | null
    ionicLiquidDisplay?: string | null
    lubricantTooltip?: string | null
    cofValue: number | null
    cofOperator: string | null
    cofRaw: string | null
    cofExtracted?: CofExtracted | null
    loadValue: string | null
    loadRaw: string | null
    loadConditions?: LoadConditions | null
    speedValue: string | null
    speedConditions?: SpeedConditions | null
    shearRate: string | null
    temperature: string | null
    potential: string | null
    waterContent: string | null
    probeMaterial: string | null
    probeGeometry: string | null
    probeRadius: string | null
    probeRoughness: string | null
    substrateMaterial: string | null
    substrateCoating: string | null
    substrateRoughness: string | null
    tribopairLabel: string | null
    surfaceRoughness: string | null
    residualFilmThicknessD?: string | null
    layerSpacingDelta?: string | null
    filmThickness: string | null
    regime?: string | null
    tribologicalSystem?: TribologicalSystem | null
    experimentProfile?: ExperimentProfile | null
    experimentScale?: string | null
    experimentMethod?: string | null
    measurementType?: string | null
    trainingView?: string | null
    molRatio?: string | null
    cation?: string | null
    anion?: string | null
    cationSmiles?: string | null
    anionSmiles?: string | null
    ilSmiles?: string | null
    ilInchikey?: string | null
    alkylChainLength?: number | null
    confidence: number
    evidenceScore?: number | null
    evidenceGrade?: 'strong' | 'adequate' | 'weak' | 'missing' | string | null
    confidenceDetails?: {
        base_score?: number
        base_percent?: number
        score: number
        percent: number
        penalties: { reason: string, value: number }[]
        boosts?: { reason: string, value: number }[]
        penalty_total?: number
        penalty_percent?: number
        boost_total?: number
        boost_percent?: number
    }
    reviewStatus?: string | null
    extractedAt?: string | null
    literatureId: number
    literature: RecordLiteratureDTO | null
    // Evidence / Source Evidence fields
    evidence: string | null
    evidencePage: number | null
    evidenceBbox: string | null
    source: string | null
    sourcePage: number | null
    sourceFigure: string | null
}

export interface PaginatedRecordResponse {
    total: number
    skip: number
    limit: number
    items: RecordResponse[]
}

export interface RecordUpdatePayload {
    cofRaw?: string
    cofValue?: number
    temperature?: string
    potential?: string
    waterContent?: string
    probeMaterial?: string
    probeGeometry?: string
    probeRadius?: string
    probeRoughness?: string
    substrateMaterial?: string
    substrateCoating?: string
    substrateRoughness?: string
    speedValue?: string
    speedConditions?: SpeedConditions | null
    shearRate?: string
    loadValue?: string
    surfaceRoughness?: string
    filmThickness?: string
    materialName?: string
    lubricant?: string
    lubricantComponents?: LubricantComponent[]
    lubricantAlias?: string | null
    cofExtracted?: CofExtracted | null
    experimentScale?: string | null
    experimentMethod?: string | null
    measurementType?: string | null
}

export type ComparisonOperator = 'EQ' | 'LT' | 'GT' | 'LE' | 'GE'

// --- Literature Management API ---

export interface Literature {
    id: number
    doi: string
    title: string
    authors: string
    journal: string
    year: number
    groupId?: number | null
    workspaceId?: number | null
    createdByUserId?: number | null
    scopeType?: 'workspace' | 'group_library' | string | null
    status?: string | null
    errorMessage?: string | null
    submissionStatus?: SubmissionStatus | string | null
    submissionNote?: string | null
    submittedAt?: string | null
    submittedByUserId?: number | null
    reviewedAt?: string | null
    reviewedByUserId?: number | null
    reviewNote?: string | null
    promotedLiteratureId?: number | null
    recordCount?: number | null
    candidateCount?: number | null
    tribologyRecordCount?: number | null
    tribologyCandidateCount?: number | null
    diffusionRecordCount?: number | null
    diffusionCandidateCount?: number | null
    totalCount?: number | null
    hasPdf?: boolean | null
    volume?: string | null
    issue?: string | null
    pages?: string | null
    filePath?: string | null
    file_path?: string
    created_at: string
}

export type SubmissionStatus = 'draft' | 'submitted' | 'returned' | 'approved'

export interface CollaborationSubmissionItem extends Literature {
    scopeKey?: string | null
    workspaceName?: string | null
    ownerDisplayName?: string | null
    ownerUsername?: string | null
    submittedByDisplayName?: string | null
    reviewedByDisplayName?: string | null
    diffusionRecordCount?: number
    diffusionCandidateCount?: number
    tribologyRecordCount?: number
    tribologyCandidateCount?: number
    totalCount?: number
    createdAt?: string | null
}

export interface CollaborationSubmissionResponse {
    success: boolean
    literature: CollaborationSubmissionItem
    targetLiteratureId?: number | null
    copied?: {
        diffusion: number
        tribology: number
    }
    message: string
}

export interface ReprocessResult {
    success: boolean
    literatureId: number
    reprocessedCount: number
    message: string
    metadata?: LiteratureMetadata
    needsUpload?: boolean
    agent_workflow?: AgentWorkflow
}

export interface LiteratureMetadataBackfillResult {
    success: boolean
    literatureId: number
    updated: boolean
    updatedFields: string[]
    message: string
    source?: string
    metadata?: Literature
}

export interface LiteratureDoiImportRequest {
    dois: string[]
    batchName?: string
    extractorType?: ExtractorType
}

export interface LiteratureDoiImportItem {
    input: string
    doi?: string | null
    status: 'imported' | 'existing' | 'duplicate' | 'failed' | string
    message: string
    literature?: Literature | null
    metadataSource?: string | null
}

export interface LiteratureDoiImportResponse {
    batchId: string
    batchName: string
    extractorType: ExtractorType | string
    total: number
    created: number
    existing: number
    failed: number
    items: LiteratureDoiImportItem[]
}

export type LiteratureListOptions = {
    scope?: 'active' | 'group_library' | 'all_visible'
}

// Get all literature list
export async function listLiterature(skip: number = 0, limit: number = 100, options: LiteratureListOptions = {}) {
    const headers = options.scope === 'group_library'
        ? { 'X-Scope-Type': 'group_library' }
        : undefined
    const response = await api.get('/api/sync/literature', {
        params: { skip, limit, ...scopeParams(options) },
        headers,
    })
    return response.data as Literature[]
}

export async function importLiteratureByDoi(payload: LiteratureDoiImportRequest) {
    const response = await api.post('/api/sync/literature/doi-import', payload)
    return response.data as LiteratureDoiImportResponse
}

// Get literature details (including historical extraction records)
export async function getLiteratureDetails(literatureId: number) {
    const response = await api.get(`/api/sync/literature/${literatureId}`)
    return response.data as LiteratureWithRecords
}

export async function submitLiteratureForApproval(literatureId: number, note?: string) {
    const response = await api.post(`/api/collaboration/literature/${literatureId}/submit`, { note: note || null })
    return response.data as CollaborationSubmissionResponse
}

export async function publishLiteratureToGroupLibrary(literatureId: number, note?: string) {
    const response = await api.post(`/api/collaboration/literature/${literatureId}/publish`, { note: note || null })
    return response.data as CollaborationSubmissionResponse
}

export async function listCollaborationSubmissions() {
    const response = await api.get('/api/collaboration/submissions')
    return response.data as { items: CollaborationSubmissionItem[] }
}

export async function approveCollaborationSubmission(literatureId: number, note?: string) {
    const response = await api.post(`/api/collaboration/submissions/${literatureId}/approve`, { note: note || null })
    return response.data as CollaborationSubmissionResponse
}

export async function returnCollaborationSubmission(literatureId: number, note?: string) {
    const response = await api.post(`/api/collaboration/submissions/${literatureId}/return`, { note: note || null })
    return response.data as CollaborationSubmissionResponse
}

// Re-extract literature data
export async function reprocessLiterature(literatureId: number) {
    const response = await api.post(`/api/sync/literature/${literatureId}/reprocess`)
    return response.data as ReprocessResult
}

export async function backfillLiteratureMetadata(literatureId: number, force: boolean = false) {
    const response = await api.post(`/api/sync/literature/${literatureId}/metadata/backfill`, null, {
        params: { force }
    })
    return response.data as LiteratureMetadataBackfillResult
}

export async function getAgentStatus(): Promise<AgentStatusResponse> {
    const response = await api.get('/api/agents/status')
    return response.data
}

export async function getUsageMetrics(): Promise<UsageMetricsResponse> {
    const response = await api.get('/api/agents/usage')
    return response.data
}

export async function getDashboardStats() {
    const response = await api.get('/api/records/stats')
    return response.data as {
        total_records: number
        literature_count: number
        distinct_il_count: number
        cof_stats: { min: number | null, max: number | null, avg: number | null }
        confidence_stats?: {
            avg: number | null
            avg_percent: number | null
            min_percent: number | null
            max_percent: number | null
            count: number
            breakdown?: Record<string, {
                count: number
                share_percent: number
                avg: number | null
                avg_percent: number | null
            }>
        }
        materials_ratio: Array<{ name: string, count: number }>
        top_liquids: Array<{ name: string, count: number }>
        publication_trend: Array<{ year: number, count: number }>
        top_journals: Array<{ name: string, count: number }>
        cof_ranges: Array<{ name: string, min: number, max: number }>
    }
}

export type QualityAssetTone = 'emerald' | 'sky' | 'amber' | 'rose' | 'slate'

export interface QualityAssetMetric {
    key: string
    label: string
    numerator: number
    denominator: number
    rate: number | null
    detail: string
    formula: string
    tone: QualityAssetTone
}

export interface QualityAssetSummaryStats {
    literatureCount: number
    recordCount: number
    activeRecordCount: number
    coreFieldCount: number
    coreFieldSlots: number
    missingFieldSlots: number
    missingFieldRate: number | null
    unitIssueCount: number
    unitFieldSlots: number
    unitIssueRate: number | null
    duplicateDoiGroups: number
    duplicateDoiExcess: number
    duplicateDoiLiteratureCount: number
    doiLiteratureCount: number
    cofOutlierCount: number
    cofValueCount: number
    missingEvidenceCount: number
    missingEvidenceRate: number | null
    pageEvidenceCount: number
    figureEvidenceCount: number
    textEvidenceCount: number
    fieldEvidenceRecordCount: number
    fieldEvidenceCoveredSlots: number
    fieldEvidenceSlots: number
    trainableSampleCount: number
    trainableSampleRate: number | null
    reviewedCount: number
    unreviewedCount: number
    reviewedRate: number | null
}

export interface QualityFieldCategoryRow {
    category: string
    filled: number
    missing: number
    denominator: number
    rate: number | null
    fields: string
}

export interface QualityUnitIssues {
    fieldBreakdown: Array<{ key: string, label: string, issues: number, denominator: number, rate: number | null }>
    examples: Array<{ recordId: number, literatureId: number, field: string, value: string, title: string, scale?: string, scaleLabel?: string }>
}

export interface QualityTrainingReadiness {
    state: 'empty' | 'blocked' | 'limited' | 'needs_review' | 'ready' | string
    tone: QualityAssetTone
    label: string
    detail: string
    minimumSampleTarget: number
}

export interface QualityReplenishmentAction {
    key: string
    label: string
    count: number
    detail: string
    tone: QualityAssetTone
}

export interface QualityReplenishmentRecord {
    recordId: number
    literatureId: number
    title: string
    doi?: string
    lubricant?: string
    tribopair?: string
    cofValue?: number | null
    reviewStatus?: string
    scale?: string
    scaleLabel?: string
    reason: string
}

export interface QualityReplenishmentLiterature {
    literatureId: number
    title: string
    doi?: string
    recordCount: number
    trainableCount: number
}

export interface QualityTrainingReplenishment {
    currentTrainableCount: number
    minimumSampleTarget: number
    sampleGap: number
    sourceLiteratureCount: number
    sourceLiteratureTarget: number
    sourceLiteratureGap: number
    recommendedAction: string
    actionItems: QualityReplenishmentAction[]
    recordGroups: Record<string, QualityReplenishmentRecord[]>
    sourceLiterature: QualityReplenishmentLiterature[]
    unknownMacroCandidates: QualityReplenishmentRecord[]
}

export interface QualityAssetSlice {
    key: string
    label: string
    trainingView?: string
    summary: QualityAssetSummaryStats
    metrics: QualityAssetMetric[]
    fieldCategories: QualityFieldCategoryRow[]
    unitIssues: QualityUnitIssues
    doiDuplicates: Array<{ doi: string, count: number, literatureIds: number[], titles: string[] }>
    cofOutliers: Array<{ recordId: number, literatureId: number, title: string, cofValue: number, reason: string, scale?: string, scaleLabel?: string }>
    evidence: { missingRecordIds: number[] }
    training: {
        trainableRecordIds: number[]
        blockers: {
            missingTarget: number
            missingLubricant: number
            missingTribopair: number
            missingCondition: number
        }
        readiness?: QualityTrainingReadiness
        replenishment?: QualityTrainingReplenishment
    }
    review: {
        statuses: Array<{ status: string, count: number }>
    }
}

export interface QualityAssetSummary {
    generatedAt: string
    scope: Record<string, unknown>
    summary: QualityAssetSummaryStats
    metrics: QualityAssetMetric[]
    fieldCategories: QualityFieldCategoryRow[]
    unitIssues: QualityUnitIssues
    doiDuplicates: Array<{ doi: string, count: number, literatureIds: number[], titles: string[] }>
    cofOutliers: Array<{ recordId: number, literatureId: number, title: string, cofValue: number, reason: string, scale?: string, scaleLabel?: string }>
    evidence: { missingRecordIds: number[] }
    training: {
        trainableRecordIds: number[]
        blockers: {
            missingTarget: number
            missingLubricant: number
            missingTribopair: number
            missingCondition: number
        }
        readiness?: QualityTrainingReadiness
        replenishment?: QualityTrainingReplenishment
    }
    review: {
        statuses: Array<{ status: string, count: number }>
    }
    scaleBreakdown?: QualityAssetSlice[]
}

export async function getQualityAssetSummary() {
    const response = await api.get('/api/records/quality-assets')
    return response.data as QualityAssetSummary
}

export interface PatternDiscoverySummary {
    recordCount: number
    cofRecordCount: number
    literatureCount: number
    distinctLubricantCount: number
    count?: number
    minCof: number | null
    maxCof: number | null
    avgCof: number | null
    meanCof?: number | null
    medianCof: number | null
    q1Cof?: number | null
    q3Cof?: number | null
    iqrCof?: number | null
}

export interface PatternDiscoverySeriesItem {
    name: string
    count: number
    sharePercent?: number
    avgCof?: number | null
    meanCof?: number | null
    medianCof?: number | null
    q1Cof?: number | null
    q3Cof?: number | null
    iqrCof?: number | null
    minCof?: number | null
    maxCof?: number | null
}

export interface PatternDiscoveryYearItem {
    year: number
    recordCount: number
    literatureCount: number
    avgCof: number | null
    medianCof?: number | null
    q1Cof?: number | null
    q3Cof?: number | null
}

export interface PatternDiscoveryChainItem {
    chainLength: number
    count: number
    avgCof: number | null
    medianCof?: number | null
    q1Cof?: number | null
    q3Cof?: number | null
    minCof: number | null
    maxCof: number | null
}

export interface PatternDiscoveryPotentialItem {
    potential: string
    potentialValue: number
    count: number
    avgCof: number | null
    medianCof?: number | null
    q1Cof?: number | null
    q3Cof?: number | null
    minCof: number | null
    maxCof: number | null
}

export interface PatternDiscoveryCharts {
    cofBuckets: PatternDiscoverySeriesItem[]
    yearlyTrend: PatternDiscoveryYearItem[]
    topMaterials: PatternDiscoverySeriesItem[]
    lowFrictionMaterials: PatternDiscoverySeriesItem[]
    highFrictionMaterials: PatternDiscoverySeriesItem[]
    topLubricants: PatternDiscoverySeriesItem[]
    lowFrictionLubricants: PatternDiscoverySeriesItem[]
    cations: PatternDiscoverySeriesItem[]
    anions: PatternDiscoverySeriesItem[]
    lowFrictionAnions?: PatternDiscoverySeriesItem[]
    chainLength: PatternDiscoveryChainItem[]
    potential: {
        byPotential: PatternDiscoveryPotentialItem[]
        byPolarity: PatternDiscoverySeriesItem[]
    }
    reviewStatus: PatternDiscoverySeriesItem[]
    fieldCoverage?: PatternDiscoverySeriesItem[]
}

export interface PatternDiscoveryInsight {
    title: string
    claim: string
    evidence: string
    interpretation?: string
    limitation?: string
    thesisUse: string
}

export interface PatternDiscoveryMethodology {
    outcome: string
    stratification: string
    robustStatistic: string
    minimumGroupSize: string
    caveat: string
}

export interface PatternDiscoveryResponse {
    generatedAt: string
    scope: Record<string, unknown>
    methodology?: PatternDiscoveryMethodology
    summary: PatternDiscoverySummary
    charts: PatternDiscoveryCharts
    insights: PatternDiscoveryInsight[]
    markdown: string
}

export interface PatternDiscoveryReportSaveResponse {
    saved: boolean
    path: string
    relativePath: string
    markdown: string
    savedAt: string
}

export async function getPatternDiscovery(): Promise<PatternDiscoveryResponse> {
    const response = await api.get('/api/records/pattern-discovery')
    return response.data
}

export async function savePatternDiscoveryReport(): Promise<PatternDiscoveryReportSaveResponse> {
    const response = await api.post('/api/records/pattern-discovery/report')
    return response.data
}

export interface MentorProgressStage {
    key: string
    label: string
    total: number
    delta_count: number
    last_updated_at: string | null
    description: string
}

export interface MentorProgressDelta {
    key: string
    label: string
    baseline_label: string
    current_label: string
    baseline_value: number
    current_value: number
    change_value: number
    unit: string
    trend: 'up' | 'down' | 'flat' | string
    description: string
}

export interface MentorTimelineItem {
    id: string
    kind: string
    title: string
    detail: string
    timestamp: string | null
    resource_type: string
    resource_id?: number | null
    literature_id?: number | null
    dataset_id?: number | null
}

export interface MentorQuickLink {
    label: string
    detail: string
    view: string
    literature_id?: number
    record_id?: number
    dataset_id?: number
    kind?: string
}

export interface MentorLatestReadyDataset {
    id: number
    name: string
    usable_records: number
    feature_dimensions: number
    created_at: string | null
}

export interface MentorProgressResponse {
    window_days: number
    progress_overview: {
        stages: MentorProgressStage[]
    }
    progress_deltas: {
        dashboard: MentorProgressDelta[]
    }
    timeline: MentorTimelineItem[]
    quick_links: {
        latest_processed_paper: MentorQuickLink | null
        latest_verified_record: MentorQuickLink | null
        latest_output: MentorQuickLink | null
    }
    latest_ready_dataset: MentorLatestReadyDataset | null
    cleaning_summary: ModelTrainingCleaningSummary | null
}

export async function getMentorProgress() {
    const response = await api.get('/api/mentor/progress')
    return response.data as MentorProgressResponse
}

export interface ModelTrainingAlgorithmOption {
    key: string
    label: string
    description: string
}

export interface ModelTrainingMetricPoint {
    round: number
    progress: number
    train_r2: number
    val_r2: number
    train_rmse: number
    val_rmse: number
    train_mae: number
    val_mae: number
}

export interface ModelTrainingFeatureImportance {
    feature: string
    importance: number
}

export interface ModelTrainingPredictionPoint {
    matrix_index?: number
    row_index: number
    record_id?: number | null
    literature_id?: number | null
    confidence?: number | null
    cation?: string | null
    friction_bin?: number | null
    joint_stratum?: string | null
    actual: number
    predicted: number
    residual: number
    abs_residual: number
}

export interface ModelTrainingExternalDiagnosticReason {
    kind: string
    label: string
    detail: string
}

export interface ModelTrainingExternalDiagnosticFeature {
    feature: string
    label: string
    value: number
    train_min: number
    train_max: number
    direction: 'below' | 'above' | string
}

export interface ModelTrainingExternalDiagnosticItem extends ModelTrainingPredictionPoint {
    severity: 'low' | 'medium' | 'high' | string
    bin_label?: string | null
    training_context?: {
        cation_train_count?: number
        bin_train_count?: number
        stratum_train_count?: number
    }
    reasons: ModelTrainingExternalDiagnosticReason[]
    out_of_range_features?: ModelTrainingExternalDiagnosticFeature[]
    suggestions?: string[]
}

export interface ModelTrainingExternalDiagnostics {
    summary: {
        sample_count: number
        high_residual_count?: number
        unseen_strata_count?: number
        out_of_range_count?: number
        sparse_cation_count?: number
    }
    items: ModelTrainingExternalDiagnosticItem[]
}

export interface ModelTrainingSegmentSummary {
    thresholds?: Record<string, number | null>
    counts?: Record<string, number>
    base_models?: string[]
    meta_model?: string | null
    min_segment_size?: number
    prediction_mode?: string
    blend_weights?: Record<string, number> | null
    local_blend?: number
}

export interface ModelTrainingInsights {
    feature_importance?: ModelTrainingFeatureImportance[]
    prediction_samples?: ModelTrainingPredictionPoint[]
    largest_residuals?: ModelTrainingPredictionPoint[]
    test_samples?: ModelTrainingPredictionPoint[]
    external_samples?: ModelTrainingPredictionPoint[]
    external_metrics?: ModelTrainingExternalMetrics | null
    external_diagnostics?: ModelTrainingExternalDiagnostics | null
    segment_summary?: ModelTrainingSegmentSummary | null
    experiment_report?: ModelTrainingExperimentReport | null
}

export interface ModelTrainingTestMetrics {
    test_r2: number | null
    test_rmse: number
    test_mae: number
    sample_count: number
}

export interface ModelTrainingExternalMetrics {
    external_r2: number | null
    external_rmse: number
    external_mae: number
    sample_count: number
}

export interface ModelTrainingExperimentMetric {
    label: string
    sample_count: number
    r2: number | null
    rmse: number | null
    mae: number | null
}

export interface ModelTrainingExperimentRisk {
    severity: 'low' | 'medium' | 'high'
    title: string
    message: string
}

export interface ModelTrainingExperimentReport {
    generated_at: string
    task_id: string
    algorithm: string
    target: {
        key?: string
        label?: string
        column?: string
    }
    metrics: {
        training: ModelTrainingExperimentMetric
        validation: ModelTrainingExperimentMetric
        test?: ModelTrainingExperimentMetric | null
        external?: ModelTrainingExperimentMetric | null
    }
    split: {
        strategy?: string | null
        label?: string | null
        random_seed: number
        cv_folds?: number | null
        train_pool_size?: number | null
        test_size?: number | null
        external_size?: number | null
        target_bin_count?: number | null
        strata_count?: number | null
        singleton_strata?: number | null
        folds?: Array<{
            label: string
            train_size: number
            validation_size: number
            metrics?: {
                train_r2?: number
                val_r2?: number
                train_rmse?: number
                val_rmse?: number
                train_mae?: number
                val_mae?: number
            }
        }>
    }
    hyperparameters: Record<string, unknown>
    target_noise?: ModelTrainingTargetNoiseDiagnostics | null
    feature_importance_top: ModelTrainingFeatureImportance[]
    residual_top: Array<ModelTrainingPredictionPoint & { source: 'val' | 'test' | 'external' }>
    external_diagnostics?: ModelTrainingExternalDiagnostics | null
    segment_summary?: ModelTrainingSegmentSummary | null
    risks: ModelTrainingExperimentRisk[]
    warnings: string[]
}

export interface ModelTrainingSplitSubsetSummary {
    key?: string
    label?: string
    count: number
    cation_count: number
    strata_count: number
    bin_count: number
    target_min?: number | null
    target_max?: number | null
}

export interface ModelTrainingSplitBinSummary {
    bin: number
    label: string
    total?: number
    train_pool?: number
    test?: number
    external?: number
    count?: number
}

export interface ModelTrainingSplitStratumSummary {
    stratum: string
    cation: string
    friction_bin: number
    bin_label: string
    total?: number
    train_pool?: number
    test?: number
    external?: number
    count?: number
}

export interface ModelTrainingSplitFoldDetail {
    index: number
    label: string
    train: ModelTrainingSplitSubsetSummary
    validation: ModelTrainingSplitSubsetSummary
    validation_bins: ModelTrainingSplitBinSummary[]
    validation_strata: ModelTrainingSplitStratumSummary[]
}

export interface ModelTrainingSplitDetails {
    subsets: ModelTrainingSplitSubsetSummary[]
    target_bins: ModelTrainingSplitBinSummary[]
    strata: ModelTrainingSplitStratumSummary[]
    strata_total: number
    strata_truncated: boolean
    folds: ModelTrainingSplitFoldDetail[]
}

export interface ModelTrainingSourceScope {
    requested_mode: string
    resolved_scope_key: string
    resolved_scope_type: string
    label: string
    used_fallback: boolean
}

export interface ModelCleaningFeatureConfig {
    use_pca: boolean
    n_components: number
    keep_features: string[]
}

export interface ModelCleaningPcaInfo {
    enabled: boolean
    requested_components: number
    actual_components: number
    explained_variance_ratio: number | null
}

export interface ModelTrainingCleaningSummary {
    source_mode: string
    training_view?: string
    raw_records: number
    view_ready_records?: number
    target_ready_records: number
    chemistry_ready_records: number
    training_ready_records: number
    missing_value_repairs?: Record<string, number>
    outliers_detected?: number
    outliers_removed?: number
    final_feature_count?: number
    final_feature_columns?: string[]
    smiles_screening?: {
        rdkit_available: boolean
        require_dual_smiles: boolean
        require_valid_smiles: boolean
        input_records: number
        dual_smiles_records: number
        descriptor_ready_records: number
        missing_cation_smiles: number
        missing_anion_smiles: number
        invalid_cation_smiles: number
        invalid_anion_smiles: number
        invalid_smiles_records: number
        unique_cations: number
        unique_anions: number
        canonicalized_cations: number
        canonicalized_anions: number
    }
    dropped_by_reason: {
        missing_target: number
        missing_cation_smiles: number
        missing_anion_smiles: number
        invalid_cation_smiles?: number
        invalid_anion_smiles?: number
        outside_training_view?: number
    }
    quality_gates?: {
        pending_review_records?: number
        blocked_review_records?: number
        missing_evidence_records?: number
        low_confidence_records?: number
        mixture_ratio_gaps?: number
        structured_condition_gaps?: number
        condition_collision_groups?: number
        condition_collision_records?: number
        feature_gaps?: Record<string, number>
    }
    rules: {
        training_view?: string
        drop_missing_target: boolean
        require_dual_smiles: boolean
        require_valid_smiles?: boolean
        missing_value_strategy?: string
        remove_target_outliers?: boolean
        iqr_multiplier?: number
        feature_config?: ModelCleaningFeatureConfig
    }
}

export interface ModelTrainingDatasetSummary {
    id?: number | null
    name?: string | null
    description?: string | null
    total_records: number
    cleaned_records: number
    usable_records: number
    test_size?: number
    external_size?: number
    pool_size?: number
    feature_dimensions: number
    target_column: string
    feature_columns: string[]
    columns: string[]
    rdkit_enabled: boolean
    target_outliers?: ModelTrainingTargetOutlierSummary | null
    source_scope: ModelTrainingSourceScope
    target_noise?: ModelTrainingTargetNoiseDiagnostics | null
    target?: {
        key: string
        label: string
        column?: string
    }
    split?: {
        strategy: string
        label: string
        cv_folds?: number | null
        train_pool_size?: number
        test_size?: number
        external_size?: number
        target_bin_edges?: number[]
        target_bin_count?: number
        strata_count?: number
        singleton_strata?: number
        cation_count?: number
        missing_cation_count?: number
        details?: ModelTrainingSplitDetails | null
    }
}

export interface ModelTrainingTargetNoiseGroup {
    key: string
    label: string
    count: number
    mean: number
    std: number
    range: number
    relative_range: number
    is_conflict: boolean
    values: number[]
    row_indices?: number[]
    record_ids?: Array<number | string>
}

export interface ModelTrainingTargetNoiseDiagnostics {
    sample_count: number
    unique_condition_groups: number
    duplicate_condition_groups: number
    duplicate_condition_records: number
    conflict_groups: number
    conflict_records: number
    max_target_range: number
    max_target_std: number
    within_condition_rmse: number
    estimated_r2_ceiling?: number | null
    recommended_strategy: 'raw' | 'mean_by_condition' | 'drop_conflicts' | string
    strategy_applied?: 'raw' | 'mean_by_condition' | 'drop_conflicts' | string
    rows_before_aggregation?: number
    rows_after_aggregation?: number
    rows_removed_by_strategy?: number
    groups_merged_by_strategy?: number
    conflict_threshold?: {
        absolute_range: number
        relative_range: number
    }
    top_groups: ModelTrainingTargetNoiseGroup[]
}

export interface ModelTrainingTargetOutlierSummary {
    strategy: 'off' | 'physical' | 'robust_iqr' | string
    enabled: boolean
    rows_before: number
    rows_after: number
    rows_removed: number
    bounds: {
        lower?: number | null
        upper?: number | null
    }
    iqr?: {
        q1: number
        q3: number
        iqr: number
        multiplier: number
    } | null
    removed_records?: Array<{
        row_index?: number | null
        record_id?: number | string | null
        literature_id?: number | string | null
        target: number
        reasons: string[]
    }>
}

export interface ModelTrainingTaskSnapshot {
    task_id: string
    status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
    status_message: string
    error: string | null
    created_at: string
    started_at: string | null
    finished_at: string | null
    total_rounds: number
    current_round: number
    current: ModelTrainingMetricPoint | null
    dataset: {
        total_records: number
        cleaned_records: number
        usable_records: number
        dropped_records: number
        train_size: number
        validation_size: number
        test_size?: number
        external_size?: number
        pool_size?: number
        feature_dimensions: number
        selected_feature_count: number
        target: {
            key: string
            label: string
        }
        filters: {
            min_confidence: number
            max_records: number | null
            validation_split: number
            training_view?: string
        }
        cleaning?: ModelTrainingCleaningSummary
        split?: {
            strategy: string
            label: string
            cv_folds?: number | null
            train_pool_size?: number
            test_size?: number
            external_size?: number
            target_bin_edges?: number[]
            target_bin_count?: number
            strata_count?: number
            singleton_strata?: number
            cation_count?: number
            missing_cation_count?: number
            details?: ModelTrainingSplitDetails | null
        }
        source_scope?: ModelTrainingSourceScope
        target_column?: string
        feature_columns?: string[]
        columns?: string[]
        pca_info?: ModelCleaningPcaInfo | null
        target_noise?: ModelTrainingTargetNoiseDiagnostics | null
        target_outliers?: ModelTrainingTargetOutlierSummary | null
    }
    warnings: string[]
    feature_blocks: Array<{
        key: string
        label: string
        dimensions: number
        features?: string[]
    }>
    config: {
        target: string
        algorithm: string
        hyperparameters: ModelTrainingHyperparameters
        data_options: ModelTrainingDataOptions
        cleaned_dataset_id?: number | null
    }
    history: ModelTrainingMetricPoint[]
    insights?: ModelTrainingInsights
    tune_progress?: ModelTrainingTuneProgress | null
    test_metrics?: ModelTrainingTestMetrics | null
}

export interface ModelTrainingPlanPreview {
    dataset: ModelTrainingTaskSnapshot['dataset']
    feature_blocks: ModelTrainingTaskSnapshot['feature_blocks']
    warnings: string[]
    split_plan: Array<{
        label: string
        train_size: number
        validation_size: number
    }>
}

export interface ModelTrainingRunListItem {
    task_id: string
    run_id?: number
    status: 'completed' | 'failed' | 'cancelled' | string
    algorithm: string
    split_strategy?: string | null
    created_at?: string | null
    started_at?: string | null
    finished_at?: string | null
    usable_records: number
    cleaned_dataset_id?: number | null
    cleaned_dataset_name?: string | null
    target_column?: string | null
    training_view?: string | null
    val_r2?: number | null
    val_rmse?: number | null
    val_mae?: number | null
    test_r2?: number | null
    test_rmse?: number | null
    test_mae?: number | null
    feature_dimensions?: number | null
    is_registered?: boolean
    registered_model_id?: number | null
    registered_model_name?: string | null
    registered_model_training_view?: string | null
    is_recommended?: boolean
}

export interface RegisteredModelListItem {
    id: number
    name: string
    description?: string | null
    is_recommended: boolean
    training_view?: string | null
    created_at?: string | null
    algorithm: string
    split_strategy?: string | null
    task_id: string
    source_dataset_id?: number | null
    source_dataset_name?: string | null
    val_r2?: number | null
    val_rmse?: number | null
    val_mae?: number | null
    test_r2?: number | null
    test_rmse?: number | null
    test_mae?: number | null
    external_r2?: number | null
    external_rmse?: number | null
    external_mae?: number | null
    feature_dimensions?: number | null
    usable_records?: number | null
    risk_count?: number
}

export interface ModelTrainingSummary {
    dataset: ModelTrainingDatasetSummary
    cleaning: ModelTrainingCleaningSummary
    algorithms: ModelTrainingAlgorithmOption[]
    split_options?: ModelTrainingSplitStrategyOption[]
    pca_info: ModelCleaningPcaInfo | null
    defaults: {
        target: string
        algorithm: string
        hyperparameters: ModelTrainingHyperparameters
        data_options: ModelTrainingDataOptions
        cleaned_dataset_id?: number | null
    }
}

export interface ModelTrainingHyperparameters {
    [key: string]: unknown
    n_estimators: number
    learning_rate: number
    max_depth: number
    l2_leaf_reg: number
    random_strength: number
}

export interface ModelTrainingDataOptions {
    validation_split: number
    training_view?: 'all' | 'macro_performance' | 'afm_surface_response' | 'cross_scale'
    min_confidence: number
    max_records: number | null
    random_seed: number
    split_strategy?: string
    cv_folds?: number
    reserve_external_validation?: boolean
    feature_columns?: string[] | null
    feature_subset_key?: string | null
    feature_subset_label?: string | null
    target_aggregation_strategy?: 'raw' | 'mean_by_condition' | 'drop_conflicts' | string
    target_outlier_strategy?: 'off' | 'physical' | 'robust_iqr' | string
    target_outlier_iqr_multiplier?: number
    target_outlier_min?: number | null
    target_outlier_max?: number | null
}

export interface ModelTrainingSplitStrategyOption {
    key: string
    label: string
    description: string
}

export interface ModelTrainingCleaningOptions {
    source_mode: 'current_scope' | 'group_library' | 'group_library_fallback'
    training_view?: 'all' | 'macro_performance' | 'afm_surface_response' | 'cross_scale'
    drop_missing_target: boolean
    require_dual_smiles: boolean
}

export interface ModelTrainingStartPayload {
    target: string
    algorithm: string
    hyperparameters: ModelTrainingHyperparameters
    data_options: ModelTrainingDataOptions
    cleaned_dataset_id?: number | null
    tune?: boolean
}

export interface ModelTrainingTuneProgress {
    active: boolean
    searched: number
    total: number
    best_score?: number | null
    best_params?: Record<string, unknown> | null
    algorithm?: string
    skipped?: boolean
    reason?: string
    all_results?: Array<{ params: Record<string, unknown>; score: number }>
}

export async function getModelTrainingSummary(cleanedDatasetId?: number | null) {
    const suffix = cleanedDatasetId ? `?cleaned_dataset_id=${cleanedDatasetId}` : ''
    const response = await api.get(`/api/model-training/summary${suffix}`)
    return response.data as ModelTrainingSummary
}

export async function getModelTrainingCleaningSummary(payload: ModelTrainingCleaningOptions) {
    const response = await api.post('/api/model-training/cleaning/summary', payload)
    return response.data as ModelTrainingSummary
}

export async function previewModelTrainingPlan(payload: ModelTrainingStartPayload) {
    const response = await api.post('/api/model-training/preview', payload)
    return response.data as ModelTrainingPlanPreview
}

export async function listModelTrainingRuns(limit: number = 20) {
    const response = await api.get(`/api/model-training/runs?limit=${encodeURIComponent(String(limit))}`)
    return response.data as { items: ModelTrainingRunListItem[] }
}

export async function getModelTrainingRun(taskId: string) {
    const response = await api.get(`/api/model-training/runs/${taskId}`)
    return response.data as { task: ModelTrainingTaskSnapshot }
}

export async function registerModelTrainingRun(taskId: string, payload: { name?: string | null; description?: string | null; is_recommended?: boolean }) {
    const response = await api.post(`/api/model-training/runs/${taskId}/register`, payload)
    return response.data as { model: RegisteredModelListItem }
}

export async function listRegisteredModels() {
    const response = await api.get('/api/model-training/registry')
    return response.data as { items: RegisteredModelListItem[] }
}

export async function deleteRegisteredModel(registryId: number) {
    const response = await api.delete(`/api/model-training/registry/${registryId}`)
    return response.data as { ok: boolean }
}

export async function setRecommendedRegisteredModel(registryId: number, recommended: boolean = true) {
    const response = await api.post(`/api/model-training/registry/${registryId}/recommend?recommended=${encodeURIComponent(String(recommended))}`)
    return response.data as { model: RegisteredModelListItem }
}

export interface RegisteredModelPredictionResult {
    prediction_run_id?: number
    registry_id: number
    registered_model_name: string
    training_view?: string | null
    created_at?: string | null
    source_dataset: {
        id?: number | null
        name?: string | null
    }
    target_dataset: {
        id?: number | null
        name?: string | null
        input_row_count?: number
        row_count: number
        dropped_outside_training_view?: number
    }
    feature_columns: string[]
    summary: {
        predicted_rows: number
        scored_rows: number
        feature_dimensions: number
        dropped_outside_training_view?: number
        r2?: number | null
        rmse?: number | null
        mae?: number | null
    }
    preview_rows: Array<{
        row_index: number
        record_id?: number | null
        literature_id?: number | null
        confidence?: number | null
        actual?: number | null
        predicted?: number | null
        residual?: number | null
    }>
}

export interface ModelPredictionRunListItem {
    id: number
    registered_model_id?: number | null
    registered_model_name: string
    training_view?: string | null
    status: string
    created_at?: string | null
    source_dataset_id?: number | null
    source_dataset_name?: string | null
    target_dataset_id?: number | null
    target_dataset_name?: string | null
    target_input_rows: number
    target_predicted_rows: number
    dropped_outside_training_view: number
    scored_rows: number
    feature_dimensions: number
    r2?: number | null
    rmse?: number | null
    mae?: number | null
    preview_rows?: RegisteredModelPredictionResult['preview_rows']
}

export async function predictWithRegisteredModel(registryId: number, cleanedDatasetId: number) {
    const response = await api.post(`/api/model-training/registry/${registryId}/predict`, {
        cleaned_dataset_id: cleanedDatasetId,
    })
    return response.data as { prediction: RegisteredModelPredictionResult }
}

export async function listModelPredictionRuns(limit: number = 20) {
    const response = await api.get(`/api/model-training/predictions?limit=${encodeURIComponent(String(limit))}`)
    return response.data as { items: ModelPredictionRunListItem[] }
}

export interface ModelCleaningOptions {
    source_mode: 'current_scope' | 'group_library' | 'group_library_fallback'
    training_view: 'all' | 'macro_performance' | 'afm_surface_response' | 'cross_scale'
    drop_missing_target: boolean
    require_dual_smiles: boolean
    require_valid_smiles: boolean
    missing_value_strategy: 'keep' | 'median' | 'zero'
    remove_target_outliers: boolean
    iqr_multiplier: number
    feature_config: ModelCleaningFeatureConfig
}

export type ModelCleaningMatrixRow = Record<string, number | string | null>

export interface ModelCleaningPreview {
    target: {
        key: string
        label: string
        column_name?: string
    }
    options: ModelCleaningOptions
    source_scope: ModelTrainingSourceScope
    summary: ModelTrainingCleaningSummary
    feature_coverage: Array<{
        key: string
        label: string
        group: string
        available_count: number
        coverage: number
    }>
    pca_info: ModelCleaningPcaInfo | null
    matrix_columns: string[]
    feature_columns: string[]
    target_column: string
    rows: ModelCleaningMatrixRow[]
    preview_rows: ModelCleaningMatrixRow[]
    normalization_preview: ModelCleaningMatrixRow[]
    dataset_builder?: {
        target_column: string
        descriptor_columns: string[]
        macro_columns: string[]
        rows: number
        descriptor_generation: {
            input_rows: number
            usable_rows: number
            descriptor_count: number
            macro_feature_count: number
            fingerprint_bits_per_ion: number
            total_fingerprint_bits: number
            descriptor_blocks: Array<{
                label: string
                count: number
            }>
            macro_features: Array<{
                key: string
                label: string
                column_name: string
                group: string
                available_count: number
                coverage: number
            }>
            surface_descriptor_source?: {
                source: string
                note?: string
                input_rows: number
                matched_rows: number
                coverage: number
                matched_surfaces: Array<{
                    key: string
                    label: string
                    count: number
                }>
                unmatched_examples: string[]
            }
            rdkit_enabled: boolean
        }
        screening: {
            feature_count: number
            analyzable_rows: number
            target_label: string
            heatmap: {
                features: string[]
                matrix: Array<Array<number | null>>
                cells: Array<{
                    x: number
                    y: number
                    value: number | null
                }>
            }
            strongest_to_target: Array<{
                feature: string
                correlation: number
                abs_correlation: number
            }>
            feature_importance?: {
                available: boolean
                method: string
                reason?: string | null
                features: Array<{
                    feature: string
                    importance: number
                    rank: number
                }>
            }
            ionic_collinearity_groups: Array<{
                label: string
                features: string[]
                size: number
                max_abs_correlation: number
            }>
            surface_bias_alerts: Array<{
                features: string[]
                correlation: number
                message: string
            }>
            nonlinear_recommendation: {
                recommended: boolean
                reason: string
                algorithms: string[]
            }
            requires_surface_stratified_split: boolean
        }
        subsets: {
            dataset_a: {
                name: string
                description: string
                target_column: string
                columns: string[]
                rows: ModelCleaningMatrixRow[]
                row_count: number
                feature_count: number
                preview_rows: ModelCleaningMatrixRow[]
            }
            dataset_b: {
                name: string
                description: string
                target_column: string
                columns: string[]
                rows: ModelCleaningMatrixRow[]
                row_count: number
                feature_count: number
                preview_rows: ModelCleaningMatrixRow[]
            }
        }
    }
}

export interface SavedCleanedDatasetSummary {
    id: number
    name: string
    description: string | null
    target_key: string
    row_count: number
    created_at: string | null
    source_scope: ModelTrainingSourceScope
    summary: ModelCleaningPreview['summary']
    feature_coverage: ModelCleaningPreview['feature_coverage']
    pca_info: ModelCleaningPcaInfo | null
    matrix_columns: string[]
    feature_columns: string[]
    target_column: string
    target: {
        key: string
        label: string
    }
    dataset_kind?: string
    import_metadata?: {
        filename?: string
        wff_dataset_key?: string
        thesis_fixed_split?: boolean
        thesis_split_counts?: Record<string, number>
        original_columns?: string[]
        identifier_columns?: string[]
        feature_columns?: string[]
        row_count?: number
    } | null
}

export interface SavedCleanedDatasetDetail extends SavedCleanedDatasetSummary {
    rows: ModelCleaningMatrixRow[]
    config: ModelCleaningOptions & {
        dataset_kind?: string
        import_config?: Record<string, any>
    }
}

export async function previewModelCleaning(payload: ModelCleaningOptions) {
    const response = await api.post('/api/model-cleaning/preview', payload)
    return response.data as ModelCleaningPreview
}

export async function listCleanedDatasets() {
    const response = await api.get('/api/model-cleaning/datasets')
    return response.data as { items: SavedCleanedDatasetSummary[] }
}

export async function saveCleanedDataset(payload: { name: string; description?: string; target_key?: string; cleaning_options: ModelCleaningOptions }) {
    const response = await api.post('/api/model-cleaning/datasets', payload)
    return response.data as { dataset: SavedCleanedDatasetDetail }
}

export async function importCleanedDatasetCsv(payload: {
    file: File
    name: string
    description?: string
    targetColumn?: string
}) {
    const formData = new FormData()
    formData.append('file', payload.file)
    formData.append('name', payload.name)
    if (payload.description) {
        formData.append('description', payload.description)
    }
    if (payload.targetColumn) {
        formData.append('target_column', payload.targetColumn)
    }

    const response = await api.post('/api/model-cleaning/datasets/import-csv', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    })
    return response.data as { dataset: SavedCleanedDatasetDetail }
}

export async function importWffThesisDatasets() {
    const response = await api.post('/api/model-cleaning/datasets/import-wff-thesis')
    return response.data as { items: SavedCleanedDatasetDetail[] }
}

export async function getCleanedDataset(datasetId: number) {
    const response = await api.get(`/api/model-cleaning/datasets/${datasetId}`)
    return response.data as { dataset: SavedCleanedDatasetDetail }
}

export async function updateCleanedDataset(datasetId: number, payload: { name: string; description?: string | null }) {
    const response = await api.patch(`/api/model-cleaning/datasets/${datasetId}`, payload)
    return response.data as { dataset: SavedCleanedDatasetDetail }
}

export async function deleteCleanedDataset(datasetId: number) {
    const response = await api.delete(`/api/model-cleaning/datasets/${datasetId}`)
    return response.data as { success: boolean; dataset_id: number }
}

export async function downloadCleanedDataset(datasetId: number) {
    const response = await authFetch(resolveApiUrl(`/api/model-cleaning/datasets/${datasetId}/export`))
    if (!response.ok) {
        throw new Error(`Export failed with status ${response.status}`)
    }
    const blob = await response.blob()
    return blob
}

export async function startModelTraining(payload: ModelTrainingStartPayload) {
    const response = await api.post('/api/model-training/start', payload)
    return response.data as { task: ModelTrainingTaskSnapshot }
}

export async function getModelTrainingTask(taskId: string) {
    const response = await api.get(`/api/model-training/tasks/${taskId}`)
    return response.data as { task: ModelTrainingTaskSnapshot }
}

export async function cancelModelTraining(taskId: string) {
    const response = await api.post(`/api/model-training/tasks/${taskId}/cancel`)
    return response.data as { task: ModelTrainingTaskSnapshot }
}

export function buildModelTrainingWebSocketUrl(taskId: string) {
    const token = getSessionToken()
    const httpUrl = resolveApiUrl(`/api/model-training/ws/${taskId}?token=${encodeURIComponent(token)}`)
    return httpUrl.replace(/^http/i, 'ws')
}

// Re-run IL resolution for all existing records in the database (without calling LLM)
export async function patchILResolution() {
    const response = await api.post('/api/sync/patch-il-resolution')
    return response.data as { success: boolean; total_scanned: number; updated_count: number; skipped_count: number; message: string }
}

// --- Literature Detail Types ---

/** Full tribology record returned by the API, fully synced with DB schema */
export interface TribologyRecord {
    id: number
    literatureId: number
    materialName: string
    lubricant: string
    lubricantComponents?: LubricantComponent[] | null
    lubricantAlias?: string | null
    ionicLiquidDisplay?: string | null
    lubricantTooltip?: string | null
    // COF
    cofValue: number | null
    cofOperator: string | null
    cofRaw: string | null
    cofExtracted?: CofExtracted | null
    // Load & Speed (stored as strings with units in DB, e.g. "20 nN", "5 mm/s")
    loadValue: string | null
    loadRaw: string | null
    loadConditions?: LoadConditions | null
    speedValue: string | null
    speedConditions?: SpeedConditions | null
    // Temperature & Environment
    temperature: string | null
    potential: string | null
    waterContent: string | null
    probeMaterial: string | null
    probeGeometry: string | null
    probeRadius: string | null
    probeRoughness: string | null
    substrateMaterial: string | null
    substrateCoating: string | null
    substrateRoughness: string | null
    tribopairLabel: string | null
    surfaceRoughness: string | null
    // Film Thickness
    residualFilmThicknessD: string | null
    layerSpacingDelta: string | null
    filmThickness: string | null
    regime?: string | null
    tribologicalSystem?: TribologicalSystem | null
    // Molecular Info
    molRatio: string | null
    cation: string | null
    anion: string | null
    cationSmiles: string | null
    anionSmiles: string | null
    ilSmiles: string | null
    ilInchikey: string | null
    alkylChainLength: number | null
    // Meta
    confidence: number
    extractedAt: string
}

export interface LiteratureWithRecords extends Literature {
    tribologyData: TribologyRecord[]
    diffusionData?: DiffusionLibraryRecord[]
}

// ============== Monitor API ==============

/** 用户使用统计 */
export interface UserUsageStats {
    user_id: number
    username: string
    display_name: string
    role: string
    is_active: boolean
    created_at: string | null
    login_count: number
    upload_count: number
    extraction_count: number
    record_view_count: number
    record_edit_count: number
    sync_count: number
    model_training_count: number
    total_activities: number
    last_activity_at: string | null
}

/** 活动日志条目 */
export interface ActivityLogEntry {
    id: number
    action_type: string
    action_label: string
    action_detail: Record<string, any> | null
    resource_type: string | null
    resource_id: number | null
    ip_address: string | null
    created_at: string | null
}

/** 研究组活动统计 */
export interface GroupActivitySummary {
    total_users: number
    active_users_today: number
    active_users_week: number
    total_uploads: number
    total_extractions: number
    total_records_viewed: number
    total_model_trainings: number
    activity_by_day: Array<{ date: string; count: number }>
}

/** 获取所有用户使用统计 */
export async function getMonitorUsers(): Promise<{ items: UserUsageStats[] }> {
    const response = await api.get('/api/monitor/users')
    return response.data
}

/** 获取单个用户统计 */
export async function getUserStats(userId: number): Promise<UserUsageStats> {
    const response = await api.get(`/api/monitor/users/${userId}/stats`)
    return response.data
}

/** 获取用户活动时间线 */
export async function getUserTimeline(
    userId: number,
    skip = 0,
    limit = 50,
): Promise<{ items: ActivityLogEntry[]; total: number }> {
    const response = await api.get(`/api/monitor/users/${userId}/timeline`, {
        params: { skip, limit },
    })
    return response.data
}

/** 获取研究组活动统计 */
export async function getGroupActivitySummary(): Promise<GroupActivitySummary> {
    const response = await api.get('/api/monitor/summary')
    return response.data
}

/** 获取操作类型定义 */
export async function getActionTypes(): Promise<{ action_types: Array<{ key: string; label: string }> }> {
    const response = await api.get('/api/monitor/action-types')
    return response.data
}

export interface ExtractionReviewProgressSummary {
    libraryLiterature: number
    reviewedLiterature: number
    approvedRecords: number
    approvedTribologyRecords: number
    approvedDiffusionRecords: number
    flaggedOrRejectedRecords: number
    unpromotedCandidates: number
    unpromotedTribologyCandidates: number
    unpromotedDiffusionCandidates: number
    reviewCompletionRate: number
    reviewCompletionNumerator: number
    reviewCompletionDenominator: number
    reviewCompletionLabel: string
}

export interface ExtractionReviewProgressTrendItem {
    date: string
    reviewedLiterature: number
    approvedRecords: number
    unpromotedCandidates: number
    reviewCompletionRate: number
}

export interface ExtractionReviewProgressLiterature {
    id: number
    title: string
    doi?: string | null
    journal?: string | null
    year?: number | null
    reviewedAt?: string | null
    reviewNote?: string | null
    submissionStatus?: string | null
    approvedRecords?: number
    unpromotedCandidates?: number
}

export interface ExtractionReviewCandidateBacklogItem {
    id: number
    title: string
    doi?: string | null
    journal?: string | null
    year?: number | null
    unpromotedCandidates: number
}

export interface ExtractionReviewProgressResponse {
    summary: ExtractionReviewProgressSummary
    trend: ExtractionReviewProgressTrendItem[]
    recentReviewedLiterature: ExtractionReviewProgressLiterature[]
    candidateBacklog: ExtractionReviewCandidateBacklogItem[]
}

export async function getExtractionReviewProgress(): Promise<ExtractionReviewProgressResponse> {
    const response = await api.get('/api/monitor/extraction-review-progress')
    return response.data
}

export interface LiteratureMonitorSchedule {
    weekday: number
    hour: number
    minute: number
    timezone: string
    label?: string
}

export interface LiteratureMonitorSourceConfig {
    id: 'crossref' | 'openalex' | 'semantic_scholar' | 'rss' | string
    label: string
    kind: 'api' | 'rss' | string
    enabled: boolean
    feeds?: string[]
    last_success_at?: string | null
    last_error?: string | null
    last_item_count?: number
    note?: string | null
}

export interface LiteratureMonitorPdfConfig {
    enabled: boolean
    auto_download_oa: boolean
    queue_proxy_required: boolean
    storage_dir?: string
    proxy_queue_path?: string
}

export interface LiteratureMonitorCampusProxyConfig {
    enabled: boolean
    mode?: string
    portal_url?: string
    proxy_url: string
    username: string
    has_password?: boolean
    verify_tls: boolean
    apply_to_metadata: boolean
    apply_to_pdf: boolean
    headless?: boolean
    webvpn_url_template?: string
    login_username_selector?: string
    login_password_selector?: string
    login_submit_selector?: string
    post_login_success_selector?: string
    download_trigger_selector?: string
}

export interface LiteratureMonitorCampusProxyUpdate extends LiteratureMonitorCampusProxyConfig {
    password?: string
    clear_password?: boolean
}

export interface LiteratureMonitorPdfState {
    status: 'pending' | 'downloaded' | 'queued_proxy' | 'failed' | 'unavailable' | string
    access: 'open_access' | 'proxy_required' | 'unavailable' | string
    is_open_access?: boolean | null
    source?: string | null
    best_url?: string | null
    candidate_urls?: string[]
    local_path?: string | null
    filename?: string | null
    last_error?: string | null
    last_attempted_at?: string | null
    downloaded_at?: string | null
    strategy?: string | null
    notes?: string[]
}

export interface LiteratureMonitorItem {
    id: string
    title: string
    abstract: string
    doi?: string | null
    link: string
    journal: string
    publisher: string
    authors: string[]
    published_at: string
    discovered_at: string
    source_id: string
    source_name: string
    matched_keywords: string[]
    relevance_score?: number
    relevance_threshold?: number
    relevance_reasons?: string[]
    pdf: LiteratureMonitorPdfState
}

export interface LiteratureMonitorRun {
    started_at: string
    completed_at?: string | null
    status: string
    trigger: string
    new_items: number
    total_items: number
    errors: string[]
}

export interface LiteratureMonitorSummary {
    total_items: number
    new_items_last_7_days: number
    active_keywords: number
    distinct_publishers: number
    items_by_source: Array<{ name: string; count: number }>
    items_by_keyword: Array<{ name: string; count: number }>
    timeline: Array<{ date: string; count: number }>
}

export interface LiteratureMonitorSnapshot {
    config: {
        keywords: string[]
        lookback_days: number
        relevance_threshold: number
        pdf_download: LiteratureMonitorPdfConfig
        campus_proxy: LiteratureMonitorCampusProxyConfig
        schedule: LiteratureMonitorSchedule
        sources: LiteratureMonitorSourceConfig[]
        notes: string[]
    }
    scheduler: {
        status: string
        next_run_at?: string | null
        last_triggered_slot?: string | null
        last_error?: string | null
        running_trigger?: string | null
    }
    last_run?: LiteratureMonitorRun | null
    recent_runs: LiteratureMonitorRun[]
    summary: LiteratureMonitorSummary
    pdf_summary: {
        downloaded_count: number
        queued_proxy_count: number
        failed_count: number
        pending_count: number
        open_access_count: number
        storage_dir: string
        proxy_queue_path: string
    }
    items: LiteratureMonitorItem[]
}

export interface LiteratureMonitorConfigUpdate {
    keywords?: string[]
    rss_feeds?: string[]
    crossref_enabled?: boolean
    openalex_enabled?: boolean
    semantic_scholar_enabled?: boolean
    rss_enabled?: boolean
    lookback_days?: number
    relevance_threshold?: number
    pdf_download?: LiteratureMonitorPdfConfig
    campus_proxy?: LiteratureMonitorCampusProxyUpdate
    schedule?: LiteratureMonitorSchedule
}

export interface LLMRuntimeConfig {
    provider: 'openai-compatible' | 'openrouter' | string
    openai_base_url: string
    openrouter_base_url: string
    openrouter_site_url: string
    openrouter_app_name: string
    text_model: string
    vision_model: string
    fast_table_model: string
    has_openai_api_key: boolean
    has_openrouter_api_key: boolean
    has_vision_api_key: boolean
    updated_at?: string | null
}

export interface LLMRuntimeUpdatePayload {
    provider?: 'openai-compatible' | 'openrouter' | string
    openai_base_url?: string
    openai_api_key?: string
    clear_openai_api_key?: boolean
    openrouter_base_url?: string
    openrouter_api_key?: string
    clear_openrouter_api_key?: boolean
    openrouter_site_url?: string
    openrouter_app_name?: string
    text_model?: string
    vision_model?: string
    fast_table_model?: string
    vision_api_key?: string
    clear_vision_api_key?: boolean
}

export interface LLMRuntimeSnapshot {
    config: LLMRuntimeConfig
    runtime: {
        active_provider: string
        active_base_url: string
        active_text_model: string
        active_vision_model: string
        active_fast_table_model: string
        default_headers: Record<string, string>
    }
    notes: string[]
}

export async function getLiteratureMonitorSnapshot(): Promise<LiteratureMonitorSnapshot> {
    const response = await api.get('/api/monitor/literature-source')
    return response.data
}

export async function runLiteratureMonitor(): Promise<LiteratureMonitorSnapshot> {
    const response = await api.post('/api/monitor/literature-source/run')
    return response.data
}

export async function updateLiteratureMonitorConfig(
    payload: LiteratureMonitorConfigUpdate,
): Promise<LiteratureMonitorSnapshot> {
    const response = await api.put('/api/monitor/literature-source/config', payload)
    return response.data
}

export async function getLLMRuntimeSnapshot(): Promise<LLMRuntimeSnapshot> {
    const response = await api.get('/api/monitor/llm-config')
    return response.data
}

export async function updateLLMRuntimeConfig(
    payload: LLMRuntimeUpdatePayload,
): Promise<LLMRuntimeSnapshot> {
    const response = await api.put('/api/monitor/llm-config', payload)
    return response.data
}

// ============== User Management API ==============

/** 用户基本信息 */
export interface UserInfo {
    id: number
    username: string
    displayName: string
    role: string
    isActive: boolean
    createdAt: string
}

/** 获取所有用户列表 */
export async function listUsers(): Promise<{ items: UserInfo[] }> {
    const response = await api.get('/api/auth/users')
    return response.data
}

/** 创建用户请求 */
export interface CreateUserRequest {
    username: string
    password: string
    displayName: string
    role: string
}

/** 创建用户 */
export async function createUser(payload: CreateUserRequest): Promise<{
    success: boolean
    user: { id: number; username: string; displayName: string; role: string; workspaceId: number }
}> {
    const response = await api.post('/api/auth/users', payload)
    return response.data
}

/** 更新用户请求 */
export interface UpdateUserRequest {
    displayName?: string
    role?: string
}

/** 更新用户 */
export async function updateUser(
    userId: number,
    payload: UpdateUserRequest,
): Promise<{ success: boolean; user: UserInfo }> {
    const response = await api.put(`/api/auth/users/${userId}`, payload)
    return response.data
}

/** 删除用户 */
export async function deleteUser(userId: number): Promise<{ success: boolean; message: string }> {
    const response = await api.delete(`/api/auth/users/${userId}`)
    return response.data
}

/** 重置用户密码 */
export async function resetUserPassword(
    userId: number,
    newPassword: string,
): Promise<{ success: boolean; message: string }> {
    const response = await api.post(`/api/auth/users/${userId}/reset-password`, {
        newPassword,
    })
    return response.data
}

/** 切换用户状态 */
export async function toggleUserActive(
    userId: number,
): Promise<{ success: boolean; user: { id: number; username: string; isActive: boolean }; message: string }> {
    const response = await api.post(`/api/auth/users/${userId}/toggle-active`)
    return response.data
}
