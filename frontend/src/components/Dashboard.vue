<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import {
  Chart as ChartJS, Title, Tooltip, Legend, ArcElement,
  CategoryScale, LinearScale, PointElement, LineElement, Filler,
  type ChartEvent, type ActiveElement
} from 'chart.js'
import { Doughnut, Line } from 'vue-chartjs'
import { FileText, Database, Zap, ShieldCheck, Sparkles, ArrowRight, Filter, X, Download, Share2, Copy } from 'lucide-vue-next'
import Card from '@/components/ui/Card.vue'
import CardHeader from '@/components/ui/CardHeader.vue'
import CardTitle from '@/components/ui/CardTitle.vue'
import CardContent from '@/components/ui/CardContent.vue'
import { getDashboardStats } from '@/lib/api'
import { useDashboardFilters } from '@/composables/useDashboardFilters'

// --- Register Chart.js Components ---
ChartJS.register(
  CategoryScale, LinearScale, PointElement, LineElement,
  ArcElement, Title, Tooltip, Legend, Filler
)

// --- Types ---
interface DashboardStats {
  total_records: number
  literature_count: number
  distinct_il_count: number
  cof_stats: { min: number | null, max: number | null, avg: number | null }
  confidence_stats?: {
    avg: number | null
    avg_percent: number | null
    min_percent: number | null
    max_percent: number | null
    count: number
    breakdown?: Record<string, {
      count: number
      share_percent: number
      avg: number | null
      avg_percent: number | null
    }>
  }
  materials_ratio: { name: string, count: number }[]
  top_liquids: { name: string, count: number }[]
  publication_trend: { year: number, count: number }[]
  top_journals: { name: string, count: number }[]
  cof_ranges: { name: string, min: number, max: number }[]
}

// --- State ---
const stats = ref<DashboardStats | null>(null)
const loading = ref(true)
const publicationTrendChartRef = ref<any>(null)
const materialsRatioChartRef = ref<any>(null)
const chartExportTarget = ref<'publication' | 'materials'>('publication')
const shareStatus = ref('')
const exportStatus = ref('')
const emit = defineEmits<{
  'open-library': []
  'explore-data': [queryParams: Record<string, string>]
}>()

// --- Filters ---
const {
  filters,
  hasActiveFilters,
  activeFilterCount,
  filterChips,
  queryParams,
  toggleYear,
  toggleMaterial,
  setIonicLiquid,
  setJournal,
  setConfidenceBucket,
  removeFilter,
  resetAll,
  replaceFromQuery,
  isYearInRange,
  isMaterialSelected,
  isIonicLiquidSelected,
  isJournalSelected,
  isConfidenceBucketSelected,
} = useDashboardFilters()

// --- Colors & Styling Helpers ---
const CHART_COLORS = [
  '#4ade80', // green
  '#3b82f6', // blue
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#ec4899', // pink
  '#14b8a6', // teal
]

const CHART_COLORS_MUTED = [
  '#86efac', // green muted
  '#93c5fd', // blue muted
  '#c4b5fd', // purple muted
  '#fcd34d', // amber muted
  '#f9a8d4', // pink muted
  '#5eead4', // teal muted
]

const FILTER_COLOR_CLASSES: Record<string, { bg: string; text: string; border: string; hover: string }> = {
  purple: {
    bg: 'bg-purple-50 dark:bg-purple-500/10',
    text: 'text-purple-700 dark:text-purple-300',
    border: 'border-purple-200 dark:border-purple-500/30',
    hover: 'hover:bg-purple-100 dark:hover:bg-purple-500/20',
  },
  green: {
    bg: 'bg-emerald-50 dark:bg-emerald-500/10',
    text: 'text-emerald-700 dark:text-emerald-300',
    border: 'border-emerald-200 dark:border-emerald-500/30',
    hover: 'hover:bg-emerald-100 dark:hover:bg-emerald-500/20',
  },
  blue: {
    bg: 'bg-blue-50 dark:bg-blue-500/10',
    text: 'text-blue-700 dark:text-blue-300',
    border: 'border-blue-200 dark:border-blue-500/30',
    hover: 'hover:bg-blue-100 dark:hover:bg-blue-500/20',
  },
  pink: {
    bg: 'bg-pink-50 dark:bg-pink-500/10',
    text: 'text-pink-700 dark:text-pink-300',
    border: 'border-pink-200 dark:border-pink-500/30',
    hover: 'hover:bg-pink-100 dark:hover:bg-pink-500/20',
  },
  cyan: {
    bg: 'bg-cyan-50 dark:bg-cyan-500/10',
    text: 'text-cyan-700 dark:text-cyan-300',
    border: 'border-cyan-200 dark:border-cyan-500/30',
    hover: 'hover:bg-cyan-100 dark:hover:bg-cyan-500/20',
  },
  emerald: {
    bg: 'bg-teal-50 dark:bg-teal-500/10',
    text: 'text-teal-700 dark:text-teal-300',
    border: 'border-teal-200 dark:border-teal-500/30',
    hover: 'hover:bg-teal-100 dark:hover:bg-teal-500/20',
  },
}

// --- Methods ---
async function fetchStats() {
  try {
    stats.value = await getDashboardStats()
  } catch (e) {
    console.error('Failed to fetch stats:', e)
  } finally {
    loading.value = false
  }
}

function handleExploreData() {
  emit('explore-data', queryParams.value)
}

