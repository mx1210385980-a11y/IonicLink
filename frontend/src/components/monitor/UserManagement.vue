<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Activity,
  Gauge,
  KeyRound,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCog,
  UserPlus,
} from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
import Input from '@/components/ui/Input.vue'
import Modal from '@/components/ui/Modal.vue'
import {
  createUser,
  deleteUser,
  getGroupActivitySummary,
  getMonitorUsers,
  getUserTimeline,
  resetUserPassword,
  toggleUserActive,
  updateUser,
  type ActivityLogEntry,
  type GroupActivitySummary,
  type UserUsageStats,
} from '@/lib/api'
import {
  buildRegistrationSuccessState,
  createEmptyRegistrationForm,
  getRoleLabel,
  normalizeRegistrationPayload,
  prioritizeHighlightedUser,
  registrationRoleOptions,
  validateRegistrationForm,
} from '@/components/monitor/userRegistration'

const emit = defineEmits<{
  (e: 'user-updated'): void
}>()

const users = ref<UserUsageStats[]>([])
const groupSummary = ref<GroupActivitySummary | null>(null)
const loading = ref(false)
const error = ref('')
const searchQuery = ref('')
const highlightedUserId = ref<number | null>(null)

const showCreateModal = ref(false)
const showEditModal = ref(false)
const showDeleteModal = ref(false)
const showResetPasswordModal = ref(false)
const showTimelineModal = ref(false)

const modalLoading = ref(false)
const modalError = ref('')
const selectedUser = ref<UserUsageStats | null>(null)

const registrationForm = ref(createEmptyRegistrationForm())
const registrationLoading = ref(false)
const registrationError = ref('')
const registrationSuccess = ref<ReturnType<typeof buildRegistrationSuccessState> | null>(null)

const editForm = ref({
  displayName: '',
  role: 'researcher',
})
const newPassword = ref('')

const timeline = ref<ActivityLogEntry[]>([])
const timelineTotal = ref(0)
const timelineLoading = ref(false)

const registrationErrors = computed(() => validateRegistrationForm(registrationForm.value))
const canCreateUser = computed(() => Object.keys(registrationErrors.value).length === 0 && !registrationLoading.value)

const filteredUsers = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  const nextUsers = keyword
    ? users.value.filter((user) => {
        return (
          user.username.toLowerCase().includes(keyword)
          || user.display_name.toLowerCase().includes(keyword)
          || getRoleLabel(user.role).toLowerCase().includes(keyword)
        )
      })
    : users.value

  return prioritizeHighlightedUser(nextUsers, highlightedUserId.value)
})

const sidebarMembers = computed(() => users.value.slice(0, 8))

async function fetchData() {
  loading.value = true
  error.value = ''

  try {
    const [usersRes, summaryRes] = await Promise.all([getMonitorUsers(), getGroupActivitySummary()])
    users.value = usersRes.items
    groupSummary.value = summaryRes
    if (highlightedUserId.value != null && !users.value.some((user) => user.user_id === highlightedUserId.value)) {
      highlightedUserId.value = null
    }
  } catch (e: any) {
    error.value = e?.response?.data?.detail || e?.message || '加载成员数据失败。'
  } finally {
    loading.value = false
  }
}

function openCreateModal() {
  registrationForm.value = createEmptyRegistrationForm()
  registrationError.value = ''
  modalError.value = ''
  showCreateModal.value = true
}

async function handleCreateUser() {
  const errors = validateRegistrationForm(registrationForm.value)
  if (Object.keys(errors).length > 0) {
    registrationError.value = Object.values(errors)[0] || '请先修正表单后再提交。'
    return
  }

  registrationLoading.value = true
  registrationError.value = ''

  try {
    const response = await createUser(normalizeRegistrationPayload(registrationForm.value))
    registrationSuccess.value = buildRegistrationSuccessState(response.user)
    highlightedUserId.value = response.user.id
    searchQuery.value = ''
    showCreateModal.value = false
    registrationForm.value = createEmptyRegistrationForm()
    await fetchData()
    emit('user-updated')
  } catch (e: any) {
    registrationError.value = e?.response?.data?.detail || e?.message || '创建成员失败。'
  } finally {
    registrationLoading.value = false
  }
}

