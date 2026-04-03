import { computed, ref, watch, type Ref } from 'vue'

import {
  getFilterOptions,
  type RecordFilterOptions,
  searchRecords,
  type PaginatedRecordResponse,
  type SearchFilter,
} from '@/lib/api'
import { useDashboardFilters } from '@/composables/useDashboardFilters'

type UseRecordSearchOptions = {
  initialDoi: Ref<string | undefined>
  selectedFileId: Ref<string | null | undefined>
  pageSize?: number
}

export function useRecordSearch(options: UseRecordSearchOptions) {
  const pageSize = options.pageSize ?? 10
  const { filters } = useDashboardFilters()

  const loading = ref(false)
  const result = ref<PaginatedRecordResponse>({
    total: 0,
    skip: 0,
    limit: pageSize,
    items: [],
  })

  const filterOptions = ref<RecordFilterOptions>({
    materials: [],
    lubricants: [],
    probeMaterials: [],
    substrateMaterials: [],
    substrateCoatings: [],
    speedValues: [],
    temperatureValues: [],
    potentialValues: [],
    waterContentValues: [],
  })

  const selectedLubricant = ref('')
  const selectedProbeMaterial = ref('')
  const selectedSubstrateMaterial = ref('')
  const selectedSubstrateCoating = ref('')
  const selectedSpeedValue = ref('')
  const selectedTemperatureValue = ref('')
  const selectedPotentialValue = ref('')
  const selectedWaterContentValue = ref('')
  const searchDoi = ref(options.initialDoi.value || '')
  const loadMin = ref('')
  const loadMax = ref('')
  const cofMin = ref('')
  const cofMax = ref('')
  const currentPage = ref(1)
  const resultView = ref<'table' | 'graph'>('table')
  const graphRefreshKey = ref(0)

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
    if (selectedLubricant.value) {
      chips.push({ id: 'manual-lubricant', label: 'Ionic Liquid', value: selectedLubricant.value })
    }
    if (selectedProbeMaterial.value) {
      chips.push({ id: 'manual-probe', label: 'Probe', value: selectedProbeMaterial.value })
    }
    if (selectedSubstrateMaterial.value) {
      chips.push({ id: 'manual-substrate', label: 'Substrate', value: selectedSubstrateMaterial.value })
    }
    if (selectedSubstrateCoating.value) {
      chips.push({ id: 'manual-coating', label: 'Coating', value: selectedSubstrateCoating.value })
    }
    if (selectedSpeedValue.value) {
      chips.push({ id: 'manual-speed', label: 'Speed', value: selectedSpeedValue.value })
    }
    if (selectedTemperatureValue.value) {
      chips.push({ id: 'manual-temperature', label: 'Temp', value: selectedTemperatureValue.value })
    }
    if (selectedPotentialValue.value) {
      chips.push({ id: 'manual-potential', label: 'Potential', value: selectedPotentialValue.value })
    }
    if (selectedWaterContentValue.value) {
      chips.push({ id: 'manual-water', label: 'Water', value: selectedWaterContentValue.value })
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
    const parsed = Number.parseFloat(normalized)
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

  function buildCurrentFilter(): SearchFilter {
    const dashboardMaterials = filters.materials.length ? [...filters.materials] : []
    const dashboardLubricants = filters.ionicLiquid ? [filters.ionicLiquid] : []
    const dashboardCofMin = filters.cofRange.min ?? undefined
    const dashboardCofMax = filters.cofRange.max ?? undefined

    return {
      materials: dashboardMaterials,
      probe_materials: selectedProbeMaterial.value ? [selectedProbeMaterial.value] : undefined,
      substrate_materials: selectedSubstrateMaterial.value ? [selectedSubstrateMaterial.value] : undefined,
      substrate_coatings: selectedSubstrateCoating.value ? [selectedSubstrateCoating.value] : undefined,
      lubricants: selectedLubricant.value ? [selectedLubricant.value] : dashboardLubricants,
      speed_values: selectedSpeedValue.value ? [selectedSpeedValue.value] : undefined,
      temperature_values: selectedTemperatureValue.value ? [selectedTemperatureValue.value] : undefined,
      potential_values: selectedPotentialValue.value ? [selectedPotentialValue.value] : undefined,
      water_content_values: selectedWaterContentValue.value ? [selectedWaterContentValue.value] : undefined,
      load_min: parsedLoadMin.value ?? undefined,
      load_max: parsedLoadMax.value ?? undefined,
      cof_min: parsedCofMin.value ?? dashboardCofMin,
      cof_max: parsedCofMax.value ?? dashboardCofMax,
      doi: searchDoi.value || undefined,
      fileId: options.selectedFileId.value || undefined,
    }
  }

  function markGraphDirty() {
    graphRefreshKey.value += 1
  }

  async function loadOptions() {
    try {
      filterOptions.value = await getFilterOptions()
    } catch (err) {
      console.error('Failed to load filter options', err)
    }
  }

  async function fetchData() {
    loading.value = true
    try {
      const skip = (currentPage.value - 1) * pageSize
      result.value = await searchRecords(buildCurrentFilter(), skip, pageSize)
    } catch (err) {
      console.error('Failed to fetch records', err)
    } finally {
      loading.value = false
    }
  }

  function handleSearch() {
    if (hasInvalidManualRange.value) return
    currentPage.value = 1
    markGraphDirty()
    void fetchData()
  }

  function clearAdvancedSearch() {
    selectedLubricant.value = ''
    selectedProbeMaterial.value = ''
    selectedSubstrateMaterial.value = ''
    selectedSubstrateCoating.value = ''
    selectedSpeedValue.value = ''
    selectedTemperatureValue.value = ''
    selectedPotentialValue.value = ''
    selectedWaterContentValue.value = ''
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
    result,
    filterOptions,
    selectedLubricant,
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
