<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LockKeyhole, LibraryBig, Shield } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'

const props = defineProps<{
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  (e: 'submit', payload: { username: string; password: string }): void
}>()

const username = ref('admin')
const password = ref('ChangeMe123!')

const canSubmit = computed(() => username.value.trim().length >= 3 && password.value.length >= 8 && !props.loading)

function handleSubmit() {
  if (!canSubmit.value) return
  emit('submit', { username: username.value.trim(), password: password.value })
}

watch(
  () => props.error,
  () => {
    password.value = password.value
  },
)
</script>

<template>
  <div class="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(14,165,233,0.18),_transparent_28%),linear-gradient(135deg,_#f8fafc_0%,_#e2e8f0_45%,_#dbeafe_100%)] px-6 py-10 text-slate-900">
    <div class="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-10 lg:grid-cols-[1.1fr_0.9fr]">
      <section class="rounded-[2rem] border border-white/60 bg-white/70 p-8 shadow-[0_24px_90px_rgba(15,23,42,0.12)] backdrop-blur xl:p-10">
        <div class="mb-8 inline-flex items-center gap-3 rounded-full border border-sky-200 bg-sky-50/90 px-4 py-2 text-sm font-semibold text-sky-700">
          <Shield class="h-4 w-4" />
          JWT + RBAC Enabled Workspace
        </div>
        <h1 class="max-w-xl text-4xl font-black tracking-tight text-slate-950 xl:text-5xl">
          课题组多用户文献平台
        </h1>
        <p class="mt-4 max-w-2xl text-base leading-7 text-slate-600">
          个人 Workspace 默认隔离，课题组共享文献库集中沉淀。登录后可以在两种作用域之间切换，所有上传、检索和 PDF Grounding 都会自动带上当前权限上下文。
        </p>

        <div class="mt-10 grid gap-4 md:grid-cols-3">
          <div class="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
            <div class="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <LockKeyhole class="h-5 w-5" />
            </div>
            <h2 class="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">JWT 鉴权</h2>
            <p class="mt-2 text-sm leading-6 text-slate-600">所有 API 请求统一携带访问令牌，后端按用户和作用域校验。</p>
          </div>

          <div class="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
            <div class="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-600 text-white">
              <Shield class="h-5 w-5" />
            </div>
            <h2 class="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">RBAC 权限</h2>
            <p class="mt-2 text-sm leading-6 text-slate-600">管理员、研究员、只读成员权限分离，共享库和私人工作区写权限独立。</p>
          </div>

          <div class="rounded-3xl border border-slate-200 bg-slate-50/80 p-5">
            <div class="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-600 text-white">
              <LibraryBig class="h-5 w-5" />
            </div>
            <h2 class="text-sm font-bold uppercase tracking-[0.18em] text-slate-500">共享文献库</h2>
            <p class="mt-2 text-sm leading-6 text-slate-600">可将验证后的论文沉淀到课题组统一库，避免重复上传与重复抽取。</p>
          </div>
        </div>
      </section>

      <section class="rounded-[2rem] border border-slate-200 bg-slate-950 p-8 text-white shadow-[0_30px_80px_rgba(15,23,42,0.28)] xl:p-10">
        <div class="mb-8">
          <p class="text-sm font-bold uppercase tracking-[0.24em] text-sky-300">Sign In</p>
          <h2 class="mt-3 text-3xl font-black tracking-tight">进入 IonicLink</h2>
          <p class="mt-3 text-sm leading-6 text-slate-300">
            默认管理员账号已通过后端启动时自动初始化。首次登录后建议立即更换密码并新增研究员账号。
          </p>
        </div>

        <form class="space-y-5" @submit.prevent="handleSubmit">
          <label class="block">
            <span class="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Username</span>
            <input
              v-model="username"
              type="text"
              autocomplete="username"
              class="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
            />
          </label>

          <label class="block">
            <span class="mb-2 block text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Password</span>
            <input
              v-model="password"
              type="password"
              autocomplete="current-password"
              class="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-400/30"
            />
          </label>

          <p v-if="error" class="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
            {{ error }}
          </p>

          <Button
            type="submit"
            class="h-12 w-full rounded-2xl bg-sky-500 text-sm font-bold text-white hover:bg-sky-400"
            :disabled="!canSubmit"
          >
            {{ loading ? 'Signing in...' : '进入平台' }}
          </Button>
        </form>

        <div class="mt-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 text-xs leading-6 text-slate-400">
          默认引导账号: <span class="font-semibold text-slate-200">admin / ChangeMe123!</span>
        </div>
      </section>
    </div>
  </div>
</template>
