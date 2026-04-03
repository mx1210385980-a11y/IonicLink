<script setup lang="ts">
import { computed, ref, type Component } from 'vue'
import { ArrowUpRight, LockKeyhole, LibraryBig, Shield, UserPlus } from 'lucide-vue-next'

import LanguageToggle from '@/components/LanguageToggle.vue'
import Button from '@/components/ui/Button.vue'
import { useI18n } from '@/composables/useI18n'

const props = defineProps<{
  loading?: boolean
  error?: string
}>()

const emit = defineEmits<{
  (e: 'submit', payload: { username: string; password: string }): void
}>()

const username = ref('admin')
const password = ref('ChangeMe123!')
const { t } = useI18n()

const canSubmit = computed(() => {
  return username.value.trim().length >= 3 && password.value.length >= 8 && !props.loading
})

const capabilityRows = computed<Array<{
  title: string
  description: string
  icon: Component
}>>(() => [
  {
    title: t('login.capability_scoped_title'),
    description: t('login.capability_scoped_description'),
    icon: LockKeyhole,
  },
  {
    title: t('login.capability_role_title'),
    description: t('login.capability_role_description'),
    icon: Shield,
  },
  {
    title: t('login.capability_grounded_title'),
    description: t('login.capability_grounded_description'),
    icon: LibraryBig,
  },
])

function handleSubmit() {
  if (!canSubmit.value) return
  emit('submit', {
    username: username.value.trim(),
    password: password.value,
  })
}
</script>

<template>
  <div class="relative min-h-screen overflow-hidden bg-[#060c13] text-slate-100">
    <div class="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(228,191,120,0.2),_transparent_30%),radial-gradient(circle_at_78%_18%,_rgba(56,189,248,0.18),_transparent_22%),linear-gradient(160deg,_#060c13_0%,_#0b1520_48%,_#10151c_100%)]" />
    <div class="absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:72px_72px]" />

    <div class="relative mx-auto flex min-h-screen max-w-7xl flex-col px-6 py-8 lg:px-10">
      <div class="mb-5 flex justify-end">
        <LanguageToggle />
      </div>

      <div class="flex min-h-0 flex-1 overflow-hidden rounded-[2.25rem] border border-white/10 bg-white/[0.06] shadow-[0_32px_120px_-48px_rgba(0,0,0,0.92)] backdrop-blur-xl lg:flex-row">
        <section class="relative flex flex-1 flex-col justify-between overflow-hidden px-8 py-10 lg:px-12 lg:py-12">
          <div class="absolute right-[-6rem] top-[-4rem] h-[24rem] w-[24rem] rounded-full border border-[#f1cc82]/25 bg-[radial-gradient(circle,_rgba(241,204,130,0.18)_0%,_rgba(241,204,130,0.05)_38%,_transparent_68%)] blur-2xl" />
          <div class="absolute bottom-[-7rem] right-[12%] h-[22rem] w-[22rem] rounded-full border border-sky-300/15 bg-[radial-gradient(circle,_rgba(125,211,252,0.14)_0%,_rgba(125,211,252,0.04)_44%,_transparent_74%)] blur-2xl" />

          <div class="relative max-w-2xl">
            <p class="text-[11px] font-semibold uppercase tracking-[0.34em] text-[#f1cc82]">{{ t('login.lab_eyebrow') }}</p>
            <h1 class="brand-serif mt-4 text-5xl leading-none text-white sm:text-6xl">
              IonicLink
            </h1>
            <p class="mt-5 max-w-xl text-lg leading-8 text-slate-300 sm:text-xl">
              {{ t('login.hero_subtitle') }}
            </p>
            <p class="mt-4 max-w-2xl text-sm leading-7 text-slate-400 sm:text-base">
              {{ t('login.hero_description') }}
            </p>
          </div>

          <div class="relative mt-12 max-w-3xl border-t border-white/10 pt-8">
            <div class="grid gap-6">
              <article
                v-for="capability in capabilityRows"
                :key="capability.title"
                class="grid gap-3 border-b border-white/10 pb-5 last:border-b-0 last:pb-0 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start sm:gap-4"
              >
                <div class="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05] text-[#f1cc82]">
                  <component :is="capability.icon" class="h-5 w-5" />
                </div>
                <div>
                  <h2 class="text-lg font-semibold text-white">{{ capability.title }}</h2>
                  <p class="mt-1 text-sm leading-7 text-slate-400">{{ capability.description }}</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section class="relative w-full border-t border-white/10 bg-[rgba(8,16,26,0.86)] px-8 py-10 lg:w-[31rem] lg:border-l lg:border-t-0 lg:px-10 lg:py-12">
          <div class="max-w-md">
            <p class="text-[11px] font-semibold uppercase tracking-[0.34em] text-[#f1cc82]">{{ t('login.secure_sign_in') }}</p>
            <h2 class="mt-4 text-3xl font-semibold tracking-[-0.04em] text-white">{{ t('login.enter_surface') }}</h2>
            <p class="mt-3 text-sm leading-7 text-slate-400">
              {{ t('login.sign_in_description') }}
            </p>

            <form class="mt-8 space-y-5" @submit.prevent="handleSubmit">
              <label class="block">
                <span class="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{{ t('login.username') }}</span>
                <input
                  v-model="username"
                  type="text"
                  autocomplete="username"
                  class="w-full rounded-[1.35rem] border border-white/10 bg-white/[0.04] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#f1cc82]/70 focus:ring-2 focus:ring-[#f1cc82]/20"
                >
              </label>

              <label class="block">
                <span class="mb-2 block text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">{{ t('login.password') }}</span>
                <input
                  v-model="password"
                  type="password"
                  autocomplete="current-password"
                  class="w-full rounded-[1.35rem] border border-white/10 bg-white/[0.04] px-4 py-3.5 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-[#f1cc82]/70 focus:ring-2 focus:ring-[#f1cc82]/20"
                >
              </label>

              <p v-if="error" class="rounded-[1.35rem] border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
                {{ error }}
              </p>

              <Button
                type="submit"
                class="h-12 w-full rounded-full bg-[#f1cc82] text-sm font-semibold text-[#111827] hover:bg-[#f6d79d]"
                :disabled="!canSubmit"
              >
                {{ loading ? t('login.signing_in') : t('login.open_workspace') }}
                <ArrowUpRight class="h-4 w-4" />
              </Button>
            </form>

            <div class="mt-8 rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-5">
              <div class="flex items-start gap-3">
                <UserPlus class="mt-0.5 h-4 w-4 text-[#f1cc82]" />
                <div>
                  <p class="text-sm font-semibold text-white">{{ t('login.error_provisioning_title') }}</p>
                  <p class="mt-2 text-sm leading-7 text-slate-400">
                    {{ t('login.error_provisioning_description') }}
                  </p>
                </div>
              </div>
            </div>

            <div class="mt-4 rounded-[1.5rem] border border-white/10 bg-white/[0.03] px-5 py-4 text-xs uppercase tracking-[0.22em] text-slate-500">
              {{ t('login.bootstrap_credentials') }}
              <span class="mt-2 block text-sm font-semibold normal-case tracking-normal text-slate-200">
                admin / ChangeMe123!
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
