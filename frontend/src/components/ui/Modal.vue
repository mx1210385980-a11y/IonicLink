<script setup lang="ts">
import { X } from 'lucide-vue-next'
import { onMounted, onUnmounted, watch } from 'vue'

const props = defineProps<{
  title?: string
  show: boolean
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl' | 'full'
}>()

const emit = defineEmits(['close'])

const closeOnEscape = (e: KeyboardEvent) => {
  if (e.key === 'Escape' && props.show) {
    emit('close')
  }
}

watch(() => props.show, (show) => {
  if (show) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

onMounted(() => document.addEventListener('keydown', closeOnEscape))
onUnmounted(() => {
  document.removeEventListener('keydown', closeOnEscape)
  document.body.style.overflow = ''
})

const maxWidthClass = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
  'full': 'max-w-full m-4',
}
</script>

<template>
  <Transition
    enter-active-class="transition ease-out duration-200"
    enter-from-class="opacity-0"
    enter-to-class="opacity-100"
    leave-active-class="transition ease-in duration-150"
    leave-from-class="opacity-100"
    leave-to-class="opacity-0"
  >
    <div v-if="show" class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm" @click.self="$emit('close')">
      <Transition
        enter-active-class="transition ease-out duration-300"
        enter-from-class="opacity-0 scale-95 translate-y-4"
        enter-to-class="opacity-100 scale-100 translate-y-0"
        leave-active-class="transition ease-in duration-200"
        leave-from-class="opacity-100 scale-100 translate-y-0"
        leave-to-class="opacity-0 scale-95 translate-y-4"
      >
        <div 
          class="relative w-full bg-white border rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh] text-slate-950"
          :class="[maxWidthClass[maxWidth || '2xl']]"
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-6 py-4 border-b">
            <h3 class="text-lg font-semibold tracking-tight">
              <slot name="header">{{ title }}</slot>
            </h3>
            <button 
              @click="$emit('close')" 
              class="p-1 rounded-full hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
            >
              <X class="w-5 h-5" />
            </button>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-auto p-6">
            <slot />
          </div>

          <!-- Footer -->
          <div v-if="$slots.footer" class="px-6 py-4 border-t bg-muted/20">
            <slot name="footer" />
          </div>
        </div>
      </Transition>
    </div>
  </Transition>
</template>
