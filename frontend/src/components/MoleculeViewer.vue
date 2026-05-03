<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
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

const isLoading = ref(true)
const error = ref<string | null>(null)
const copySuccess = ref(false)
const svgUrl = ref<string | null>(null)

const { initRDKit } = useRDKit()

const canvasWidth = computed(() => {
  if (props.width) return props.width
  return props.size === 'thumbnail' ? 80 : 200
})

const canvasHeight = computed(() => {
  if (props.height) return props.height
  return props.size === 'thumbnail' ? 60 : 150
})

const moleculeImageStyle = computed(() => ({
  width: `${canvasWidth.value}px`,
  height: `${canvasHeight.value}px`,
}))

const clearSvgUrl = () => {
  if (!svgUrl.value) return
  URL.revokeObjectURL(svgUrl.value)
  svgUrl.value = null
}

const renderMolecule = async () => {
  clearSvgUrl()

  if (!props.smiles) {
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
      mol?.delete()
      return
    }

    // Keep RDKit output as SVG instead of rasterizing to a tiny canvas.
    // This preserves crisp bonds and atom labels on Retina/high-DPI displays.
    const svg = mol.get_svg_with_highlights(JSON.stringify({
      width: canvasWidth.value,
      height: canvasHeight.value,
      bondLineWidth: props.size === 'thumbnail' ? 1.35 : 1.5,
      addStereoAnnotation: true,
    }))

    const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' })
    svgUrl.value = URL.createObjectURL(svgBlob)
    isLoading.value = false
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
  clearSvgUrl()
})
</script>

<template>
  <div class="molecule-viewer" :class="{ 'molecule-viewer--thumbnail': size === 'thumbnail' }">
    <div v-if="label && size === 'full'" class="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
      {{ label }}
    </div>

    <div class="relative inline-block">
      <img
        v-if="svgUrl"
        :src="svgUrl"
        :width="canvasWidth"
        :height="canvasHeight"
        :style="moleculeImageStyle"
        alt="Molecule structure"
        class="rounded border border-gray-200 dark:border-gray-700"
        :class="{
          'opacity-50': isLoading,
          'border-red-300 dark:border-red-700': error,
        }"
      />
      <div
        v-else
        class="rounded border border-gray-200 bg-white dark:border-gray-700 dark:bg-slate-800"
        :class="{ 'border-red-300 dark:border-red-700': error }"
        :style="moleculeImageStyle"
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

.molecule-viewer--thumbnail img {
  display: block;
}

.molecule-viewer img {
  background: #ffffff;
  image-rendering: auto;
  object-fit: contain;
}

:global(.dark) .molecule-viewer img {
  background: #1e293b;
}
</style>