function getFilterColorClasses(color: string) {
  return FILTER_COLOR_CLASSES[color] || FILTER_COLOR_CLASSES['blue']!
}

function handleRemoveChip(chip: (typeof filterChips.value)[0]) {
  if (chip.type === 'materials') {
    removeFilter('materials', chip.value)
    return
  }
  removeFilter(chip.type)
}

function handleCofRangeSelect(surface: string) {
  if (filters.cofRange.min !== null || filters.cofRange.max !== null) {
    removeFilter('cofRange')
  }
  toggleMaterial(surface)
}

function buildUrlSearchParams(paramsRecord: Record<string, string>) {
  const params = new URLSearchParams()
  Object.entries(paramsRecord).forEach(([key, value]) => {
    if (value) params.set(key, value)
  })
  return params
}

function triggerDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

function fileSafeStamp() {
  const now = new Date()
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`
}

function dataUrlToBytes(dataUrl: string) {
  const [, base64] = dataUrl.split(',', 2)
  const binary = window.atob(base64 || '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

function stringToBytes(value: string) {
  return new TextEncoder().encode(value)
}

function buildSvgFromCanvasData(dataUrl: string, width: number, height: number, title: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}">
  <title>${title}</title>
  <rect width="100%" height="100%" fill="white"/>
  <image href="${dataUrl}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>
</svg>`
}

function buildPdfFromJpeg(jpegDataUrl: string, imageWidth: number, imageHeight: number) {
  const jpegBytes = dataUrlToBytes(jpegDataUrl)
  const aspectRatio = imageWidth > 0 && imageHeight > 0 ? imageHeight / imageWidth : 1
  const pageWidth = 792
  const pageHeight = Math.max(320, Math.min(1000, pageWidth * aspectRatio))
  const contentStream = `q\n${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm\n/Im0 Do\nQ\n`

  const chunks: Uint8Array[] = []
  const offsets: number[] = [0]
  let position = 0

  const pushChunk = (chunk: Uint8Array) => {
    chunks.push(chunk)
    position += chunk.length
  }

  const pushText = (text: string) => pushChunk(stringToBytes(text))
  const startObject = (id: number) => {
    offsets[id] = position
  }

  pushText('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n')

  startObject(1)
  pushText('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  startObject(2)
  pushText('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n')
  startObject(3)
  pushText(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`)
  startObject(4)
  pushText(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`)
  pushChunk(jpegBytes)
  pushText('\nendstream\nendobj\n')
  startObject(5)
  pushText(`5 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream\nendobj\n`)

  const xrefStart = position
  pushText(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map((id) => `${String(offsets[id] || 0).padStart(10, '0')} 00000 n `).join('\n')}\n`)
  pushText(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`)

  const output = new Uint8Array(position)
  let offset = 0
  chunks.forEach((chunk) => {
    output.set(chunk, offset)
    offset += chunk.length
  })

  return new Blob([output as unknown as BlobPart], { type: 'application/pdf' })
}

function handleIonicLiquidSelect(liquid: string) {
  setIonicLiquid(liquid)
}

function handleJournalSelect(journal: string) {
  setJournal(journal)
}

function handleConfidenceSelect(bucket: 'text_grounded' | 'figure_grounded' | 'inferred') {
  setConfidenceBucket(bucket)
}

function resolveChartInstance(target: 'publication' | 'materials') {
  const component = target === 'publication' ? publicationTrendChartRef.value : materialsRatioChartRef.value
  return component?.chart || null
}

function exportChart(format: 'png' | 'svg' | 'pdf') {
  const chart = resolveChartInstance(chartExportTarget.value)
  if (!chart?.canvas) {
    exportStatus.value = 'Chart not ready yet.'
    return
  }

  const canvas = chart.canvas as HTMLCanvasElement
  const stamp = fileSafeStamp()
  const baseName = chartExportTarget.value === 'publication' ? 'publication_trend' : 'surface_material_ratio'

  if (format === 'png') {
    const dataUrl = canvas.toDataURL('image/png')
    const response = fetch(dataUrl)
    response.then(async (res) => {
      triggerDownload(`${baseName}_${stamp}.png`, await res.blob())
      exportStatus.value = 'Chart exported as PNG.'
    })
    return
  }

  if (format === 'svg') {
    const dataUrl = canvas.toDataURL('image/png')
    const svg = buildSvgFromCanvasData(dataUrl, canvas.width, canvas.height, baseName)
    triggerDownload(`${baseName}_${stamp}.svg`, new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    exportStatus.value = 'Chart exported as SVG.'
    return
  }

  const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95)
  triggerDownload(`${baseName}_${stamp}.pdf`, buildPdfFromJpeg(jpegDataUrl, canvas.width, canvas.height))
  exportStatus.value = 'Chart exported as PDF.'
}

