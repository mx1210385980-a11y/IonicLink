<script setup lang="ts">
import { ref, nextTick, computed } from 'vue'
import { Send, User, Sparkles, ChevronRight } from 'lucide-vue-next'


import Button from '@/components/ui/Button.vue'
import Textarea from '@/components/ui/Textarea.vue'
import Spinner from '@/components/ui/Spinner.vue'

interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const emit = defineEmits<{
  'send': [message: string]
}>()

const props = defineProps<{
  loading?: boolean
}>()

const messages = ref<Message[]>([
  {
    id: '1',
    role: 'assistant',
    content: 'Hello! I am IonicLink AI Assistant 👋\n\nI can help you automatically extract core information such as **tribology data** and **physicochemical parameters** from complex ionic liquid lubrication literature.\n\nPlease upload a PDF on the left or send me a command directly here!',
    timestamp: new Date()
  }
])
const inputMessage = ref('')
const messagesContainer = ref<HTMLElement>()

const isInputEmpty = computed(() => inputMessage.value.trim() === '')

defineExpose({
  addMessage(role: 'user' | 'assistant', content: string) {
    messages.value.push({
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date()
    })
    scrollToBottom()
  }
})

function sendMessage() {
  if (isInputEmpty.value || props.loading) return
  
  const message = inputMessage.value.trim()
  inputMessage.value = ''
  
  emit('send', message)
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
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
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <div class="flex h-full flex-col bg-white text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <!-- Header -->
    <div class="z-10 flex shrink-0 items-center justify-between border-b border-slate-200 bg-white/95 px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-950/90">
      <div class="flex items-center gap-2">
        <Sparkles class="h-[18px] w-[18px] text-indigo-500 dark:text-indigo-300" />
        <h3 class="text-[14.5px] font-bold text-gray-800 dark:text-slate-100">IonicLink AI Assistant</h3>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        <span class="text-[12px] font-medium tracking-wide text-gray-500 dark:text-slate-400">Online</span>
      </div>
    </div>
    
    <div class="flex flex-1 flex-col overflow-hidden bg-white dark:bg-slate-950">
      <!-- Message List -->
      <div 
        ref="messagesContainer"
        class="flex-1 overflow-y-auto p-5 space-y-6 custom-scrollbar"
      >
        <div
          v-for="message in messages"
          :key="message.id"
          class="flex gap-3"
          :class="message.role === 'user' ? 'flex-row-reverse' : ''"
        >
          <!-- Avatar -->
          <div
            v-if="message.role === 'assistant'"
            class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-indigo-500 dark:bg-indigo-500/15 dark:text-indigo-300"
          >
            <Sparkles class="w-4 h-4" />
          </div>
          <div
            v-else
            class="mt-1 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500 dark:bg-slate-800 dark:text-slate-300"
          >
            <User class="w-4 h-4" />
          </div>
          
          <!-- Message Content -->
          <div class="flex flex-col" :class="message.role === 'user' ? 'items-end' : 'items-start'">
            <div
              class="max-w-[100%] rounded-2xl border px-5 py-4 shadow-sm"
              :class="message.role === 'user'
                ? 'rounded-br-sm border-blue-500/20 bg-primary text-primary-foreground shadow-blue-500/20'
                : 'rounded-tl-sm border-slate-200 bg-white text-gray-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200'"
            >
              <!-- eslint-disable-next-line vue/no-v-html -->
              <p class="text-[13.5px] leading-relaxed whitespace-pre-wrap" v-html="message.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')"></p>
            </div>
            <p 
              class="text-[11px] mt-2 font-medium"
              :class="message.role === 'user' ? 'text-gray-400 dark:text-slate-500' : 'pl-1 text-gray-400 dark:text-slate-500'"
            >
              {{ formatTime(message.timestamp) }}
            </p>
          </div>
        </div>
        
        <!-- Quick Actions (Only show after the first welcome message if it's the only message) -->
        <div v-if="messages.length === 1" class="pl-11 space-y-3">
           <button class="flex w-[260px] items-center justify-between rounded-full border border-gray-200 bg-white px-4 py-2.5 text-[13px] text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800/90" @click="inputMessage = 'Extract wear rate data from current doc'; sendMessage()">
              <span>Extract wear rate data</span>
              <ChevronRight class="h-3.5 w-3.5 text-gray-400 dark:text-slate-500" />
           </button>
           <button class="flex w-[260px] items-center justify-between rounded-full border border-gray-200 bg-white px-4 py-2.5 text-[13px] text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800/90" @click="inputMessage = 'Summarize ionic liquid synthesis methods'; sendMessage()">
              <span>Summarize synthesis methods</span>
              <ChevronRight class="h-3.5 w-3.5 text-gray-400 dark:text-slate-500" />
           </button>
        </div>
        
        <!-- Loading Animation -->
        <div v-if="loading" class="flex gap-3">
          <div class="mt-1 flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 dark:bg-indigo-500/15">
            <Sparkles class="h-4 w-4 text-indigo-500 dark:text-indigo-300" />
          </div>
          <div class="rounded-2xl rounded-tl-sm border border-gray-100/50 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div class="flex gap-1">
              <span class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]"></span>
              <span class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]"></span>
              <span class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]"></span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Input Area -->
      <div class="shrink-0 bg-white p-4 dark:bg-slate-950">
        <div class="relative overflow-hidden rounded-xl border border-gray-100 bg-gray-50 shadow-sm transition-all focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500 dark:border-slate-800 dark:bg-slate-900/90 dark:shadow-[0_0_0_1px_rgba(15,23,42,0.3)]">
          <Textarea
            v-model="inputMessage"
            placeholder="Type a message or command..."
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
        <div class="flex items-center justify-between mt-2.5 px-1">
          <div class="flex items-center gap-1 text-[11px] text-gray-400 dark:text-slate-500">
            Press Enter to send, Shift + Enter for new line
          </div>
          <div class="text-[11px] text-gray-400 dark:text-slate-500">Powered by AI</div>
        </div>
      </div>
    </div>
  </div>
</template>
