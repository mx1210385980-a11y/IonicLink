<script setup lang="ts">
import { computed, ref } from 'vue'

type AdminModal = 'detail' | 'account' | 'activity' | null

interface MemberRow {
  id: number
  displayName: string
  username: string
  lastActive: string
  role: string
  roleLabel: string
  roleTone: 'blue' | 'green'
  avatarTone: string
  completedPapers: number
  totalPapers: number
  directionCount: number
  trend: number[]
  trendTone: string
  adminNote: string
  accountStatus: string
  recentActivity: string[]
}

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

const selectedMemberId = ref(1)
const activeModal = ref<AdminModal>(null)

const memberRows: MemberRow[] = [
  {
    id: 1,
    displayName: '程远舟',
    username: 'chengyuanzhou',
    lastActive: '今天 10:18',
    role: 'researcher',
    roleLabel: '研究员',
    roleTone: 'blue',
    avatarTone: 'bg-teal-50 text-teal-700',
    completedPapers: 18,
    totalPapers: 24,
    directionCount: 3,
    trend: [18, 28, 36, 44, 52, 63, 70],
    trendTone: '#0f766e',
    adminNote: '负责扩散模块。重点看 diffusion 文献、扩散系数和字段模板是否稳定。',
    accountStatus: '账号正常，保留扩散模块相关权限即可。',
    recentActivity: ['上传 diffusion 文献 3 篇', '查看扩散字段模板', '重新运行 1 篇提取'],
  },
  {
    id: 2,
    displayName: '朱俊宇',
    username: 'zhujunyu',
    lastActive: '今天 09:36',
    role: 'researcher',
    roleLabel: '研究员',
    roleTone: 'blue',
    avatarTone: 'bg-blue-50 text-blue-700',
    completedPapers: 12,
    totalPapers: 18,
    directionCount: 2,
    trend: [12, 18, 20, 32, 38, 44, 48],
    trendTone: '#15803d',
    adminNote: '负责电导模块。优先关注 conductivity、EIS 和迁移数相关数据。',
    accountStatus: '账号正常，保留电导模块相关权限即可。',
    recentActivity: ['上传电导文献 2 篇', '核对 conductivity 字段', '查看 EIS 数据记录'],
  },
  {
    id: 3,
    displayName: 'Julyanffzz',
    username: 'Julyanffzz',
    lastActive: '刚刚',
    role: 'principal_investigator',
    roleLabel: '管理员',
    roleTone: 'green',
    avatarTone: 'bg-orange-50 text-orange-700',
    completedPapers: 26,
    totalPapers: 30,
    directionCount: 5,
    trend: [36, 42, 55, 58, 66, 74, 82],
    trendTone: '#b45309',
    adminNote: '负责整体模块。重点看账号权限、抽取流程和模块之间的数据衔接。',
    accountStatus: '管理员账号正常，可管理成员、模块权限和平台配置。',
    recentActivity: ['调整 Monitor 页面', '检查成员权限', '查看整体抽取进度'],
  },
]

const selectedMember = computed<MemberRow>(() =>
  memberRows.find((member) => member.id === selectedMemberId.value) || memberRows[0] as MemberRow,
)

const activeMembersCount = computed(() => memberRows.filter((member) => member.lastActive !== '7 天前').length)
const totalPapers = computed(() => memberRows.reduce((sum, member) => sum + member.totalPapers, 0))
const completedPapers = computed(() => memberRows.reduce((sum, member) => sum + member.completedPapers, 0))
const pendingPapers = computed(() => Math.max(0, totalPapers.value - completedPapers.value))
const completionRate = computed(() => Math.round((completedPapers.value / Math.max(1, totalPapers.value)) * 100))
const attentionItems = computed(() => 4)

const memberComparisonRows = computed(() =>
  memberRows.map((member) => ({
    id: member.id,
    name: member.displayName,
    total: member.totalPapers,
    completedPercent: Math.round((member.completedPapers / Math.max(1, member.totalPapers)) * 100),
    pendingPercent: Math.round(((member.totalPapers - member.completedPapers) / Math.max(1, member.totalPapers)) * 100),
    directions: member.directionCount,
  })),
)

function selectMember(member: MemberRow) {
  selectedMemberId.value = member.id
}

function openModal(type: Exclude<AdminModal, null>, member: MemberRow) {
  selectedMemberId.value = member.id
  activeModal.value = type
}

