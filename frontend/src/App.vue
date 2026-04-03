<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import {
  ArrowUpRight,
  Beaker,
  BookOpen,
  Database,
  FlaskConical,
  Github,
  Library,
  LogOut,
  Moon,
  PieChart,
  Search,
  Server,
  Sparkles,
  Sun,
  UserCircle2,
} from 'lucide-vue-next'

import AgentStatusPanel from '@/components/AgentStatusPanel.vue'
import ChatPanel from '@/components/ChatPanel.vue'
import Dashboard from '@/components/Dashboard.vue'
import DataCleaningWorkbench from '@/components/DataCleaningWorkbench.vue'
import FileUpload from '@/components/FileUpload.vue'
import GettingStarted from '@/components/GettingStarted.vue'
import IntegratedExplorer from '@/components/IntegratedExplorer.vue'
import LanguageToggle from '@/components/LanguageToggle.vue'
import LiteratureList from '@/components/LiteratureList.vue'
import LoginScreen from '@/components/LoginScreen.vue'
import ModelTrainingWorkbench from '@/components/ModelTrainingWorkbench.vue'
import MonitorView from '@/components/MonitorView.vue'
import SourceGroundingView from '@/components/SourceGroundingView.vue'
import Button from '@/components/ui/Button.vue'
import { useAppShell } from '@/composables/useAppShell'
import { useI18n } from '@/composables/useI18n'

type RoutedView =
  | 'dashboard'
  | 'workspace'
  | 'cleaning'
  | 'predict'
  | 'monitor'
  | 'literature'
  | 'grounding'
  | 'guide'

type NavView = 'guide' | 'workspace' | 'dashboard' | 'cleaning' | 'predict' | 'monitor'

const ADMIN_ROLES = new Set(['principal_investigator', 'group_admin'])
const NAV_ITEMS: Array<{
  key: NavView
  labelKey: 'nav.guide' | 'nav.workspace' | 'nav.dashboard' | 'nav.cleaning' | 'nav.predict' | 'nav.monitor'
  icon: Component
  adminOnly?: boolean
}> = [
  { key: 'guide', labelKey: 'nav.guide', icon: BookOpen },
  { key: 'workspace', labelKey: 'nav.workspace', icon: Search },
  { key: 'dashboard', labelKey: 'nav.dashboard', icon: PieChart },
  { key: 'cleaning', labelKey: 'nav.cleaning', icon: Database },
  { key: 'predict', labelKey: 'nav.predict', icon: FlaskConical },
  { key: 'monitor', labelKey: 'nav.monitor', icon: Server, adminOnly: true },
]

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
  processing: 'status.processing',
  running: 'status.running',
} as const

const fileUploadRef = ref<InstanceType<typeof FileUpload>>()
const chatPanelRef = ref<InstanceType<typeof ChatPanel>>()
const { t } = useI18n()

const {
  activeExtractionFileName,
  activeExtractionRun,
  authError,
  availableScopes,
  batchFiles,
  currentView,
  explorerDoi,
  groundingHighlightData,
  groundingPdfUrl,
  handleBatchExtract,
  handleBatchUpload,
  handleChat,
  handleClearFiles,
  handleExploreData,
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
  openTrainingWorkbench,
  preferredTrainingDatasetId,
  selectedFileId,
  selectedScopeKey,
  sessionState,
  sidebarTab,
  toggleDarkMode,
} = useAppShell(fileUploadRef, chatPanelRef)

