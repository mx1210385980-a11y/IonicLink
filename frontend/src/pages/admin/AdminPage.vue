<script setup lang="ts">
import { computed } from 'vue'

import GettingStarted from '@/components/GettingStarted.vue'
import MonitorView from '@/components/MonitorView.vue'
import PlatformSectionHeader from '@/components/shell/PlatformSectionHeader.vue'
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  currentSection: string
  activeScopeLabel: string
  operatorName: string
  runStateLabel: string
  canAccessMonitor: boolean
  latestAgentWorkflow: any | null
  activeRun: any | null
  activeFileName: string | null
}>()

const emit = defineEmits<{
  'change-section': [section: string]
  'open-help': []
  'open-home': []
}>()

const { isChinese } = useI18n()

const tabs = computed(() => [
  { key: 'runtime', label: isChinese.value ? '运行监控' : 'Runtime Monitor' },
  { key: 'users', label: isChinese.value ? '用户与范围' : 'User And Scope' },
  { key: 'metrics', label: isChinese.value ? '使用指标' : 'Usage Metrics' },
])

const signals = computed(() => [
  {
    key: 'access',
    label: isChinese.value ? '访问级别' : 'Access',
    value: props.canAccessMonitor ? (isChinese.value ? '已授权' : 'Granted') : (isChinese.value ? '受限' : 'Restricted'),
  },
  { key: 'scope', label: isChinese.value ? '当前范围' : 'Active Scope', value: props.activeScopeLabel },
  { key: 'operator', label: isChinese.value ? '当前操作员' : 'Operator', value: props.operatorName },
])
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-3 sm:gap-4">
    <PlatformSectionHeader
      :eyebrow="isChinese ? 'Admin' : 'Admin'"
      :title="isChinese ? '把运行监控和管理能力收束到受权限控制的域。' : 'Place monitoring and administration behind a dedicated, permissioned domain.'"
      :description="isChinese
        ? 'Monitor 不再长期暴露在普通研究流程里，而是作为 Admin / Ops 专区承接健康度、成员和运行时配置。'
        : 'Monitor should stop living in the general research flow and move into an Admin / Ops area for health, members, and runtime configuration.'"
      :tabs="tabs"
      :active-tab="currentSection"
      :signals="signals"
      :primary-action-label="isChinese ? '返回首页' : 'Back To Home'"
      :secondary-action-label="isChinese ? '打开帮助' : 'Open Help'"
      @select-tab="emit('change-section', $event)"
      @primary-action="emit('open-home')"
      @secondary-action="emit('open-help')"
    />

    <div class="shell-surface min-h-0 flex-1 overflow-hidden">
      <MonitorView
        v-if="canAccessMonitor"
        :workflow="latestAgentWorkflow"
        :active-run="activeRun"
        :active-file-name="activeFileName"
      />
      <GettingStarted v-else />
    </div>
  </div>
</template>
