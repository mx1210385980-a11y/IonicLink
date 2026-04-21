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
const { isChinese, t } = useI18n()

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
  handleLiteratureView,
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

function openLatestReview() {
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
            :files="batchFiles"
            :highlight-count="groundingHighlightData.length"
            :pdf-url="groundingPdfUrl"
            :highlight-data="groundingHighlightData"
            :scope-key="sessionState.activeScopeKey"
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
            :scope-key="sessionState.activeScopeKey"
            @change-section="handleSectionChange"
            @open-training="openTrainingWorkbench"
            @open-review="handleLiteratureView"
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