const canAccessMonitor = computed(() => ADMIN_ROLES.has(String(sessionState.user?.role || '')))
const visibleNavItems = computed(() => {
  return NAV_ITEMS
    .filter((item) => !item.adminOnly || canAccessMonitor.value)
    .map((item) => ({ ...item, label: t(item.labelKey) }))
})
const selectedFile = computed(() => batchFiles.value.find((file) => file.id === selectedFileId.value) || null)
const queueSizeLabel = computed(() => {
  const count = batchFiles.value.length
  return count === 1 ? t('common.file_count_singular', { count }) : t('common.file_count_plural', { count })
})
const operatorName = computed(() => sessionState.user?.displayName || t('common.operator_default'))
const operatorRole = computed(() => formatMappedLabel(String(sessionState.user?.role || 'member'), roleLabelKeys))
const activeScopeLabel = computed(() => {
  return availableScopes.value.find((scope) => scope.key === selectedScopeKey.value)?.label || t('common.no_active_scope')
})
const runStateLabel = computed(() => formatMappedLabel(String(activeExtractionRun.value?.status || 'idle'), statusLabelKeys))

const viewMeta = computed(() => {
  switch (currentView.value) {
    case 'workspace':
      return {
        eyebrow: t('view.workspace.eyebrow'),
        title: t('view.workspace.title'),
        description: t('view.workspace.description'),
        signals: [
          { key: 'queue', label: t('signal.queue'), value: queueSizeLabel.value },
          { key: 'selected_file', label: t('signal.selected_file'), value: selectedFile.value?.name || t('common.no_file_selected') },
          { key: 'agent_state', label: t('signal.agent_state'), value: runStateLabel.value },
        ],
      }
    case 'dashboard':
      return {
        eyebrow: t('view.dashboard.eyebrow'),
        title: t('view.dashboard.title'),
        description: t('view.dashboard.description'),
        signals: [
          { key: 'scope', label: t('signal.scope'), value: activeScopeLabel.value },
          { key: 'queued_files', label: t('signal.queued_files'), value: queueSizeLabel.value },
          { key: 'operator', label: t('signal.operator'), value: operatorName.value },
        ],
      }
    case 'cleaning':
      return {
        eyebrow: t('view.cleaning.eyebrow'),
        title: t('view.cleaning.title'),
        description: t('view.cleaning.description'),
        signals: [
          { key: 'scope', label: t('signal.scope'), value: activeScopeLabel.value },
          { key: 'queue', label: t('signal.queue'), value: queueSizeLabel.value },
          { key: 'operator', label: t('signal.operator'), value: operatorName.value },
        ],
      }
    case 'predict':
      return {
        eyebrow: t('view.predict.eyebrow'),
        title: t('view.predict.title'),
        description: t('view.predict.description'),
        signals: [
          {
            key: 'dataset_handoff',
            label: t('signal.dataset_handoff'),
            value: preferredTrainingDatasetId.value !== null
              ? t('common.dataset', { id: preferredTrainingDatasetId.value })
              : t('common.awaiting_selection'),
          },
          { key: 'scope', label: t('signal.scope'), value: activeScopeLabel.value },
          { key: 'operator', label: t('signal.operator'), value: operatorName.value },
        ],
      }
    case 'monitor':
      return {
        eyebrow: t('view.monitor.eyebrow'),
        title: t('view.monitor.title'),
        description: canAccessMonitor.value
          ? t('view.monitor.description')
          : t('view.monitor.no_access_description'),
        signals: [
          { key: 'access', label: t('signal.access'), value: canAccessMonitor.value ? t('common.granted') : t('common.restricted') },
          { key: 'scope', label: t('signal.scope'), value: activeScopeLabel.value },
          { key: 'run_state', label: t('signal.run_state'), value: runStateLabel.value },
        ],
      }
    case 'literature':
      return {
        eyebrow: t('view.literature.eyebrow'),
        title: t('view.literature.title'),
        description: t('view.literature.description'),
        signals: [
          { key: 'scope', label: t('signal.scope'), value: activeScopeLabel.value },
          { key: 'queue', label: t('signal.queue'), value: queueSizeLabel.value },
          { key: 'operator', label: t('signal.operator'), value: operatorName.value },
        ],
      }
    case 'grounding':
      return {
        eyebrow: t('view.grounding.eyebrow'),
        title: t('view.grounding.title'),
        description: t('view.grounding.description'),
        signals: [
          { key: 'source', label: t('signal.source'), value: selectedFile.value?.name || t('common.no_file_selected') },
          { key: 'highlights', label: t('signal.highlights'), value: `${groundingHighlightData.value.length}` },
          { key: 'scope', label: t('signal.scope'), value: activeScopeLabel.value },
        ],
      }
    case 'guide':
    default:
      return {
        eyebrow: t('view.guide.eyebrow'),
        title: t('view.guide.title'),
        description: t('view.guide.description'),
        signals: [
          { key: 'mode', label: t('signal.mode'), value: t('common.mode_quickstart') },
          { key: 'scope', label: t('signal.scope'), value: activeScopeLabel.value },
          { key: 'operator', label: t('signal.operator'), value: operatorName.value },
        ],
      }
  }
})

