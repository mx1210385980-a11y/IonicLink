// Shared, framework- and i18n-free extraction-run stage logic.
// Single source of truth for run-status classification and stage→progress mapping,
// consumed by both useAppShell (existing list badges) and useExtractionProcess
// (the process viewer) so the two cannot drift.

export const TERMINAL_RUN_STATUSES = new Set(['completed', 'failed', 'error', 'cancelled', 'no_data'])
export const ACTIVE_RUN_STATUSES = new Set(['queued', 'running', 'processing', 'extracting'])

export function isTerminalRunStatus(status?: string | null): boolean {
  return TERMINAL_RUN_STATUSES.has(String(status || '').toLowerCase())
}

export function isActiveRunStatus(status?: string | null): boolean {
  return ACTIVE_RUN_STATUSES.has(String(status || '').toLowerCase())
}

export function mapStageToProgress(stage?: string | null, status?: string | null): number {
  const statusLower = String(status || '').toLowerCase()
  if (statusLower === 'completed') return 100
  if (statusLower === 'no_data') return 100

  const normalized = String(stage || '').trim().toLowerCase()
  if (!normalized) return 8
  if (normalized.startsWith('stage_a')) return 14
  if (normalized.startsWith('stage_b')) return 24
  if (normalized.startsWith('stage_c.fast_text')) return 62
  if (normalized.startsWith('stage_c.figure_retry')) return 50
  if (normalized.startsWith('stage_c.figure')) return 44
  if (normalized.startsWith('stage_c.text')) return 62
  if (normalized.startsWith('fallback_table')) return 74
  if (normalized.startsWith('stage_d')) return 82
  if (normalized.startsWith('stage_e')) return 94
  return 18
}

// Five coarse stage bands for the process stepper (mirrors the backend bands in
// services/extraction_trace_service.py).
export type StageBandId = 'stage_a' | 'stage_b' | 'stage_c' | 'stage_d' | 'stage_e'

export interface StageBand {
  id: StageBandId
  label: string
  lo: number
  hi: number
}

export const STAGE_BANDS: StageBand[] = [
  { id: 'stage_a', label: 'Queued', lo: 2, hi: 8 },
  { id: 'stage_b', label: 'Scanning', lo: 8, hi: 30 },
  { id: 'stage_c', label: 'Extracting', lo: 30, hi: 78 },
  { id: 'stage_d', label: 'Validating', lo: 78, hi: 90 },
  { id: 'stage_e', label: 'Finalizing', lo: 90, hi: 99 },
]

export function stageBandId(stage?: string | null): StageBandId | null {
  const n = String(stage || '').trim().toLowerCase()
  if (!n) return null
  if (n.startsWith('stage_a')) return 'stage_a'
  if (n.startsWith('stage_b')) return 'stage_b'
  if (n.startsWith('stage_c') || n.startsWith('fallback_table')) return 'stage_c'
  if (n.startsWith('stage_d')) return 'stage_d'
  if (n.startsWith('stage_e')) return 'stage_e'
  return null
}

// Index of the active band (0..4), or -1 when unknown.
export function stageBandIndex(stage?: string | null): number {
  const id = stageBandId(stage)
  if (!id) return -1
  return STAGE_BANDS.findIndex((b) => b.id === id)
}
