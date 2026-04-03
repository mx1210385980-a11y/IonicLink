import { computed, reactive, readonly } from 'vue'

/**
 * Filter types for dashboard linkage
 */
export interface DashboardFilter {
  /** Selected year range for publication trend */
  yearRange: { start: number | null; end: number | null }
  /** Selected surface materials */
  materials: string[]
  /** Selected ionic liquid */
  ionicLiquid: string | null
  /** Selected journal */
  journal: string | null
  /** COF range filter */
  cofRange: { min: number | null; max: number | null }
  /** Confidence bucket filter */
  confidenceBucket: 'text_grounded' | 'figure_grounded' | 'inferred' | null
}

export interface FilterChangeEvent {
  type: keyof DashboardFilter
  value: unknown
  source: 'chart' | 'chip' | 'reset'
}

// Shared state across components
const state = reactive<DashboardFilter>({
  yearRange: { start: null, end: null },
  materials: [],
  ionicLiquid: null,
  journal: null,
  cofRange: { min: null, max: null },
  confidenceBucket: null,
})

// Event listeners for filter changes
const listeners: Set<(event: FilterChangeEvent) => void> = new Set()

function parseInteger(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

function parseFloatValue(value: string | null): number | null {
  if (!value) return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * Composable for managing dashboard filter state with cross-chart linkage
 */
export function useDashboardFilters() {
  // Check if any filters are active
  const hasActiveFilters = computed(() => {
    return (
      state.yearRange.start !== null ||
      state.yearRange.end !== null ||
      state.materials.length > 0 ||
      state.ionicLiquid !== null ||
      state.journal !== null ||
      state.cofRange.min !== null ||
      state.cofRange.max !== null ||
      state.confidenceBucket !== null
    )
  })

  // Get active filter count
  const activeFilterCount = computed(() => {
    let count = 0
    if (state.yearRange.start !== null || state.yearRange.end !== null) count++
    count += state.materials.length
    if (state.ionicLiquid !== null) count++
    if (state.journal !== null) count++
    if (state.cofRange.min !== null || state.cofRange.max !== null) count++
    if (state.confidenceBucket !== null) count++
    return count
  })

  // Generate filter chips for display
  const filterChips = computed(() => {
    const chips: Array<{
      id: string
      type: keyof DashboardFilter
      label: string
      value: string
      color: string
    }> = []

    if (state.yearRange.start !== null || state.yearRange.end !== null) {
      const start = state.yearRange.start ?? 'earliest'
      const end = state.yearRange.end ?? 'latest'
      chips.push({
        id: 'year-range',
        type: 'yearRange',
        label: 'Year',
        value: `${start} - ${end}`,
        color: 'purple',
      })
    }

    state.materials.forEach((material, index) => {
      chips.push({
        id: `material-${index}`,
        type: 'materials',
        label: 'Surface',
        value: material,
        color: 'green',
      })
    })

    if (state.ionicLiquid) {
      chips.push({
        id: 'ionic-liquid',
        type: 'ionicLiquid',
        label: 'IL',
        value: state.ionicLiquid,
        color: 'blue',
      })
    }

    if (state.journal) {
      chips.push({
        id: 'journal',
        type: 'journal',
        label: 'Journal',
        value: state.journal,
        color: 'pink',
      })
    }

    if (state.cofRange.min !== null || state.cofRange.max !== null) {
      const min = state.cofRange.min?.toFixed(3) ?? '0'
      const max = state.cofRange.max?.toFixed(3) ?? '1'
      chips.push({
        id: 'cof-range',
        type: 'cofRange',
        label: 'COF',
        value: `${min} - ${max}`,
        color: 'cyan',
      })
    }

    if (state.confidenceBucket) {
      const labels: Record<string, string> = {
        text_grounded: 'Text-grounded',
        figure_grounded: 'Figure-grounded',
        inferred: 'Model-inferred',
      }
      chips.push({
        id: 'confidence',
        type: 'confidenceBucket',
        label: 'Confidence',
        value: labels[state.confidenceBucket] || state.confidenceBucket,
        color: 'emerald',
      })
    }

    return chips
  })

  // Build query params for navigation
  const queryParams = computed(() => {
    const params: Record<string, string> = {}

    if (state.yearRange.start !== null) {
      params.yearStart = String(state.yearRange.start)
    }
    if (state.yearRange.end !== null) {
      params.yearEnd = String(state.yearRange.end)
    }
    if (state.materials.length > 0) {
      params.materials = state.materials.join(',')
    }
    if (state.ionicLiquid) {
      params.lubricant = state.ionicLiquid
    }
    if (state.journal) {
      params.journal = state.journal
    }
    if (state.cofRange.min !== null) {
      params.cofMin = String(state.cofRange.min)
    }
    if (state.cofRange.max !== null) {
      params.cofMax = String(state.cofRange.max)
    }
    if (state.confidenceBucket) {
      params.confidence = state.confidenceBucket
    }

    return params
  })

  // Emit filter change event
  function emitChange(event: FilterChangeEvent) {
    listeners.forEach((listener) => listener(event))
  }

  // Set year range filter
  function setYearRange(start: number | null, end: number | null, source: FilterChangeEvent['source'] = 'chart') {
    state.yearRange = { start, end }
    emitChange({ type: 'yearRange', value: state.yearRange, source })
  }

  // Toggle year in range (for clicking single year on chart)
  function toggleYear(year: number, source: FilterChangeEvent['source'] = 'chart') {
    if (state.yearRange.start === year && state.yearRange.end === year) {
      // Already selected, deselect
      state.yearRange = { start: null, end: null }
    } else if (state.yearRange.start === null) {
      // No selection, select single year
      state.yearRange = { start: year, end: year }
    } else if (state.yearRange.end === null || state.yearRange.start === state.yearRange.end) {
      // Single year selected, extend range
      const current = state.yearRange.start
      state.yearRange = {
        start: Math.min(current, year),
        end: Math.max(current, year),
      }
    } else {
      // Range selected, start new selection
      state.yearRange = { start: year, end: year }
    }
    emitChange({ type: 'yearRange', value: state.yearRange, source })
  }

  // Toggle material selection
  function toggleMaterial(material: string, source: FilterChangeEvent['source'] = 'chart') {
    const index = state.materials.indexOf(material)
    if (index >= 0) {
      state.materials.splice(index, 1)
    } else {
      state.materials.push(material)
    }
    emitChange({ type: 'materials', value: [...state.materials], source })
  }

  // Set ionic liquid filter
  function setIonicLiquid(liquid: string | null, source: FilterChangeEvent['source'] = 'chart') {
    state.ionicLiquid = state.ionicLiquid === liquid ? null : liquid
    emitChange({ type: 'ionicLiquid', value: state.ionicLiquid, source })
  }

  // Set journal filter
  function setJournal(journal: string | null, source: FilterChangeEvent['source'] = 'chart') {
    state.journal = state.journal === journal ? null : journal
    emitChange({ type: 'journal', value: state.journal, source })
  }

  // Set COF range filter
  function setCofRange(min: number | null, max: number | null, source: FilterChangeEvent['source'] = 'chart') {
    // Toggle off if same range
    if (state.cofRange.min === min && state.cofRange.max === max) {
      state.cofRange = { min: null, max: null }
    } else {
      state.cofRange = { min, max }
    }
    emitChange({ type: 'cofRange', value: state.cofRange, source })
  }

  // Set confidence bucket filter
  function setConfidenceBucket(
    bucket: 'text_grounded' | 'figure_grounded' | 'inferred' | null,
    source: FilterChangeEvent['source'] = 'chart'
  ) {
    state.confidenceBucket = state.confidenceBucket === bucket ? null : bucket
    emitChange({ type: 'confidenceBucket', value: state.confidenceBucket, source })
  }

  // Remove a specific filter
  function removeFilter(type: keyof DashboardFilter, value?: string) {
    switch (type) {
      case 'yearRange':
        state.yearRange = { start: null, end: null }
        break
      case 'materials':
        if (value) {
          const index = state.materials.indexOf(value)
          if (index >= 0) state.materials.splice(index, 1)
        } else {
          state.materials = []
        }
        break
      case 'ionicLiquid':
        state.ionicLiquid = null
        break
      case 'journal':
        state.journal = null
        break
      case 'cofRange':
        state.cofRange = { min: null, max: null }
        break
      case 'confidenceBucket':
        state.confidenceBucket = null
        break
    }
    emitChange({ type, value: null, source: 'chip' })
  }

  // Reset all filters
  function resetAll() {
    state.yearRange = { start: null, end: null }
    state.materials = []
    state.ionicLiquid = null
    state.journal = null
    state.cofRange = { min: null, max: null }
    state.confidenceBucket = null
    emitChange({ type: 'yearRange', value: null, source: 'reset' })
  }

  function replaceFromQuery(params: URLSearchParams, source: FilterChangeEvent['source'] = 'reset') {
    state.yearRange = {
      start: parseInteger(params.get('yearStart')),
      end: parseInteger(params.get('yearEnd')),
    }
    state.materials = (params.get('materials') || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    state.ionicLiquid = params.get('lubricant')?.trim() || null
    state.journal = params.get('journal')?.trim() || null
    state.cofRange = {
      min: parseFloatValue(params.get('cofMin')),
      max: parseFloatValue(params.get('cofMax')),
    }

    const confidence = params.get('confidence')
    state.confidenceBucket =
      confidence === 'text_grounded' || confidence === 'figure_grounded' || confidence === 'inferred'
        ? confidence
        : null

    emitChange({ type: 'yearRange', value: { ...state }, source })
  }

  // Subscribe to filter changes
  function onFilterChange(callback: (event: FilterChangeEvent) => void) {
    listeners.add(callback)
    return () => listeners.delete(callback)
  }

  // Check if a specific item is selected
  function isYearInRange(year: number): boolean {
    if (state.yearRange.start === null || state.yearRange.end === null) return false
    return year >= state.yearRange.start && year <= state.yearRange.end
  }

  function isMaterialSelected(material: string): boolean {
    return state.materials.includes(material)
  }

  function isIonicLiquidSelected(liquid: string): boolean {
    return state.ionicLiquid === liquid
  }

  function isJournalSelected(journal: string): boolean {
    return state.journal === journal
  }

  function isCofRangeSelected(min: number, max: number): boolean {
    return state.cofRange.min === min && state.cofRange.max === max
  }

  function isConfidenceBucketSelected(bucket: string): boolean {
    return state.confidenceBucket === bucket
  }

  return {
    // State (readonly)
    filters: readonly(state),
    hasActiveFilters,
    activeFilterCount,
    filterChips,
    queryParams,

    // Actions
    setYearRange,
    toggleYear,
    toggleMaterial,
    setIonicLiquid,
    setJournal,
    setCofRange,
    setConfidenceBucket,
    removeFilter,
    resetAll,
    replaceFromQuery,

    // Subscriptions
    onFilterChange,

    // Checks
    isYearInRange,
    isMaterialSelected,
    isIonicLiquidSelected,
    isJournalSelected,
    isCofRangeSelected,
    isConfidenceBucketSelected,
  }
}
