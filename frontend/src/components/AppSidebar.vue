<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, type Component } from 'vue'
import {
  Beaker,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Database,
  FileText,
  FlaskConical,
  Library,
  LogOut,
  Moon,
  PieChart,
  Search,
  ShieldCheck,
  Server,
  Sun,
  UserCircle2,
} from 'lucide-vue-next'

import LanguageToggle from '@/components/LanguageToggle.vue'
import type { BatchFile } from '@/lib/api'
import type { AppSection, AppView } from '@/lib/platform'

interface NavItem {
  key: AppView
  label: string
  icon: Component
  adminOnly?: boolean
}

interface Scope {
  key: string
  label: string
}

const SIDEBAR_COLLAPSE_STORAGE_KEY = 'ioniclink-sidebar-collapsed'
const AUTO_COLLAPSE_WIDTH = 1440

const props = defineProps<{
  currentView: AppView
  batchFiles: BatchFile[]
  selectedFileId: string | null
  canAccessAdmin: boolean
  operatorName: string
  operatorRole: string
  selectedScopeKey: string
  availableScopes: Scope[]
  isDark: boolean
  isChinese: boolean
}>()

const emit = defineEmits<{
  navigate: [view: AppView, section?: AppSection]
  selectFile: [fileId: string | null]
  toggleDark: []
  logout: []
  'update:selectedScopeKey': [key: string]
}>()

const primaryNav: NavItem[] = [
  { key: 'home',      label: 'Home',      icon: PieChart    },
  { key: 'pipeline',  label: 'Pipeline',  icon: Search      },
  { key: 'review',    label: 'Review',    icon: Library     },
  { key: 'knowledge', label: 'Knowledge', icon: Database    },
  { key: 'quality',   label: 'Quality',   icon: ShieldCheck },
  { key: 'modeling',  label: 'Modeling',  icon: FlaskConical },
]

const secondaryNav: NavItem[] = [
  { key: 'admin', label: 'Admin', icon: Server,   adminOnly: true },
  { key: 'help',  label: 'Help',  icon: BookOpen  },
]

const visibleSecondaryNav = computed(() =>
  secondaryNav.filter((item) => !item.adminOnly || props.canAccessAdmin),
)
const isCollapsed = ref(false)
const hasStoredCollapsePreference = ref(false)
const collapsedPaperItems = computed(() => props.batchFiles.slice(0, 8))

function resolveAutoCollapsed() {
  if (typeof window === 'undefined') return false
  return window.innerWidth < AUTO_COLLAPSE_WIDTH
}

function applyAutoCollapsed() {
  if (hasStoredCollapsePreference.value) return
  isCollapsed.value = resolveAutoCollapsed()
}

function persistCollapsedPreference() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, isCollapsed.value ? '1' : '0')
}

function toggleSidebarCollapse() {
  isCollapsed.value = !isCollapsed.value
  hasStoredCollapsePreference.value = true
  persistCollapsedPreference()
}

function handleResize() {
  applyAutoCollapsed()
}

function statusDotClass(file: BatchFile): string {
  if (file.status === 'processing') return 'bg-blue-400 animate-pulse'
  if (file.status === 'success' && file.hasWarnings) return 'bg-amber-400'
  if (file.status === 'success') return 'bg-emerald-400'
  if (file.status === 'error') return 'bg-red-400'
  if (file.status === 'no_data') return 'bg-slate-500'
  if (file.status === 'cancelled') return 'bg-amber-500'
  return 'bg-slate-600'
}

function statusLabel(file: BatchFile): string {
  if (file.status === 'processing') return props.isChinese ? '处理中' : 'Processing'
  if (file.status === 'success' && file.hasWarnings) return props.isChinese ? '待审核' : 'Review'
  if (file.status === 'success') return props.isChinese ? '完成' : 'Done'
  if (file.status === 'error') return props.isChinese ? '失败' : 'Error'
  if (file.status === 'no_data') return props.isChinese ? '无数据' : 'No data'
  if (file.status === 'cancelled') return props.isChinese ? '已停止' : 'Stopped'
  return props.isChinese ? '已上传' : 'Uploaded'
}