function closeModal() {
  activeModal.value = null
}

function percent(member: MemberRow) {
  return Math.round((member.completedPapers / Math.max(1, member.totalPapers)) * 100)
}

function sparklinePoints(values: number[]) {
  const width = 128
  const height = 38
  const max = Math.max(...values)
  const min = Math.min(...values)
  const range = Math.max(1, max - min)

  return values
    .map((value, index) => {
      const x = 4 + (index / Math.max(1, values.length - 1)) * (width - 8)
      const y = height - 6 - ((value - min) / range) * (height - 12)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function modalTitle() {
  if (activeModal.value === 'detail') return '详情'
  if (activeModal.value === 'account') return '账号'
  if (activeModal.value === 'activity') return '活动'
  return ''
}
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-[#f7fafc] text-slate-900">
    <div v-if="canAccessMonitor" class="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6">
      <section class="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
        <div>
          <p class="text-xs font-black uppercase tracking-[0.22em] text-slate-400">Admin</p>
          <h1 class="mt-2 text-2xl font-black tracking-tight text-slate-950">成员使用情况</h1>
          <p class="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
            表格是主界面。文献详情、账号设置和活动记录通过弹窗打开，系统提示直接放在对应成员旁边。
          </p>
        </div>
        <div class="flex flex-wrap gap-2 lg:justify-end">
          <button class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm">
            导出本页
          </button>
          <button class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 shadow-sm">
            刷新
          </button>
          <button class="h-9 rounded-lg bg-teal-700 px-3 text-sm font-bold text-white shadow-sm hover:bg-teal-600">
            新建成员
          </button>
        </div>
      </section>

      <section class="mb-3 grid overflow-hidden rounded-xl border border-slate-200 bg-slate-200 shadow-sm sm:grid-cols-2 xl:grid-cols-4">
        <div class="flex min-h-[74px] items-center justify-between gap-3 bg-white px-4 py-3">
          <div>
            <p class="text-xs font-black text-slate-500">本周活跃</p>
            <p class="mt-1 text-2xl font-black text-slate-950">{{ activeMembersCount }} / {{ memberRows.length }}</p>
          </div>
          <div class="flex h-9 w-24 items-end gap-1">
            <span class="h-3 w-2 rounded-t bg-teal-100" />
            <span class="h-5 w-2 rounded-t bg-teal-100" />
            <span class="h-7 w-2 rounded-t bg-teal-700" />
            <span class="h-4 w-2 rounded-t bg-teal-100" />
            <span class="h-8 w-2 rounded-t bg-teal-700" />
            <span class="h-5 w-2 rounded-t bg-teal-100" />
            <span class="h-7 w-2 rounded-t bg-teal-700" />
            <span class="h-4 w-2 rounded-t bg-teal-100" />
          </div>
        </div>
        <div class="flex min-h-[74px] items-center justify-between gap-3 bg-white px-4 py-3">
          <div>
            <p class="text-xs font-black text-slate-500">文献完成</p>
            <p class="mt-1 text-2xl font-black text-slate-950">{{ completionRate }}%</p>
          </div>
          <div class="w-28">
            <div class="h-2 overflow-hidden rounded-full bg-slate-200">
              <div class="h-full rounded-full bg-teal-700" :style="{ width: `${completionRate}%` }" />
            </div>
            <p class="mt-2 text-xs font-semibold text-slate-500">{{ completedPapers }} / {{ totalPapers }} 篇</p>
          </div>
        </div>
        <div class="flex min-h-[74px] items-center justify-between gap-3 bg-white px-4 py-3">
          <div>
            <p class="text-xs font-black text-slate-500">待管理员处理</p>
            <p class="mt-1 text-2xl font-black text-slate-950">{{ attentionItems }} 项</p>
          </div>
          <span class="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-black text-orange-700">
            {{ pendingPapers }} 篇未完成
          </span>
        </div>
        <div class="flex min-h-[74px] items-center justify-between gap-3 bg-white px-4 py-3">
          <div>
            <p class="text-xs font-black text-slate-500">最多卡点</p>
            <p class="mt-1 text-2xl font-black text-slate-950">校验</p>
          </div>
          <div class="flex h-9 w-20 items-end gap-1">
            <span class="h-2 w-2 rounded-t bg-slate-200" />
            <span class="h-3 w-2 rounded-t bg-slate-200" />
            <span class="h-4 w-2 rounded-t bg-slate-200" />
            <span class="h-9 w-2 rounded-t bg-orange-400" />
            <span class="h-6 w-2 rounded-t bg-orange-300" />
            <span class="h-2 w-2 rounded-t bg-slate-200" />
          </div>
        </div>
      </section>

      <section class="rounded-t-xl border border-b-0 border-slate-200 bg-white p-3">
        <div class="grid gap-2 lg:grid-cols-[minmax(280px,1fr)_132px_132px_148px]">
          <div class="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
            搜索姓名、账号、研究方向或最近处理的文献
          </div>
          <button class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm font-bold text-slate-700">
            状态：全部
          </button>
          <button class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm font-bold text-slate-700">
            角色：全部
          </button>
          <button class="h-10 rounded-lg border border-slate-200 bg-white px-3 text-left text-sm font-bold text-slate-700">
            需处理优先
          </button>
        </div>
      </section>

      <section class="overflow-hidden rounded-b-xl border border-slate-200 bg-white shadow-sm">
        <div class="overflow-x-auto">
          <table class="min-w-[1080px] w-full table-fixed border-collapse">
            <thead>
              <tr class="bg-slate-50 text-left text-sm font-black text-slate-500">
                <th class="w-[320px] px-5 py-4">成员</th>
                <th class="w-[150px] px-4 py-4">角色</th>
                <th class="w-[220px] px-4 py-4">完成情况</th>
                <th class="w-[170px] px-4 py-4">近 7 天</th>
                <th class="px-4 py-4">提示</th>
                <th class="w-[250px] px-5 py-4 text-right">操作</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr
                v-for="member in memberRows"
                :key="member.id"
                class="transition"
                :class="selectedMember.id === member.id ? 'bg-teal-50/70' : 'bg-white hover:bg-slate-50'"
                @click="selectMember(member)"
              >
                <td class="px-5 py-4">
                  <div class="flex items-center gap-3">
                    <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-base font-black" :class="member.avatarTone">
                      {{ member.displayName.slice(0, 1) }}
                    </div>
                    <div class="min-w-0">
                      <p class="truncate text-lg font-black text-slate-950">{{ member.displayName }}</p>
                      <p class="mt-0.5 truncate text-sm text-slate-500">@{{ member.username }} · {{ member.lastActive }}</p>
                    </div>
                  </div>
                </td>
                <td class="px-4 py-4">
                  <span
                    class="inline-flex h-8 items-center rounded-full border px-3 text-sm font-black"
                    :class="member.roleTone === 'green'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                      : 'border-blue-200 bg-blue-50 text-blue-700'"
                  >
                    {{ member.roleLabel }}
                  </span>
                </td>
                <td class="px-4 py-4">
                  <div class="h-2.5 w-48 overflow-hidden rounded-full bg-slate-200">
                    <div
                      class="h-full rounded-full"
                      :class="percent(member) > 80 ? 'bg-emerald-700' : percent(member) < 30 ? 'bg-orange-700' : 'bg-teal-700'"
                      :style="{ width: `${percent(member)}%` }"
                    />
                  </div>
                  <p class="mt-2 text-base text-slate-600">{{ member.completedPapers }} / {{ member.totalPapers }} 篇</p>
                </td>
                <td class="px-4 py-4">
                  <svg class="h-10 w-32" viewBox="0 0 128 38" aria-hidden="true">
                    <polyline
                      :points="sparklinePoints(member.trend)"
                      fill="none"
                      :stroke="member.trendTone"
                      stroke-width="4"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    />
                  </svg>
                </td>
                <td class="px-4 py-4 text-[15px] leading-6 text-slate-600">
                  {{ member.adminNote }}
                </td>
                <td class="px-5 py-4">
                  <div class="flex justify-end gap-2">
                    <button class="h-11 rounded-xl border border-slate-200 bg-white px-4 text-base font-black text-slate-900" @click.stop="openModal('detail', member)">
                      详情
                    </button>
                    <button class="h-11 rounded-xl border border-slate-200 bg-white px-4 text-base font-black text-slate-900" @click.stop="openModal('account', member)">
                      账号
                    </button>
                    <button class="h-11 rounded-xl border border-slate-200 bg-white px-4 text-base font-black text-slate-900" @click.stop="openModal('activity', member)">
                      活动
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div class="flex items-center justify-between px-5 py-4 text-sm text-slate-500">
          <span>第 1 页，共 3 名成员</span>
          <div class="flex gap-2">
            <button class="h-10 rounded-xl border border-slate-200 bg-white px-4 font-black text-slate-900">上一页</button>
            <button class="h-10 rounded-xl border border-slate-200 bg-white px-4 font-black text-slate-900">下一页</button>
          </div>
        </div>
      </section>

      <section class="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center justify-between gap-3">
            <h2 class="text-base font-black text-slate-950">成员对比</h2>
            <span class="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-black text-blue-700">可折叠模块</span>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <div v-for="item in memberComparisonRows" :key="item.id" class="rounded-xl border border-slate-100 bg-slate-50 p-3">
              <p class="text-sm font-black text-slate-900">{{ item.name }}</p>
              <div class="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-200">
                <div class="bg-teal-700" :style="{ width: `${item.completedPercent}%` }" />
                <div class="bg-orange-300" :style="{ width: `${item.pendingPercent}%` }" />
              </div>
              <p class="mt-2 text-xs text-slate-500">{{ item.total }} 篇 · {{ item.directions }} 个方向</p>
            </div>
          </div>
        </div>

        <aside class="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div class="mb-3 flex items-center justify-between gap-3">
            <h2 class="text-base font-black text-slate-950">弹窗内容示意</h2>
            <span class="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-600">不常驻</span>
          </div>
          <div class="space-y-3 text-sm leading-6 text-slate-600">
            <p><span class="font-black text-slate-900">详情：</span>文献列表、字段、证据页、流程卡点放在抽屉里。</p>
            <p><span class="font-black text-slate-900">账号：</span>编辑角色、重置密码、停用账号放在弹窗里。</p>
            <p><span class="font-black text-slate-900">活动：</span>登录、上传、提取、修改记录单独分页查看。</p>
          </div>
        </aside>
      </section>
    </div>

    <div v-else class="flex min-h-[360px] items-center justify-center p-6">
      <div class="max-w-md rounded-xl border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p class="text-lg font-black text-slate-950">需要管理员权限</p>
        <p class="mt-2 text-sm leading-6 text-slate-600">当前账号不能查看成员使用情况。请联系管理员调整角色。</p>
        <div class="mt-4 flex justify-center gap-2">
          <button class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700" @click="emit('open-home')">
            返回首页
          </button>
          <button class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700" @click="emit('open-help')">
            打开帮助
          </button>
        </div>
      </div>
    </div>

    <div v-if="activeModal" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4" @click.self="closeModal">
      <section class="w-full max-w-xl rounded-2xl bg-white shadow-2xl">
        <div class="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <p class="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{{ modalTitle() }}</p>
            <h2 class="mt-1 text-xl font-black text-slate-950">{{ selectedMember.displayName }}</h2>
          </div>
          <button class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700" @click="closeModal">
            关闭
          </button>
        </div>
        <div class="space-y-4 px-5 py-5">
          <div v-if="activeModal === 'detail'" class="space-y-3 text-sm leading-6 text-slate-600">
            <p><span class="font-black text-slate-900">Papers: </span>{{ selectedMember.completedPapers }} / {{ selectedMember.totalPapers }} completed.</p>
            <p><span class="font-black text-slate-900">Directions: </span>{{ selectedMember.directionCount }}</p>
            <p><span class="font-black text-slate-900">Note: </span>{{ selectedMember.adminNote }}</p>
          </div>
          <div v-else-if="activeModal === 'account'" class="space-y-3 text-sm leading-6 text-slate-600">
            <p><span class="font-black text-slate-900">Role: </span>{{ selectedMember.roleLabel }}</p>
            <p><span class="font-black text-slate-900">Status: </span>{{ selectedMember.accountStatus }}</p>
            <div class="flex flex-wrap gap-2 pt-1">
              <button class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">Edit role</button>
              <button class="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700">Reset password</button>
              <button class="h-9 rounded-lg border border-orange-200 bg-orange-50 px-3 text-sm font-bold text-orange-700">Disable account</button>
            </div>
          </div>
          <div v-else class="space-y-3">
            <div v-for="activity in selectedMember.recentActivity" :key="activity" class="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
              {{ activity }}
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
