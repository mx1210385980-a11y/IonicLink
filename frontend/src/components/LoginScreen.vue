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
  <div class="min-h-screen bg-slate-100 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <div class="mx-auto flex min-h-screen max-w-6xl flex-col px-5 py-6 lg:px-8">
      <div class="mb-5 flex items-center justify-between">
        <div>
          <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {{ t('login.lab_eyebrow') }}
          </p>
          <h1 class="mt-1 text-xl font-semibold text-slate-950 dark:text-white">IonicLink</h1>
        </div>
        <LanguageToggle />
      </div>

      <div class="grid min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 lg:grid-cols-[minmax(0,1fr)_24rem]">
        <section class="border-b border-slate-200 px-6 py-7 dark:border-slate-800 lg:border-b-0 lg:border-r lg:px-8 lg:py-8">
          <div class="max-w-2xl">
            <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
              {{ t('login.secure_sign_in') }}
            </p>
            <h2 class="mt-3 text-2xl font-semibold text-slate-950 dark:text-white">{{ t('login.enter_surface') }}</h2>
            <p class="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
              {{ t('login.sign_in_description') }}
            </p>

            <form class="mt-6 max-w-md space-y-4" @submit.prevent="handleSubmit">
              <label class="block">
                <span class="mb-2 block text-xs font-semibold text-slate-600 dark:text-slate-300">{{ t('login.username') }}</span>
                <input
                  v-model="username"
                  type="text"
                  autocomplete="username"
                  class="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-slate-400 dark:focus:ring-slate-800"
                >
              </label>

              <label class="block">
                <span class="mb-2 block text-xs font-semibold text-slate-600 dark:text-slate-300">{{ t('login.password') }}</span>
                <input
                  v-model="password"
                  type="password"
                  autocomplete="current-password"
                  class="h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-500 focus:ring-2 focus:ring-slate-200 dark:border-slate-700 dark:bg-slate-950 dark:text-white dark:focus:border-slate-400 dark:focus:ring-slate-800"
                >
              </label>

              <p v-if="error" class="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                {{ error }}
              </p>

              <Button
                type="submit"
                class="h-11 w-full bg-slate-950 text-sm font-semibold text-white hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                :disabled="!canSubmit"
              >
                {{ loading ? t('login.signing_in') : t('login.open_workspace') }}
                <ArrowUpRight class="h-4 w-4" />
              </Button>
            </form>

            <div class="mt-6 rounded-md border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
              <div class="flex items-start gap-3">
                <UserPlus class="mt-0.5 h-4 w-4 text-slate-500 dark:text-slate-400" />
                <div>
                  <p class="text-sm font-semibold text-slate-900 dark:text-white">{{ t('login.error_provisioning_title') }}</p>
                  <p class="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    {{ t('login.error_provisioning_description') }}
                  </p>
                </div>
              </div>
            </div>

            <div class="mt-3 rounded-md border border-slate-200 bg-white px-4 py-3 text-xs uppercase tracking-widest text-slate-500 dark:border-slate-800 dark:bg-slate-900">
              {{ t('login.bootstrap_credentials') }}
              <span class="mt-1 block text-sm font-semibold normal-case tracking-normal text-slate-900 dark:text-slate-100">
                admin / ChangeMe123!
              </span>
            </div>
          </div>
        </section>

        <section class="px-6 py-7 lg:px-6 lg:py-8">
          <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            {{ t('login.hero_subtitle') }}
          </p>
          <p class="mt-3 text-sm leading-6 text-slate-600 dark:text-slate-300">
            {{ t('login.hero_description') }}
          </p>

          <div class="mt-6 grid gap-4">
            <article
              v-for="capability in capabilityRows"
              :key="capability.title"
              class="border-t border-slate-200 pt-4 dark:border-slate-800"
            >
              <div class="flex items-start gap-3">
                <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  <component :is="capability.icon" class="h-4 w-4" />
                </div>
                <div>
                  <h3 class="text-sm font-semibold text-slate-950 dark:text-white">{{ capability.title }}</h3>
                  <p class="mt-1 text-sm leading-6 text-slate-600 dark:text-slate-400">{{ capability.description }}</p>
                </div>
              </div>
            </article>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>
