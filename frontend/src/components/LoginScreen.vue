<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, FlaskConical, KeyRound } from 'lucide-vue-next'

import LanguageToggle from '@/components/LanguageToggle.vue'
import Button from '@/components/ui/Button.vue'

const props = defineProps<{
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  (e: 'submit', payload: { username: string; password: string }): void
}>()

const username = ref('')
const password = ref('')

const canSubmit = computed(() => {
  return username.value.trim().length >= 3 && password.value.length >= 8 && !props.loading
})

function handleSubmit() {
  if (!canSubmit.value) return
  emit('submit', {
    username: username.value.trim(),
    password: password.value,
  })
}
</script>

<template>
  <div class="min-h-screen bg-[#f8fafb] text-slate-950">
    <div class="pointer-events-none fixed inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[#16868b]/35 to-transparent" />

    <div class="mx-auto flex min-h-screen w-full max-w-[1120px] flex-col px-5 py-6 sm:px-8 lg:px-10">
      <header class="flex items-center justify-between">
        <div class="inline-flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-[10px] border border-[#bfe8e9] bg-white text-[#0f7c82] shadow-[0_12px_34px_-24px_rgba(15,124,130,0.85)]">
            <FlaskConical class="h-5 w-5" />
          </div>
          <div>
            <p class="text-[11px] font-black uppercase tracking-[0.24em] text-[#0f7c82]">IonicLink</p>
            <p class="mt-0.5 text-xs font-semibold text-slate-400">Research extraction lab</p>
          </div>
        </div>
        <LanguageToggle />
      </header>

      <main class="flex flex-1 items-center justify-center py-6">
        <section class="w-full max-w-[30rem]">
          <div class="text-center">
            <div class="mx-auto mb-3 inline-flex items-center gap-2 rounded-full border border-[#d5eef0] bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-[0.18em] text-[#0f7c82] shadow-[0_12px_32px_-26px_rgba(15,124,130,0.85)]">
              <span class="h-1.5 w-1.5 rounded-full bg-[#0f7c82]" />
              Literature OS
            </div>
            <h1 class="text-3xl font-black tracking-[0.01em] text-slate-900 sm:text-5xl">Sign in</h1>
            <p class="mt-3 text-base font-medium text-slate-500 sm:text-lg">
              Need access?
              <span class="font-semibold text-[#0f7c82] underline decoration-[#0f7c82]/45 underline-offset-4">Ask your administrator</span>
            </p>
          </div>

          <form class="mx-auto mt-8 w-full max-w-[30rem] sm:mt-10" novalidate @submit.prevent="handleSubmit">
            <div class="grid gap-3">
              <button
                type="button"
                class="group grid h-12 grid-cols-[3.25rem_minmax(0,1fr)_3.25rem] items-center rounded-[10px] border border-slate-200 bg-white text-sm font-semibold text-slate-950 shadow-[0_14px_34px_-28px_rgba(15,23,42,0.62)] transition hover:border-[#9debed] hover:shadow-[0_18px_42px_-32px_rgba(15,124,130,0.72)] focus:outline-none focus:ring-2 focus:ring-[#93e7e8] sm:h-14 sm:text-base"
                title="OAuth connector is not enabled yet"
              >
                <svg class="mx-auto h-5 w-5 text-black" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
                  <path d="M12 .5A11.5 11.5 0 0 0 8.36 22.9c.58.11.79-.25.79-.56v-2.02c-3.22.7-3.9-1.38-3.9-1.38-.52-1.34-1.28-1.7-1.28-1.7-1.05-.72.08-.71.08-.71 1.16.08 1.77 1.2 1.77 1.2 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.57-.29-5.27-1.29-5.27-5.73 0-1.27.45-2.3 1.2-3.12-.13-.29-.52-1.47.1-3.07 0 0 .98-.31 3.17 1.19A11 11 0 0 1 12 5.53c.98 0 1.96.13 2.88.39 2.19-1.5 3.16-1.19 3.16-1.19.63 1.6.24 2.78.12 3.07.75.82 1.19 1.85 1.19 3.12 0 4.45-2.7 5.43-5.28 5.72.42.36.79 1.07.79 2.16v3.54c0 .31.21.68.8.56A11.5 11.5 0 0 0 12 .5Z" />
                </svg>
                <span>Continue with Github</span>
                <ArrowRight class="mx-auto h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#0f7c82] sm:h-5 sm:w-5" />
              </button>

              <button
                type="button"
                class="group grid h-12 grid-cols-[3.25rem_minmax(0,1fr)_3.25rem] items-center rounded-[10px] border border-slate-200 bg-white text-sm font-semibold text-slate-950 shadow-[0_14px_34px_-28px_rgba(15,23,42,0.62)] transition hover:border-[#9debed] hover:shadow-[0_18px_42px_-32px_rgba(15,124,130,0.72)] focus:outline-none focus:ring-2 focus:ring-[#93e7e8] sm:h-14 sm:text-base"
                title="OAuth connector is not enabled yet"
              >
                <svg class="mx-auto h-5 w-5" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M23.49 12.27c0-.82-.07-1.42-.22-2.04H12.24v3.95h6.48c-.13.98-.84 2.45-2.41 3.44l-.02.13 3.5 2.45.24.02c2.2-1.84 3.46-4.55 3.46-7.95Z" />
                  <path fill="#34A853" d="M12.24 22.64c3.14 0 5.78-.94 7.79-2.42l-3.72-2.6c-.99.63-2.32 1.07-4.07 1.07a7.08 7.08 0 0 1-6.7-4.43l-.13.01-3.64 2.55-.05.12a11.74 11.74 0 0 0 10.52 5.7Z" />
                  <path fill="#FBBC05" d="M5.54 14.26a6.56 6.56 0 0 1-.38-2.19c0-.76.14-1.5.37-2.19l-.01-.14-3.68-2.58-.12.05A10.3 10.3 0 0 0 .5 12.07c0 1.75.46 3.4 1.22 4.87l3.82-2.68Z" />
                  <path fill="#EA4335" d="M12.24 5.45c2.18 0 3.65.85 4.49 1.57l3.38-2.98C18.03 2.29 15.38 1.5 12.24 1.5A11.74 11.74 0 0 0 1.72 7.21l3.81 2.67a7.11 7.11 0 0 1 6.71-4.43Z" />
                </svg>
                <span>Continue with Google</span>
                <ArrowRight class="mx-auto h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-[#0f7c82] sm:h-5 sm:w-5" />
              </button>
            </div>

            <div class="my-6 flex items-center gap-5 sm:my-7">
              <span class="h-px flex-1 bg-slate-200" />
              <span class="text-sm font-medium text-slate-400">or</span>
              <span class="h-px flex-1 bg-slate-200" />
            </div>

            <div class="space-y-5">
              <label class="block">
                <span class="mb-2 block text-sm font-bold text-slate-800">Work email</span>
                <input
                  v-model="username"
                  type="email"
                  autocomplete="username"
                  placeholder="name@yourwork.com"
                  class="h-12 w-full rounded-[10px] border border-slate-200 bg-white px-4 text-base font-medium text-slate-900 shadow-[0_14px_34px_-30px_rgba(15,23,42,0.7)] outline-none transition placeholder:text-slate-400 focus:border-[#93e7e8] focus:ring-4 focus:ring-[#93e7e8]/25 sm:h-14"
                >
              </label>

              <label class="block">
                <span class="mb-2 block text-sm font-bold text-slate-800">Password</span>
                <input
                  v-model="password"
                  type="password"
                  autocomplete="current-password"
                  placeholder="Password"
                  class="h-12 w-full rounded-[10px] border border-slate-200 bg-white px-4 text-base font-medium text-slate-900 shadow-[0_14px_34px_-30px_rgba(15,23,42,0.7)] outline-none transition placeholder:text-slate-400 focus:border-[#93e7e8] focus:ring-4 focus:ring-[#93e7e8]/25 sm:h-14"
                >
              </label>

              <p v-if="error" class="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-600">
                {{ error }}
              </p>

              <Button
                type="submit"
                class="h-12 w-full rounded-[10px] bg-[#16868b] text-base font-black text-white shadow-[0_18px_42px_-30px_rgba(15,124,130,0.88)] hover:bg-[#0f7c82] disabled:opacity-40 sm:h-14"
                :disabled="!canSubmit"
              >
                {{ loading ? 'Signing in...' : 'Sign in' }}
              </Button>
            </div>
          </form>

          <div class="mt-6 text-center">
            <button
              type="button"
              class="inline-flex items-center gap-2 text-sm font-semibold text-[#0f7c82] underline decoration-[#0f7c82]/45 underline-offset-4 transition hover:text-[#095f64]"
              title="Single sign-on is not enabled yet"
            >
              <KeyRound class="h-4 w-4" />
              Use single sign-on
            </button>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>
