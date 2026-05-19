<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Activity, Database, FileText, Github, PanelTop } from 'lucide-vue-next'

import AppSidebar from '@/components/AppSidebar.vue'
import LoginScreen from '@/components/LoginScreen.vue'
import type { HomeSuggestedAction } from '@/composables/useHomeSummary'
import { useAppShell } from '@/composables/useAppShell'
import { useI18n } from '@/composables/useI18n'
import { getLiteratureDetails, type BatchFile, type TribologyData, type ValidationStatus } from '@/lib/api'
import { lazyComponent } from '@/lib/lazyComponent'
import type { AppSection, AppView } from '@/lib/platform'

type FileUploadBridge = {
  setUploading: (value: boolean) => void
}
type ChatPanelBridge = {
  addMessage: (role: 'user' | 'assistant', message: string) => void
}

const AdminPage = lazyComponent(() => import('@/pages/admin/AdminPage.vue'))
const BlogView = lazyComponent(() => import('@/components/BlogView.vue'))
const HelpPage = lazyComponent(() => import('@/pages/help/HelpPage.vue'))
const HomePage = lazyComponent(() => import('@/pages/home/HomePage.vue'))
const KnowledgePage = lazyComponent(() => import('@/pages/knowledge/KnowledgePage.vue'))
const ModelingPage = lazyComponent(() => import('@/pages/modeling/ModelingPage.vue'))
const PipelinePage = lazyComponent(() => import('@/pages/pipeline/PipelinePage.vue'))
const QualityMetricsPage = lazyComponent(() => import('@/pages/quality/QualityMetricsPage.vue'))
const ReviewPage = lazyComponent(() => import('@/pages/review/ReviewPage.vue'))

const ADMIN_ROLES = new Set(['principal_investigator', 'group_admin'])

const roleLabelKeys = {
  admin: 'role.admin',
  group_admin: 'role.group_admin',
  member: 'role.member',
  principal_investigator: 'role.principal_investigator',
  viewer: 'role.viewer',
} as const

const statusLabelKeys = {
  cancelled: 'status.cancelled',
  completed: 'status.completed',
  error: 'status.error',
  failed: 'status.failed',
  idle: 'status.idle',
  no_data: 'status.completed',
  processing: 'status.processing',
  running: 'status.running',
} as const


const fileUploadRef = ref<FileUploadBridge>()
const chatPanelRef = ref<ChatPanelBridge>()
const route = useRoute()

// 从异常诊断面板跳转过来时高亮的目标记录 id（一次性，用户切走后清掉）
const focusedRecordId = ref<number | null>(null)
const reviewTargetRecordId = ref<string | null>(null)
const reviewTargetMode = ref<'training-blockers' | null>(null)
const hydratedReviewRouteKey = ref('')
const { isChinese, t } = useI18n()

type ReviewTarget = {
  literatureId?: number | null
  recordId?: number | null
  mode?: 'training-blockers' | null
}

const {
  activeExtractionFileName,
  activeExtractionRun,
  authError,
  availableScopes,
  batchFiles,
  currentSection,
  currentView,
  defaultExtractorType,
  explorerDoi,
  groundingHighlightData,
  groundingPdfUrl,
  handleBatchExtract,
  handleBatchUpload,
  handleCancelExtraction,
  handleChat,
  handleClearFiles,
  handleExtract,
  handleLogin,
  handleLogout,
  handleRemoveFile,
  handleUpload,
  isAuthenticating,
  isChatting,
  isDark,
  latestAgentWorkflow,
  navigateTo,
  openTrainingWorkbench,
  prepareFileForReview,
  preferredTrainingDatasetId,
  selectedFileId,
  selectedScopeKey,
  sessionState,
  sidebarTab,
  setDefaultExtractorType,
  setFileExtractorType,
  toggleDarkMode,
} = useAppShell(fileUploadRef, chatPanelRef)

