<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { BookOpen, Bot, FileSearch, Loader2, Send, UserRound } from 'lucide-vue-next'

import Textarea from '@/components/ui/Textarea.vue'
import { useI18n } from '@/composables/useI18n'
import { chat, type ChatSource } from '@/lib/api'

type ChatMessage = {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: Date
  sources?: ChatSource[]
}

const emit = defineEmits<{
  openSource: [source: ChatSource]
}>()

const { isChinese, locale } = useI18n()
const input = ref('')
const loading = ref(false)
const error = ref('')
const messagesContainer = ref<HTMLElement>()
let messageSeed = 0

const welcomeMessage = computed(() => isChinese.value
  ? '你好，我是 IonicLink 材料文献助手。可以直接问材料体系、离子液体润滑、COF、载荷、速度、表面和实验条件，我会先检索平台文献再回答。'
  : 'Hi, I am the IonicLink materials literature assistant. Ask about material systems, ionic-liquid lubrication, COF, load, speed, surfaces, or experimental conditions.')

const quickPrompts = computed(() => isChinese.value
  ? [
      '哪些离子液体在石墨表面表现出较低摩擦系数？',
      '总结水含量对离子液体润滑性能的影响。',
      '找出和 potential-dependent superlubricity 相关的文献与实验条件。',
    ]
  : [
      'Which ionic liquids show low friction on graphite surfaces?',
      'Summarize how water content affects ionic-liquid lubrication.',
      'Find papers and conditions related to potential-dependent superlubricity.',
    ])

const messages = ref<ChatMessage[]>([
  {
    id: 'welcome',
    role: 'assistant',
    content: welcomeMessage.value,
    createdAt: new Date(),
  },
])

const isInputEmpty = computed(() => input.value.trim().length === 0)
const latestSourceCount = computed(() => {
  const latestAssistant = [...messages.value].reverse().find((message) => message.role === 'assistant' && message.sources?.length)
  return latestAssistant?.sources?.length || 0
})

watch(welcomeMessage, (nextMessage) => {
  const welcome = messages.value.find((message) => message.id === 'welcome')
  if (welcome) {
    welcome.content = nextMessage
  }
})

function nextMessageId(role: ChatMessage['role']) {
  messageSeed += 1
  return `${role}-${Date.now()}-${messageSeed}`
}

async function scrollToBottom() {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

function addMessage(role: ChatMessage['role'], content: string, sources?: ChatSource[]) {
  messages.value.push({
    id: nextMessageId(role),
    role,
    content,
    createdAt: new Date(),
    sources,
  })
  void scrollToBottom()
}

async function sendMessage(text?: string) {
  const message = String(text ?? input.value).trim()
  if (!message || loading.value) return

  input.value = ''
  error.value = ''
  addMessage('user', message)

  try {
    loading.value = true
    const response = await chat(message)
    if (response.success) {
      addMessage('assistant', response.response || fallbackAssistantText(), response.sources || [])
    } else {
      addMessage('assistant', fallbackAssistantText())
    }
  } catch (err: any) {
    const detail = err?.response?.data?.detail || err?.message || ''
    error.value = detail
    addMessage(
      'assistant',
      isChinese.value
        ? `请求没有完成：${detail || '请确认后端和 LLM 配置可用。'}`
        : `The request did not complete: ${detail || 'Check the backend and LLM configuration.'}`,
    )
  } finally {
    loading.value = false
    void scrollToBottom()
  }
}

function fallbackAssistantText() {
  return isChinese.value
    ? '暂时没有生成回答。可以换一个材料、离子液体、DOI 或性能指标继续检索。'
    : 'No answer was generated. Try another material, ionic liquid, DOI, or property metric.'
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    void sendMessage()
  }
}

