import axios from 'axios'

import {
    authFetch,
    clearSession,
    getAuthHeaders,
    getSessionToken,
    type AuthUser,
} from './session'

export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:8000').replace(/\/$/, '')

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
    Object.entries(authHeaders).forEach(([key, value]) => {
        ;(config.headers as any)[key] = value
    })
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

export async function getCurrentUser() {
    const response = await api.get('/api/auth/me', {
        timeout: 8000,
    })
    return response.data as AuthUser
}

// File Upload
export async function uploadFile(file: File) {
    const formData = new FormData()
    formData.append('file', file)

    const response = await api.post('/api/upload', formData, {
        headers: {
            'Content-Type': 'multipart/form-data',
        },
    })
    return response.data
}

// Extract Data
export async function extractData(
    fileId: string,
    force: boolean = false,
    profile: 'high_accuracy' | 'standard' = 'high_accuracy',
    strictCofMode?: boolean,
): Promise<ExtractionResponse> {
    const query = new URLSearchParams()
    if (force) query.set('force', 'true')
    query.set('profile', profile)
    if (strictCofMode !== undefined) query.set('strict_cof_mode', strictCofMode ? 'true' : 'false')
    const url = `/api/extract/${fileId}${query.toString() ? `?${query.toString()}` : ''}`
    const response = await api.post(url)
    return response.data
}

// Get Extracted Data
export async function getData(fileId?: string) {
    const url = fileId ? `/api/data/${fileId}` : '/api/data'
    const response = await api.get(url)
    return response.data
}

