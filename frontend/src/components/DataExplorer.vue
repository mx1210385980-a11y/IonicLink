<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import {
  Chart as ChartJS,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Title
} from 'chart.js'
import { Scatter } from 'vue-chartjs'
import { searchRecords, getFilterOptions, type SearchFilter, type RecordResponse } from '@/lib/api'

import { Filter, Loader2 } from 'lucide-vue-next'

// --- Mocks/Types for Chart.js Registration ---
ChartJS.register(LinearScale, PointElement, LineElement, Tooltip, Legend, Title)

// --- State ---
const loading = ref(false)
const records = ref<RecordResponse[]>([])
const filterOptions = ref<{ materials: string[], lubricants: string[] }>({ materials: [], lubricants: [] })

const filters = ref<SearchFilter>({
  materials: [],
  lubricants: [],
  load_min: undefined,
  load_max: undefined
})

// --- Chart Data & Config ---
const chartData = ref({
  datasets: [
    {
      label: 'Tribology Data',
      data: [] as any[],
      backgroundColor: 'rgba(54, 162, 235, 0.6)',
      pointRadius: 6,
      pointHoverRadius: 8
    }
  ]
})

const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    tooltip: {
      callbacks: {
        label: (context: any) => {
          const point = context.raw
          return [
            `Material: ${point.extra.material}`,
            `Lubricant: ${point.extra.lubricant}`,
            `Load: ${point.x} N`,
            `COF: ${point.y} ${point.extra.operator !== 'EQ' ? `(${point.extra.operator})` : ''}`,
            `Source: ${point.extra.source}`
          ]
        }
      }
    },
    legend: {
        display: false
    }
  },
  scales: {
    x: {
      title: {
        display: true,
        text: 'Load (N)'
      },
      type: 'linear' as const,
      position: 'bottom' as const
    },
    y: {
      title: {
        display: true,
        text: 'COF (Friction Coefficient)'
      },
      min: 0
    }
  }
}

// --- Methods ---

const loadOptions = async () => {
  try {
    const opts = await getFilterOptions()
    filterOptions.value = opts
  } catch (e) {
    console.error("Failed to load options", e)
  }
}

const fetchData = async () => {
  loading.value = true
  try {
    const data = await searchRecords(filters.value)
    records.value = data
    updateChart(data)
  } catch (e) {
    console.error("Failed to search records", e)
  } finally {
    loading.value = false
  }
}

const updateChart = (data: RecordResponse[]) => {
  // Map data to chart format
  // Handle operators for point style?
  // For now, simpler implementation: just map x, y
  
  const points = data
    .filter(r => r.load_value != null && r.cof_value != null)
    .map(r => ({
      x: r.load_value,
      y: r.cof_value,
      extra: {
        material: r.material_name,
        lubricant: r.lubricant,
        operator: r.cof_operator,
        source: r.source?.filename || 'Unknown'
      }
    }))

  chartData.value = {
    datasets: [
      {
        label: 'Tribology Data',
        data: points,
        backgroundColor: ((ctx: any) => {
            // Context can be raw data during initialization, safe check needed
            const raw = ctx.raw
            if(raw && raw.extra && raw.extra.operator === 'LT') return 'rgba(255, 99, 132, 0.6)' // Red for <
            return 'rgba(54, 162, 235, 0.6)' // Blue for normal
        }) as unknown as string,
        pointStyle: ((ctx: any) => {
            const raw = ctx.raw
            if(raw && raw.extra && raw.extra.operator === 'LT') return 'triangle'
            return 'circle'
        }) as unknown as string,
        pointRadius: 6,
        pointHoverRadius: 8
      } as any
    ]
  }
}

// --- Lifecycle ---
onMounted(() => {
  loadOptions()
  fetchData()
})

// Debounce Filter Changes
let debounceTimer: ReturnType<typeof setTimeout>
watch(filters, () => {
  clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    fetchData()
  }, 500)
}, { deep: true })

</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full p-6">
    <!-- Filters Sidebar -->
    <div class="lg:col-span-3 flex flex-col gap-6 bg-card border rounded-lg p-4 h-fit">
      <div class="flex items-center gap-2 border-b pb-4">
        <Filter class="w-5 h-5 text-primary" />
        <h2 class="font-semibold text-lg">Filters</h2>
      </div>

      <!-- Material Filter -->
      <div class="space-y-2">
        <label class="text-sm font-medium">Materials</label>
        <select 
            multiple 
            v-model="filters.materials"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[120px]"
        >
          <option v-for="m in filterOptions.materials" :key="m" :value="m">{{ m }}</option>
        </select>
        <p class="text-xs text-muted-foreground">Hold Ctrl/Cmd to select multiple</p>
      </div>

      <!-- Lubricant Filter -->
      <div class="space-y-2">
        <label class="text-sm font-medium">Lubricants</label>
        <select 
            multiple 
            v-model="filters.lubricants"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-h-[120px]"
        >
           <option v-for="l in filterOptions.lubricants" :key="l" :value="l">{{ l }}</option>
        </select>
      </div>

      <!-- Load Range -->
      <div class="space-y-4">
        <label class="text-sm font-medium">Load Range (N)</label>
        <div class="flex items-center gap-2">
          <input 
            type="number" 
            v-model.number="filters.load_min" 
            placeholder="Min"
            class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
           />
           <span>-</span>
           <input 
            type="number" 
            v-model.number="filters.load_max" 
            placeholder="Max"
            class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
           />
        </div>
      </div>

      <div class="text-sm text-muted-foreground mt-4">
        Found {{ records.length }} records
      </div>
    </div>

    <!-- Chart Area -->
    <div class="lg:col-span-9 flex flex-col bg-card border rounded-lg p-4 min-h-[500px]">
        <div class="flex-1 w-full relative">
            <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-background/50 z-10">
                <Loader2 class="w-8 h-8 animate-spin text-primary" />
            </div>
            <Scatter :data="chartData" :options="chartOptions" />
        </div>
    </div>
  </div>
</template>
