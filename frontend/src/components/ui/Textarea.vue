<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/lib/utils'

interface Props {
  modelValue?: string
  placeholder?: string
  disabled?: boolean
  rows?: number
  class?: string
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  rows: 3,
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

const textareaValue = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value ?? ''),
})
</script>

<template>
  <textarea
    v-model="textareaValue"
    :placeholder="placeholder"
    :disabled="disabled"
    :rows="rows"
    :class="
      cn(
        'flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 resize-none',
        props.class
      )
    "
  />
</template>