function csvEscape(value: unknown) {
  const text = String(value ?? '')
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function dashboardExportSections() {
  const confidenceRows = confidenceBreakdownItems.value.map((bucket) => ({
    bucket: confidenceBucketLabel(bucket.key),
    count: bucket.count,
    avgPercent: formatConfidencePercent(bucket.avg_percent),
    sharePercent: `${(bucket.share_percent || 0).toFixed(1)}%`,
  }))

  return [
    {
      title: 'Summary',
      headers: ['metric', 'value'],
      rows: [
        ['exported_at', new Date().toISOString()],
        ['literature_count', stats.value?.literature_count ?? 0],
        ['total_records', stats.value?.total_records ?? 0],
        ['distinct_il_count', stats.value?.distinct_il_count ?? 0],
        ['confidence_avg_percent', formatConfidencePercent(stats.value?.confidence_stats?.avg_percent ?? null)],
      ],
    },
    {
      title: 'Active Filters',
      headers: ['key', 'value'],
      rows: Object.entries(queryParams.value),
    },
    {
      title: 'Publication Trend',
      headers: ['year', 'count'],
      rows: sortedPublicationTrend.value.map((item) => [item.year, item.count]),
    },
    {
      title: 'Surface Material Ratio',
      headers: ['material', 'count'],
      rows: stats.value?.materials_ratio.map((item) => [item.name, item.count]) || [],
    },
    {
      title: 'COF Range Span',
      headers: ['surface', 'min', 'max'],
      rows: stats.value?.cof_ranges.map((item) => [item.name, item.min, item.max]) || [],
    },
    {
      title: 'Top Ionic Liquids',
      headers: ['ionic_liquid', 'count'],
      rows: stats.value?.top_liquids.map((item) => [item.name, item.count]) || [],
    },
    {
      title: 'Leading Journals',
      headers: ['journal', 'count'],
      rows: stats.value?.top_journals.map((item) => [item.name, item.count]) || [],
    },
    {
      title: 'Confidence Breakdown',
      headers: ['bucket', 'count', 'avg_percent', 'share_percent'],
      rows: confidenceRows.map((row) => [row.bucket, row.count, row.avgPercent, row.sharePercent]),
    },
  ]
}

function exportDashboardData(format: 'csv' | 'json' | 'excel') {
  if (!stats.value) {
    exportStatus.value = 'Dashboard data is still loading.'
    return
  }

  const stamp = fileSafeStamp()
  const sections = dashboardExportSections()

  if (format === 'json') {
    const payload = {
      exportedAt: new Date().toISOString(),
      shareUrl: shareSnapshotUrl.value,
      filters: { ...queryParams.value },
      stats: stats.value,
    }
    triggerDownload(`dashboard_snapshot_${stamp}.json`, new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' }))
    exportStatus.value = 'Dashboard data exported as JSON.'
    return
  }

  if (format === 'csv') {
    const lines: string[] = []
    sections.forEach((section, index) => {
      if (index > 0) lines.push('')
      lines.push(section.title)
      lines.push(section.headers.join(','))
      section.rows.forEach((row) => {
        lines.push(row.map(csvEscape).join(','))
      })
    })
    triggerDownload(`dashboard_snapshot_${stamp}.csv`, new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }))
    exportStatus.value = 'Dashboard data exported as CSV.'
    return
  }

  const html = `
    <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">
      <head><meta charset="UTF-8" /></head>
      <body>
        ${sections.map((section) => `
          <table border="1" cellspacing="0" cellpadding="4">
            <tr><th colspan="${section.headers.length}" style="background:#eef2ff">${section.title}</th></tr>
            <tr>${section.headers.map((header) => `<th>${header}</th>`).join('')}</tr>
            ${section.rows.map((row) => `<tr>${row.map((cell) => `<td>${String(cell ?? '')}</td>`).join('')}</tr>`).join('')}
          </table>
          <br />
        `).join('')}
      </body>
    </html>
  `
  triggerDownload(`dashboard_snapshot_${stamp}.xls`, new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8' }))
  exportStatus.value = 'Dashboard data exported as Excel.'
}

const shareSnapshotUrl = computed(() => {
  if (typeof window === 'undefined') return ''
  const params = buildUrlSearchParams(queryParams.value)
  params.set('view', 'dashboard')
  const queryString = params.toString()
  return `${window.location.origin}${window.location.pathname}${queryString ? `?${queryString}` : ''}`
})

async function copyShareSnapshot() {
  try {
    await navigator.clipboard.writeText(shareSnapshotUrl.value)
    shareStatus.value = 'Snapshot link copied.'
  } catch (error) {
    console.error('Failed to copy snapshot link', error)
    shareStatus.value = 'Copy failed.'
  }
}

// --- Computed Chart Data ---
const sortedPublicationTrend = computed(() => {
  if (!stats.value?.publication_trend) return []
  return [...stats.value.publication_trend].sort((a, b) => a.year - b.year)
})

const publicationTrendData = computed(() => {
  if (!sortedPublicationTrend.value.length) return { labels: [], datasets: [] }
  const data = sortedPublicationTrend.value

  // Highlight selected years
  const backgroundColors = data.map((d, _i) => {
    if (isYearInRange(d.year)) {
      return 'rgba(139, 92, 246, 0.6)'
    }
    return 'rgba(139, 92, 246, 0.2)'
  })

  const borderColors = data.map((d) => {
    if (isYearInRange(d.year)) {
      return '#7c3aed'
    }
    return '#8b5cf6'
  })

  const pointRadius = data.map((d) => isYearInRange(d.year) ? 6 : 4)

  return {
    labels: data.map(d => d.year.toString()),
    datasets: [{
      label: 'Publications',
      data: data.map(d => d.count),
      borderColor: '#8b5cf6',
      backgroundColor: (context: { chart: { ctx: CanvasRenderingContext2D } }) => {
        const ctx = context.chart.ctx
        const gradient = ctx.createLinearGradient(0, 0, 0, 300)
        gradient.addColorStop(0, 'rgba(139, 92, 246, 0.4)')
        gradient.addColorStop(1, 'rgba(139, 92, 246, 0.0)')
        return gradient
      },
      fill: true,
      tension: 0.4,
      pointBackgroundColor: backgroundColors,
      pointBorderColor: borderColors,
      pointBorderWidth: 2,
      pointRadius: pointRadius,
      pointHoverRadius: 8,
    }]
  }
})

const publicationTrendOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    tooltip: {
      callbacks: {
        title: (items: { label: string }[]) => `Year ${items[0]?.label}`,
        afterLabel: () => 'Click to filter by this year',
      }
    }
  },
  scales: {
    y: { display: false, beginAtZero: true },
    x: { grid: { display: false } }
  },
  onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
    if (elements.length > 0) {
      const index = elements[0]!.index
      const year = sortedPublicationTrend.value[index]?.year
      if (year) toggleYear(year)
    }
  },
  onHover: (event: ChartEvent, elements: ActiveElement[]) => {
    const canvas = event.native?.target as HTMLCanvasElement | undefined
    if (canvas) {
      canvas.style.cursor = elements.length > 0 ? 'pointer' : 'default'
    }
  },
}))