function handlePaperClick(file: BatchFile) {
  emit('selectFile', file.id)
  if (file.status === 'processing' || file.status === 'uploaded') {
    emit('navigate', 'pipeline', 'runs')
  } else if (file.status === 'success' && file.hasWarnings) {
    emit('navigate', 'review', 'inbox')
  } else if (file.status === 'success') {
    emit('navigate', 'knowledge', 'explorer')
  } else if (file.status === 'error' || file.status === 'cancelled') {
    emit('navigate', 'pipeline', 'runs')
  } else {
    emit('navigate', 'pipeline', 'upload')
  }
}

function openScopeLibrary() {
  emit('selectFile', null)
  emit('navigate', 'knowledge', 'explorer')
}

function truncateName(name: string, maxLen = 22): string {
  if (name.length <= maxLen) return name
  const ext = name.lastIndexOf('.')
  if (ext > 0 && name.length - ext <= 5) {
    const base = name.slice(0, ext)
    const extension = name.slice(ext)
    if (base.length > maxLen - extension.length - 1) {
      return base.slice(0, maxLen - extension.length - 2) + '…' + extension
    }
  }
  return name.slice(0, maxLen - 1) + '…'
}

onMounted(() => {
  if (typeof window === 'undefined') return
  const stored = window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY)
  if (stored === '1' || stored === '0') {
    hasStoredCollapsePreference.value = true
    isCollapsed.value = stored === '1'
  } else {
    applyAutoCollapsed()
  }
  window.addEventListener('resize', handleResize)
})

