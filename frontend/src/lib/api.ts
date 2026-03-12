import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
})

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
    // Convert to the format expected by the backend (snake_case conversion is handled in RecordInput, but field names need alignment)
    const formattedRecords = records.map(r => ({
        id: r.id,
        materialName: r.material_name,
        lubricant: r.ionic_liquid, // Backend DataRecord lubricant field corresponds to frontend ionic_liquid
        cofRaw: r.cof,
        loadRaw: r.load,
        speedRaw: r.speed,
        validationStatus: r.validationStatus,
        adminComment: r.notes
    }))

    const response = await api.post(`/api/sync/${fileId}`, {
        records: formattedRecords
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
        inferred?: boolean
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

// Get Filter Options
export async function getFilterOptions() {
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
        records: records.map(r => ({
            materialName: r.material_name,
            lubricant: r.ionic_liquid,
            cofValue: r.cof ? parseFloat(r.cof.replace(/[<>~=]/g, '')) : null,
            cofOperator: r.cof?.match(/[<>~=]/)?.[0] || null,
            cofRaw: r.cof,
            loadValue: r.load ? parseFloat(r.load.replace(/[^0-9.]/g, '')) : null,
            loadRaw: r.load,
            speedValue: r.speed ? parseFloat(r.speed.replace(/[^0-9.]/g, '')) : null,
            speedRaw: r.speed,
            temperature: r.temperature,
            temperatureValue: r.temperature ? parseFloat(r.temperature.replace(/[^0-9.]/g, '')) : null,
            // Environmental variables
            potential: r.potential,
            waterContent: r.water_content,
            surfaceRoughness: r.surface_roughness,
            residualFilmThicknessD: r.residual_film_thickness_d,
            layerSpacingDelta: r.layer_spacing_delta,
            filmThickness: r.film_thickness,
            molRatio: r.mol_ratio,
            cation: r.cation,
            anion: r.anion,
            cationSmiles: r.cation_smiles,
            anionSmiles: r.anion_smiles,
            ilSmiles: r.il_smiles,
            ilInchikey: r.il_inchikey,
            alkylChainLength: r.alkyl_chain_length,
            evidence: r.evidence,
            source: r.source,
            sourcePage: r.source_page,
            sourceFigure: r.source_figure,
            confidence: 0.9
        }))
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
        records: records.map(r => ({
            // Map frontend TribologyData to backend TribologyDataCreate
            materialName: r.material_name,
            lubricant: r.ionic_liquid,
            cofValue: r.cof ? parseFloat(r.cof.replace(/[<>~=]/g, '')) : null,
            cofOperator: r.cof?.match(/[<>~=]/)?.[0] || null,
            cofRaw: r.cof,
            loadValue: r.load ? parseFloat(r.load.replace(/[^0-9.]/g, '')) : null,
            loadRaw: r.load,
            speedValue: r.speed ? parseFloat(r.speed.replace(/[^0-9.]/g, '')) : null,
            speedRaw: r.speed,
            temperature: r.temperature,
            temperatureValue: r.temperature ? parseFloat(r.temperature.replace(/[^0-9.]/g, '')) : null,
            // Environmental variables
            potential: r.potential,
            waterContent: r.water_content,
            surfaceRoughness: r.surface_roughness,
            residualFilmThicknessD: r.residual_film_thickness_d,
            layerSpacingDelta: r.layer_spacing_delta,
            filmThickness: r.film_thickness,
            molRatio: r.mol_ratio,
            cation: r.cation,
            anion: r.anion,
            cationSmiles: r.cation_smiles,
            anionSmiles: r.anion_smiles,
            ilSmiles: r.il_smiles,
            ilInchikey: r.il_inchikey,
            alkylChainLength: r.alkyl_chain_length,
            evidence: r.evidence,
            source: r.source,
            sourcePage: r.source_page,
            sourceFigure: r.source_figure,
            confidence: 0.9, // Default confidence, or fetch from frontend tracking
        }))
    }

    const response = await api.post('/api/sync/', payload)
    return response.data
}

// Batch processing related types
export type FileExtractionStatus = 'uploaded' | 'processing' | 'success' | 'error'

export interface BatchFile {
    id: string
    name: string
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
    lubricants?: string[]
    load_min?: number
    load_max?: number
    cof_min?: number
    cof_max?: number
    doi?: string
    fileId?: string
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
    surfaceRoughness: string | null
    residualFilmThicknessD?: string | null
    layerSpacingDelta?: string | null
    filmThickness: string | null
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