function formatTime(date: Date) {
  return date.toLocaleTimeString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sourceTitle(source: ChatSource) {
  return source.title || `Literature ${source.literature_id}`
}

function sourceMeta(source: ChatSource) {
  return [
    source.journal,
    source.year ? String(source.year) : '',
    source.doi ? `DOI ${source.doi}` : '',
    source.page ? `p. ${source.page}` : '',
  ].filter(Boolean).join(' · ')
}
</script>

<template>
  <section class="shell-surface flex min-h-[32rem] flex-col overflow-hidden xl:min-h-0">
    <div class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 dark:border-slate-800 sm:px-5">
      <div class="flex min-w-0 items-center gap-3">
        <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <Bot class="h-4.5 w-4.5" />
        </div>
        <div class="min-w-0">
          <p class="text-[11px] font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
            {{ isChinese ? 'Materials AI' : 'Materials AI' }}
          </p>
          <h2 class="truncate text-base font-semibold tracking-normal text-slate-950 dark:text-white">
            {{ isChinese ? '材料文献对话' : 'Literature Chat' }}
          </h2>
        </div>
      </div>

      <div class="hidden items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300 sm:flex">
        <BookOpen class="h-3.5 w-3.5" />
        {{ latestSourceCount || 0 }}
      </div>
    </div>

    <div ref="messagesContainer" class="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-5">
      <div
        v-for="message in messages"
        :key="message.id"
        class="flex gap-3"
        :class="message.role === 'user' ? 'flex-row-reverse' : ''"
      >
        <div
          class="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-md"
          :class="message.role === 'user'
            ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'
            : 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950'"
        >
          <UserRound v-if="message.role === 'user'" class="h-4 w-4" />
          <Bot v-else class="h-4 w-4" />
        </div>

        <div class="min-w-0 max-w-[92%]" :class="message.role === 'user' ? 'items-end text-right' : 'items-start'">
          <div
            class="rounded-md border px-4 py-3 text-left"
            :class="message.role === 'user'
              ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950'
              : 'border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200'"
          >
            <p class="whitespace-pre-wrap text-[13px] leading-6">{{ message.content }}</p>
          </div>

          <div v-if="message.sources?.length" class="mt-2 grid gap-1.5 text-left">
            <button
              v-for="source in message.sources"
              :key="`${source.literature_id}-${source.record_id || 'lit'}-${source.index}`"
              type="button"
              class="group rounded-md border border-slate-200 bg-white px-3 py-2 text-left transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800"
              @click="emit('openSource', source)"
            >
              <div class="flex items-start gap-2">
                <div class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-slate-100 text-[10px] font-black text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  {{ source.index }}
                </div>
                <div class="min-w-0">
                  <p class="line-clamp-1 text-[12px] font-semibold text-slate-900 dark:text-slate-100">
                    {{ sourceTitle(source) }}
                  </p>
                  <p v-if="sourceMeta(source)" class="mt-0.5 line-clamp-1 text-[11px] text-slate-500 dark:text-slate-400">
                    {{ sourceMeta(source) }}
                  </p>
                  <p v-if="source.summary" class="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                    {{ source.summary }}
                  </p>
                </div>
              </div>
            </button>
          </div>

          <p
            class="mt-1.5 text-[10px] font-medium text-slate-400 dark:text-slate-500"
            :class="message.role === 'user' ? 'text-right' : 'pl-1'"
          >
            {{ formatTime(message.createdAt) }}
          </p>
        </div>
      </div>

      <div v-if="messages.length === 1" class="grid gap-2 pl-11 sm:grid-cols-3">
        <button
          v-for="prompt in quickPrompts"
          :key="prompt"
          type="button"
          class="flex min-h-[4.25rem] items-start gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2.5 text-left text-[12px] font-semibold leading-5 text-slate-600 transition hover:border-slate-300 hover:bg-white dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
          @click="sendMessage(prompt)"
        >
          <FileSearch class="mt-0.5 h-4 w-4 shrink-0 text-slate-500 dark:text-slate-400" />
          <span class="min-w-0">{{ prompt }}</span>
        </button>
      </div>

      <div v-if="loading" class="flex gap-3">
        <div class="mt-1 flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-950">
          <Bot class="h-4 w-4" />
        </div>
        <div class="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-slate-500 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
          <Loader2 class="h-4 w-4 animate-spin" />
        </div>
      </div>
    </div>

    <div class="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950 sm:px-5">
      <div class="relative">
        <Textarea
          v-model="input"
          :placeholder="isChinese ? '询问材料、离子液体、COF、实验条件或 DOI…' : 'Ask about materials, ionic liquids, COF, conditions, or DOI...'"
          :disabled="loading"
          :rows="2"
          class="min-h-[4.5rem] resize-none rounded-md border-slate-300 bg-white py-3 pr-12 text-[13px] leading-5 dark:border-slate-700 dark:bg-slate-900"
          @keydown="handleKeydown"
        />
        <button
          type="button"
          class="absolute bottom-2.5 right-2.5 flex h-9 w-9 items-center justify-center rounded-md bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
          :disabled="isInputEmpty || loading"
          :title="isChinese ? '发送' : 'Send'"
          @click="sendMessage()"
        >
          <Loader2 v-if="loading" class="h-4 w-4 animate-spin" />
          <Send v-else class="h-4 w-4" />
        </button>
      </div>
      <p v-if="error" class="mt-2 line-clamp-2 text-[11px] text-[#be123c] dark:text-[#fda4af]">
        {{ error }}
      </p>
    </div>
  </section>
</template>
