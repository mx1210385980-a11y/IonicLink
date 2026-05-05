<script setup lang="ts">
import { computed, ref } from 'vue'
import { Github } from 'lucide-vue-next'

import AppSidebar from '@/components/AppSidebar.vue'
import BlogView from '@/components/BlogView.vue'
import FileUpload from '@/components/FileUpload.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import LoginScreen from '@/components/LoginScreen.vue'
import type { HomeSuggestedAction } from '@/composables/useHomeSummary'
import { useAppShell } from '@/composables/useAppShell'
import { useI18n } from '@/composables/useI18n'
import { getLiteratureDetails, type BatchFile, type TribologyData, type ValidationStatus } from '@/lib/api'
import type { AppSection, AppView } from '@/lib/platform'
import AdminPage from '@/pages/admin/AdminPage.vue'
import HelpPage from '@/pages/help/HelpPage.vue'
import HomePage from '@/pages/home/HomePage.vue'
import KnowledgePage from '@/pages/knowledge/KnowledgePage.vue'
import ModelingPage from '@/pages/modeling/ModelingPage.vue'
import PipelinePage from '@/pages/pipeline/PipelinePage.vue'
import ReviewPage from '@/pages/review/ReviewPage.vue'

type FileUploadBridge = InstanceType<typeof FileUpload>
type ChatPanelBridge = InstanceType<typeof ChatPanel>

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

// 从异常诊断面板跳转过来时高亮的目标记录 id（一次性，用户切走后清掉）
const focusedRecordId = ref<number | null>(null)
const reviewTargetRecordId = ref<string | null>(null)
const { isChinese, t } = useI18n()

type ReviewTarget = {
  literatureId?: number | null
  recordId?: number | null
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
    return
  }

  try {
    const details = await getLiteratureDetails(literatureId)
    const records = (details.tribologyData || []).map(normalizeReviewRecord)
    const batchFile: BatchFile = {
      id: String(literatureId),
      name: details.title || details.doi || `Literature ${literatureId}`,
      status: 'success',
      progress: 100,
      progressMessage: 'Loaded from literature library',
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

async function openReviewTarget(target?: ReviewTarget) {
  reviewTargetRecordId.value = target?.recordId ? String(target.recordId) : null

  if (target?.literatureId) {
    await ensureReviewFileForTarget(target)
    selectedFileId.value = String(target.literatureId)
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
  <div v-if="!sessionState.ready" class="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#07111a] px-6 text-white">
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(232,185,104,0.18),transparent_32%),radial-gradient(circle_at_bottom_right,_rgba(56,189,248,0.12),transparent_28%)]" />
    <div class="shell-surface-strong relative w-full max-w-xl px-8 py-8 text-center">
      <p class="text-[11px] font-semibold uppercase tracking-[0.32em] text-[#d9b266]">IonicLink</p>
      <h1 class="brand-serif mt-4 text-4xl text-white">{{ t('loading.restore_title') }}</h1>
      <p class="mt-3 text-sm leading-7 text-slate-300">
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

  <div v-else class="app-shell relative flex h-screen overflow-hidden bg-background text-foreground">
    <!-- Ambient gradient orbs -->
    <div class="pointer-events-none absolute inset-0 overflow-hidden z-0">
      <div class="absolute left-[220px] top-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#e4bf78]/14 blur-3xl dark:bg-[#e4bf78]/6" />
      <div class="absolute right-[-12rem] top-[8rem] h-[26rem] w-[26rem] rounded-full bg-sky-300/12 blur-3xl dark:bg-sky-400/8" />
      <div class="absolute bottom-[-14rem] left-[30%] h-[28rem] w-[28rem] rounded-full bg-emerald-200/14 blur-3xl dark:bg-emerald-300/6" />
    </div>

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
    <div class="relative z-10 flex flex-1 flex-col min-w-0 min-h-0">
      <!-- Minimal top bar -->
      <header class="flex h-11 shrink-0 items-center gap-3 border-b border-black/8 bg-[rgba(251,248,242,0.72)] px-4 backdrop-blur-xl dark:border-white/8 dark:bg-[rgba(8,16,26,0.72)]">
        <h2 class="text-[13px] font-semibold capitalize text-slate-700 dark:text-slate-200">
          {{ currentView }}
        </h2>
        <div class="ml-auto flex items-center gap-1.5">
          <a
            href="https://github.com/mx1210385980-a11y/IonicLink/tree/main"
            target="_blank"
            rel="noreferrer"
            class="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 hover:text-slate-700 hover:bg-black/5 transition dark:text-slate-500 dark:hover:text-slate-200 dark:hover:bg-white/6"
          >
            <Github class="h-3.5 w-3.5" />
          </a>
        </div>
      </header>

      <!-- Page workspace -->
      <main class="flex-1 min-h-0 overflow-hidden">
        <div class="flex h-full min-h-0 flex-col gap-3 px-3 pb-3 pt-3 sm:gap-4 sm:px-4 sm:pb-4">
          <HomePage
            v-if="currentView === 'home'"
            :active-scope-label="activeScopeLabel"
            :operator-name="operatorName"
            :files="batchFiles"
            :active-run="activeExtractionRun"
            :latest-workflow="latestAgentWorkflow"
            :preferred-training-dataset-id="preferredTrainingDatasetId"
            @action="handleHomeAction"
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
            @send-chat="handleChat"
            @update-sidebar-tab="setSidebarTab"
            @open-review="navigateTo('review', 'inbox')"
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