const primaryActionLabel = computed(() => {
  switch (currentView.value) {
    case 'guide':
      return t('action.open_workspace')
    case 'dashboard':
      return t('action.explore_records')
    case 'workspace':
      return t('action.open_library')
    case 'cleaning':
      return t('action.open_model_studio')
    case 'predict':
      return t('action.open_cleaning')
    case 'monitor':
      return canAccessMonitor.value ? t('action.open_dashboard') : t('action.open_guide')
    case 'literature':
      return t('action.open_workspace')
    case 'grounding':
      return t('action.back_to_workspace')
    default:
      return t('action.open_workspace')
  }
})

const secondaryActionLabel = computed(() => {
  switch (currentView.value) {
    case 'guide':
      return t('action.view_dashboard')
    case 'dashboard':
      return t('action.open_library')
    case 'workspace':
      return t('action.review_guide')
    case 'cleaning':
      return t('action.open_workspace')
    case 'predict':
      return t('action.view_dashboard')
    case 'monitor':
      return t('action.review_guide')
    case 'literature':
      return t('action.view_dashboard')
    case 'grounding':
      return t('action.open_library')
    default:
      return t('action.view_dashboard')
  }
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

function setView(view: RoutedView) {
  if (view === 'predict') {
    openTrainingWorkbench(null)
    return
  }
  currentView.value = view
}

function handlePrimaryAction() {
  switch (currentView.value) {
    case 'guide':
      setView('workspace')
      return
    case 'dashboard':
      handleExploreData({})
      return
    case 'workspace':
      setView('literature')
      return
    case 'cleaning':
      setView('predict')
      return
    case 'predict':
      setView('cleaning')
      return
    case 'monitor':
      setView(canAccessMonitor.value ? 'dashboard' : 'guide')
      return
    case 'literature':
      setView('workspace')
      return
    case 'grounding':
      setView('workspace')
      return
  }
}

function handleSecondaryAction() {
  switch (currentView.value) {
    case 'guide':
      setView('dashboard')
      return
    case 'dashboard':
      setView('literature')
      return
    case 'workspace':
      setView('guide')
      return
    case 'cleaning':
      setView('workspace')
      return
    case 'predict':
      setView('dashboard')
      return
    case 'monitor':
      setView('guide')
      return
    case 'literature':
      setView('dashboard')
      return
    case 'grounding':
      setView('literature')
      return
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

  <div v-else class="app-shell relative flex min-h-screen flex-col bg-background text-foreground">
    <div class="pointer-events-none absolute inset-0 overflow-hidden">
      <div class="absolute left-[-10rem] top-[-12rem] h-[30rem] w-[30rem] rounded-full bg-[#e4bf78]/18 blur-3xl dark:bg-[#e4bf78]/8" />
      <div class="absolute right-[-12rem] top-[8rem] h-[26rem] w-[26rem] rounded-full bg-sky-300/16 blur-3xl dark:bg-sky-400/10" />
      <div class="absolute bottom-[-14rem] left-[20%] h-[28rem] w-[28rem] rounded-full bg-emerald-200/18 blur-3xl dark:bg-emerald-300/8" />
    </div>

    <header class="relative z-40 border-b border-black/8 bg-[rgba(251,248,242,0.72)] backdrop-blur-2xl dark:border-white/10 dark:bg-[rgba(8,16,26,0.78)]">
      <div class="px-4 py-4 sm:px-6">
        <div class="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div class="flex items-start gap-4">
            <div class="flex h-14 w-14 items-center justify-center rounded-[1.4rem] border border-black/8 bg-[#0d1724] text-[#f4d18f] shadow-[0_16px_40px_-26px_rgba(15,23,42,0.95)] dark:border-white/10 dark:bg-[#101b29]">
              <Beaker class="h-6 w-6" />
            </div>
            <div>
              <p class="text-[11px] font-semibold uppercase tracking-[0.32em] text-slate-500 dark:text-slate-400">{{ t('header.platform_eyebrow') }}</p>
              <h1 class="brand-serif text-[2rem] leading-none text-slate-950 dark:text-white">IonicLink</h1>
              <p class="mt-2 max-w-2xl text-sm leading-6 text-slate-600 dark:text-slate-300">
                {{ t('header.platform_description') }}
              </p>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 xl:justify-end">
            <div class="inline-flex min-w-[14rem] items-center gap-3 rounded-full border border-black/8 bg-white/75 px-4 py-2.5 text-sm shadow-[0_10px_30px_-24px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-[#0d1825]/85">
              <Library class="h-4 w-4 text-[#c79237]" />
              <label class="min-w-0 flex-1">
                <span class="block text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">{{ t('common.active_scope') }}</span>
                <select
                  v-model="selectedScopeKey"
                  class="mt-0.5 w-full appearance-none bg-transparent text-sm font-semibold text-slate-800 outline-none dark:text-slate-100"
                >
                  <option v-for="scope in availableScopes" :key="scope.key" :value="scope.key">
                    {{ scope.label }}
                  </option>
                </select>
              </label>
            </div>

            <div class="hidden min-w-[14rem] items-center gap-3 rounded-full border border-black/8 bg-white/75 px-4 py-2.5 text-sm shadow-[0_10px_30px_-24px_rgba(15,23,42,0.45)] dark:border-white/10 dark:bg-[#0d1825]/85 md:inline-flex">
              <UserCircle2 class="h-5 w-5 text-slate-400" />
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{{ operatorName }}</p>
                <p class="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">{{ operatorRole }}</p>
              </div>
            </div>

            <LanguageToggle />

            <Button
              variant="ghost"
              size="icon"
              class="h-11 w-11 rounded-full border border-black/8 bg-white/75 text-slate-700 hover:bg-white dark:border-white/10 dark:bg-[#0d1825]/85 dark:text-slate-200 dark:hover:bg-[#132131]"
              @click="toggleDarkMode"
            >
              <Sun v-if="isDark" class="h-5 w-5" />
              <Moon v-else class="h-5 w-5" />
            </Button>

            <a
              href="https://github.com/mx1210385980-a11y/IonicLink/tree/main"
              target="_blank"
              rel="noreferrer"
              class="inline-flex h-11 w-11 items-center justify-center rounded-full border border-black/8 bg-white/75 text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-[#0d1825]/85 dark:text-slate-200 dark:hover:bg-[#132131]"
            >
              <Github class="h-5 w-5" />
            </a>

            <Button
              variant="ghost"
              size="icon"
              class="h-11 w-11 rounded-full border border-black/8 bg-white/75 text-slate-700 hover:bg-white dark:border-white/10 dark:bg-[#0d1825]/85 dark:text-slate-200 dark:hover:bg-[#132131]"
              @click="handleLogout"
            >
              <LogOut class="h-5 w-5" />
            </Button>
          </div>
        </div>

        <nav class="mt-4 flex gap-2 overflow-x-auto pb-1">
          <button
            v-for="item in visibleNavItems"
            :key="item.key"
            type="button"
            class="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition"
            :class="currentView === item.key
              ? 'border-transparent bg-[#101b29] text-[#f4d18f] shadow-[0_16px_34px_-24px_rgba(15,23,42,0.9)] dark:bg-[#f4d18f] dark:text-[#111827]'
              : 'border-black/8 bg-white/72 text-slate-600 hover:bg-white hover:text-slate-900 dark:border-white/10 dark:bg-[#0d1825]/78 dark:text-slate-300 dark:hover:bg-[#132131] dark:hover:text-white'"
            @click="setView(item.key)"
          >
            <component :is="item.icon" class="h-4 w-4" />
            {{ item.label }}
          </button>
        </nav>
      </div>
    </header>

    <main class="relative z-10 flex-1 min-h-0 overflow-hidden">
      <div class="flex h-full min-h-0 flex-col gap-3 px-3 pb-3 pt-3 sm:gap-4 sm:px-4 sm:pb-4">
        <section class="shell-surface-strong overflow-hidden px-5 py-5 sm:px-6 lg:px-7 lg:py-6">
          <div class="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:items-end">
            <div>
              <div class="inline-flex items-center gap-2 rounded-full border border-[#d8c39a]/60 bg-[#f8eedb]/70 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-[#9b6b17] dark:border-[#6b5221]/70 dark:bg-[#22190d]/70 dark:text-[#f1ca80]">
                <Sparkles class="h-3.5 w-3.5" />
                {{ viewMeta.eyebrow }}
              </div>
              <h2 class="mt-4 max-w-4xl text-3xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white sm:text-4xl">
                {{ viewMeta.title }}
              </h2>
              <p class="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300 sm:text-[15px]">
                {{ viewMeta.description }}
              </p>

              <div class="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full bg-[#111827] px-5 py-3 text-sm font-semibold text-[#f7d496] transition hover:bg-[#1f2937] dark:bg-[#f1cc82] dark:text-[#111827] dark:hover:bg-[#f6d79d]"
                  @click="handlePrimaryAction"
                >
                  {{ primaryActionLabel }}
                  <ArrowUpRight class="h-4 w-4" />
                </button>
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full border border-black/10 bg-white/72 px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-[#0e1826]/80 dark:text-slate-200 dark:hover:bg-[#132131]"
                  @click="handleSecondaryAction"
                >
                  {{ secondaryActionLabel }}
                </button>
              </div>
            </div>

            <div class="grid gap-4 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              <div
                v-for="signal in viewMeta.signals"
                :key="signal.key"
                class="border-l border-black/10 pl-4 dark:border-white/10"
              >
                <p class="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400 dark:text-slate-500">{{ signal.label }}</p>
                <p class="mt-2 text-sm font-semibold leading-6 text-slate-800 dark:text-slate-100">{{ signal.value }}</p>
              </div>
            </div>
          </div>
        </section>

        <div class="min-h-0 flex-1">
          <div v-if="currentView === 'dashboard'" class="shell-surface h-full overflow-hidden">
            <Dashboard :key="sessionState.activeScopeKey" @open-library="currentView = 'literature'" @explore-data="handleExploreData" />
          </div>

          <div v-else-if="currentView === 'cleaning'" class="shell-surface h-full overflow-hidden">
            <DataCleaningWorkbench :key="sessionState.activeScopeKey" @open-training="openTrainingWorkbench" />
          </div>

          <div v-else-if="currentView === 'predict'" class="shell-surface h-full overflow-hidden">
            <ModelTrainingWorkbench
              :key="sessionState.activeScopeKey"
              :preselected-cleaned-dataset-id="preferredTrainingDatasetId"
            />
          </div>

          <div v-else-if="currentView === 'workspace'" class="flex h-full min-h-0 flex-col gap-3 overflow-auto xl:flex-row xl:overflow-hidden">
            <aside class="shell-surface min-h-[22rem] w-full overflow-hidden xl:min-h-0 xl:w-[21rem]">
              <FileUpload
                ref="fileUploadRef"
                :files="batchFiles"
                :active-id="selectedFileId"
                @select="(id) => selectedFileId = id"
                @remove="handleRemoveFile"
                @clear="handleClearFiles"
                @upload="handleUpload"
                @batch-upload="handleBatchUpload"
                @extract="handleExtract"
                @batch-extract="handleBatchExtract"
              />
            </aside>

            <main class="shell-surface min-h-[32rem] min-w-0 flex-1 overflow-hidden xl:min-h-0">
              <IntegratedExplorer
                :key="sessionState.activeScopeKey"
                :initial-doi="explorerDoi"
                :selected-file-id="selectedFileId"
                :source-name="selectedFile?.name"
                :literature-metadata="selectedFile?.metadata"
                @view-literature="handleLiteratureView"
                @clear-doi="explorerDoi = ''"
              />
            </main>

            <aside class="shell-surface min-h-[24rem] w-full overflow-hidden xl:min-h-0 xl:w-[24rem]">
              <div class="border-b border-black/8 p-2 dark:border-white/10">
                <div class="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    class="rounded-full px-3 py-2 text-sm font-semibold transition"
                    :class="sidebarTab === 'chat'
                      ? 'bg-[#101b29] text-[#f4d18f] shadow-[0_14px_28px_-20px_rgba(15,23,42,0.9)] dark:bg-[#f4d18f] dark:text-[#111827]'
                      : 'bg-transparent text-slate-500 hover:bg-black/[0.04] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100'"
                    @click="sidebarTab = 'chat'"
                  >
                    {{ t('common.ai_assistant') }}
                  </button>
                  <button
                    type="button"
                    class="rounded-full px-3 py-2 text-sm font-semibold transition"
                    :class="sidebarTab === 'agents'
                      ? 'bg-[#101b29] text-[#f4d18f] shadow-[0_14px_28px_-20px_rgba(15,23,42,0.9)] dark:bg-[#f4d18f] dark:text-[#111827]'
                      : 'bg-transparent text-slate-500 hover:bg-black/[0.04] hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/[0.05] dark:hover:text-slate-100'"
                    @click="sidebarTab = 'agents'"
                  >
                    {{ t('common.coordination') }}
                  </button>
                </div>
              </div>

              <div class="relative min-h-0 flex-1 bg-white/35 dark:bg-[#050c14]/60">
                <ChatPanel
                  v-show="sidebarTab === 'chat'"
                  ref="chatPanelRef"
                  class="absolute inset-0"
                  :loading="isChatting"
                  @send="handleChat"
                />
                <AgentStatusPanel
                  v-show="sidebarTab === 'agents'"
                  class="absolute inset-0"
                  :workflow="latestAgentWorkflow"
                  :active-run="activeExtractionRun"
                  :active-file-name="activeExtractionFileName"
                />
              </div>
            </aside>
          </div>

          <div v-else-if="currentView === 'monitor'" class="shell-surface h-full overflow-hidden">
            <MonitorView
              v-if="canAccessMonitor"
              :workflow="latestAgentWorkflow"
              :active-run="activeExtractionRun"
              :active-file-name="activeExtractionFileName"
            />
            <GettingStarted v-else />
          </div>

          <div v-else-if="currentView === 'literature'" class="shell-surface h-full overflow-hidden">
            <LiteratureList :key="sessionState.activeScopeKey" />
          </div>

          <div v-else-if="currentView === 'grounding'" class="shell-surface h-full overflow-hidden">
            <SourceGroundingView :pdf-url="groundingPdfUrl" :highlight-data="groundingHighlightData" />
          </div>

          <div v-else class="shell-surface h-full overflow-hidden">
            <GettingStarted />
          </div>
        </div>
      </div>
    </main>
  </div>
</template>
