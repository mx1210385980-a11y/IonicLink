import { computed, ref, type Ref } from 'vue'

import {
  deleteTribologyRecord,
  formatTribopairLabel,
  updateTribologyRecord,
  type EvidenceResult,
  type PaginatedRecordResponse,
  type RecordResponse,
} from '@/lib/api'
import { applyLiveConfidence } from '@/lib/integratedExplorerHelpers'
import { recordEvidenceCacheKey } from '@/composables/useEvidencePanel'

export type EditableRecordValues = {
  lubricant: string
  temperature: string
  potential: string
  waterContent: string
  speedValue: string
  shearRate: string
  loadValue: string
  probeMaterial: string
  probeGeometry: string
  probeRadius: string
  probeRoughness: string
  substrateMaterial: string
  substrateCoating: string
  substrateRoughness: string
  filmThickness: string
  cof: string
}

type UseRecordEditingOptions = {
  result: Ref<PaginatedRecordResponse>
  evidenceData: Ref<Record<string, EvidenceResult | null>>
  evidenceModalRecord: Ref<RecordResponse | null>
  markGraphDirty: () => void
}

export function useRecordEditing(options: UseRecordEditingOptions) {
  const savingRowId = ref<number | null>(null)
  const deletingRowId = ref<number | null>(null)
  const editDrawerRecord = ref<RecordResponse | null>(null)
  const editingValues = ref<Record<number, EditableRecordValues>>({})

  const activeEditValues = computed<EditableRecordValues | null>(() => {
    if (!editDrawerRecord.value) return null
    return editingValues.value[editDrawerRecord.value.id] ?? null
  })

  function resetEditingValues(record: RecordResponse) {
    editingValues.value[record.id] = {
      lubricant: record.lubricant ?? '',
      temperature: record.temperature ?? '',
      potential: record.potential ?? '',
      waterContent: record.waterContent ?? '',
      speedValue: record.speedValue ?? '',
      shearRate: record.shearRate ?? '',
      loadValue: record.loadValue ?? '',
      probeMaterial: record.probeMaterial ?? '',
      probeGeometry: record.probeGeometry ?? '',
      probeRadius: record.probeRadius ?? '',
      probeRoughness: record.probeRoughness ?? '',
      substrateMaterial: record.substrateMaterial ?? record.materialName ?? '',
      substrateCoating: record.substrateCoating ?? '',
      substrateRoughness: record.substrateRoughness ?? record.surfaceRoughness ?? '',
      filmThickness: record.filmThickness ?? '',
      cof: record.cofRaw ?? (record.cofValue != null ? String(record.cofValue) : ''),
    }
  }

  function openEditModal(record: RecordResponse) {
    resetEditingValues(record)
    editDrawerRecord.value = record
  }

  function closeEditDrawer() {
    editDrawerRecord.value = null
  }

  function updateEditingField(recordId: number, field: keyof EditableRecordValues, value: string) {
    const target = editingValues.value[recordId]
    if (!target) return
    target[field] = value
  }

  function updateActiveEditingField(field: keyof EditableRecordValues, value: string) {
    if (!editDrawerRecord.value) return
    updateEditingField(editDrawerRecord.value.id, field, value)
  }

  async function saveRecord(record: RecordResponse) {
    const vals = editingValues.value[record.id]
    if (!vals) return

    savingRowId.value = record.id
    try {
      const cofRaw = vals.cof.trim()
      const parsed = cofRaw ? parseFloat(cofRaw.replace(/[<>~=]/g, '')) : undefined
      const lubricant = vals.lubricant.trim()
      const temperature = vals.temperature.trim()
      const potential = vals.potential.trim()
      const waterContent = vals.waterContent.trim()
      const speedValue = vals.speedValue.trim()
      const shearRate = vals.shearRate.trim()
      const loadValue = vals.loadValue.trim()
      const probeMaterial = vals.probeMaterial.trim()
      const probeGeometry = vals.probeGeometry.trim()
      const probeRadius = vals.probeRadius.trim()
      const probeRoughness = vals.probeRoughness.trim()
      const substrateMaterial = vals.substrateMaterial.trim()
      const substrateCoating = vals.substrateCoating.trim()
      const substrateRoughness = vals.substrateRoughness.trim()
      const filmThickness = vals.filmThickness.trim()

      const updated = await updateTribologyRecord(record.id, {
        lubricant,
        temperature,
        potential,
        waterContent,
        speedValue,
        shearRate,
        loadValue,
        probeMaterial,
        probeGeometry,
        probeRadius,
        probeRoughness,
        substrateMaterial,
        substrateCoating,
        substrateRoughness,
        filmThickness,
        cofRaw,
        cofValue: isNaN(parsed as number) ? undefined : parsed,
      })

      record.lubricant = lubricant
      record.temperature = temperature
      record.potential = potential
      record.waterContent = waterContent
      record.speedValue = speedValue
      record.shearRate = shearRate
      record.loadValue = loadValue
      record.probeMaterial = probeMaterial || null
      record.probeGeometry = probeGeometry || null
      record.probeRadius = probeRadius || null
      record.probeRoughness = probeRoughness || null
      record.substrateMaterial = substrateMaterial || null
      record.substrateCoating = substrateCoating || null
      record.substrateRoughness = substrateRoughness || null
      record.materialName = substrateMaterial || record.materialName
      record.surfaceRoughness = substrateRoughness || null
      record.tribopairLabel = formatTribopairLabel({
        probeMaterial: record.probeMaterial,
        substrateMaterial: record.substrateMaterial,
        substrateCoating: record.substrateCoating,
        materialName: record.materialName,
      })
      record.filmThickness = filmThickness
      record.cofRaw = cofRaw
      if (!isNaN(parsed as number)) {
        record.cofValue = parsed as number
      }
      if (typeof updated?.confidence === 'number') {
        record.confidence = updated.confidence
      }
      if (updated?.confidenceDetails) {
        record.confidenceDetails = updated.confidenceDetails
      }
      const evidence = options.evidenceData.value[recordEvidenceCacheKey(record)]
      if (evidence) {
        applyLiveConfidence(record, evidence)
      }
      options.markGraphDirty()
      if (editDrawerRecord.value?.id === record.id) {
        closeEditDrawer()
      }
    } catch (err) {
      console.error('Failed to save record', err)
      alert('Save failed')
    } finally {
      savingRowId.value = null
    }
  }

  function saveActiveEditRecord() {
    if (!editDrawerRecord.value) return
    void saveRecord(editDrawerRecord.value)
  }

  function isSavingActiveEditRecord(): boolean {
    return !!editDrawerRecord.value && savingRowId.value === editDrawerRecord.value.id
  }

  async function removeRecord(record: RecordResponse) {
    if (!confirm(`Delete record ${record.id}?`)) return

    deletingRowId.value = record.id
    try {
      const resp = await deleteTribologyRecord(record.id)
      if (resp?.success) {
        options.result.value.items = options.result.value.items.filter((item) => item.id !== record.id)
        options.result.value.total = Math.max(0, options.result.value.total - 1)
        options.markGraphDirty()
        if (options.evidenceModalRecord.value?.id === record.id) {
          options.evidenceModalRecord.value = null
        }
        if (editDrawerRecord.value?.id === record.id) {
          closeEditDrawer()
        }
      }
    } catch (err) {
      console.error('Failed to delete record', err)
      alert('Delete failed')
    } finally {
      deletingRowId.value = null
    }
  }

  return {
    savingRowId,
    deletingRowId,
    editDrawerRecord,
    editingValues,
    activeEditValues,
    resetEditingValues,
    openEditModal,
    closeEditDrawer,
    updateEditingField,
    updateActiveEditingField,
    saveRecord,
    saveActiveEditRecord,
    isSavingActiveEditRecord,
    removeRecord,
  }
}