// Chat
export async function chat(message: string, context?: string) {
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

export interface ExtractionRunDetail {
    run_id: string
    literature_id: number
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

export async function getExtractionRun(runId: string): Promise<ExtractionRunDetail> {
    const response = await api.get(`/api/extraction-runs/${runId}`)
    return response.data
}

export async function getLatestExtractionRun(literatureId: number): Promise<ExtractionRunDetail> {
    const response = await api.get(`/api/extraction-runs/latest/${literatureId}`)
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

// Search Records (Paginated)
export async function searchRecords(filter: SearchFilter, skip: number = 0, limit: number = 20): Promise<PaginatedRecordResponse> {
    const response = await api.post(`/api/records/search?skip=${skip}&limit=${limit}`, filter)
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
export async function getFilterOptions(): Promise<RecordFilterOptions> {
    const response = await api.get('/api/records/options')
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

// --- Types ---

export type ValidationStatus = 'unverified' | 'verified' | 'modified' | 'warning'

export interface TribologyData {
    id?: string
    material_name: string
    ionic_liquid: string
    base_oil?: string
    concentration?: string
    load?: string
    speed?: string
    temperature?: string
    cof?: string
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
    surface_roughness?: string  // Surface roughness (e.g. 'RMS 4.9 nm')
    residual_film_thickness_d?: string
    layer_spacing_delta?: string
    film_thickness?: string // Film thickness
    mol_ratio?: string // Mol ratio
    cation?: string // Cation
    anion?: string // Anion
    cation_smiles?: string
    anion_smiles?: string
    il_smiles?: string
    il_inchikey?: string
    alkyl_chain_length?: number
    source?: string
    source_page?: number
    source_figure?: string
    notes?: string
    evidence?: string

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
    extraction_summary?: ExtractionSummary
    agent_workflow?: AgentWorkflow
    message?: string
}

export interface ExtractionSummary {
    run_id?: string | null
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
        cofRaw: record.cof,
        loadRaw: record.load,
        speedRaw: record.speed,
        probeMaterial: record.probe_material,
        probeGeometry: record.probe_geometry,
        probeRadius: record.probe_radius,
        probeRoughness: record.probe_roughness,
        substrateMaterial: record.substrate_material,
        substrateCoating: record.substrate_coating,
        substrateRoughness: record.substrate_roughness,
        validationStatus: record.validationStatus,
        adminComment: record.notes,
    }
}

export function mapRecordToPayload(record: TribologyData) {
    return {
        materialName: record.material_name,
        lubricant: record.ionic_liquid,
        cofValue: parseNumericValue(record.cof, /[<>~=]/g),
        cofOperator: record.cof?.match(/[<>~=]/)?.[0] || null,
        cofRaw: record.cof,
        loadValue: parseNumericValue(record.load, /[^0-9.]/g),
        loadRaw: record.load,
        speedValue: parseNumericValue(record.speed, /[^0-9.]/g),
        speedRaw: record.speed,
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
export type FileExtractionStatus = 'uploaded' | 'processing' | 'success' | 'error'

export interface BatchFile {
    id: string
    name: string
    scopeKey?: string
    status: FileExtractionStatus
    progress: number // 0-100
    progressMessage?: string
    metadata?: LiteratureMetadata  // Literature Metadata
    records: TribologyData[]
    errorMessage?: string
    hasWarnings?: boolean // Whether it contains missing values (e.g. COF is null)
}

export type SearchFilter = {
    materials?: string[]
    probe_materials?: string[]
    substrate_materials?: string[]
    substrate_coatings?: string[]
    lubricants?: string[]
    speed_values?: string[]
    temperature_values?: string[]
    potential_values?: string[]
    water_content_values?: string[]
    load_min?: number
    load_max?: number
    cof_min?: number
    cof_max?: number
    doi?: string
    fileId?: string
}

export interface RecordFilterOptions {
    materials: string[]
    lubricants: string[]
    probeMaterials: string[]
    substrateMaterials: string[]
    substrateCoatings: string[]
    speedValues: string[]
    temperatureValues: string[]
    potentialValues: string[]
    waterContentValues: string[]
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
    materialName: string
    lubricant: string
    cofValue: number | null
    cofOperator: string | null
    cofRaw: string | null
    loadValue: string | null
    loadRaw: string | null
    speedValue: string | null
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
    molRatio?: string | null
    cation?: string | null
    anion?: string | null
    cationSmiles?: string | null
    anionSmiles?: string | null
    ilSmiles?: string | null
    ilInchikey?: string | null
    alkylChainLength?: number | null
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
    loadValue?: string
    surfaceRoughness?: string
    filmThickness?: string
    materialName?: string
    lubricant?: string
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
    volume?: string | null
    issue?: string | null
    pages?: string | null
    file_path?: string
    created_at: string
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

// Get all literature list
export async function listLiterature(skip: number = 0, limit: number = 100) {
    const response = await api.get('/api/sync/literature', {
        params: { skip, limit }
    })
    return response.data as Literature[]
}

// Get literature details (including historical extraction records)
export async function getLiteratureDetails(literatureId: number) {
    const response = await api.get(`/api/sync/literature/${literatureId}`)
    return response.data as LiteratureWithRecords
}

// Re-extract literature data
export async function reprocessLiterature(literatureId: number) {
    const response = await api.post(`/api/sync/literature/${literatureId}/reprocess`)
    return response.data as ReprocessResult
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
    raw_records: number
    target_ready_records: number
    chemistry_ready_records: number
    training_ready_records: number
    missing_value_repairs?: Record<string, number>
    outliers_detected?: number
    outliers_removed?: number
    final_feature_count?: number
    final_feature_columns?: string[]
    dropped_by_reason: {
        missing_target: number
        missing_cation_smiles: number
        missing_anion_smiles: number
    }
    rules: {
        drop_missing_target: boolean
        require_dual_smiles: boolean
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
    feature_dimensions: number
    target_column: string
    feature_columns: string[]
    columns: string[]
    rdkit_enabled: boolean
    source_scope: ModelTrainingSourceScope
    target?: {
        key: string
        label: string
        column?: string
    }
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
        }
        cleaning?: ModelTrainingCleaningSummary
        source_scope?: ModelTrainingSourceScope
        target_column?: string
        feature_columns?: string[]
        columns?: string[]
        pca_info?: ModelCleaningPcaInfo | null
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
}

export interface ModelTrainingSummary {
    dataset: ModelTrainingDatasetSummary
    cleaning: ModelTrainingCleaningSummary
    algorithms: ModelTrainingAlgorithmOption[]
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
    n_estimators: number
    learning_rate: number
    max_depth: number
    l2_leaf_reg: number
    random_strength: number
}

export interface ModelTrainingDataOptions {
    validation_split: number
    min_confidence: number
    max_records: number | null
    random_seed: number
}

export interface ModelTrainingCleaningOptions {
    source_mode: 'current_scope' | 'group_library' | 'group_library_fallback'
    drop_missing_target: boolean
    require_dual_smiles: boolean
}

export interface ModelTrainingStartPayload {
    target: string
    algorithm: string
    hyperparameters: ModelTrainingHyperparameters
    data_options: ModelTrainingDataOptions
    cleaned_dataset_id?: number | null
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

export interface ModelCleaningOptions {
    source_mode: 'current_scope' | 'group_library' | 'group_library_fallback'
    drop_missing_target: boolean
    require_dual_smiles: boolean
    missing_value_strategy: 'keep' | 'median' | 'zero'
    remove_target_outliers: boolean
    iqr_multiplier: number
    feature_config: ModelCleaningFeatureConfig
}

export type ModelCleaningMatrixRow = Record<string, number | null>

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

export async function getCleanedDataset(datasetId: number) {
    const response = await api.get(`/api/model-cleaning/datasets/${datasetId}`)
    return response.data as { dataset: SavedCleanedDatasetDetail }
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
    // COF
    cofValue: number | null
    cofOperator: string | null
    cofRaw: string | null
    // Load & Speed (stored as strings with units in DB, e.g. "20 nN", "5 mm/s")
    loadValue: string | null
    loadRaw: string | null
    speedValue: string | null
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