const canAccessAdmin = computed(() => ADMIN_ROLES.has(String(sessionState.user?.role || '')))
const isBlogView = computed(() => currentView.value === 'blog')
const viewTitle = computed(() => {
  if (isChinese.value) {
    const labels: Record<AppView, string> = {
      admin: '管理',
      blog: '内容',
      help: '帮助',
      home: '概览',
      knowledge: '知识库',
      modeling: '建模',
      pipeline: '抽取',
      quality: '质量',
      review: '审阅',
    }
    return labels[currentView.value] || currentView.value
  }

  const labels: Record<AppView, string> = {
    admin: 'Admin',
    blog: 'Content',
    help: 'Help',
    home: 'Overview',
    knowledge: 'Knowledge',
    modeling: 'Modeling',
    pipeline: 'Extract',
    quality: 'Quality',
    review: 'Review',
  }
  return labels[currentView.value] || formatLabel(currentView.value)
})

const viewSubtitle = computed(() => {
  if (isChinese.value) {
    const labels: Record<AppView, string> = {
      admin: '权限、运行和系统配置',
      blog: '内容与文档中心',
      help: '上手指南与协作说明',
      home: '今日任务、风险和下一步',
      knowledge: '分类数据资产与来源追踪',
      modeling: '特征工程与建模准备',
      pipeline: '上传、抽取、重试和审阅交接',
      quality: '数据质量、缺失和异常监控',
      review: '人工确认机器抽取结果',
    }
    return labels[currentView.value] || '科研数据工作台'
  }

  const labels: Record<AppView, string> = {
    admin: 'Permissions, runtime, and system setup',
    blog: 'Content and documentation center',
    help: 'Guides for onboarding and collaboration',
    home: 'Today, blockers, and next actions',
    knowledge: 'Structured data assets and source traceability',
    modeling: 'Feature engineering and modeling preparation',
    pipeline: 'Upload, extract, retry, and hand off to review',
    quality: 'Data quality, missing fields, and anomaly monitoring',
    review: 'Human confirmation for extracted records',
  }
  return labels[currentView.value] || 'Research data workspace'
})

const queueSizeLabel = computed(() => {
  const count = batchFiles.value.length
  return count === 1 ? t('common.file_count_singular', { count }) : t('common.file_count_plural', { count })
})

const operatorName = computed(() => sessionState.user?.displayName || t('common.operator_default'))
const operatorRole = computed(() => formatMappedLabel(String(sessionState.user?.role || 'member'), roleLabelKeys))
const activeScopeLabel = computed(() => {
  return availableScopes.value.find((scope) => scope.key === selectedScopeKey.value)?.label || t('common.no_active_scope')
})
const selectedFile = computed(() => batchFiles.value.find((file) => file.id === selectedFileId.value) || null)
const selectedFileName = computed(() => selectedFile.value?.name || t('common.no_file_selected'))
const runStateLabel = computed(() => {
  if (String(activeExtractionRun.value?.status || '').toLowerCase() === 'no_data') {
    return 'NO DATA / No extractable records found'
  }
  return formatMappedLabel(String(activeExtractionRun.value?.status || 'idle'), statusLabelKeys)
})
const latestFailedFile = computed(() => [...batchFiles.value].reverse().find((file) => file.status === 'error') || null)
const latestReviewFile = computed(() => {
  return [...batchFiles.value].reverse().find((file) => file.status === 'success' && file.hasWarnings)
    || [...batchFiles.value].reverse().find((file) => file.status === 'success')
    || null
})

function formatLabel(value: string) {
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(' ')
}

function formatMappedLabel(value: string, map: Record<string, Parameters<typeof t>[0]>) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized && map[normalized] ? t(map[normalized]) : formatLabel(value)
}

function handleSectionChange(section: string) {
  navigateTo(currentView.value, section as AppSection)
}

function setSidebarTab(tab: 'chat' | 'agents') {
  sidebarTab.value = tab
}

function setSelectedFile(fileId: string | null) {
  selectedFileId.value = fileId
}

function bindFileUploadRef(instance: any) {
  fileUploadRef.value = instance as FileUploadBridge | undefined
}

function bindChatPanelRef(instance: any) {
  chatPanelRef.value = instance as ChatPanelBridge | undefined
}

function clearExplorerDoi() {
  explorerDoi.value = ''
}

function parseRecordBbox(value: unknown): number[] | null {
  if (Array.isArray(value)) {
    const coords = value.map((item) => Number(item))
    return coords.length >= 4 && coords.every((item) => Number.isFinite(item)) ? coords : null
  }
  if (typeof value === 'string' && value.trim()) {
    try {
      return parseRecordBbox(JSON.parse(value))
    } catch {
      return null
    }
  }
  return null
}