onBeforeUnmount(() => {
  if (typeof window === 'undefined') return
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <aside
    class="relative z-50 flex h-screen shrink-0 flex-col overflow-hidden bg-[#0b1520] text-slate-300 transition-[width] duration-300"
    :class="isCollapsed ? 'w-[4.9rem]' : 'w-[220px]'"
  >
    <button
      type="button"
      class="absolute right-2 top-3 flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition hover:bg-white/6 hover:text-slate-200"
      :title="isCollapsed ? (isChinese ? '展开侧栏' : 'Expand sidebar') : (isChinese ? '收起侧栏' : 'Collapse sidebar')"
      @click="toggleSidebarCollapse"
    >
      <ChevronRight v-if="isCollapsed" class="h-4 w-4" />
      <ChevronLeft v-else class="h-4 w-4" />
    </button>

    <!-- Brand -->
    <div
      class="flex border-b border-white/6"
      :class="isCollapsed ? 'justify-center px-2 py-4' : 'items-center gap-2.5 px-4 py-4'"
    >
      <button
        type="button"
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.6rem] bg-[#f4d18f]/10 text-[#f4d18f] hover:bg-[#f4d18f]/18 transition"
        :title="isChinese ? '打开内容中心' : 'Open Content Center'"
        @click="emit('navigate', 'blog', 'articles')"
      >
        <Beaker class="h-4 w-4" />
      </button>
      <button
        v-if="!isCollapsed"
        type="button"
        class="brand-serif text-[1.1rem] leading-none text-white hover:text-[#f4d18f] transition"
        @click="emit('navigate', 'home')"
      >
        IonicLink
      </button>
    </div>

    <!-- Primary nav -->
    <nav class="mt-2 flex flex-col gap-0.5" :class="isCollapsed ? 'px-2' : 'px-2'">
      <button
        v-for="item in primaryNav"
        :key="item.key"
        type="button"
        class="group relative flex rounded-lg text-[13.5px] font-medium transition-all"
        :class="currentView === item.key
          ? (isCollapsed ? 'justify-center bg-white/8 px-0 py-2.5 text-[#f4d18f]' : 'items-center gap-2.5 bg-white/8 px-2.5 py-2 text-[#f4d18f]')
          : (isCollapsed ? 'justify-center px-0 py-2.5 text-slate-400 hover:bg-white/5 hover:text-slate-100' : 'items-center gap-2.5 px-2.5 py-2 text-slate-400 hover:bg-white/5 hover:text-slate-100')"
        :title="item.label"
        @click="emit('navigate', item.key)"
      >
        <component
          :is="item.icon"
          class="h-4 w-4 shrink-0 transition-colors"
          :class="currentView === item.key ? 'text-[#f4d18f]' : 'text-slate-500 group-hover:text-slate-300'"
        />
        <span v-if="!isCollapsed">{{ item.label }}</span>
        <span
          v-if="item.key === 'review' && batchFiles.some(f => f.status === 'success' && f.hasWarnings)"
          class="h-1.5 w-1.5 rounded-full bg-amber-400"
          :class="isCollapsed ? 'absolute right-2 top-2' : 'ml-auto'"
        />
      </button>
    </nav>

    <!-- Papers section -->
    <div class="mt-3 flex flex-col min-h-0 flex-1">
      <div v-if="!isCollapsed" class="mb-1.5 flex items-center justify-between px-4">
        <p class="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-600">
          {{ isChinese ? '论文' : 'Papers' }}
          <span v-if="batchFiles.length" class="ml-1 text-slate-500">{{ batchFiles.length }}</span>
        </p>
        <button
          type="button"
          class="text-[10px] font-medium text-slate-600 hover:text-[#f4d18f] transition"
          @click="emit('navigate', 'pipeline', 'upload')"
        >
          + {{ isChinese ? '上传' : 'Add' }}
        </button>
      </div>

      <div
        v-if="!isCollapsed"
        class="flex-1 overflow-y-auto px-2 pb-2 scrollbar-hide"
        style="scrollbar-width: none;"
      >
        <button
          type="button"
          class="group mb-1 w-full flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-all"
          :class="selectedFileId === null
            ? 'bg-white/8 text-slate-100'
            : 'hover:bg-white/4 text-slate-400 hover:text-slate-200'"
          @click="openScopeLibrary"
        >
          <Database class="h-3.5 w-3.5 shrink-0 text-slate-600 group-hover:text-slate-400" />
          <span class="flex-1 min-w-0 text-[12.5px] font-medium leading-tight">
            {{ isChinese ? '当前范围总库' : 'Scope Library' }}
          </span>
        </button>

        <div
          v-if="batchFiles.length === 0"
          class="px-2.5 py-3 text-[12px] text-slate-600 text-center leading-5"
        >
          {{ isChinese ? '暂无论文，点击上传开始' : 'No papers yet.' }}
        </div>

        <button
          v-for="file in batchFiles"
          :key="file.id"
          type="button"
          class="group w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-all"
          :class="selectedFileId === file.id
            ? 'bg-white/8 text-slate-100'
            : 'hover:bg-white/4 text-slate-400 hover:text-slate-200'"
          @click="handlePaperClick(file)"
        >
          <FileText class="h-3.5 w-3.5 shrink-0 text-slate-600 group-hover:text-slate-400" />
          <span class="flex-1 min-w-0 text-[12.5px] font-medium truncate leading-tight">
            {{ truncateName(file.name) }}
          </span>
          <span class="shrink-0 flex items-center gap-1">
            <span
              class="inline-block h-1.5 w-1.5 rounded-full"
              :class="statusDotClass(file)"
              :title="statusLabel(file)"
            />
          </span>
        </button>
      </div>

      <div
        v-else
        class="flex flex-1 flex-col items-center gap-2 overflow-y-auto px-2 pb-2 pt-1 scrollbar-hide"
        style="scrollbar-width: none;"
      >
        <button
          type="button"
          class="group flex h-10 w-10 items-center justify-center rounded-xl transition-all"
          :class="selectedFileId === null
            ? 'bg-white/8 text-slate-100'
            : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'"
          :title="isChinese ? '当前范围总库' : 'Scope Library'"
          @click="openScopeLibrary"
        >
          <Database class="h-4 w-4 shrink-0 text-slate-500 group-hover:text-slate-300" />
        </button>

        <button
          type="button"
          class="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-white/4 hover:text-slate-200"
          :title="isChinese ? '上传论文' : 'Upload paper'"
          @click="emit('navigate', 'pipeline', 'upload')"
        >
          <FileText class="h-4 w-4" />
        </button>

        <div class="my-1 h-px w-8 bg-white/8" />

        <button
          v-for="file in collapsedPaperItems"
          :key="file.id"
          type="button"
          class="relative flex h-10 w-10 items-center justify-center rounded-xl transition-all"
          :class="selectedFileId === file.id
            ? 'bg-white/8 text-slate-100'
            : 'text-slate-400 hover:bg-white/4 hover:text-slate-200'"
          :title="truncateName(file.name, 36)"
          @click="handlePaperClick(file)"
        >
          <FileText class="h-4 w-4 text-slate-500" />
          <span
            class="absolute bottom-2 right-2 inline-block h-1.5 w-1.5 rounded-full"
            :class="statusDotClass(file)"
          />
        </button>
      </div>
    </div>

    <!-- Secondary nav + footer -->
    <div class="flex flex-col gap-0.5 border-t border-white/6 px-2 pb-1 pt-2">
      <button
        v-for="item in visibleSecondaryNav"
        :key="item.key"
        type="button"
        class="group flex rounded-lg text-[13px] font-medium transition-all"
        :class="currentView === item.key
          ? (isCollapsed ? 'justify-center bg-white/8 px-0 py-2 text-[#f4d18f]' : 'items-center gap-2.5 bg-white/8 px-2.5 py-1.5 text-[#f4d18f]')
          : (isCollapsed ? 'justify-center px-0 py-2 text-slate-500 hover:bg-white/5 hover:text-slate-300' : 'items-center gap-2.5 px-2.5 py-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300')"
        :title="item.label"
        @click="emit('navigate', item.key)"
      >
        <component :is="item.icon" class="h-3.5 w-3.5 shrink-0" />
        <span v-if="!isCollapsed">{{ item.label }}</span>
      </button>
    </div>

    <!-- Scope selector -->
    <div v-if="!isCollapsed" class="border-t border-white/6 px-3 pb-2 pt-2">
      <label class="block">
        <span class="block text-[9.5px] font-semibold uppercase tracking-[0.22em] text-slate-600 mb-0.5">
          {{ isChinese ? '研究范围' : 'Scope' }}
        </span>
        <select
          :value="selectedScopeKey"
          class="w-full appearance-none bg-white/5 text-[12.5px] font-medium text-slate-300 rounded-md px-2 py-1 outline-none border border-white/8 hover:border-white/14 transition"
          @change="emit('update:selectedScopeKey', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="scope in availableScopes" :key="scope.key" :value="scope.key">
            {{ scope.label }}
          </option>
        </select>
      </label>
    </div>

    <!-- User block -->
    <div
      class="border-t border-white/6"
      :class="isCollapsed ? 'px-2 py-2' : 'px-3 py-2.5'"
    >
      <div
        class="flex"
        :class="isCollapsed ? 'flex-col items-center gap-2' : 'items-center gap-2'"
      >
      <div
        class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/8"
        :title="operatorName"
      >
        <UserCircle2 class="h-4 w-4 text-slate-400" />
      </div>
      <div v-if="!isCollapsed" class="flex-1 min-w-0">
        <p class="text-[12.5px] font-semibold text-slate-200 truncate leading-tight">{{ operatorName }}</p>
        <p class="text-[10px] text-slate-500 uppercase tracking-[0.14em] truncate">{{ operatorRole }}</p>
      </div>
      <div
        class="flex items-center"
        :class="isCollapsed ? 'flex-col gap-1' : 'gap-0.5'"
      >
        <LanguageToggle class="opacity-70 hover:opacity-100 transition" />
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:text-slate-200 hover:bg-white/6 transition"
          :title="isChinese ? '切换主题' : 'Toggle theme'"
          @click="emit('toggleDark')"
        >
          <Sun v-if="isDark" class="h-3.5 w-3.5" />
          <Moon v-else class="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          class="flex h-7 w-7 items-center justify-center rounded-md text-slate-500 hover:text-red-400 hover:bg-white/6 transition"
          :title="isChinese ? '退出登录' : 'Sign out'"
          @click="emit('logout')"
        >
          <LogOut class="h-3.5 w-3.5" />
        </button>
      </div>
      </div>
    </div>
  </aside>
</template>
