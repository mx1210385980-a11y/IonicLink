import { computed, ref, type Ref } from 'vue'

import {
  correctRecord,
  deleteTribologyRecord,
  formatTribopairLabel,
  updateTribologyRecord,
  type EvidenceResult,
  type PaginatedRecordResponse,
  type RecordCorrectionResult,
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
    correctionPreview.value = null
    correctionError.value = ''
  }

  function closeEditDrawer() {
    editDrawerRecord.value = null
    correctionPreview.value = null
    correctionError.value = ''
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

  type TrimmedEditValues = {
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
    cofRaw: string
    parsedCof: number | undefined
  }

  function trimEditValues(vals: EditableRecordValues): TrimmedEditValues {
    const cofRaw = vals.cof.trim()
    const parsed = cofRaw ? parseFloat(cofRaw.replace(/[<>~=]/g, '')) : undefined
    return {
      lubricant: vals.lubricant.trim(),
      temperature: vals.temperature.trim(),
      potential: vals.potential.trim(),
      waterContent: vals.waterContent.trim(),
      speedValue: vals.speedValue.trim(),
      shearRate: vals.shearRate.trim(),
      loadValue: vals.loadValue.trim(),
      probeMaterial: vals.probeMaterial.trim(),
      probeGeometry: vals.probeGeometry.trim(),
      probeRadius: vals.probeRadius.trim(),
      probeRoughness: vals.probeRoughness.trim(),
      substrateMaterial: vals.substrateMaterial.trim(),
      substrateCoating: vals.substrateCoating.trim(),
      substrateRoughness: vals.substrateRoughness.trim(),
      filmThickness: vals.filmThickness.trim(),
      cofRaw,
      parsedCof: isNaN(parsed as number) ? undefined : parsed,
    }
  }

  // Map the reviewer's edits onto the live row so the table reflects the saved
  // state without a refetch. Shared by the legacy PUT path and the correction path.
  function applyTrimmedToRecord(record: RecordResponse, t: TrimmedEditValues) {
    record.lubricant = t.lubricant
    record.temperature = t.temperature
    record.potential = t.potential
    record.waterContent = t.waterContent
    record.speedValue = t.speedValue
    record.shearRate = t.shearRate
    record.loadValue = t.loadValue
    record.probeMaterial = t.probeMaterial || null
    record.probeGeometry = t.probeGeometry || null
    record.probeRadius = t.probeRadius || null
    record.probeRoughness = t.probeRoughness || null
    record.substrateMaterial = t.substrateMaterial || null
    record.substrateCoating = t.substrateCoating || null
    record.substrateRoughness = t.substrateRoughness || null
    record.materialName = t.substrateMaterial || record.materialName
    record.surfaceRoughness = t.substrateRoughness || null
    record.tribopairLabel = formatTribopairLabel({
      probeMaterial: record.probeMaterial,
      substrateMaterial: record.substrateMaterial,
      substrateCoating: record.substrateCoating,
      materialName: record.materialName,
    })
    record.filmThickness = t.filmThickness
    record.cofRaw = t.cofRaw
    if (t.parsedCof !== undefined) {
      record.cofValue = t.parsedCof
    }
    const evidence = options.evidenceData.value[recordEvidenceCacheKey(record)]
    if (evidence) {
      applyLiveConfidence(record, evidence)
    }
  }

  // Build the {column: value} payload for the sanctioned correction service.
  // Column names match the backend correctable-field allowlist.
  function correctionFieldsFor(record: RecordResponse, t: TrimmedEditValues): Record<string, unknown> {
    const fields: Record<string, unknown> = {
      lubricant: t.lubricant,
      temperature: t.temperature,
      potential: t.potential,
      water_content: t.waterContent,
      speed_value: t.speedValue,
      shear_rate: t.shearRate,
      load_value: t.loadValue,
      probe_material: t.probeMaterial,
      probe_geometry: t.probeGeometry,
      probe_radius: t.probeRadius,
      probe_roughness: t.probeRoughness,
      substrate_material: t.substrateMaterial,
      material_name: t.substrateMaterial || (record.materialName ?? ''),
      substrate_coating: t.substrateCoating,
      substrate_roughness: t.substrateRoughness,
      film_thickness: t.filmThickness,
      cof_raw: t.cofRaw,
    }
    if (t.parsedCof !== undefined) {
      fields.cof_value = t.parsedCof
    }
    return fields
  }

  async function saveRecord(record: RecordResponse) {
    const vals = editingValues.value[record.id]
    if (!vals) return

    savingRowId.value = record.id
    try {
      const t = trimEditValues(vals)
      const updated = await updateTribologyRecord(record.id, {
        lubricant: t.lubricant,
        temperature: t.temperature,
        potential: t.potential,
        waterContent: t.waterContent,
        speedValue: t.speedValue,
        shearRate: t.shearRate,
        loadValue: t.loadValue,
        probeMaterial: t.probeMaterial,
        probeGeometry: t.probeGeometry,
        probeRadius: t.probeRadius,
        probeRoughness: t.probeRoughness,
        substrateMaterial: t.substrateMaterial,
        substrateCoating: t.substrateCoating,
        substrateRoughness: t.substrateRoughness,
        filmThickness: t.filmThickness,
        cofRaw: t.cofRaw,
        cofValue: t.parsedCof,
      })

      applyTrimmedToRecord(record, t)
      if (typeof updated?.confidence === 'number') {
        record.confidence = updated.confidence
      }
      if (updated?.confidenceDetails) {
        record.confidenceDetails = updated.confidenceDetails
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

  // --- Sanctioned correction flow (dry-run preview → confirm) -----------------
  const correctionPending = ref(false)
  const correctionError = ref('')
  const correctionPreview = ref<RecordCorrectionResult | null>(null)
  const correctionReviewMode = computed(() => correctionPreview.value !== null)

  async function previewActiveCorrection() {
    const record = editDrawerRecord.value
    const vals = record ? editingValues.value[record.id] : null
    if (!record || !vals) return
    correctionPending.value = true
    correctionError.value = ''
    try {
      const t = trimEditValues(vals)
      correctionPreview.value = await correctRecord(
        record.id,
        { fields: correctionFieldsFor(record, t) },
        { dryRun: true },
      )
    } catch (err: any) {
      correctionError.value = err?.response?.data?.detail || err?.message || 'Could not preview changes'
    } finally {
      correctionPending.value = false
    }
  }

  async function commitActiveCorrection() {
    const record = editDrawerRecord.value
    const vals = record ? editingValues.value[record.id] : null
    if (!record || !vals) return
    correctionPending.value = true
    correctionError.value = ''
    try {
      const t = trimEditValues(vals)
      const result = await correctRecord(record.id, { fields: correctionFieldsFor(record, t) })
      applyTrimmedToRecord(record, t)
      if (typeof result.confidence === 'number') {
        record.confidence = result.confidence
      }
      options.markGraphDirty()
      correctionPreview.value = null
      closeEditDrawer()
    } catch (err: any) {
      correctionError.value = err?.response?.data?.detail || err?.message || 'Save failed'
    } finally {
      correctionPending.value = false
    }
  }

  function cancelCorrectionReview() {
    correctionPreview.value = null
    correctionError.value = ''
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
    correctionPending,
    correctionError,
    correctionPreview,
    correctionReviewMode,
    previewActiveCorrection,
    commitActiveCorrection,
    cancelCorrectionReview,
  }
}
