<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Send, User, Sparkles, ChevronRight } from 'lucide-vue-next'

import Button from '@/components/ui/Button.vue'
import Spinner from '@/components/ui/Spinner.vue'
import Textarea from '@/components/ui/Textarea.vue'
import { useI18n } from '@/composables/useI18n'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const emit = defineEmits<{
  send: [message: string]
}>()

const props = defineProps<{
  loading?: boolean
}>()

const { locale, t } = useI18n()
const messagesContainer = ref<HTMLElement>()
const inputMessage = ref('')
const messages = ref<Message[]>([
  {
    id: 'welcome',
    role: 'assistant',
    content: t('chat.welcome_message'),
    timestamp: new Date(),
  },
])

const isInputEmpty = computed(() => inputMessage.value.trim() === '')

watch(
  () => locale.value,
  () => {
    const welcome = messages.value.find((message) => message.id === 'welcome')
    if (welcome) {
      welcome.content = t('chat.welcome_message')
    }
  },
)

defineExpose({
  addMessage(role: 'user' | 'assistant', content: string) {
    messages.value.push({
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date(),
    })
    void scrollToBottom()
  },
})

function sendMessage() {
  if (isInputEmpty.value || props.loading) {
    return
  }

  const message = inputMessage.value.trim()
  inputMessage.value = ''
  emit('send', message)
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    sendMessage()
  }
}

async function scrollToBottom() {
  await nextTick()
  if (messagesContainer.value) {
    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  }
}

function formatTime(date: Date) {
  return date.toLocaleTimeString(locale.value === 'zh-CN' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

function runQuickAction(message: string) {
  inputMessage.value = message
  sendMessage()
}
</script>

<template>
  <div class="flex h-full flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <div class="z-10 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/90">
      <div class="flex items-center gap-2">
        <Sparkles class="h-[18px] w-[18px] text-indigo-500 dark:text-indigo-300" />
        <h3 class="text-[14.5px] font-bold text-gray-800 dark:text-slate-100">{{ t('chat.title') }}</h3>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span class="text-[12px] font-medium tracking-wide text-gray-500 dark:text-slate-400">{{ t('common.online') }}</span>
      </div>
    </div>

    <div class="flex flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950">
      <div
        ref="messagesContainer"
        class="custom-scrollbar flex-1 space-y-6 overflow-y-auto p-5"
      >
        <div
          v-for="message in messages"
          :key="message.id"
          class="flex gap-3"
          :class="message.role === 'user' ? 'flex-row-reverse' : ''"
        >
          <div
            v-if="message.role === 'assistant'"
            class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-500 dark:bg-indigo-500/15 dark:text-indigo-300"
          >
            <Sparkles class="h-4 w-4" />
          </div>
          <div
            v-else
            class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-300"
          >
            <User class="h-4 w-4" />
          </div>

          <div class="flex flex-col" :class="message.role === 'user' ? 'items-end' : 'items-start'">
            <div
              class="max-w-[100%] rounded-2xl border px-5 py-4 shadow-sm"
              :class="message.role === 'user'
                ? 'rounded-br-sm border-blue-500/20 bg-primary text-primary-foreground shadow-blue-500/20'
                : 'rounded-tl-sm border-slate-200 bg-white text-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'"
            >
              <p class="whitespace-pre-wrap text-[13.5px] leading-relaxed" v-html="message.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')" />
            </div>
            <p
              class="mt-2 text-[11px] font-medium"
              :class="message.role === 'user' ? 'text-gray-400 dark:text-slate-500' : 'pl-1 text-gray-400 dark:text-slate-500'"
            >
              {{ formatTime(message.timestamp) }}
            </p>
          </div>
        </div>

        <div v-if="messages.length === 1" class="space-y-3 pl-11">
          <button
            class="flex w-[260px] items-center justify-between rounded-full border border-gray-200 bg-white px-4 py-2.5 text-[13px] text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800/90"
            @click="runQuickAction(t('chat.quick_extract_prompt'))"
          >
            <span>{{ t('chat.quick_extract_label') }}</span>
            <ChevronRight class="h-3.5 w-3.5 text-gray-400 dark:text-slate-500" />
          </button>
          <button
            class="flex w-[260px] items-center justify-between rounded-full border border-gray-200 bg-white px-4 py-2.5 text-[13px] text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800/90"
            @click="runQuickAction(t('chat.quick_summarize_prompt'))"
          >
            <span>{{ t('chat.quick_summarize_label') }}</span>
            <ChevronRight class="h-3.5 w-3.5 text-gray-400 dark:text-slate-500" />
          </button>
        </div>

        <div v-if="loading" class="flex gap-3">
          <div class="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/15">
            <Sparkles class="h-4 w-4 text-indigo-500 dark:text-indigo-300" />
          </div>
          <div class="rounded-2xl rounded-tl-sm border border-gray-100/50 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div class="flex gap-1">
              <span class="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:0ms]" />
              <span class="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:150ms]" />
              <span class="h-2 w-2 animate-bounce rounded-full bg-muted-foreground/50 [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      </div>

      <div class="shrink-0 bg-white p-4 dark:bg-slate-950">
        <div class="relative overflow-hidden rounded-xl border border-gray-100 bg-gray-50 shadow-sm transition-all focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-[0_0_0_1px_rgba(15,23,42,0.3)]">
          <Textarea
            v-model="inputMessage"
            :placeholder="t('chat.placeholder')"
            class="min-h-[44px] max-h-32 resize-none border-0 bg-transparent px-4 py-3.5 text-[13px] text-gray-700 shadow-none placeholder:text-gray-400 focus-visible:ring-0 dark:text-slate-200 dark:placeholder:text-slate-500"
            :rows="1"
            @keydown="handleKeydown"
          />
          <Button
            size="sm"
            variant="ghost"
            class="absolute bottom-2.5 right-2 h-8 w-8 rounded-full p-0 text-gray-400 hover:bg-blue-50 hover:text-blue-500 dark:text-slate-500 dark:hover:bg-slate-800 dark:hover:text-blue-300"
            :disabled="isInputEmpty || loading"
            @click="sendMessage"
          >
            <Spinner v-if="loading" size="sm" class="text-primary-foreground" />
            <Send v-else class="h-4 w-4" />
          </Button>
        </div>
        <div class="mt-2.5 flex items-center justify-between px-1">
          <div class="flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500">
            {{ t('chat.input_hint') }}
          </div>
          <div class="text-[11px] text-gray-400 dark:text-slate-500">{{ t('common.powered_by_ai') }}</div>
        </div>
      </div>
    </div>
  </div>
</template>