function parseFieldEvidence(value: unknown): TribologyData['field_evidence_json'] {
  if (!value) return undefined
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed : undefined
    } catch {
      return undefined
    }
  }
  return typeof value === 'object' ? value as TribologyData['field_evidence_json'] : undefined
}

function validationStatusFromReviewStatus(reviewStatus: unknown): ValidationStatus {
  const normalized = String(reviewStatus || '').trim().toLowerCase()
  if (normalized === 'approved') return 'verified'
  if (normalized === 'flagged' || normalized === 'needs_evidence') return 'warning'
  return 'unverified'
}

function normalizeReviewRecord(record: any): TribologyData {
  const cofValue = record.cof ?? record.cofRaw ?? record.cof_raw ?? record.cofValue
  const confidence = Number(record.confidence ?? record.confidence_details?.score ?? record.confidenceDetails?.score)
  return {
    id: String(record.id || ''),
    extractor_type: record.extractor_type || 'tribology',
    material_name: record.material_name ?? record.materialName ?? '',
    ionic_liquid: record.ionic_liquid ?? record.lubricant ?? '',
    lubricant_components: record.lubricant_components ?? record.lubricantComponents ?? [],
    lubricant_alias: record.lubricant_alias ?? record.lubricantAlias ?? null,
    ionic_liquid_display: record.ionic_liquid_display ?? record.ionicLiquidDisplay ?? null,
    lubricant_tooltip: record.lubricant_tooltip ?? record.lubricantTooltip ?? null,
    load: record.load ?? record.loadRaw ?? record.load_raw ?? record.loadValue ?? '',
    load_conditions: record.load_conditions ?? record.loadConditions ?? null,
    speed: record.speed ?? record.speedValue ?? record.speed_value ?? '',
    speed_conditions: record.speed_conditions ?? record.speedConditions ?? null,
    shear_rate: record.shear_rate ?? record.shearRate ?? '',
    temperature: record.temperature ?? '',
    potential: record.potential ?? '',
    water_content: record.water_content ?? record.waterContent ?? '',
    cof: cofValue == null ? '' : String(cofValue),
    cof_extracted: record.cof_extracted ?? record.cofExtracted ?? null,
    probe_material: record.probe_material ?? record.probeMaterial ?? '',
    probe_geometry: record.probe_geometry ?? record.probeGeometry ?? '',
    probe_radius: record.probe_radius ?? record.probeRadius ?? '',
    probe_roughness: record.probe_roughness ?? record.probeRoughness ?? '',
    substrate_material: record.substrate_material ?? record.substrateMaterial ?? record.materialName ?? '',
    substrate_coating: record.substrate_coating ?? record.substrateCoating ?? '',
    substrate_roughness: record.substrate_roughness ?? record.substrateRoughness ?? '',
    surface_roughness: record.surface_roughness ?? record.surfaceRoughness ?? '',
    residual_film_thickness_d: record.residual_film_thickness_d ?? record.residualFilmThicknessD ?? '',
    layer_spacing_delta: record.layer_spacing_delta ?? record.layerSpacingDelta ?? '',
    film_thickness: record.film_thickness ?? record.filmThickness ?? '',
    regime: record.regime ?? '',
    tribological_system: record.tribological_system ?? record.tribologicalSystem ?? null,
    mol_ratio: record.mol_ratio ?? record.molRatio ?? '',
    cation: record.cation ?? '',
    anion: record.anion ?? '',
    cation_smiles: record.cation_smiles ?? record.cationSmiles ?? '',
    anion_smiles: record.anion_smiles ?? record.anionSmiles ?? '',
    il_smiles: record.il_smiles ?? record.ilSmiles ?? '',
    il_inchikey: record.il_inchikey ?? record.ilInchikey ?? '',
    alkyl_chain_length: record.alkyl_chain_length ?? record.alkylChainLength ?? undefined,
    source: record.source ?? '',
    source_page: record.source_page ?? record.sourcePage ?? record.evidencePage ?? undefined,
    source_bbox: parseRecordBbox(record.source_bbox ?? record.sourceBbox ?? record.evidenceBbox),
    source_figure: record.source_figure ?? record.sourceFigure ?? '',
    evidence: record.evidence ?? '',
    sample_id: record.sample_id ?? record.sampleId ?? '',
    series_id: record.series_id ?? record.seriesId ?? '',
    field_evidence_json: parseFieldEvidence(record.field_evidence_json ?? record.fieldEvidenceJson),
    review_status: record.review_status ?? record.reviewStatus ?? '',
    record_origin: record.record_origin ?? record.recordOrigin ?? 'knowledge_record',
    review_entity_type: record.review_entity_type ?? record.reviewEntityType ?? 'record',
    assembly_notes: record.assembly_notes ?? record.assemblyNotes ?? '',
    confidence: Number.isFinite(confidence) ? confidence : null,
    confidence_details: record.confidence_details ?? record.confidenceDetails ?? null,
    confidenceDetails: record.confidenceDetails ?? record.confidence_details ?? null,
    system_name: record.system_name ?? record.systemName ?? '',
    confinement_material_class: record.confinement_material_class ?? record.confinementMaterialClass ?? '',
    confinement_geometry_class: record.confinement_geometry_class ?? record.confinementGeometryClass ?? '',
    surface_functional_groups: record.surface_functional_groups ?? record.surfaceFunctionalGroups ?? '',
    confinement_dimensionality: record.confinement_dimensionality ?? record.confinementDimensionality ?? '',
    D_total: record.D_total ?? record.d_total ?? record.dTotal ?? null,
    D_cation: record.D_cation ?? record.d_cation ?? record.dCation ?? null,
    D_anion: record.D_anion ?? record.d_anion ?? record.dAnion ?? null,
    D_unit: record.D_unit ?? record.d_unit ?? record.dUnit ?? '',
    temperature_value: record.temperature_value ?? record.temperatureValue ?? null,
    confinement_scale_value: record.confinement_scale_value ?? record.confinementScaleValue ?? null,
    confinement_scale_unit: record.confinement_scale_unit ?? record.confinementScaleUnit ?? '',
    smiles: record.smiles ?? '',
    novel_features_json: record.novel_features_json ?? record.novelFeaturesJson ?? {},
    rdkit_features_json: record.rdkit_features_json ?? record.rdkitFeaturesJson ?? {},
    validationStatus: validationStatusFromReviewStatus(record.review_status ?? record.reviewStatus),
  }
}

