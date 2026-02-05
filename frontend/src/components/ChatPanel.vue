<script setup lang="ts">
import { ref, nextTick, computed } from 'vue'
import { Send, Bot, User } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import CardContent from '@/components/ui/CardContent.vue'
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
    content: '你好！我是 IonicLink 文献数据提取助手 🧪\n\n我可以帮助你从离子液体润滑相关的文献中自动提取摩擦学数据。\n\n请上传PDF文献，或直接向我提问！',
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
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}
</script>

<template>
  <Card class="h-full flex flex-col">
    <CardContent class="flex-1 flex flex-col p-0 overflow-hidden">
      <!-- 消息列表 -->
      <div 
        ref="messagesContainer"
        class="flex-1 overflow-y-auto p-4 space-y-4"
      >
        <div
          v-for="message in messages"
          :key="message.id"
          class="flex gap-3"
          :class="message.role === 'user' ? 'flex-row-reverse' : ''"
        >
          <!-- 头像 -->
          <div
            class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
            :class="message.role === 'user' 
              ? 'bg-primary text-primary-foreground' 
              : 'bg-muted text-muted-foreground'"
          >
            <User v-if="message.role === 'user'" class="w-4 h-4" />
            <Bot v-else class="w-4 h-4" />
          </div>
          
          <!-- 消息内容 -->
          <div
            class="max-w-[80%] rounded-2xl px-4 py-2"
            :class="message.role === 'user'
              ? 'bg-primary text-primary-foreground rounded-tr-md'
              : 'bg-muted rounded-tl-md'"
          >
            <p class="text-sm whitespace-pre-wrap">{{ message.content }}</p>
            <p 
              class="text-[10px] mt-1"
              :class="message.role === 'user' ? 'text-primary-foreground/70' : 'text-muted-foreground'"
            >
              {{ formatTime(message.timestamp) }}
            </p>
          </div>
        </div>
        
        <!-- 加载动画 -->
        <div v-if="loading" class="flex gap-3">
          <div class="w-8 h-8 rounded-full bg-muted flex items-center justify-center">
            <Bot class="w-4 h-4 text-muted-foreground" />
          </div>
          <div class="bg-muted rounded-2xl rounded-tl-md px-4 py-3">
            <div class="flex gap-1">
              <span class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:0ms]"></span>
              <span class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:150ms]"></span>
              <span class="w-2 h-2 bg-muted-foreground/50 rounded-full animate-bounce [animation-delay:300ms]"></span>
            </div>
          </div>
        </div>
      </div>
      
      <!-- 输入区域 -->
      <div class="border-t p-4">
        <div class="flex gap-2">
          <Textarea
            v-model="inputMessage"
            placeholder="输入消息或提取指令..."
            class="min-h-[44px] max-h-32 resize-none"
            :rows="1"
            @keydown="handleKeydown"
          />
          <Button
            size="icon"
            :disabled="isInputEmpty || loading"
            @click="sendMessage"
          >
            <Spinner v-if="loading" size="sm" class="text-primary-foreground" />
            <Send v-else class="h-4 w-4" />
          </Button>
        </div>
        <p class="text-xs text-muted-foreground mt-2">
          按 Enter 发送，Shift + Enter 换行
        </p>
      </div>
    </CardContent>
  </Card>
</template>