const materialsRatioData = computed(() => {
  if (!stats.value?.materials_ratio) return { labels: [], datasets: [] }

  // Highlight selected materials
  const colors = stats.value.materials_ratio.map((d, i) => {
    if (isMaterialSelected(d.name)) {
      return CHART_COLORS[i % CHART_COLORS.length]
    }
    // Use muted color if there are active material filters but this one isn't selected
    if (filters.materials.length > 0) {
      return CHART_COLORS_MUTED[i % CHART_COLORS_MUTED.length]
    }
    return CHART_COLORS[i % CHART_COLORS.length]
  })

  return {
    labels: stats.value.materials_ratio.map(d => d.name),
    datasets: [{
      data: stats.value.materials_ratio.map(d => d.count),
      backgroundColor: colors,
      borderWidth: stats.value.materials_ratio.map((d) =>
        isMaterialSelected(d.name) ? 3 : 0
      ),
      borderColor: stats.value.materials_ratio.map((d, i) =>
        isMaterialSelected(d.name) ? CHART_COLORS[i % CHART_COLORS.length] : 'transparent'
      ),
      cutout: '65%',
      hoverOffset: 8,
    }]
  }
})

const materialsRatioOptions = computed(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      position: 'right' as const,
      labels: {
        boxWidth: 10,
        usePointStyle: true,
        generateLabels: (chart: any) => {
          const labels = chart.data.labels || []
          return labels.map((label: string, i: number) => ({
            text: label,
            fillStyle: chart.data.datasets[0]?.backgroundColor[i],
            strokeStyle: isMaterialSelected(label) ? '#1e40af' : 'transparent',
            lineWidth: isMaterialSelected(label) ? 2 : 0,
            fontColor: isMaterialSelected(label) ? '#1e40af' : '#64748b',
            hidden: false,
            index: i,
          }))
        }
      }
    },
    tooltip: {
      callbacks: {
        afterLabel: () => 'Click to filter by this material',
      }
    }
  },
  onClick: (_event: ChartEvent, elements: ActiveElement[]) => {
    if (elements.length > 0) {
      const index = elements[0]!.index
      const material = stats.value?.materials_ratio[index]?.name
      if (material) toggleMaterial(material)
    }
  },
  onHover: (event: ChartEvent, elements: ActiveElement[]) => {
    const canvas = event.native?.target as HTMLCanvasElement | undefined
    if (canvas) {
      canvas.style.cursor = elements.length > 0 ? 'pointer' : 'default'
    }
  },
}))

const materialsCount = computed(() => {
  return stats.value?.materials_ratio?.length || 0
})

const topLiquidsMax = computed(() => {
  if (!stats.value?.top_liquids || stats.value.top_liquids.length === 0) return 1
  return Math.max(...stats.value.top_liquids.map(d => d.count))
})

const topJournalsMax = computed(() => {
  if (!stats.value?.top_journals || stats.value.top_journals.length === 0) return 1
  return Math.max(...stats.value.top_journals.map(d => d.count))
})

const cofSpanMax = computed(() => {
  if (!stats.value?.cof_ranges || stats.value.cof_ranges.length === 0) return 1.0
  return Math.max(...stats.value.cof_ranges.map(d => d.max))
})

const cofSpanMin = computed(() => {
  if (!stats.value?.cof_ranges || stats.value.cof_ranges.length === 0) return 0.0
  return Math.min(...stats.value.cof_ranges.map(d => d.min))
})

const cofSpanRange = computed(() => {
  const span = cofSpanMax.value - cofSpanMin.value
  return span > 0 ? span : 1
})

const cofSpanMid = computed(() => cofSpanMin.value + cofSpanRange.value / 2)

function formatCofTick(value: number): string {
  if (!Number.isFinite(value)) return '--'
  const abs = Math.abs(value)
  let decimals = 3
  if (abs >= 1) decimals = 2
  else if (abs >= 0.1) decimals = 3
  else if (abs >= 0.01) decimals = 3
  else decimals = 4
  return value.toFixed(decimals).replace(/\.?0+$/, '')
}

function formatConfidencePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--'
  const safe = Math.max(0, Math.min(100, Number(value)))
  return `${safe.toFixed(1)}%`
}