async function ensureReviewFileForTarget(target: ReviewTarget) {
  const literatureId = Number(target.literatureId || 0)
  if (!Number.isFinite(literatureId) || literatureId <= 0) return
  const existingIndex = batchFiles.value.findIndex((file) => String(file.id) === String(literatureId))
  const targetRecordId = target.recordId ? String(target.recordId) : ''
  if (existingIndex >= 0 && targetRecordId) {
    const existingFile = batchFiles.value[existingIndex]
    const hasTargetFinalRecord = existingFile?.records.some((record) => {
      const entityType = String(record.review_entity_type || '').trim().toLowerCase()
      return String(record.id || '') === targetRecordId && entityType === 'record'
    })
    if (hasTargetFinalRecord) return
  } else if (existingIndex >= 0) {
    const existingFile = batchFiles.value[existingIndex]
    if (existingFile && existingFile.records.length > 0) return
  }

  try {
    const details = await getLiteratureDetails(literatureId)
    const diffusionRows = Array.isArray((details as any).diffusionData) ? (details as any).diffusionData : []
    const tribologyRows = Array.isArray(details.tribologyData) ? details.tribologyData : []
    const rows = diffusionRows.length ? diffusionRows : tribologyRows
    const records: TribologyData[] = rows.map(normalizeReviewRecord)
    const extractorType = (diffusionRows.length ? 'diffusion' : (records[0]?.extractor_type || 'tribology')) as 'tribology' | 'diffusion'
    const batchFile: BatchFile = {
      id: String(literatureId),
      name: details.title || details.doi || `Literature ${literatureId}`,
      status: 'success',
      progress: 100,
      progressMessage: 'Loaded from literature library',
      extractor_type: extractorType,
      metadata: {
        title: details.title || '',
        authors: details.authors || '',
        doi: details.doi || '',
        journal: details.journal || '',
        year: details.year || new Date().getFullYear(),
        volume: details.volume || null,
        issue: details.issue || null,
        pages: details.pages || null,
      },
      records,
      hasWarnings: records.some((record) => record.validationStatus !== 'verified'),
    }
    if (existingIndex >= 0) {
      batchFiles.value.splice(existingIndex, 1, batchFile)
    } else {
      batchFiles.value.push(batchFile)
    }
  } catch (error) {
    console.warn('[Review] Failed to hydrate literature for review target:', error)
  }
}

