import { computed, ref, watch, type Ref } from 'vue'

import {
  getFilterOptions,
  type RecordFilterOptions,
  searchRecords,
  type PaginatedRecordResponse,
  type RecordSortColumn,
  type SearchFilter,
} from '@/lib/api'
import { canonicalExperimentScaleValue } from '@/lib/experimentScale'
import { useDashboardFilters } from '@/composables/useDashboardFilters'

const RANGE_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i

type UseRecordSearchOptions = {
  initialDoi: Ref<string | undefined>
  selectedFileId: Ref<string | null | undefined>
  fixedExperimentScale?: Ref<string | null | undefined>
  targetRecordId?: Ref<string | number | null | undefined>
  targetEntityType?: Ref<'record' | 'candidate' | string | null | undefined>
  entityTypeFilter?: Ref<'record' | 'candidate' | string | null | undefined>
  scope?: Ref<'active' | 'group_library' | 'all_visible' | undefined>
  pageSize?: number
}

export function useRecordSearch(options: UseRecordSearchOptions) {
  const pageSize = options.pageSize ?? 10
  const { filters } = useDashboardFilters()

  const loading = ref(false)
  const error = ref('')
  const result = ref<PaginatedRecordResponse>({
    total: 0,
    skip: 0,
    limit: pageSize,
    items: [],
  })

  const filterOptions = ref<RecordFilterOptions>({
    materials: [],
    lubricants: [],
    cations: [],
    anions: [],
    probeMaterials: [],
    substrateMaterials: [],
    substrateCoatings: [],
    speedValues: [],
    shearRateValues: [],
    temperatureValues: [],
    potentialValues: [],
    waterContentValues: [],
    experimentScales: [],
    experimentMethods: [],
    measurementTypes: [],
    trainingViews: [],
  })

  const selectedExperimentScale = ref('')
  const selectedCation = ref<string[]>([])
  const selectedAnion = ref<string[]>([])
  const selectedProbeMaterial = ref<string[]>([])
  const selectedSubstrateMaterial = ref<string[]>([])
  const selectedSubstrateCoating = ref<string[]>([])
  const selectedSpeedValue = ref<string[]>([])
  const selectedTemperatureValue = ref<string[]>([])
  const selectedPotentialValue = ref<string[]>([])
  const selectedWaterContentValue = ref<string[]>([])
  const searchDoi = ref(options.initialDoi.value || '')
  const loadMin = ref('')
  const loadMax = ref('')
  const cofMin = ref('')
  const cofMax = ref('')
  const currentPage = ref(1)
  const sortBy = ref<RecordSortColumn | ''>('')
  const sortDir = ref<'asc' | 'desc'>('asc')
  const resultView = ref<'table' | 'graph'>('table')
  const graphRefreshKey = ref(0)
  let latestFetchRequestId = 0

  const totalPages = computed(() => Math.max(1, Math.ceil(result.value.total / pageSize)))
  const rangeStart = computed(() => (result.value.total === 0 ? 0 : result.value.skip + 1))
  const rangeEnd = computed(() => Math.min(result.value.skip + pageSize, result.value.total))
  const currentFilter = computed(() => buildCurrentFilter())
  const parsedLoadMin = computed(() => parseRangeNumber(loadMin.value))
  const parsedLoadMax = computed(() => parseRangeNumber(loadMax.value))
  const parsedCofMin = computed(() => parseRangeNumber(cofMin.value))
  const parsedCofMax = computed(() => parseRangeNumber(cofMax.value))
  const isLoadRangeInvalid = computed(() => isInvalidRange(loadMin.value, loadMax.value, parsedLoadMin.value, parsedLoadMax.value))
  const isCofRangeInvalid = computed(() => {
    return isInvalidRange(cofMin.value, cofMax.value, parsedCofMin.value, parsedCofMax.value)
  })
  const hasInvalidManualRange = computed(() => isLoadRangeInvalid.value || isCofRangeInvalid.value)
  const manualFilterChips = computed(() => {
    const chips: Array<{ id: string; label: string; value: string }> = []
    if (selectedCation.value.length) {
      chips.push({ id: 'manual-cation', label: 'Cation', value: selectedCation.value.join(', ') })
    }
    if (selectedAnion.value.length) {
      chips.push({ id: 'manual-anion', label: 'Anion', value: selectedAnion.value.join(', ') })
    }
    if (selectedProbeMaterial.value.length) {
      chips.push({ id: 'manual-probe', label: 'Probe', value: selectedProbeMaterial.value.join(', ') })
    }
    if (selectedSubstrateMaterial.value.length) {
      chips.push({ id: 'manual-substrate', label: 'Substrate', value: selectedSubstrateMaterial.value.join(', ') })
    }
    if (selectedSubstrateCoating.value.length) {
      chips.push({ id: 'manual-coating', label: 'Coating', value: selectedSubstrateCoating.value.join(', ') })
    }
    if (selectedSpeedValue.value.length) {
      chips.push({ id: 'manual-speed', label: 'Speed', value: selectedSpeedValue.value.join(', ') })
    }
    if (selectedTemperatureValue.value.length) {
      chips.push({ id: 'manual-temperature', label: 'Temp', value: selectedTemperatureValue.value.join(', ') })
    }
    if (selectedPotentialValue.value.length) {
      chips.push({ id: 'manual-potential', label: 'Potential', value: selectedPotentialValue.value.join(', ') })
    }
    if (selectedWaterContentValue.value.length) {
      chips.push({ id: 'manual-water', label: 'Water', value: selectedWaterContentValue.value.join(', ') })
    }
    if (loadMin.value.trim() || loadMax.value.trim()) {
      chips.push({
        id: 'manual-load',
        label: 'Load',
        value: `${loadMin.value.trim() || 'Min'} - ${loadMax.value.trim() || 'Max'}`,
      })
    }
    if (cofMin.value.trim() || cofMax.value.trim()) {
      chips.push({
        id: 'manual-cof',
        label: 'COF',
        value: `${cofMin.value.trim() || 'Min'} - ${cofMax.value.trim() || 'Max'}`,
      })
    }
    return chips
  })
  const activeManualFilterCount = computed(() => manualFilterChips.value.length)
  const hasManualFilters = computed(() => activeManualFilterCount.value > 0)

  function parseRangeNumber(value: string): number | null {
    const normalized = String(value || '').trim()
    if (!normalized) return null
    if (!RANGE_NUMBER_PATTERN.test(normalized)) return null
    const parsed = Number(normalized)
    return Number.isFinite(parsed) ? parsed : null
  }

  function isInvalidRange(minRaw: string, maxRaw: string, minValue: number | null, maxValue: number | null) {
    const hasMinInput = minRaw.trim().length > 0
    const hasMaxInput = maxRaw.trim().length > 0

    if (hasMinInput && minValue == null) return true
    if (hasMaxInput && maxValue == null) return true
    if (minValue != null && maxValue != null && minValue > maxValue) return true
    return false
  }

  function parseTargetRecordId(value: string | number | null | undefined): number | null {
    if (value == null) return null
    const normalized = String(value).trim()
    if (!normalized) return null
    const parsed = Number(normalized)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  function normalizeEntityTypeFilter(value: string | null | undefined): 'record' | 'candidate' | undefined {
    const normalized = String(value || '').trim().toLowerCase()
    if (normalized === 'candidate') return 'candidate'
    return 'record'
  }

  function buildCurrentFilter(): SearchFilter {
    const targetRecordId = parseTargetRecordId(options.targetRecordId?.value)
    void targetRecordId

    const dashboardMaterials = filters.materials.length ? [...filters.materials] : []
    const dashboardLubricants = filters.ionicLiquid ? [filters.ionicLiquid] : []
    const dashboardCofMin = filters.cofRange.min ?? undefined
    const dashboardCofMax = filters.cofRange.max ?? undefined

    const fixedExperimentScale = canonicalExperimentScaleValue(options.fixedExperimentScale?.value || '')
    const experimentScale = fixedExperimentScale || canonicalExperimentScaleValue(selectedExperimentScale.value)

    return {
      materials: dashboardMaterials,
      probe_materials: selectedProbeMaterial.value.length ? selectedProbeMaterial.value : undefined,
      substrate_materials: selectedSubstrateMaterial.value.length ? selectedSubstrateMaterial.value : undefined,
      substrate_coatings: selectedSubstrateCoating.value.length ? selectedSubstrateCoating.value : undefined,
      lubricants: dashboardLubricants,
      cations: selectedCation.value.length ? selectedCation.value : undefined,
      anions: selectedAnion.value.length ? selectedAnion.value : undefined,
      speed_values: selectedSpeedValue.value.length ? selectedSpeedValue.value : undefined,
      temperature_values: selectedTemperatureValue.value.length ? selectedTemperatureValue.value : undefined,
      potential_values: selectedPotentialValue.value.length ? selectedPotentialValue.value : undefined,
      water_content_values: selectedWaterContentValue.value.length ? selectedWaterContentValue.value : undefined,
      experiment_scales: experimentScale ? [experimentScale] : undefined,
      load_min: parsedLoadMin.value ?? undefined,
      load_max: parsedLoadMax.value ?? undefined,
      cof_min: parsedCofMin.value ?? dashboardCofMin,
      cof_max: parsedCofMax.value ?? dashboardCofMax,
      query: searchDoi.value || undefined,
      fileId: options.selectedFileId.value || undefined,
      entityType: normalizeEntityTypeFilter(options.entityTypeFilter?.value),
      sortBy: sortBy.value || undefined,
      sortDir: sortBy.value ? sortDir.value : undefined,
    }
  }

  // Cycle a column through asc → desc → off. Picking a new column starts at asc.
  function setSort(column: RecordSortColumn) {
    if (sortBy.value === column) {
      if (sortDir.value === 'asc') {
        sortDir.value = 'desc'
      } else {
        sortBy.value = ''
        sortDir.value = 'asc'
      }
    } else {
      sortBy.value = column
      sortDir.value = 'asc'
    }
    currentPage.value = 1
    markGraphDirty()
    void fetchData()
  }

  function markGraphDirty() {
    graphRefreshKey.value += 1
  }

  async function loadOptions() {
    try {
      filterOptions.value = await getFilterOptions({ scope: options.scope?.value })
    } catch (err) {
      console.error('Failed to load filter options', err)
    }
  }

  async function fetchData() {
    const requestId = ++latestFetchRequestId
    loading.value = true
    error.value = ''
    try {
      const skip = (currentPage.value - 1) * pageSize
      const response = await searchRecords(buildCurrentFilter(), skip, pageSize, { scope: options.scope?.value })
      if (requestId !== latestFetchRequestId) return
      result.value = response
      error.value = ''
    } catch (err: any) {
      if (requestId !== latestFetchRequestId) return
      error.value = err?.message || 'Database records could not be loaded.'
      console.error('Failed to fetch records', err)
    } finally {
      if (requestId === latestFetchRequestId) loading.value = false
    }
  }

  function handleSearch() {
    if (hasInvalidManualRange.value) return
    currentPage.value = 1
    markGraphDirty()
    void fetchData()
  }

  function clearAdvancedSearch() {
    selectedCation.value = []
    selectedAnion.value = []
    selectedProbeMaterial.value = []
    selectedSubstrateMaterial.value = []
    selectedSubstrateCoating.value = []
    selectedSpeedValue.value = []
    selectedTemperatureValue.value = []
    selectedPotentialValue.value = []
    selectedWaterContentValue.value = []
    selectedExperimentScale.value = ''
    loadMin.value = ''
    loadMax.value = ''
    cofMin.value = ''
    cofMax.value = ''
    handleSearch()
  }

  function goToPage(page: number) {
    if (page < 1 || page > totalPages.value) return
    currentPage.value = page
    void fetchData()
  }

  function clearDoiFilter(onClear?: () => void) {
    searchDoi.value = ''
    onClear?.()
    handleSearch()
  }

  watch(
    options.initialDoi,
    (newDoi) => {
      searchDoi.value = newDoi || ''
      handleSearch()
    },
  )

  watch(
    options.selectedFileId,
    () => {
      currentPage.value = 1
      markGraphDirty()
      void fetchData()
    },
  )

  if (options.targetRecordId) {
    watch(
      options.targetRecordId,
      () => {
        currentPage.value = 1
        markGraphDirty()
        void fetchData()
      },
    )
  }

  if (options.entityTypeFilter) {
    watch(
      options.entityTypeFilter,
      () => {
        currentPage.value = 1
        markGraphDirty()
        void fetchData()
      },
    )
  }

  if (options.fixedExperimentScale) {
    watch(
      options.fixedExperimentScale,
      () => {
        selectedExperimentScale.value = ''
        currentPage.value = 1
        markGraphDirty()
        void fetchData()
      },
    )
  }

  watch(
    filters,
    () => {
      currentPage.value = 1
      markGraphDirty()
      void fetchData()
    },
    { deep: true },
  )

  return {
    loading,
    error,
    result,
    filterOptions,
    selectedExperimentScale,
    selectedCation,
    selectedAnion,
    selectedProbeMaterial,
    selectedSubstrateMaterial,
    selectedSubstrateCoating,
    selectedSpeedValue,
    selectedTemperatureValue,
    selectedPotentialValue,
    selectedWaterContentValue,
    searchDoi,
    loadMin,
    loadMax,
    cofMin,
    cofMax,
    currentPage,
    sortBy,
    sortDir,
    setSort,
    resultView,
    graphRefreshKey,
    totalPages,
    rangeStart,
    rangeEnd,
    currentFilter,
    parsedLoadMin,
    parsedLoadMax,
    parsedCofMin,
    parsedCofMax,
    isLoadRangeInvalid,
    isCofRangeInvalid,
    hasInvalidManualRange,
    manualFilterChips,
    activeManualFilterCount,
    hasManualFilters,
    buildCurrentFilter,
    markGraphDirty,
    loadOptions,
    fetchData,
    handleSearch,
    clearAdvancedSearch,
    goToPage,
    clearDoiFilter,
  }
}