function confidenceBucketLabel(key: string): string {
  const labels: Record<string, string> = {
    text_grounded: 'Text-grounded',
    figure_grounded: 'Figure-grounded',
    inferred: 'Model-inferred',
  }
  return labels[key] || key.replace(/_/g, ' ')
}

function confidenceBucketTone(key: string): string {
  const tones: Record<string, string> = {
    text_grounded: 'from-emerald-400 to-teal-500',
    figure_grounded: 'from-cyan-400 to-blue-500',
    inferred: 'from-amber-400 to-orange-500',
  }
  return tones[key] || 'from-slate-400 to-slate-500'
}

const confidenceBreakdownItems = computed(() => {
  const breakdown = stats.value?.confidence_stats?.breakdown || {}
  const order = ['text_grounded', 'figure_grounded', 'inferred']
  return order
    .filter((key) => breakdown[key])
    .map((key) => ({
      key,
      ...breakdown[key],
    }))
})

const heroTitle = computed(() =>
  hasActiveFilters.value ? 'Exploration Dashboard' : 'Library Intelligence Dashboard',
)

const heroDescription = computed(() =>
  hasActiveFilters.value
    ? 'Your chart selections are active. Review the linked filters below, then open the workspace for record-level evidence and graph exploration.'
    : 'Track extraction coverage, confidence structure, and ionic liquid distribution across the current library. Every chart can become the start of a focused investigation.',
)

const selectionSummary = computed(() => {
  if (!filterChips.value.length) {
    return 'Select chart elements to assemble a linked query across publication year, surface material, ionic liquid, journal, COF span, and confidence source.'
  }

  const preview = filterChips.value.slice(0, 4).map((chip) => `${chip.label}: ${chip.value}`)
  const suffix = filterChips.value.length > 4 ? ` +${filterChips.value.length - 4} more` : ''
  return `${preview.join(' | ')}${suffix}`
})

const queryRuleCount = computed(() => Object.keys(queryParams.value).length)

// Force chart re-render when filters change
const chartKey = computed(() => {
  return JSON.stringify(filters)
})

// --- Lifecycle ---
onMounted(() => {
  const params = new URLSearchParams(window.location.search)
  if (['yearStart', 'yearEnd', 'materials', 'lubricant', 'journal', 'cofMin', 'cofMax', 'confidence'].some((key) => params.has(key))) {
    replaceFromQuery(params)
  }
  fetchStats()
})

// Watch for filter changes to trigger visual updates
watch(filters, () => {
  // Charts will automatically update through computed properties
}, { deep: true })
</script>