function openEditModal(user: UserUsageStats) {
  selectedUser.value = user
  editForm.value = {
    displayName: user.display_name,
    role: user.role,
  }
  modalError.value = ''
  showEditModal.value = true
}

async function handleEdit() {
  if (!selectedUser.value) return

  modalLoading.value = true
  modalError.value = ''
  try {
    await updateUser(selectedUser.value.user_id, {
      displayName: editForm.value.displayName.trim(),
      role: editForm.value.role,
    })
    showEditModal.value = false
    await fetchData()
    emit('user-updated')
  } catch (e: any) {
    modalError.value = e?.response?.data?.detail || e?.message || '更新成员失败。'
  } finally {
    modalLoading.value = false
  }
}

function openDeleteModal(user: UserUsageStats) {
  selectedUser.value = user
  modalError.value = ''
  showDeleteModal.value = true
}

async function handleDelete() {
  if (!selectedUser.value) return

  modalLoading.value = true
  modalError.value = ''
  try {
    await deleteUser(selectedUser.value.user_id)
    showDeleteModal.value = false
    if (highlightedUserId.value === selectedUser.value.user_id) {
      highlightedUserId.value = null
    }
    await fetchData()
    emit('user-updated')
  } catch (e: any) {
    modalError.value = e?.response?.data?.detail || e?.message || '删除成员失败。'
  } finally {
    modalLoading.value = false
  }
}

function openResetPasswordModal(user: UserUsageStats) {
  selectedUser.value = user
  newPassword.value = ''
  modalError.value = ''
  showResetPasswordModal.value = true
}

async function handleResetPassword() {
  if (!selectedUser.value) return
  if (newPassword.value.length < 8) {
    modalError.value = '新密码至少需要 8 位。'
    return
  }

  modalLoading.value = true
  modalError.value = ''
  try {
    await resetUserPassword(selectedUser.value.user_id, newPassword.value)
    showResetPasswordModal.value = false
  } catch (e: any) {
    modalError.value = e?.response?.data?.detail || e?.message || '重置密码失败。'
  } finally {
    modalLoading.value = false
  }
}

async function handleToggleActive(user: UserUsageStats) {
  error.value = ''
  try {
    await toggleUserActive(user.user_id)
    await fetchData()
    emit('user-updated')
  } catch (e: any) {
    error.value = e?.response?.data?.detail || e?.message || '切换账号状态失败。'
  }
}

async function openTimelineModal(user: UserUsageStats) {
  selectedUser.value = user
  timeline.value = []
  timelineTotal.value = 0
  modalError.value = ''
  showTimelineModal.value = true
  await loadTimeline()
}

async function loadTimeline() {
  if (!selectedUser.value) return

  timelineLoading.value = true
  try {
    const response = await getUserTimeline(selectedUser.value.user_id, 0, 100)
    timeline.value = response.items
    timelineTotal.value = response.total
  } catch (e: any) {
    modalError.value = e?.response?.data?.detail || e?.message || '加载活动记录失败。'
  } finally {
    timelineLoading.value = false
  }
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '--'
  return new Date(dateStr).toLocaleString('zh-CN')
}

