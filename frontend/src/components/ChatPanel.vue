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
  <div class="h-full flex flex-col bg-card bg-white">
    <!-- Header -->
    <div class="px-5 py-4 border-b flex items-center justify-between bg-white shrink-0 shadow-sm z-10">
      <div class="flex items-center gap-2">
        <Sparkles class="h-[18px] w-[18px] text-indigo-500" />
        <h3 class="font-bold text-[14.5px] text-gray-800">IonicLink AI Assistant</h3>
      </div>
      <div class="flex items-center gap-1.5">
        <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        <span class="text-[12px] text-gray-500 font-medium tracking-wide">Online</span>
      </div>
    </div>
    
    <div class="flex-1 flex flex-col overflow-hidden bg-white">
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
            class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-indigo-50 text-indigo-500 mt-1"
          >
            <Sparkles class="w-4 h-4" />
          </div>
          <div
            v-else
            class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center bg-gray-100 text-gray-500 mt-1"
          >
            <User class="w-4 h-4" />
          </div>
          
          <!-- Message Content -->
          <div class="flex flex-col" :class="message.role === 'user' ? 'items-end' : 'items-start'">
            <div
              class="max-w-[100%] rounded-2xl px-5 py-4 shadow-sm border border-gray-100/50"
              :class="message.role === 'user'
                ? 'bg-primary text-primary-foreground rounded-br-sm'
                : 'bg-white rounded-tl-sm text-gray-700'"
            >
              <!-- eslint-disable-next-line vue/no-v-html -->
              <p class="text-[13.5px] leading-relaxed whitespace-pre-wrap" v-html="message.content.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')"></p>
            </div>
            <p 
              class="text-[11px] mt-2 font-medium"
              :class="message.role === 'user' ? 'text-gray-400' : 'text-gray-400 pl-1'"
            >
              {{ formatTime(message.timestamp) }}
            </p>
          </div>
        </div>
        
        <!-- Quick Actions (Only show after the first welcome message if it's the only message) -->
        <div v-if="messages.length === 1" class="pl-11 space-y-3">
           <button class="flex items-center justify-between px-4 py-2.5 bg-white border border-gray-200 rounded-full text-[13px] text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm w-[260px]" @click="inputMessage = 'Extract wear rate data from current doc'; sendMessage()">
              <span>Extract wear rate data</span>
              <ChevronRight class="w-3.5 h-3.5 text-gray-400" />
           </button>
           <button class="flex items-center justify-between px-4 py-2.5 bg-white border border-gray-200 rounded-full text-[13px] text-gray-600 hover:bg-gray-50 hover:border-gray-300 transition-colors shadow-sm w-[260px]" @click="inputMessage = 'Summarize ionic liquid synthesis methods'; sendMessage()">
              <span>Summarize synthesis methods</span>
              <ChevronRight class="w-3.5 h-3.5 text-gray-400" />
           </button>
        </div>
        
        <!-- Loading Animation -->
        <div v-if="loading" class="flex gap-3">
          <div class="w-8 h-8 rounded-full bg-indigo-50 flex items-center justify-center mt-1">
            <Sparkles class="w-4 h-4 text-indigo-500" />
          </div>
          <div class="bg-white border border-gray-100/50 shadow-sm rounded-2xl rounded-tl-sm px-5 py-4">
            <div class="flex gap-1">
              <span class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]"></span>
              <span class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]"></span>
              <span class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]"></span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Input Area -->
      <div class="p-4 bg-white shrink-0">
        <div class="relative bg-gray-50 border border-gray-100 rounded-xl overflow-hidden focus-within:ring-1 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all shadow-sm">
          <Textarea
            v-model="inputMessage"
            placeholder="Type a message or command..."
            class="min-h-[44px] max-h-32 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 px-4 py-3.5 text-[13px] text-gray-700 placeholder:text-gray-400"
            :rows="1"
            @keydown="handleKeydown"
          />
          <Button
            size="sm"
            variant="ghost"
            class="absolute bottom-2.5 right-2 h-8 w-8 p-0 rounded-full text-gray-400 hover:text-blue-500 hover:bg-blue-50"
            :disabled="isInputEmpty || loading"
            @click="sendMessage"
          >
            <Spinner v-if="loading" size="sm" class="text-primary-foreground" />
            <Send v-else class="h-4 w-4" />
          </Button>
        </div>
        <div class="flex items-center justify-between mt-2.5 px-1">
          <div class="text-[11px] text-gray-400 flex items-center gap-1">
            Press Enter to send, Shift + Enter for new line
          </div>
          <div class="text-[11px] text-gray-400">Powered by AI</div>
        </div>
      </div>
    </div>
  </div>
</template>
