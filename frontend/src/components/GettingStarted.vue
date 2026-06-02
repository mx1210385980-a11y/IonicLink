<script setup lang="ts">
import type { Component } from 'vue'
import { computed } from 'vue'
import {
  BarChart3,
  BookOpen,
  Database,
  KeyRound,
  MessageSquare,
  Monitor,
  Search,
  Server,
  Upload,
} from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'

const { t } = useI18n()

const howItWorks = computed<Array<{
  title: string
  description: string
  icon: Component
  iconBoxClass: string
  iconClass: string
}>>(() => [
  {
    title: t('guide.workflow_step_1_title'),
    description: t('guide.workflow_step_1_description'),
    icon: Upload,
    iconBoxClass: 'bg-indigo-50',
    iconClass: 'text-indigo-600',
  },
  {
    title: t('guide.workflow_step_2_title'),
    description: t('guide.workflow_step_2_description'),
    icon: Database,
    iconBoxClass: 'bg-emerald-50',
    iconClass: 'text-emerald-600',
  },
  {
    title: t('guide.workflow_step_3_title'),
    description: t('guide.workflow_step_3_description'),
    icon: Search,
    iconBoxClass: 'bg-violet-50',
    iconClass: 'text-violet-600',
  },
  {
    title: t('guide.workflow_step_4_title'),
    description: t('guide.workflow_step_4_description'),
    icon: MessageSquare,
    iconBoxClass: 'bg-orange-50',
    iconClass: 'text-orange-600',
  },
])

const featureBlocks = computed<Array<{
  title: string
  description: string
  icon: Component
}>>(() => [
  {
    title: t('guide.feature_dashboard_title'),
    description: t('guide.feature_dashboard_description'),
    icon: BarChart3,
  },
  {
    title: t('guide.feature_explorer_title'),
    description: t('guide.feature_explorer_description'),
    icon: Database,
  },
  {
    title: t('guide.feature_library_title'),
    description: t('guide.feature_library_description'),
    icon: BookOpen,
  },
  {
    title: t('guide.feature_grounding_title'),
    description: t('guide.feature_grounding_description'),
    icon: Search,
  },
])

const tips = computed(() => [
  t('guide.tip_1'),
  t('guide.tip_2'),
  t('guide.tip_3'),
  t('guide.tip_4'),
  t('guide.tip_5'),
])

const systemRequirements = computed<Array<{
  title: string
  detail: string
  icon: Component
}>>(() => [
  {
    title: t('guide.requirement_backend_title'),
    detail: t('guide.requirement_backend_detail'),
    icon: Server,
  },
  {
    title: t('guide.requirement_frontend_title'),
    detail: t('guide.requirement_frontend_detail'),
    icon: Monitor,
  },
  {
    title: t('guide.requirement_api_title'),
    detail: t('guide.requirement_api_detail'),
    icon: KeyRound,
  },
])
</script>

<template>
  <div class="h-full overflow-y-auto bg-[#f3f5fa] dark:bg-slate-950">
    <div class="mx-auto max-w-6xl px-4 py-10 sm:px-6 lg:py-14">
      <header class="mx-auto mb-10 max-w-3xl text-center lg:mb-14">
        <h1 class="text-5xl font-bold tracking-tight text-slate-900 sm:text-6xl">
          {{ t('guide.hero_title_prefix') }} <span class="text-indigo-600">IonicLink</span>
        </h1>
        <p class="mt-4 text-lg leading-8 text-slate-600 sm:text-[1.35rem]">
          {{ t('guide.hero_subtitle') }}
        </p>
        <p class="mt-4 max-w-2xl text-sm leading-7 text-slate-400 sm:text-base">
          {{ t('guide.hero_description') }}
        </p>
      </header>

      <section class="mb-12 lg:mb-14">
        <h2 class="mb-6 text-center text-[2.35rem] font-semibold text-slate-900 sm:mb-8">
          {{ t('guide.how_it_works') }}
        </h2>
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <article
            v-for="step in howItWorks"
            :key="step.title"
            class="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_26px_-22px_rgba(15,23,42,0.5)]"
          >
            <span
              class="mb-5 inline-flex h-12 w-12 items-center justify-center rounded-xl"
              :class="step.iconBoxClass"
            >
              <component :is="step.icon" class="h-5 w-5" :class="step.iconClass" />
            </span>
            <h3 class="text-[1.75rem] font-semibold tracking-tight text-slate-900">
              {{ step.title }}
            </h3>
            <p class="mt-3 text-[17px] leading-7 text-slate-600">
              {{ step.description }}
            </p>
          </article>
        </div>
      </section>

      <section class="mb-12 rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_12px_26px_-22px_rgba(15,23,42,0.5)] lg:mb-14">
        <h2 class="mb-8 text-[2.35rem] font-semibold text-slate-900">
          {{ t('guide.key_features') }}
        </h2>
        <div class="grid gap-8 md:grid-cols-2">
          <article v-for="feature in featureBlocks" :key="feature.title" class="flex gap-4">
            <span class="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
              <component :is="feature.icon" class="h-5 w-5" />
            </span>
            <div>
              <h3 class="text-[1.7rem] font-semibold tracking-tight text-slate-900">
                {{ feature.title }}
              </h3>
              <p class="mt-2 text-[17px] leading-7 text-slate-600">
                {{ feature.description }}
              </p>
            </div>
          </article>
        </div>
      </section>

      <section class="grid gap-6 lg:grid-cols-2">
        <article class="rounded-2xl border border-slate-200 bg-white p-8 shadow-[0_12px_26px_-22px_rgba(15,23,42,0.5)]">
          <h2 class="mb-6 text-[2.35rem] font-semibold text-slate-900">
            {{ t('guide.tips_title') }}
          </h2>
          <ul class="space-y-3 text-[17px] leading-7 text-slate-600">
            <li v-for="tip in tips" :key="tip" class="flex gap-3">
              <span class="mt-3 h-2 w-2 shrink-0 rounded-full bg-indigo-500" />
              <span>{{ tip }}</span>
            </li>
          </ul>
        </article>

        <article class="rounded-2xl bg-slate-950 p-8 text-slate-100 shadow-[0_18px_36px_-24px_rgba(15,23,42,0.8)]">
          <h2 class="mb-6 border-b border-slate-700/70 pb-4 text-[2.35rem] font-semibold">
            {{ t('guide.system_requirements') }}
          </h2>
          <div class="space-y-6">
            <div v-for="requirement in systemRequirements" :key="requirement.title" class="flex gap-3">
              <span class="mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-slate-800 text-slate-200">
                <component :is="requirement.icon" class="h-4 w-4" />
              </span>
              <div>
                <h3 class="text-2xl font-semibold tracking-tight text-white">
                  {{ requirement.title }}
                </h3>
                <p class="mt-1 text-[16px] leading-6 text-slate-300">
                  {{ requirement.detail }}
                </p>
              </div>
            </div>
          </div>
        </article>
      </section>
    </div>
  </div>
</template>