function formatRelativeTime(dateStr: string | null) {
  if (!dateStr) return '--'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMins = Math.floor((now.getTime() - date.getTime()) / 60000)

  if (diffMins < 1) return '刚刚'
  if (diffMins < 60) return `${diffMins} 分钟前`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours} 小时前`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) return `${diffDays} 天前`

  return formatDate(dateStr)
}

function getRoleBadgeClass(role: string) {
  switch (role) {
    case 'principal_investigator':
      return 'border-amber-300 bg-amber-50 text-amber-700'
    case 'group_admin':
      return 'border-violet-300 bg-violet-50 text-violet-700'
    case 'researcher':
      return 'border-emerald-300 bg-emerald-50 text-emerald-700'
    default:
      return 'border-slate-300 bg-slate-50 text-slate-600'
  }
}

function getSidebarDotClass(role: string) {
  switch (role) {
    case 'principal_investigator':
      return 'bg-amber-400'
    case 'group_admin':
      return 'bg-emerald-400'
    case 'researcher':
      return 'bg-sky-400'
    default:
      return 'bg-slate-300'
  }
}

onMounted(() => {
  void fetchData()
})
</script>

<template>
  <div class="h-full overflow-hidden bg-[#f4f7fb] text-slate-900">
    <div class="grid h-full min-h-0 grid-cols-1 md:grid-cols-[232px_minmax(0,1fr)]">
      <aside class="flex min-h-0 flex-col border-r border-slate-200 bg-white">
        <div class="flex items-center gap-3 border-b border-slate-200 px-4 py-4">
          <div class="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-600 text-white shadow-sm">
            <Sparkles class="h-4 w-4" />
          </div>
          <div>
            <p class="text-[13px] font-black text-slate-900">AI Data Platform</p>
          </div>
        </div>

        <div class="min-h-0 flex-1 overflow-auto px-4 py-5">
          <div>
            <p class="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">管理模块</p>
            <div class="space-y-2">
              <button class="flex w-full items-center gap-3 rounded-xl bg-indigo-50 px-3 py-3 text-left text-sm font-semibold text-indigo-700">
                <UserCog class="h-4 w-4" />
                用户管理（开通台）
              </button>
              <div class="flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-slate-700">
                <Gauge class="h-4 w-4" />
                系统全局监控
              </div>
            </div>
          </div>

          <div class="mt-10">
            <p class="mb-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">监控填空学生/成员</p>
            <div class="space-y-4">
              <div v-for="user in sidebarMembers" :key="user.user_id" class="flex items-start gap-3 text-sm text-slate-700">
                <span class="mt-1.5 h-2 w-2 rounded-full" :class="getSidebarDotClass(user.role)" />
                <div class="min-w-0">
                  <p class="truncate font-medium text-slate-800">{{ user.display_name }}</p>
                  <p class="truncate text-xs text-slate-400">@{{ user.username }}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <main class="min-h-0 overflow-auto bg-[#f6f8fc]">
        <div class="mx-auto max-w-[1180px] px-6 py-6 lg:px-8">
          <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <h1 class="text-[20px] font-black tracking-tight text-slate-950 md:text-[22px]">研究组成员开通台</h1>
              <p class="mt-2 text-sm text-slate-600">
                在这里直接建研究组账号、分配角色，并追踪每位成员的登录与使用情况。
              </p>
            </div>

            <div class="flex flex-wrap gap-3">
              <Button variant="outline" class="h-11 rounded-xl border-slate-200 bg-white px-4 text-slate-700 shadow-sm" :loading="loading" @click="fetchData">
                <RefreshCw class="h-4 w-4" />
                刷新数据
              </Button>
              <Button class="h-11 rounded-xl bg-violet-600 px-4 text-white shadow-[0_10px_20px_rgba(109,40,217,0.24)] hover:bg-violet-500" @click="openCreateModal">
                <UserPlus class="h-4 w-4" />
                新建成员
              </Button>
            </div>
          </div>

          <div v-if="registrationSuccess" class="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 shadow-sm">
            已成功创建成员 <span class="font-semibold">{{ registrationSuccess.displayName }}</span>（@{{ registrationSuccess.username }}），
            角色为 {{ getRoleLabel(registrationSuccess.role) }}，系统已自动创建个人工作区。
          </div>

          <div class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card class="rounded-[20px] border border-slate-200/80 bg-white shadow-sm">
              <CardContent class="p-5">
                <p class="text-sm text-slate-500">总成员数</p>
                <p class="mt-2 text-4xl font-black tracking-tight text-slate-950">{{ groupSummary?.total_users ?? '--' }}</p>
                <p class="mt-3 text-xs text-slate-400">当前研究组已开通账号总量</p>
              </CardContent>
            </Card>
            <Card class="rounded-[20px] border border-slate-200/80 bg-white shadow-sm">
              <CardContent class="p-5">
                <p class="text-sm text-slate-500">今日活跃</p>
                <p class="mt-2 text-4xl font-black tracking-tight text-slate-950">{{ groupSummary?.active_users_today ?? '--' }}</p>
                <p class="mt-3 text-xs text-slate-400">今天有操作记录的成员</p>
              </CardContent>
            </Card>
            <Card class="rounded-[20px] border border-slate-200/80 bg-white shadow-sm">
              <CardContent class="p-5">
                <p class="text-sm text-slate-500">本周活跃</p>
                <p class="mt-2 text-4xl font-black tracking-tight text-slate-950">{{ groupSummary?.active_users_week ?? '--' }}</p>
                <p class="mt-3 text-xs text-slate-400">最近 7 天有活动的成员</p>
              </CardContent>
            </Card>
            <Card class="rounded-[20px] border border-slate-200/80 bg-white shadow-sm">
              <CardContent class="p-5">
                <p class="text-sm text-slate-500">累计上传</p>
                <p class="mt-2 text-4xl font-black tracking-tight text-slate-950">{{ groupSummary?.total_uploads ?? '--' }}</p>
                <p class="mt-3 text-xs text-slate-400">组内历史上传次数</p>
              </CardContent>
            </Card>
          </div>

          <Card class="mt-6 overflow-hidden rounded-[22px] border border-slate-200/80 bg-white shadow-sm">
            <CardContent class="p-0">
              <div class="flex flex-col gap-4 border-b border-slate-200 px-5 py-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 class="text-[18px] font-bold text-slate-900">成员列表</h2>
                </div>
                <div class="relative w-full md:max-w-sm">
                  <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    v-model="searchQuery"
                    placeholder="搜索用户名、显示名或角色"
                    class="h-11 rounded-xl border-slate-200 bg-white pl-10 shadow-sm"
                  />
                </div>
              </div>

              <div v-if="error" class="border-b border-rose-100 bg-rose-50 px-5 py-3 text-sm text-rose-700">
                {{ error }}
              </div>

              <div class="overflow-auto">
                <table class="min-w-full text-sm">
                  <thead class="bg-slate-50/80 text-left text-xs font-semibold text-slate-500">
                    <tr>
                      <th class="px-5 py-4">成员</th>
                      <th class="px-4 py-4">角色</th>
                      <th class="px-4 py-4">状态</th>
                      <th class="px-4 py-4">登录</th>
                      <th class="px-4 py-4">最近活动</th>
                      <th class="px-5 py-4 text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody class="divide-y divide-slate-100">
                    <tr
                      v-for="user in filteredUsers"
                      :key="user.user_id"
                      :class="highlightedUserId === user.user_id ? 'bg-violet-50/60' : 'bg-white'"
                    >
                      <td class="px-5 py-4">
                        <div class="flex items-center gap-3">
                          <div
                            class="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold"
                            :class="highlightedUserId === user.user_id ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-700'"
                          >
                            {{ user.display_name.slice(0, 1).toUpperCase() }}
                          </div>
                          <div class="min-w-0">
                            <div class="flex items-center gap-2">
                              <p class="truncate font-semibold text-slate-900">{{ user.display_name }}</p>
                              <span
                                v-if="highlightedUserId === user.user_id"
                                class="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-700"
                              >
                                <Sparkles class="h-3 w-3" />
                                新建
                              </span>
                            </div>
                            <p class="truncate text-xs text-slate-500">@{{ user.username }}</p>
                          </div>
                        </div>
                      </td>
                      <td class="px-4 py-4">
                        <span class="inline-flex rounded-full border px-3 py-1 text-xs font-semibold" :class="getRoleBadgeClass(user.role)">
                          {{ getRoleLabel(user.role) }}
                        </span>
                      </td>
                      <td class="px-4 py-4">
                        <span v-if="user.is_active" class="inline-flex items-center gap-1.5 text-sm text-slate-700">
                          <span class="h-2 w-2 rounded-full bg-emerald-500" />
                          正常
                        </span>
                        <span v-else class="inline-flex items-center gap-1.5 text-sm text-slate-500">
                          <span class="h-2 w-2 rounded-full bg-rose-400" />
                          停用
                        </span>
                      </td>
                      <td class="px-4 py-4 text-slate-700">{{ user.login_count }}</td>
                      <td class="px-4 py-4 text-slate-500">{{ formatRelativeTime(user.last_activity_at) }}</td>
                      <td class="px-5 py-4">
                        <div class="flex items-center justify-end gap-1">
                          <button class="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" title="查看活动" @click="openTimelineModal(user)">
                            <Activity class="h-4 w-4" />
                          </button>
                          <button class="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" title="编辑成员" @click="openEditModal(user)">
                            <UserCog class="h-4 w-4" />
                          </button>
                          <button class="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" title="重置密码" @click="openResetPasswordModal(user)">
                            <KeyRound class="h-4 w-4" />
                          </button>
                          <button class="rounded-lg p-2 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700" :title="user.is_active ? '停用账号' : '启用账号'" @click="handleToggleActive(user)">
                            <ShieldCheck class="h-4 w-4" />
                          </button>
                          <button class="rounded-lg p-2 text-slate-400 transition hover:bg-rose-100 hover:text-rose-600" title="删除成员" @click="openDeleteModal(user)">
                            <Trash2 class="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    <tr v-if="filteredUsers.length === 0 && !loading">
                      <td colspan="6" class="px-5 py-10 text-center text-sm text-slate-500">没有匹配的成员记录。</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
    </div>

    <Modal :show="showCreateModal" max-width="xl" @close="showCreateModal = false">
      <template #header>
        <div class="flex items-center gap-2">
          <UserPlus class="h-5 w-5 text-violet-600" />
          <span>新建研究组成员</span>
        </div>
      </template>

      <div class="grid gap-5 md:grid-cols-[1.1fr_0.9fr]">
        <div class="space-y-4">
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-700">用户名</label>
            <Input v-model="registrationForm.username" placeholder="例如 julyanffzz" />
            <p v-if="registrationErrors.username" class="mt-2 text-xs text-rose-600">{{ registrationErrors.username }}</p>
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-700">显示名称</label>
            <Input v-model="registrationForm.displayName" placeholder="例如 张三（Student）" />
            <p v-if="registrationErrors.displayName" class="mt-2 text-xs text-rose-600">{{ registrationErrors.displayName }}</p>
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-700">初始密码</label>
            <Input v-model="registrationForm.password" type="password" placeholder="至少 8 位" />
            <p v-if="registrationErrors.password" class="mt-2 text-xs text-rose-600">{{ registrationErrors.password }}</p>
          </div>
          <div>
            <label class="mb-2 block text-sm font-medium text-slate-700">确认密码</label>
            <Input v-model="registrationForm.confirmPassword" type="password" placeholder="再次输入密码" />
            <p v-if="registrationErrors.confirmPassword" class="mt-2 text-xs text-rose-600">{{ registrationErrors.confirmPassword }}</p>
          </div>
        </div>

        <div class="space-y-3">
          <p class="text-sm font-medium text-slate-700">成员角色</p>
          <label
            v-for="option in registrationRoleOptions"
            :key="option.value"
            class="flex cursor-pointer gap-3 rounded-2xl border px-4 py-4 transition"
            :class="registrationForm.role === option.value ? 'border-violet-300 bg-violet-50' : 'border-slate-200 hover:border-slate-300'"
          >
            <input v-model="registrationForm.role" :value="option.value" type="radio" class="mt-1 h-4 w-4 accent-violet-600">
            <div>
              <p class="font-semibold text-slate-900">{{ option.label }}</p>
              <p class="mt-1 text-sm leading-6 text-slate-500">{{ option.description }}</p>
            </div>
          </label>
          <p v-if="registrationErrors.role" class="text-xs text-rose-600">{{ registrationErrors.role }}</p>

          <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600">
            创建完成后，系统会自动分配个人工作区，并立即纳入当前研究组的权限体系。
          </div>
        </div>

        <div v-if="registrationError" class="md:col-span-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {{ registrationError }}
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="showCreateModal = false">取消</Button>
          <Button :loading="registrationLoading" :disabled="!canCreateUser" @click="handleCreateUser">创建成员</Button>
        </div>
      </template>
    </Modal>

    <Modal :show="showEditModal" max-width="md" @close="showEditModal = false">
      <template #header>
        <div class="flex items-center gap-2">
          <UserCog class="h-5 w-5 text-violet-600" />
          <span>编辑成员资料</span>
        </div>
      </template>
      <div class="space-y-4">
        <div>
          <label class="mb-2 block text-sm font-medium text-slate-700">显示名称</label>
          <Input v-model="editForm.displayName" placeholder="输入显示名称" />
        </div>
        <div>
          <label class="mb-2 block text-sm font-medium text-slate-700">角色</label>
          <select v-model="editForm.role" class="w-full rounded-md border border-slate-200 px-3 py-2 text-sm focus:border-violet-500 focus:outline-none focus:ring-1 focus:ring-violet-500">
            <option v-for="option in registrationRoleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </div>
        <div v-if="modalError" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ modalError }}</div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="showEditModal = false">取消</Button>
          <Button :loading="modalLoading" @click="handleEdit">保存</Button>
        </div>
      </template>
    </Modal>

    <Modal :show="showDeleteModal" max-width="sm" @close="showDeleteModal = false">
      <template #header>
        <div class="flex items-center gap-2 text-rose-600">
          <Trash2 class="h-5 w-5" />
          <span>确认删除成员</span>
        </div>
      </template>
      <div class="space-y-4">
        <p class="text-sm leading-6 text-slate-600">
          确定要删除 <span class="font-semibold text-slate-900">{{ selectedUser?.display_name }}</span>
          （@{{ selectedUser?.username }}）吗？该操作不可撤销。
        </p>
        <div v-if="modalError" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ modalError }}</div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="showDeleteModal = false">取消</Button>
          <Button variant="destructive" :loading="modalLoading" @click="handleDelete">删除</Button>
        </div>
      </template>
    </Modal>

    <Modal :show="showResetPasswordModal" max-width="sm" @close="showResetPasswordModal = false">
      <template #header>
        <div class="flex items-center gap-2">
          <KeyRound class="h-5 w-5 text-violet-600" />
          <span>重置成员密码</span>
        </div>
      </template>
      <div class="space-y-4">
        <p class="text-sm text-slate-600">为 <span class="font-semibold text-slate-900">{{ selectedUser?.display_name }}</span> 设置新的登录密码。</p>
        <div>
          <label class="mb-2 block text-sm font-medium text-slate-700">新密码</label>
          <Input v-model="newPassword" type="password" placeholder="至少 8 位" />
        </div>
        <div v-if="modalError" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ modalError }}</div>
      </div>
      <template #footer>
        <div class="flex justify-end gap-2">
          <Button variant="outline" @click="showResetPasswordModal = false">取消</Button>
          <Button :loading="modalLoading" @click="handleResetPassword">确认重置</Button>
        </div>
      </template>
    </Modal>

    <Modal :show="showTimelineModal" max-width="2xl" @close="showTimelineModal = false">
      <template #header>
        <div class="flex items-center gap-2">
          <Activity class="h-5 w-5 text-violet-600" />
          <span>{{ selectedUser?.display_name }} 的活动记录</span>
        </div>
      </template>
      <div class="max-h-[60vh] overflow-auto">
        <div v-if="timelineLoading" class="flex items-center justify-center py-10">
          <RefreshCw class="h-6 w-6 animate-spin text-slate-400" />
        </div>
        <div v-else-if="timeline.length === 0" class="py-10 text-center text-sm text-slate-500">
          暂无活动记录。
        </div>
        <div v-else class="space-y-3">
          <div v-for="entry in timeline" :key="entry.id" class="rounded-2xl border border-slate-100 bg-white p-4">
            <div class="flex items-start justify-between gap-3">
              <div>
                <p class="font-medium text-slate-900">{{ entry.action_label }}</p>
                <p class="mt-1 text-xs text-slate-500">{{ formatDate(entry.created_at) }}</p>
              </div>
              <span class="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600">{{ entry.action_type }}</span>
            </div>
            <div v-if="entry.action_detail" class="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              <pre class="whitespace-pre-wrap">{{ JSON.stringify(entry.action_detail, null, 2) }}</pre>
            </div>
          </div>
        </div>
        <div v-if="modalError && !timelineLoading" class="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{{ modalError }}</div>
      </div>
      <template #footer>
        <div class="flex items-center justify-between">
          <span class="text-sm text-slate-500">共 {{ timelineTotal }} 条记录</span>
          <Button variant="outline" @click="showTimelineModal = false">关闭</Button>
        </div>
      </template>
    </Modal>
  </div>
</template>
