<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch, computed } from 'vue'
import { useRDKit } from '@/composables/useRDKit'
import { Copy, Loader2, AlertCircle } from 'lucide-vue-next'

interface Props {
  smiles?: string | null
  label?: string
  size?: 'thumbnail' | 'full'
  width?: number
  height?: number
}

const props = withDefaults(defineProps<Props>(), {
  smiles: null,
  label: '',
  size: 'full',
  width: undefined,
  height: undefined,
})

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isLoading = ref(true)
const error = ref<string | null>(null)
const copySuccess = ref(false)

const { initRDKit } = useRDKit()

const canvasWidth = computed(() => {
  if (props.width) return props.width
  return props.size === 'thumbnail' ? 80 : 200
})

const canvasHeight = computed(() => {
  if (props.height) return props.height
  return props.size === 'thumbnail' ? 60 : 150
})

const renderMolecule = async () => {
  if (!props.smiles || !canvasRef.value) {
    isLoading.value = false
    return
  }

  isLoading.value = true
  error.value = null

  try {
    const rdkit = await initRDKit()
    const mol = rdkit.get_mol(props.smiles)

    if (!mol || !mol.is_valid()) {
      error.value = 'Invalid SMILES structure'
      isLoading.value = false
      return
    }

    const canvas = canvasRef.value
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      error.value = 'Canvas not supported'
      isLoading.value = false
      return
    }

    // Clear canvas
    ctx.clearRect(0, 0, canvasWidth.value, canvasHeight.value)

    // Set background color based on dark mode
    const isDark = document.documentElement.classList.contains('dark')
    ctx.fillStyle = isDark ? '#1e293b' : '#ffffff'
    ctx.fillRect(0, 0, canvasWidth.value, canvasHeight.value)

    // Generate SVG and draw to canvas
    const svg = mol.get_svg_with_highlights(JSON.stringify({
      width: canvasWidth.value,
      height: canvasHeight.value,
      bondLineWidth: props.size === 'thumbnail' ? 1 : 1.5,
      addStereoAnnotation: true,
    }))

    // Convert SVG to image and draw on canvas
    const img = new Image()
    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    const url = URL.createObjectURL(svgBlob)

    img.onload = () => {
      ctx.drawImage(img, 0, 0, canvasWidth.value, canvasHeight.value)
      URL.revokeObjectURL(url)
      isLoading.value = false
    }

    img.onerror = () => {
      error.value = 'Failed to render structure'
      URL.revokeObjectURL(url)
      isLoading.value = false
    }

    img.src = url

    // Cleanup
    mol.delete()
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to render structure'
    isLoading.value = false
  }
}

const copySmiles = async () => {
  if (!props.smiles) return

  try {
    await navigator.clipboard.writeText(props.smiles)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy SMILES:', err)
  }
}

onMounted(() => {
  renderMolecule()
})

watch(() => props.smiles, () => {
  renderMolecule()
})

onUnmounted(() => {
  // Cleanup is handled in renderMolecule
})
</script>

<template>
  <div class="molecule-viewer" :class="{ 'molecule-viewer--thumbnail': size === 'thumbnail' }">
    <div v-if="label && size === 'full'" class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
      {{ label }}
    </div>

    <div class="relative inline-block">
      <canvas
        ref="canvasRef"
        :width="canvasWidth"
        :height="canvasHeight"
        class="rounded border border-gray-200 dark:border-gray-700"
        :class="{
          'opacity-50': isLoading,
          'border-red-300 dark:border-red-700': error,
        }"
      />

      <!-- Loading State -->
      <div
        v-if="isLoading"
        class="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 rounded"
      >
        <Loader2 class="w-5 h-5 animate-spin text-gray-500" />
      </div>

      <!-- Error State -->
      <div
        v-if="error && !isLoading"
        class="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 rounded"
      >
        <AlertCircle class="w-5 h-5 text-gray-400 mb-1" />
        <span class="text-xs text-gray-500 dark:text-gray-400 text-center px-2">{{ error }}</span>
      </div>

      <!-- No Data State -->
      <div
        v-if="!smiles && !isLoading"
        class="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-800 rounded"
      >
        <AlertCircle class="w-5 h-5 text-gray-400 mb-1" />
        <span class="text-xs text-gray-500 dark:text-gray-400">No structure</span>
      </div>
    </div>

    <!-- SMILES Display and Copy Button (Full Size Only) -->
    <div v-if="size === 'full' && smiles && !error" class="mt-2">
      <div class="flex items-center gap-2">
        <code class="flex-1 text-xs font-mono text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 px-2 py-1 rounded truncate">
          {{ smiles }}
        </code>
        <button
          @click="copySmiles"
          class="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          :class="{ 'text-green-600': copySuccess, 'text-gray-500': !copySuccess }"
          title="Copy SMILES"
        >
          <Copy class="w-4 h-4" />
        </button>
      </div>
      <div v-if="copySuccess" class="text-xs text-green-600 dark:text-green-400 mt-1">
        Copied!
      </div>
    </div>
  </div>
</template>

<style scoped>
.molecule-viewer--thumbnail {
  display: inline-block;
}

.molecule-viewer--thumbnail canvas {
  display: block;
}
</style>
