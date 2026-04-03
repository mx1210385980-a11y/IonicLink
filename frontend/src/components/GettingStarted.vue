<script setup lang="ts">
import type { Component } from 'vue'
import { computed, ref } from 'vue'
import {
  BarChart3,
  BookOpen,
  CirclePause,
  CirclePlay,
  Database,
  KeyRound,
  MessageSquare,
  Monitor,
  Search,
  Server,
  Upload,
} from 'lucide-vue-next'

import { useI18n } from '@/composables/useI18n'

const guideVideoRef = ref<HTMLVideoElement | null>(null)
const isPlaying = ref(false)
const currentTime = ref(0)
const duration = ref(0)
const { t } = useI18n()

const progressPercent = computed(() => {
  if (duration.value <= 0) {
    return 0
  }
  return Math.min(100, (currentTime.value / duration.value) * 100)
})

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

const toggleVideo = () => {
  const video = guideVideoRef.value
  if (!video) {
    return
  }

  if (video.paused) {
    void video.play()
    return
  }

  video.pause()
}

const onLoadedMetadata = () => {
  const video = guideVideoRef.value
  if (!video) {
    return
  }

  duration.value = Number.isFinite(video.duration) ? video.duration : 0
}

const onTimeUpdate = () => {
  const video = guideVideoRef.value
  if (!video) {
    return
  }

  currentTime.value = video.currentTime
  if (!duration.value && Number.isFinite(video.duration)) {
    duration.value = video.duration
  }
}

const onSeek = (event: Event) => {
  const target = event.target as HTMLInputElement
  const nextTime = Number(target.value)
  if (!Number.isFinite(nextTime)) {
    return
  }

  const video = guideVideoRef.value
  if (!video) {
    return
  }

  video.currentTime = nextTime
  currentTime.value = nextTime
}

const formatTime = (timeInSeconds: number) => {
  if (!Number.isFinite(timeInSeconds) || timeInSeconds <= 0) {
    return '0:00'
  }

  const minutes = Math.floor(timeInSeconds / 60)
  const seconds = Math.floor(timeInSeconds % 60)
    .toString()
    .padStart(2, '0')
  return `${minutes}:${seconds}`
}
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
        <div class="group/video relative overflow-hidden rounded-3xl bg-slate-900 shadow-[0_24px_56px_-24px_rgba(15,23,42,0.65)]">
          <video
            ref="guideVideoRef"
            class="aspect-[16/9] w-full object-cover"
            src="/guide.mp4"
            preload="metadata"
            playsinline
            @click="toggleVideo"
            @play="isPlaying = true"
            @pause="isPlaying = false"
            @ended="isPlaying = false"
            @loadedmetadata="onLoadedMetadata"
            @timeupdate="onTimeUpdate"
          />

          <div
            class="pointer-events-none absolute inset-0 bg-gradient-to-r from-slate-900/85 via-slate-900/70 to-indigo-950/80 transition-opacity duration-300"
            :class="isPlaying ? 'opacity-0' : 'opacity-100'"
          />

          <div
            v-if="!isPlaying"
            class="pointer-events-none absolute inset-0 flex items-center justify-center px-4 text-center"
          >
            <button
              type="button"
              class="pointer-events-auto flex flex-col items-center"
              @click="toggleVideo"
            >
              <span class="mb-5 inline-flex h-20 w-20 items-center justify-center rounded-full bg-indigo-500/95 text-white shadow-[0_0_28px_rgba(99,102,241,0.55)]">
                <CirclePlay class="h-10 w-10" />
              </span>
              <p class="text-4xl font-semibold text-white sm:text-[2.2rem]">
                {{ t('guide.video_title') }}
              </p>
              <p class="mt-2 text-base text-slate-300 sm:text-lg">
                {{ t('guide.video_subtitle') }}
              </p>
            </button>
          </div>

          <div
            class="pointer-events-none absolute inset-x-4 bottom-4 z-20 translate-y-3 opacity-0 transition-all duration-200 group-hover/video:pointer-events-auto group-hover/video:translate-y-0 group-hover/video:opacity-100 group-focus-within/video:pointer-events-auto group-focus-within/video:translate-y-0 group-focus-within/video:opacity-100 sm:inset-x-6"
            @click.stop
          >
            <div class="flex items-center gap-3 rounded-full bg-slate-950/75 px-3 py-2 backdrop-blur-md sm:px-4">
              <button
                type="button"
                class="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-indigo-500 text-white transition hover:bg-indigo-400"
                @click="toggleVideo"
              >
                <CirclePause v-if="isPlaying" class="h-4 w-4" />
                <CirclePlay v-else class="h-4 w-4" />
              </button>
              <span class="w-11 shrink-0 text-right text-xs font-medium text-slate-200">
                {{ formatTime(currentTime) }}
              </span>
              <input
                class="video-progress h-1.5 w-full cursor-pointer rounded-full"
                type="range"
                min="0"
                :max="duration || 0"
                step="0.1"
                :value="currentTime"
                :disabled="duration <= 0"
                :style="{
                  background: `linear-gradient(to right, #818cf8 0%, #818cf8 ${progressPercent}%, rgba(148,163,184,0.45) ${progressPercent}%, rgba(148,163,184,0.45) 100%)`,
                }"
                @input="onSeek"
              />
              <span class="w-11 shrink-0 text-xs font-medium text-slate-200">
                {{ formatTime(duration) }}
              </span>
            </div>
          </div>
        </div>
      </section>

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

<style scoped>
.video-progress {
  -webkit-appearance: none;
  appearance: none;
}

.video-progress::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  height: 14px;
  width: 14px;
  border-radius: 9999px;
  background: #ffffff;
  border: 2px solid #6366f1;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.35);
}

.video-progress::-moz-range-thumb {
  height: 14px;
  width: 14px;
  border-radius: 9999px;
  background: #ffffff;
  border: 2px solid #6366f1;
  box-shadow: 0 1px 4px rgba(15, 23, 42, 0.35);
}
</style>
