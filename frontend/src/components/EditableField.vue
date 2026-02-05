<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import type { ValidationStatus } from '@/lib/api'

interface Props {
  modelValue: string | undefined
  fieldName: string
  validationStatus?: ValidationStatus
  validationMessage?: string
  placeholder?: string
  type?: 'text' | 'number'
  disabled?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  type: 'text',
  disabled: false
})

const emit = defineEmits<{
  'update:modelValue': [value: string | undefined]
  'validated': [fieldName: string]
}>()

const isEditing = ref(false)
const editValue = ref(props.modelValue || '')
const inputRef = ref<HTMLInputElement | null>(null)

// Watch for external changes
watch(() => props.modelValue, (newValue) => {
  if (!isEditing.value) {
    editValue.value = newValue || ''
  }
})

// Display value with fallback
const displayValue = computed(() => {
  return props.modelValue || props.placeholder || '-'
})

// Check if value is missing
const isMissing = computed(() => {
  return !props.modelValue || props.modelValue === '-' || props.modelValue.trim() === ''
})

// Determine CSS classes based on validation status
const displayClasses = computed(() => {
  const classes = ['editable-field-display', 'cursor-pointer', 'transition-colors']
  
  if (props.validationStatus === 'warning' || isMissing.value) {
    classes.push('text-orange-600', 'underline', 'decoration-dotted', 'hover:text-orange-700')
  } else if (props.validationStatus === 'verified') {
    classes.push('text-green-700', 'hover:text-green-800')
  } else if (props.validationStatus === 'modified') {
    classes.push('text-blue-700', 'hover:text-blue-800')
  } else {
    classes.push('hover:text-primary')
  }
  
  return classes
})

// Enter edit mode
function startEditing() {
  if (props.disabled) return
  
  isEditing.value = true
  editValue.value = props.modelValue || ''
  
  // Auto-focus input
  setTimeout(() => {
    inputRef.value?.focus()
    inputRef.value?.select()
  }, 50)
}

// Save changes
function save() {
  if (editValue.value !== props.modelValue) {
    emit('update:modelValue', editValue.value || undefined)
    emit('validated', props.fieldName)
  }
  isEditing.value = false
}

// Cancel editing
function cancel() {
  editValue.value = props.modelValue || ''
  isEditing.value = false
}

// Handle keyboard events
function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter') {
    event.preventDefault()
    save()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  }
}

// Handle blur (auto-save on focus loss)
function handleBlur() {
  // Small delay to allow click events to fire
  setTimeout(() => {
    if (isEditing.value) {
      save()
    }
  }, 150)
}
</script>

<template>
  <div class="editable-field inline-flex items-center gap-1">
    <!-- Edit Mode -->
    <input
      v-if="isEditing"
      ref="inputRef"
      v-model="editValue"
      :type="type"
      :placeholder="placeholder"
      class="editable-field-input px-2 py-1 border border-primary rounded text-sm focus:outline-none focus:ring-2 focus:ring-primary/50 min-w-[80px]"
      @keydown="handleKeydown"
      @blur="handleBlur"
    />
    
    <!-- View Mode -->
    <span
      v-else
      :class="displayClasses"
      :title="validationMessage || (isMissing ? 'Click to edit (missing value)' : 'Click to edit')"
      @click="startEditing"
    >
      {{ displayValue }}
    </span>
    
    <!-- Warning indicator -->
    <span
      v-if="!isEditing && validationStatus === 'warning'"
      class="text-xs text-orange-500"
      :title="validationMessage"
    >
      ⚠️
    </span>
  </div>
</template>

<style scoped>
.editable-field-display {
  position: relative;
}

.editable-field-display:hover::after {
  content: '✏️';
  font-size: 0.65em;
  margin-left: 4px;
  opacity: 0.5;
}

.editable-field-input {
  background: white;
  transition: all 0.2s;
}
</style>