<template>
  <div class="h-full overflow-y-auto bg-slate-50 dark:bg-slate-950">
    <div class="mx-auto flex max-w-7xl flex-col gap-6 p-4 md:p-6 xl:p-8">
      <section class="relative overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div class="pointer-events-none absolute -left-12 top-0 h-40 w-40 rounded-full bg-sky-200/50 blur-3xl dark:bg-sky-500/10"></div>
        <div class="pointer-events-none absolute right-0 top-0 h-48 w-48 rounded-full bg-violet-200/40 blur-3xl dark:bg-violet-500/10"></div>
        <div class="relative grid gap-6 p-6 xl:grid-cols-[minmax(0,1.45fr)_380px]">
          <div>
            <div class="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-300">
              <Sparkles class="h-3.5 w-3.5" />
              Dashboard Intelligence
            </div>
            <h1 class="mt-5 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-4xl">
              {{ heroTitle }}
            </h1>
            <p class="mt-3 max-w-3xl text-sm leading-7 text-slate-600 dark:text-slate-300">
              {{ heroDescription }}
            </p>
            <div class="mt-5 flex flex-wrap gap-3">
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80">
                <div class="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Library Scope</div>
                <div class="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{{ stats?.literature_count || 0 }} papers</div>
                <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">curated literature records</div>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80">
                <div class="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Extraction Coverage</div>
                <div class="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{{ stats?.total_records || 0 }} records</div>
                <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">across {{ stats?.distinct_il_count || 0 }} ionic liquids</div>
              </div>
              <div class="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-700 dark:bg-slate-800/80">
                <div class="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Confidence</div>
                <div class="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{{ formatConfidencePercent(stats?.confidence_stats?.avg_percent ?? null) }}</div>
                <div class="mt-1 text-xs text-slate-500 dark:text-slate-400">average verified trust score</div>
              </div>
            </div>
          </div>

          <div class="rounded-3xl border border-slate-200 bg-slate-50 p-5 dark:border-slate-700 dark:bg-slate-950/70">
            <div class="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
                  <Filter class="h-3.5 w-3.5" />
                  Linked Exploration
                </div>
                <div class="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">
                  {{ hasActiveFilters ? 'Selection Console Ready' : 'Start a Focused Query' }}
                </div>
                <p class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">
                  {{ selectionSummary }}
                </p>
              </div>
              <div class="grid grid-cols-2 gap-2">
                <div class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right dark:border-slate-700 dark:bg-slate-900">
                  <div class="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Active</div>
                  <div class="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{{ activeFilterCount }}</div>
                </div>
                <div class="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-right dark:border-slate-700 dark:bg-slate-900">
                  <div class="text-[10px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Rules</div>
                  <div class="mt-1 text-2xl font-semibold text-slate-900 dark:text-slate-100">{{ queryRuleCount }}</div>
                </div>
              </div>
            </div>

            <div v-if="filterChips.length" class="mt-4 flex flex-wrap gap-2.5">
              <div
                v-for="chip in filterChips"
                :key="chip.id"
                class="inline-flex max-w-full items-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold shadow-sm transition-all"
                :class="[getFilterColorClasses(chip.color).bg, getFilterColorClasses(chip.color).text, getFilterColorClasses(chip.color).border]"
              >
                <span class="shrink-0 text-[10px] font-bold uppercase tracking-[0.18em] opacity-60">{{ chip.label }}</span>
                <span class="max-w-[180px] truncate">{{ chip.value }}</span>
                <button
                  type="button"
                  class="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full transition-colors"
                  :class="getFilterColorClasses(chip.color).hover"
                  @click.stop="handleRemoveChip(chip)"
                >
                  <X class="h-3 w-3" />
                </button>
              </div>
            </div>
            <div v-else class="mt-4 rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm leading-6 text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400">
              Click the publication trend, material donut, COF span, ionic liquid bars, or journal list to assemble a linked selection. The workspace will inherit the same filters.
            </div>

            <div class="mt-5 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-2xl bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800 dark:bg-blue-600 dark:hover:bg-blue-500"
                @click="handleExploreData"
              >
                Open Workspace
                <ArrowRight class="h-4 w-4" />
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                @click="resetAll"
              >
                <X class="h-4 w-4" />
                Clear Filters
              </button>
            </div>
          </div>
        </div>
      </section>

      <section class="grid gap-4 xl:grid-cols-3">
        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardContent class="p-6">
            <div class="flex items-start justify-between gap-4">
              <div>
                <div class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
                  <Download class="h-3.5 w-3.5" />
                  Chart Export
                </div>
                <h3 class="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">PNG / SVG / PDF</h3>
                <p class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Export the interactive trend or material chart in presentation-ready formats.</p>
              </div>
            </div>

            <div class="mt-5 flex flex-wrap gap-2">
              <button
                type="button"
                class="rounded-2xl px-3 py-2 text-sm font-medium transition"
                :class="chartExportTarget === 'publication' ? 'bg-purple-50 text-purple-700 ring-1 ring-purple-200 dark:bg-purple-500/10 dark:text-purple-300 dark:ring-purple-500/30' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'"
                @click="chartExportTarget = 'publication'"
              >
                Publication Trend
              </button>
              <button
                type="button"
                class="rounded-2xl px-3 py-2 text-sm font-medium transition"
                :class="chartExportTarget === 'materials' ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/30' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'"
                @click="chartExportTarget = 'materials'"
              >
                Surface Ratio
              </button>
            </div>

            <div class="mt-5 grid grid-cols-3 gap-2">
              <button type="button" class="rounded-2xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200" @click="exportChart('png')">PNG</button>
              <button type="button" class="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" @click="exportChart('svg')">SVG</button>
              <button type="button" class="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" @click="exportChart('pdf')">PDF</button>
            </div>
          </CardContent>
        </Card>

        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardContent class="p-6">
            <div class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <Database class="h-3.5 w-3.5" />
              Data Export
            </div>
            <h3 class="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">CSV / JSON / Excel</h3>
            <p class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Bundle the current dashboard snapshot, active filters, and chart datasets for downstream analysis.</p>

            <div class="mt-5 grid grid-cols-3 gap-2">
              <button type="button" class="rounded-2xl bg-slate-900 px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200" @click="exportDashboardData('csv')">CSV</button>
              <button type="button" class="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" @click="exportDashboardData('json')">JSON</button>
              <button type="button" class="rounded-2xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800" @click="exportDashboardData('excel')">Excel</button>
            </div>
          </CardContent>
        </Card>

        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardContent class="p-6">
            <div class="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400">
              <Share2 class="h-3.5 w-3.5" />
              Share Snapshot
            </div>
            <h3 class="mt-3 text-lg font-semibold text-slate-900 dark:text-slate-100">Replayable dashboard link</h3>
            <p class="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">Generate a shareable dashboard snapshot that restores the same filters and opens directly in the dashboard view.</p>

            <div class="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-500 dark:border-slate-700 dark:bg-slate-800/80 dark:text-slate-400">
              <span class="line-clamp-3 break-all">{{ shareSnapshotUrl }}</span>
            </div>

            <div class="mt-4 flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="inline-flex items-center gap-2 rounded-2xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
                @click="copyShareSnapshot"
              >
                <Copy class="h-4 w-4" />
                Copy Link
              </button>
              <span class="text-xs text-slate-500 dark:text-slate-400">{{ shareStatus || 'The link includes current filters and dashboard view state.' }}</span>
            </div>
          </CardContent>
        </Card>
      </section>

      <p v-if="exportStatus" class="text-sm text-slate-500 dark:text-slate-400">{{ exportStatus }}</p>

      <section class="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card
          class="group overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm transition-all hover:-translate-y-1 dark:border-slate-800 dark:bg-slate-900"
          role="button"
          tabindex="0"
          @click="emit('open-library')"
          @keydown.enter="emit('open-library')"
        >
          <CardContent class="flex h-full items-start justify-between p-6">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Processed Papers</p>
              <h2 class="mt-3 text-4xl font-semibold text-slate-950 dark:text-white">{{ stats?.literature_count || 0 }}</h2>
              <p class="mt-2 text-sm text-blue-600 dark:text-blue-300">Total literature loaded</p>
            </div>
            <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-500/10 dark:text-blue-300">
              <FileText class="h-7 w-7" />
            </div>
          </CardContent>
        </Card>

        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardContent class="flex h-full items-start justify-between p-6">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Extracted Data Points</p>
              <h2 class="mt-3 text-4xl font-semibold text-slate-950 dark:text-white">{{ stats?.total_records || 0 }}</h2>
              <p class="mt-2 text-sm text-violet-600 dark:text-violet-300">across {{ stats?.distinct_il_count || 0 }} ionic liquids</p>
            </div>
            <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-50 text-violet-600 dark:bg-violet-500/10 dark:text-violet-300">
              <Database class="h-7 w-7" />
            </div>
          </CardContent>
        </Card>

        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardContent class="flex h-full items-start justify-between p-6">
            <div>
              <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Avg Extraction Speed</p>
              <h2 class="mt-3 text-4xl font-semibold text-slate-950 dark:text-white">1.2s</h2>
              <p class="mt-2 text-sm text-amber-600 dark:text-amber-300">per document via AI</p>
            </div>
            <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-400 text-white">
              <Zap class="h-7 w-7" />
            </div>
          </CardContent>
        </Card>

        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardContent class="p-6">
            <div class="flex items-start justify-between gap-4">
              <div>
                <p class="text-xs font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-500">Data Confidence Score</p>
                <h2 class="mt-3 text-4xl font-semibold text-slate-950 dark:text-white">{{ formatConfidencePercent(stats?.confidence_stats?.avg_percent ?? null) }}</h2>
                <p class="mt-2 text-sm text-emerald-600 dark:text-emerald-300">AI composite confidence across library records</p>
              </div>
              <div class="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500 text-white">
                <ShieldCheck class="h-7 w-7" />
              </div>
            </div>

            <div class="mt-5 space-y-2.5">
              <button
                v-for="bucket in confidenceBreakdownItems"
                :key="bucket.key"
                type="button"
                class="block w-full rounded-2xl border px-3 py-2.5 text-left transition-all"
                :class="isConfidenceBucketSelected(bucket.key) ? 'border-blue-300 bg-blue-50/80 ring-2 ring-blue-500/30 dark:border-blue-500/40 dark:bg-blue-500/10' : 'border-slate-200 bg-slate-50/80 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/60 dark:hover:bg-slate-800'"
                @click="handleConfidenceSelect(bucket.key as 'text_grounded' | 'figure_grounded' | 'inferred')"
              >
                <div class="mb-2 flex items-center justify-between gap-2 text-[11px]">
                  <span class="font-semibold text-slate-600 dark:text-slate-300">{{ confidenceBucketLabel(bucket.key) }}</span>
                  <span class="text-slate-500 dark:text-slate-400">{{ bucket.count }} rec / {{ formatConfidencePercent(bucket.avg_percent) }}</span>
                </div>
                <div class="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    class="h-full rounded-full bg-gradient-to-r transition-all"
                    :class="confidenceBucketTone(bucket.key)"
                    :style="{ width: Math.max(8, Math.min(100, bucket.share_percent || 0)) + '%' }"
                  ></div>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>
      </section>

      <section class="grid gap-6 xl:grid-cols-3">
        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm xl:col-span-2 dark:border-slate-800 dark:bg-slate-900">
          <CardHeader class="pb-2">
            <div class="flex items-center justify-between gap-3">
              <CardTitle class="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                <span class="h-2 w-2 rounded-full bg-purple-500" />
                Publication & Data Trend
              </CardTitle>
              <span class="rounded-full border px-3 py-1 text-xs font-semibold"
                :class="filters.yearRange.start || filters.yearRange.end ? 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-500/30 dark:bg-purple-500/10 dark:text-purple-300' : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'">
                {{ filters.yearRange.start || filters.yearRange.end ? 'Year Filter Active' : 'Interactive Year Filter' }}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div class="h-72 w-full relative">
              <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-slate-900/50 z-10">
                <span class="text-sm text-muted-foreground">Loading...</span>
              </div>
              <Line ref="publicationTrendChartRef" v-if="stats" :key="'trend-' + chartKey" :data="publicationTrendData" :options="publicationTrendOptions" />
            </div>
          </CardContent>
        </Card>

        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader class="pb-2">
            <CardTitle class="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-green-500" />
              Surface Material Ratio
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="h-72 w-full relative">
              <div v-if="loading" class="absolute inset-0 flex items-center justify-center bg-white/50 dark:bg-slate-900/50 z-10">
                <span class="text-sm text-muted-foreground">Loading...</span>
              </div>
              <div v-if="!loading" class="absolute inset-0 flex flex-col items-center justify-center pointer-events-none -translate-x-12">
                <span class="text-3xl font-bold text-slate-800 dark:text-slate-100">{{ materialsCount }}</span>
                <span class="text-[0.6rem] font-bold tracking-[0.28em] text-slate-400 dark:text-slate-500">MATERIALS</span>
              </div>
              <Doughnut ref="materialsRatioChartRef" v-if="stats" :key="'materials-' + chartKey" :data="materialsRatioData" :options="materialsRatioOptions" class="relative z-0" />
            </div>
          </CardContent>
        </Card>
      </section>

      <section class="grid gap-6 xl:grid-cols-3">
        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader class="pb-2">
            <CardTitle class="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-cyan-500" />
              Friction Coef (COF) Range Span
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-4 mt-6">
              <div class="grid grid-cols-[96px_1fr_86px] items-center text-xs text-slate-500 dark:text-slate-400 mb-2">
                <span></span>
                <div class="flex justify-between px-1">
                  <span>{{ formatCofTick(cofSpanMin) }}</span>
                  <span class="font-semibold text-slate-700 dark:text-slate-300">{{ formatCofTick(cofSpanMid) }}</span>
                  <span>{{ formatCofTick(cofSpanMax) }}</span>
                </div>
                <span class="text-right">min ~ max</span>
              </div>
              <button
                v-for="range in stats?.cof_ranges.slice(0, 5)"
                :key="range.name"
                type="button"
                class="grid grid-cols-[96px_1fr_86px] items-center gap-2 text-sm w-full rounded-lg py-1 px-1 transition-all"
                :class="isMaterialSelected(range.name) ? 'bg-cyan-50 dark:bg-cyan-500/10 ring-2 ring-cyan-500' : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'"
                @click="handleCofRangeSelect(range.name)"
              >
                <span class="text-xs font-bold text-slate-800 dark:text-slate-200 text-right pr-2 truncate">{{ range.name }}</span>
                <div class="h-8 bg-slate-100 dark:bg-slate-800 rounded-full relative flex items-center px-1 border border-slate-200 dark:border-slate-700">
                  <div
                    class="absolute h-6 rounded-full border transition-all"
                    :class="isMaterialSelected(range.name) ? 'bg-cyan-300/90 border-cyan-400 dark:bg-cyan-500/50 dark:border-cyan-400' : 'bg-blue-200/90 border-blue-300 dark:bg-blue-500/30 dark:border-blue-500/50'"
                    :style="{ left: ((range.min - cofSpanMin) / cofSpanRange) * 100 + '%', width: Math.max(2, ((range.max - range.min) / cofSpanRange) * 100) + '%' }"
                  ></div>
                  <div
                    class="absolute w-2.5 h-6 rounded-full shadow-sm transition-all"
                    :class="isMaterialSelected(range.name) ? 'bg-cyan-600 dark:bg-cyan-400' : 'bg-blue-600 dark:bg-blue-400'"
                    :style="{ left: ((((range.min + range.max) / 2) - cofSpanMin) / cofSpanRange) * 100 + '%', transform: 'translateX(-50%)' }"
                  ></div>
                </div>
                <span class="text-right text-[11px] font-medium text-slate-600 dark:text-slate-400 tabular-nums">{{ formatCofTick(range.min) }}-{{ formatCofTick(range.max) }}</span>
              </button>
            </div>
          </CardContent>
        </Card>

        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader class="pb-2">
            <CardTitle class="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-blue-500" />
              Top Ionic Liquids Analyzed
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-3 mt-4 h-56 overflow-y-auto pr-2 custom-scrollbar flex flex-col pt-1">
              <button
                v-for="item in stats?.top_liquids"
                :key="item.name"
                type="button"
                class="w-full flex text-left rounded-lg transition-all"
                :class="isIonicLiquidSelected(item.name) ? 'ring-2 ring-blue-500' : ''"
                @click="handleIonicLiquidSelect(item.name)"
              >
                <div
                  class="h-10 rounded-md flex items-center justify-between px-3 transition-all"
                  :class="isIonicLiquidSelected(item.name) ? 'bg-gradient-to-r from-blue-500 to-cyan-400 text-white' : 'bg-gradient-to-r from-blue-100 to-cyan-100 hover:from-blue-200 hover:to-cyan-200 dark:from-blue-500/30 dark:to-cyan-500/30 dark:text-slate-200'"
                  :style="{ width: Math.max(20, (item.count / topLiquidsMax) * 100) + '%' }"
                >
                  <span class="text-xs font-bold truncate pr-4">{{ item.name }}</span>
                  <span class="text-xs font-bold">{{ item.count }}</span>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>

        <Card class="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <CardHeader class="pb-2">
            <CardTitle class="text-base font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <span class="h-2 w-2 rounded-full bg-pink-500" />
              Leading Journals Source
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div class="space-y-3 mt-4 h-56 overflow-y-auto pr-2 custom-scrollbar flex flex-col pt-1">
              <button
                v-for="item in stats?.top_journals"
                :key="item.name"
                type="button"
                class="w-full flex text-left rounded-lg transition-all"
                :class="isJournalSelected(item.name) ? 'ring-2 ring-pink-500' : ''"
                @click="handleJournalSelect(item.name)"
              >
                <div
                  class="h-10 rounded-md flex items-center justify-between px-3 transition-all"
                  :class="isJournalSelected(item.name) ? 'bg-gradient-to-r from-fuchsia-500 to-pink-400 text-white' : 'bg-gradient-to-r from-fuchsia-100 to-pink-100 hover:from-fuchsia-200 hover:to-pink-200 dark:from-fuchsia-500/20 dark:to-pink-500/25 dark:text-slate-200'"
                  :style="{ width: Math.max(20, (item.count / topJournalsMax) * 100) + '%' }"
                >
                  <span class="text-xs font-bold truncate pr-4">{{ item.name }}</span>
                  <span class="text-xs font-bold">{{ item.count }}</span>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Custom scrollbar styles */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}

.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}

.custom-scrollbar::-webkit-scrollbar-thumb {
  background-color: rgba(156, 163, 175, 0.4);
  border-radius: 2px;
}

.custom-scrollbar::-webkit-scrollbar-thumb:hover {
  background-color: rgba(156, 163, 175, 0.6);
}
</style>