function positiveNumberFromQuery(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value
  const parsed = Number(raw || 0)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function hydrateReviewTargetFromRoute() {
  if (route.name !== 'review' || !sessionState.user) return
  const literatureId = positiveNumberFromQuery(
    route.query.literatureId ?? route.query.literature_id ?? route.query.lit,
  )
  if (!literatureId) return

  const recordId = positiveNumberFromQuery(
    route.query.recordId ?? route.query.record_id ?? route.query.candidateId ?? route.query.candidate_id,
  )
  const key = `${literatureId}:${recordId || ''}`
  if (hydratedReviewRouteKey.value === key) return
  hydratedReviewRouteKey.value = key

  reviewTargetRecordId.value = recordId ? String(recordId) : null
  reviewTargetMode.value = null
  await ensureReviewFileForTarget({ literatureId, recordId })
  selectedFileId.value = String(literatureId)
}

async function openReviewTarget(target?: ReviewTarget) {
  reviewTargetRecordId.value = target?.recordId ? String(target.recordId) : null
  reviewTargetMode.value = target?.mode ?? null

  if (target?.literatureId) {
    await ensureReviewFileForTarget(target)
    selectedFileId.value = String(target.literatureId)
  }

  navigateTo('review', 'inbox')
}

watch(
  () => [
    route.name,
    route.query.literatureId,
    route.query.literature_id,
    route.query.lit,
    route.query.recordId,
    route.query.record_id,
    route.query.candidateId,
    route.query.candidate_id,
    sessionState.user?.id,
  ],
  () => {
    void hydrateReviewTargetFromRoute()
  },
  { immediate: true },
)

async function openReviewForCurrentFile(fileId?: string | null) {
  reviewTargetRecordId.value = null
  reviewTargetMode.value = null
  const targetFileId = fileId || selectedFileId.value
  let readyForReview = false
  if (targetFileId) {
    readyForReview = await prepareFileForReview(targetFileId)
  }
  const targetFile = targetFileId ? batchFiles.value.find((file) => file.id === targetFileId) : null
  if (!readyForReview && !targetFile?.records.length) {
    if (targetFileId) selectedFileId.value = targetFileId
    navigateTo('pipeline', 'runs')
    return
  }
  navigateTo('review', 'inbox')
}

async function handleReviewReextract(fileId: string) {
  if (!fileId) return
  reviewTargetRecordId.value = null
  selectedFileId.value = fileId
  await handleExtract(fileId, true, { profile: 'review_figure_estimate' })
  selectedFileId.value = selectedFileId.value || fileId
  navigateTo('review', 'inbox')
}

function openLatestReview() {
  reviewTargetRecordId.value = null
  if (latestReviewFile.value) {
    selectedFileId.value = latestReviewFile.value.id
  }
  navigateTo('review', 'inbox')
}

async function retryLatestFailedRun() {
  const failedFile = latestFailedFile.value
  if (!failedFile) {
    navigateTo('pipeline', 'runs')
    return
  }

  selectedFileId.value = failedFile.id
  setSidebarTab('agents')
  navigateTo('pipeline', 'runs')
  await handleExtract(failedFile.id, true)
}

function openReviewQueue() {
  reviewTargetRecordId.value = null
  navigateTo('review', 'queue')
}

function openDatasetBuilder() {
  navigateTo('knowledge', 'datasets')
}

function handleHomeAction(action: HomeSuggestedAction) {
  switch (action.id) {
    case 'continue-review':
      openLatestReview()
      return
    case 'retry-failed-run':
      void retryLatestFailedRun()
      return
    case 'open-review-queue':
      openReviewQueue()
      return
    case 'open-dataset-builder':
      openDatasetBuilder()
      return
    default: {
      if (action.actionType === 'route') {
        const [viewPart, sectionPart] = String(action.target || '').split('/', 2)
        const view = viewPart as AppView
        if (view) {
          navigateTo(view, sectionPart as AppSection | undefined)
        }
      }
    }
  }
}
</script>

<template>
  <div v-if="!sessionState.ready" class="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
    <div class="w-full max-w-md rounded-lg border border-white/10 bg-slate-900 px-6 py-6 text-center shadow-sm">
      <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-400">IonicLink</p>
      <h1 class="mt-3 text-2xl font-semibold text-white">{{ t('loading.restore_title') }}</h1>
      <p class="mt-2 text-sm leading-6 text-slate-300">
        {{ t('loading.restore_description') }}
      </p>
    </div>
  </div>

  <LoginScreen
    v-else-if="!sessionState.user"
    :loading="isAuthenticating"
    :error="authError"
    @submit="handleLogin"
  />

  <BlogView
    v-else-if="isBlogView"
    :operator-name="operatorName"
    @exit="navigateTo('help', 'content')"
  />

  <div v-else class="app-shell flex h-screen overflow-hidden text-foreground">
    <!-- Left sidebar -->
    <AppSidebar
      :current-view="currentView"
      :batch-files="batchFiles"
      :selected-file-id="selectedFileId"
      :can-access-admin="canAccessAdmin"
      :operator-name="operatorName"
      :operator-role="operatorRole"
      :selected-scope-key="selectedScopeKey"
      :available-scopes="availableScopes"
      :is-dark="isDark"
      :is-chinese="isChinese"
      @navigate="navigateTo"
      @select-file="setSelectedFile"
      @toggle-dark="toggleDarkMode"
      @logout="handleLogout"
      @update:selected-scope-key="(key) => { selectedScopeKey = key }"
    />

    <!-- Right content column -->
    <div class="flex min-h-0 min-w-0 flex-1 flex-col">
      <!-- Workspace top bar -->
      <header class="app-topbar flex h-14 shrink-0 items-center gap-3 px-4">
        <div class="flex min-w-0 items-center gap-2.5">
          <span class="hidden h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 sm:flex">
            <PanelTop class="h-4 w-4" />
          </span>
          <div class="min-w-0">
            <h2 class="truncate text-sm font-semibold text-slate-950 dark:text-slate-50">
              {{ viewTitle }}
            </h2>
            <p class="hidden truncate text-xs text-slate-500 dark:text-slate-400 md:block">
              {{ viewSubtitle }}
            </p>
          </div>
        </div>

        <div class="ml-auto flex min-w-0 items-center gap-2">
          <span class="topbar-chip hidden max-w-[16rem] lg:inline-flex">
            <Database class="h-3.5 w-3.5 shrink-0" />
            <span class="truncate">{{ activeScopeLabel }}</span>
          </span>
          <span v-if="selectedFile" class="topbar-chip hidden max-w-[20rem] xl:inline-flex">
            <FileText class="h-3.5 w-3.5 shrink-0" />
            <span class="truncate">{{ selectedFileName }}</span>
          </span>
          <span class="topbar-chip hidden max-w-[14rem] sm:inline-flex">
            <Activity class="h-3.5 w-3.5 shrink-0" />
            <span class="truncate">{{ runStateLabel }}</span>
          </span>
          <a
            href="https://github.com/mx1210385980-a11y/IonicLink/tree/main"
            target="_blank"
            rel="noreferrer"
            class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
            title="GitHub"
          >
            <Github class="h-4 w-4" />
          </a>
        </div>
      </header>

      <!-- Page workspace -->
      <main class="flex-1 min-h-0 overflow-hidden">
        <div class="app-workspace flex h-full min-h-0 flex-col gap-3 px-3 py-3 sm:px-4 sm:py-4">
          <HomePage
            v-if="currentView === 'home'"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            :files="batchFiles"
            :active-run="activeExtractionRun"
            :latest-workflow="latestAgentWorkflow"
            :preferred-training-dataset-id="preferredTrainingDatasetId"
            @action="handleHomeAction"
            @open-source="(source) => openReviewTarget({ literatureId: source.literature_id })"
          />

          <PipelinePage
            v-else-if="currentView === 'pipeline'"
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :queue-size-label="queueSizeLabel"
            :operator-name="operatorName"
            :run-state-label="runStateLabel"
            :selected-file-name="selectedFileName"
            :selected-file="selectedFile"
            :selected-file-id="selectedFileId"
            :explorer-doi="explorerDoi"
            :session-scope-key="sessionState.activeScopeKey"
            :files="batchFiles"
            :active-id="selectedFileId"
            :bind-file-upload-ref="bindFileUploadRef"
            :bind-chat-panel-ref="bindChatPanelRef"
            :sidebar-tab="sidebarTab"
            :is-chatting="isChatting"
            :latest-agent-workflow="latestAgentWorkflow"
            :active-run="activeExtractionRun"
            :active-file-name="activeExtractionFileName"
            :default-extractor-type="defaultExtractorType"
            @change-section="handleSectionChange"
            @select-file="setSelectedFile"
            @remove-file="handleRemoveFile"
            @clear-files="handleClearFiles"
            @upload="handleUpload"
            @batch-upload="handleBatchUpload"
            @extract="handleExtract"
            @batch-extract="handleBatchExtract"
            @cancel-extraction="handleCancelExtraction"
            @send-chat="handleChat"
            @update-sidebar-tab="setSidebarTab"
            @open-review="openReviewForCurrentFile"
            @open-knowledge="navigateTo('knowledge', 'explorer')"
            @clear-doi="clearExplorerDoi"
            @set-default-extractor-type="setDefaultExtractorType"
            @set-file-extractor-type="setFileExtractorType"
          />

          <ReviewPage
            v-else-if="currentView === 'review'"
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :selected-file-name="selectedFileName"
            :selected-file="selectedFile"
            :initial-record-id="reviewTargetRecordId"
            :initial-mode="reviewTargetMode"
            :files="batchFiles"
            :highlight-count="groundingHighlightData.length"
            :pdf-url="groundingPdfUrl"
            :highlight-data="groundingHighlightData"
            :scope-key="sessionState.activeScopeKey"
            :reextract-file="handleReviewReextract"
            @change-section="handleSectionChange"
            @select-file="setSelectedFile"
            @open-pipeline="navigateTo('pipeline', 'upload')"
            @open-knowledge="navigateTo('knowledge', 'explorer')"
            @open-dataset-workflow="navigateTo('knowledge', 'datasets')"
          />

          <KnowledgePage
            v-else-if="currentView === 'knowledge'"
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            :selected-file-name="selectedFileName"
            :explorer-doi="explorerDoi"
            :selected-file="selectedFile"
            :selected-file-id="selectedFileId"
            :focus-record-id="focusedRecordId"
            :scope-key="sessionState.activeScopeKey"
            @clear-focused-record="focusedRecordId = null"
            @change-section="handleSectionChange"
            @open-training="openTrainingWorkbench"
            @open-review="openReviewTarget"
            @select-source="setSelectedFile"
            @clear-doi="clearExplorerDoi"
            @clear-source="setSelectedFile(null)"
          />

          <ModelingPage
            v-else-if="currentView === 'modeling'"
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            :preferred-training-dataset-id="preferredTrainingDatasetId"
            :scope-key="sessionState.activeScopeKey"
            @change-section="handleSectionChange"
            @open-knowledge="navigateTo('knowledge', 'cleaning')"
            @inspect-record="(payload) => {
              setSelectedFile(String(payload.literatureId))
              focusedRecordId = payload.recordId ?? null
              navigateTo('knowledge', 'explorer')
            }"
          />

          <QualityMetricsPage
            v-else-if="currentView === 'quality'"
            :files="batchFiles"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
          />

          <AdminPage
            v-else-if="currentView === 'admin'"
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            :run-state-label="runStateLabel"
            :can-access-monitor="canAccessAdmin"
            :latest-agent-workflow="latestAgentWorkflow"
            :active-run="activeExtractionRun"
            :active-file-name="activeExtractionFileName"
            @change-section="handleSectionChange"
            @open-help="navigateTo('help', 'quick-start')"
            @open-home="navigateTo('home', 'today')"
          />

          <HelpPage
            v-else
            :current-section="currentSection"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            @change-section="handleSectionChange"
            @open-pipeline="navigateTo('pipeline', 'upload')"
            @open-blog="navigateTo('blog', 'articles')"
          />
        </div>
      </main>
    </div>
  </div>
</template>
