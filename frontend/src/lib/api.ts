import axios from 'axios'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

export const api = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Content-Type': 'application/json',
    },
})

// 文件上传
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

// 提取数据
export async function extractData(fileId: string, force: boolean = false): Promise<ExtractionResponse> {
    // Add query param for force explicitly
    const url = force ? `/api/extract/${fileId}?force=true` : `/api/extract/${fileId}`
    const response = await api.post(url)
    return response.data
}

// 获取提取的数据
export async function getData(fileId?: string) {
    const url = fileId ? `/api/data/${fileId}` : '/api/data'
    const response = await api.get(url)
    return response.data
}

// 聊天
export async function chat(message: string, context?: string) {
    const response = await api.post('/api/chat', { message, context })
    return response.data
}

// 同步数据到数据库
export async function syncData(fileId: string, records: TribologyData[]) {
    // 转换为后端需要的格式 (驼峰转蛇形在后端 RecordInput 中有处理，但字段名需要对齐)
    const formattedRecords = records.map(r => ({
        id: r.id,
        materialName: r.material_name,
        lubricant: r.ionic_liquid, // 后端 DataRecord 的 lubricant 字段对应前端的 ionic_liquid
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


// --- Search API ---

// 搜索记录
export async function searchRecords(filter: SearchFilter) {
    const response = await api.post('/api/records/search', filter)
    return response.data
}

// 获取过滤选项
export async function getFilterOptions() {
    const response = await api.get('/api/records/options')
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
    potential?: string  // 电化学电势/电压 (如 '+1.5V', 'OCP')
    water_content?: string  // 含水量或湿度 (如 '50 ppm', 'Dry')
    surface_roughness?: string  // 表面粗糙度 (如 'RMS 4.9 nm')
    film_thickness?: string // 膜厚
    mol_ratio?: string // 摩尔比
    cation?: string // 阳离子
    source?: string
    notes?: string

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

// 文献元数据接口
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
    file_hash?: string | null  // File content hash for caching/deduplication
}

export interface ExtractionResponse {
    success: boolean
    metadata?: LiteratureMetadata
    data: TribologyData[]
    message?: string
}

export interface ChatResponse {
    success: boolean
    response: string
}

// 同步数据到数据库 (新版: 含文献元数据)
export async function syncWithLiterature(metadata: LiteratureMetadata, records: TribologyData[]) {
    // 构建 SyncPayload 格式
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
            filePath: "",  // 将由后端填充
            fileHash: metadata.file_hash  // Include file_hash for smart caching
        },
        records: records.map(r => ({
            materialName: r.material_name,
            lubricant: r.ionic_liquid,
            cofValue: r.cof ? parseFloat(r.cof.replace(/[<>≤≥~]/g, '')) : null,
            cofOperator: r.cof?.match(/[<>≤≥~]/)?.[0] || null,
            cofRaw: r.cof,
            loadValue: r.load ? parseFloat(r.load.replace(/[^0-9.]/g, '')) : null,
            loadRaw: r.load,
            speedValue: r.speed ? parseFloat(r.speed.replace(/[^0-9.]/g, '')) : null,
            temperature: r.temperature ? parseFloat(r.temperature.replace(/[^0-9.]/g, '')) : null,
            // Environmental variables
            potential: r.potential,
            waterContent: r.water_content,
            surfaceRoughness: r.surface_roughness,
            filmThickness: r.film_thickness,
            molRatio: r.mol_ratio,
            cation: r.cation,
            confidence: 0.9
        }))
    }

    const response = await api.post('/api/sync/', payload)
    return response.data
}

// 批量同步数据 (含元数据)
export async function syncBatchData(metadata: LiteratureMetadata, records: TribologyData[]) {
    const payload = {
        metadata: {
            ...metadata,
            // 确保包含所有必要字段，如果有缺失可以给默认值
            doi: metadata.doi || '',
            title: metadata.title || 'Untitled',
            authors: metadata.authors || '',
            journal: metadata.journal || '',
            year: metadata.year || new Date().getFullYear(),
            fileHash: metadata.file_hash  // Include file_hash for smart caching
        },
        records: records.map(r => ({
            // 映射前端 TribologyData 到后端 TribologyDataCreate
            materialName: r.material_name,
            lubricant: r.ionic_liquid,
            cofValue: r.cof ? parseFloat(r.cof.replace(/[<>≤≥~]/g, '')) : null,
            cofOperator: r.cof?.match(/[<>≤≥~]/)?.[0] || null,
            cofRaw: r.cof,
            loadValue: r.load ? parseFloat(r.load.replace(/[^0-9.]/g, '')) : null,
            loadRaw: r.load,
            speedValue: r.speed ? parseFloat(r.speed.replace(/[^0-9.]/g, '')) : null,
            temperature: r.temperature ? parseFloat(r.temperature.replace(/[^0-9.]/g, '')) : null,
            // Environmental variables
            potential: r.potential,
            waterContent: r.water_content,
            surfaceRoughness: r.surface_roughness,
            filmThickness: r.film_thickness,
            molRatio: r.mol_ratio,
            cation: r.cation,
            confidence: 0.9, // 默认置信度，或者从 frontend tracking 中获取
        }))
    }

    const response = await api.post('/api/sync/', payload)
    return response.data
}

// 批量处理相关类型
export type FileExtractionStatus = 'uploaded' | 'processing' | 'success' | 'error'

export interface BatchFile {
    id: string
    name: string
    status: FileExtractionStatus
    progress: number // 0-100
    metadata?: LiteratureMetadata  // 文献元数据
    records: TribologyData[]
    errorMessage?: string
    hasWarnings?: boolean // 是否包含缺失值(如COF为null)
}

export type SearchFilter = {
    materials?: string[]
    lubricants?: string[]
    load_min?: number
    load_max?: number
}

export interface SourceFileDTO {
    id: string
    filename: string
}

export interface RecordResponse {
    id: string
    material_name: string
    lubricant: string
    cof_value: number | null
    cof_operator: 'EQ' | 'LT' | 'GT' | 'LE' | 'GE'
    load_value: number | null
    speed_value: number | null
    source: SourceFileDTO | null
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
}

// 获取所有文献列表
export async function listLiterature(skip: number = 0, limit: number = 100) {
    const response = await api.get('/api/sync/literature', {
        params: { skip, limit }
    })
    return response.data as Literature[]
}

// 获取文献详情 (包括历史提取记录)
export async function getLiteratureDetails(literatureId: number) {
    const response = await api.get(`/api/sync/literature/${literatureId}`)
    return response.data as LiteratureWithRecords
}

// 重新提取文献数据
export async function reprocessLiterature(literatureId: number) {
    const response = await api.post(`/api/sync/literature/${literatureId}/reprocess`)
    return response.data as ReprocessResult
}

// 扩展 Literature 类型，包含记录
export interface LiteratureWithRecords extends Literature {
    tribologyData: {
        id: number
        literatureId: number
        materialName: string
        lubricant: string
        cofValue: number | null
        cofOperator: string | null
        loadValue: number | null
        speedValue: number | null
        temperature: number | null
        confidence: number
        extractedAt: string
    }[]
}

