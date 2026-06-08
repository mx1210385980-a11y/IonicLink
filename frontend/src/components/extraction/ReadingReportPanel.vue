<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { AlertCircle, FileText, Loader2, Pencil, RefreshCw, Rows3, Save, Sparkles, X } from 'lucide-vue-next'

import type { ReadingReportResponse } from '@/lib/api'
import { renderMarkdown } from '@/lib/blogContent'

const props = withDefaults(defineProps<{
  report: ReadingReportResponse | null
  loading?: boolean
  generatingCandidates?: boolean
  deepExtracting?: boolean
  reader?: boolean
  editable?: boolean
  saving?: boolean
  saveError?: string
  saveLabel?: string
}>(), {
  loading: false,
  generatingCandidates: false,
  deepExtracting: false,
  reader: false,
  editable: false,
  saving: false,
  saveError: '',
  saveLabel: 'Save',
})

const emit = defineEmits<{
  retry: []
  generateCandidates: []
  deepExtraction: []
  save: [markdown: string]
  'editing-change': [editing: boolean]
}>()

const status = computed(() => String(props.report?.status || (props.loading ? 'running' : 'missing')).toLowerCase())
const isReady = computed(() => status.value === 'completed' && Boolean(props.report?.report_markdown))
const isFailed = computed(() => status.value === 'failed')
const displayReport = computed(() => buildReportTable(props.report?.report_markdown || ''))
const draftMarkdown = ref(props.report?.report_markdown || '')
const editing = ref(false)
const activeSaveMode = ref<'display' | 'edit' | null>(null)
const canSaveDraft = computed(() => draftMarkdown.value.trim().length > 0 && !props.saving)
const canSaveDisplay = computed(() => Boolean(props.report?.report_markdown?.trim()) && !props.saving)
const modelLabel = computed(() => {
  const model = props.report?.model
  const provider = props.report?.provider
  if (model && provider) return `${provider} · ${model}`
  return model || provider || 'LLM report'
})

watch(() => props.report?.report_markdown, (value) => {
  if (!editing.value) draftMarkdown.value = value || ''
})

watch(() => props.saving, (saving, wasSaving) => {
  if (!wasSaving || saving) return
  if (activeSaveMode.value === 'edit' && !props.saveError) {
    editing.value = false
    emit('editing-change', false)
  }
  activeSaveMode.value = null
})

function startEditing() {
  draftMarkdown.value = props.report?.report_markdown || ''
  editing.value = true
  emit('editing-change', true)
}

function cancelEditing() {
  draftMarkdown.value = props.report?.report_markdown || ''
  editing.value = false
  emit('editing-change', false)
}

function saveDisplayReport() {
  if (!canSaveDisplay.value) return
  activeSaveMode.value = 'display'
  emit('save', props.report?.report_markdown || '')
}

function saveEditedReport() {
  if (!canSaveDraft.value) return
  activeSaveMode.value = 'edit'
  emit('save', draftMarkdown.value)
}

type ReportTableRow = {
  label: string
  value: string
}

type ReportTable = {
  headers: [string, string]
  rows: ReportTableRow[]
}

function buildReportTable(markdown: string): ReportTable {
  const table = extractFirstMarkdownTable(markdown)
  if (table.rows.length) return table

  const rows = extractSectionRows(markdown)
  return {
    headers: ['Topic', 'Notes'],
    rows: rows.length ? rows : [{ label: 'Report', value: markdown.trim() }],
  }
}

function extractFirstMarkdownTable(markdown: string): ReportTable {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index] || ''
    const separatorLine = lines[index + 1] || ''
    if (!isMarkdownTableRow(headerLine) || !isMarkdownTableSeparator(separatorLine)) continue

    const header = splitMarkdownTableRow(headerLine)
    const rows: ReportTableRow[] = []
    let rowIndex = index + 2
    while (rowIndex < lines.length && isMarkdownTableRow(lines[rowIndex] || '')) {
      const cells = splitMarkdownTableRow(lines[rowIndex] || '')
      rows.push({
        label: cells[0] || 'Topic',
        value: cells.slice(1).join(' | ') || cells[0] || '',
      })
      rowIndex += 1
    }
    return {
      headers: [header[0] || 'Topic', header[1] || 'Notes'],
      rows,
    }
  }
  return { headers: ['Topic', 'Notes'], rows: [] }
}

function extractSectionRows(markdown: string): ReportTableRow[] {
  const rows: ReportTableRow[] = []
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  let currentHeading = ''
  let buffer: string[] = []

  const flush = () => {
    const value = buffer.join('\n').trim()
    if (currentHeading && value) rows.push({ label: currentHeading, value })
    buffer = []
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const heading = trimmed.match(/^#{1,3}\s+(.+)$/)
    if (heading) {
      flush()
      currentHeading = cleanReportLabel(heading[1] || '')
      continue
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/)
    if (bullet) {
      const bulletText = bullet[1] || ''
      const splitIndex = bulletText.indexOf(':')
      if (splitIndex > 0) {
        rows.push({
          label: cleanReportLabel(bulletText.slice(0, splitIndex)),
          value: bulletText.slice(splitIndex + 1).trim(),
        })
        continue
      }
    }

    buffer.push(trimmed)
  }

  flush()
  return rows
}

function splitMarkdownTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line)
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function isMarkdownTableRow(line: string) {
  return line.includes('|') && splitMarkdownTableRow(line).length >= 2
}

function cleanReportLabel(value: string) {
  return value
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .trim()
}

function renderReportCell(value: string) {
  return renderMarkdown(value).html
}
</script>

<template>
  <section v-if="reader && isReady" class="space-y-3">
    <div
      v-if="editable"
      data-testid="reading-report-toolbar"
      class="flex flex-wrap items-center justify-end gap-2"
    >
      <template v-if="editing">
        <button
          type="button"
          class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-600 transition hover:border-teal-200 hover:text-[#0f7c82]"
          :disabled="saving"
          @click="cancelEditing"
        >
          <X class="h-4 w-4" />
          Cancel
        </button>
        <button
          type="button"
          data-testid="save-edited-reading-report"
          class="inline-flex h-9 items-center gap-2 rounded-md bg-[#12312f] px-3 text-sm font-extrabold text-white transition hover:bg-[#1c4642] disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="!canSaveDraft"
          @click="saveEditedReport"
        >
          <Loader2 v-if="saving && activeSaveMode === 'edit'" class="h-4 w-4 animate-spin" />
          <Save v-else class="h-4 w-4" />
          {{ saving && activeSaveMode === 'edit' ? 'Saving...' : 'Save' }}
        </button>
      </template>
      <template v-else>
        <button
          type="button"
          data-testid="save-report-to-library"
          class="inline-flex h-9 items-center gap-2 rounded-md bg-[#12312f] px-3 text-sm font-extrabold text-white transition hover:bg-[#1c4642] disabled:cursor-not-allowed disabled:opacity-60"
          :disabled="!canSaveDisplay"
          @click="saveDisplayReport"
        >
          <Loader2 v-if="saving && activeSaveMode === 'display'" class="h-4 w-4 animate-spin" />
          <Save v-else class="h-4 w-4" />
          {{ saving && activeSaveMode === 'display' ? 'Saving...' : saveLabel }}
        </button>
        <button
          type="button"
          data-testid="edit-reading-report"
          class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-600 transition hover:border-teal-200 hover:text-[#0f7c82]"
          @click="startEditing"
        >
          <Pencil class="h-4 w-4" />
          Edit
        </button>
      </template>
    </div>
    <div v-if="saveError" class="mb-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
      {{ saveError }}
    </div>
    <article
      class="reading-report reading-report--reader max-h-[31rem] overflow-y-auto rounded-lg border border-slate-200 bg-white px-5 py-4"
      :class="editing ? 'bg-[#fbfcf8]' : ''"
    >
      <div v-if="editing" data-testid="reading-report-edit-mode">
        <textarea
        v-model="draftMarkdown"
        class="min-h-[20rem] w-full resize-y rounded-md border border-slate-200 bg-[#fbfcf8] px-4 py-3 font-mono text-sm leading-7 text-slate-800 outline-none transition focus:border-[#0f7c82] focus:bg-white focus:ring-2 focus:ring-teal-100"
        spellcheck="false"
        aria-label="Editable reading report"
        ></textarea>
      </div>
      <div
        v-else
        data-testid="reading-report-display-table"
        class="reading-report-table overflow-hidden rounded-md border border-slate-200 bg-white"
      >
        <table>
          <thead>
            <tr>
              <th>{{ displayReport.headers[0] }}</th>
              <th>{{ displayReport.headers[1] }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in displayReport.rows" :key="`${row.label}:${row.value}`">
              <td class="font-black text-slate-900">{{ row.label }}</td>
              <td v-html="renderReportCell(row.value)"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </article>
  </section>
  <section v-else class="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
    <header class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 bg-[#fbfcf8] px-4 py-3">
      <div class="flex min-w-0 items-start gap-3">
        <span class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#12312f] text-white shadow-sm">
          <Sparkles v-if="isReady" class="h-4.5 w-4.5" />
          <AlertCircle v-else-if="isFailed" class="h-4.5 w-4.5" />
          <Loader2 v-else class="h-4.5 w-4.5 animate-spin" />
        </span>
        <div class="min-w-0">
          <p class="text-xs font-black uppercase tracking-[0.14em] text-slate-400">LLM reading report</p>
          <h3 class="mt-0.5 text-base font-black text-slate-950">
            <template v-if="isReady">Report ready</template>
            <template v-else-if="isFailed">Report needs a retry</template>
            <template v-else>Reading paper</template>
          </h3>
          <p class="mt-1 text-sm font-medium text-slate-500">
            <template v-if="isReady">{{ modelLabel }}</template>
            <template v-else-if="isFailed">{{ report?.error_message || 'The model report could not be generated.' }}</template>
            <template v-else>Preparing the first model report before any deep extraction.</template>
          </p>
        </div>
      </div>

      <div class="flex shrink-0 flex-wrap items-center gap-2">
        <button
          v-if="isFailed"
          type="button"
          class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-700 transition hover:border-[#12312f] hover:text-[#12312f]"
          @click="emit('retry')"
        >
          <RefreshCw class="h-4 w-4" />
          Retry report
        </button>
        <template v-if="isReady">
          <button
            v-if="editable && !editing"
            type="button"
            data-testid="save-report-to-library"
            class="inline-flex h-9 items-center gap-2 rounded-md bg-[#12312f] px-3 text-sm font-extrabold text-white transition hover:bg-[#1c4642] disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="!canSaveDisplay"
            @click="saveDisplayReport"
          >
            <Loader2 v-if="saving && activeSaveMode === 'display'" class="h-4 w-4 animate-spin" />
            <Save v-else class="h-4 w-4" />
            {{ saving && activeSaveMode === 'display' ? 'Saving...' : saveLabel }}
          </button>
          <button
            v-if="editable && !editing"
            type="button"
            data-testid="edit-reading-report"
            class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-600 transition hover:border-teal-200 hover:text-[#0f7c82]"
            @click="startEditing"
          >
            <Pencil class="h-4 w-4" />
            Edit
          </button>
          <button
            v-if="editable && editing"
            type="button"
            class="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-extrabold text-slate-600 transition hover:border-teal-200 hover:text-[#0f7c82]"
            :disabled="saving"
            @click="cancelEditing"
          >
            <X class="h-4 w-4" />
            Cancel
          </button>
          <button
            v-if="editable && editing"
            type="button"
            data-testid="save-edited-reading-report"
            class="inline-flex h-9 items-center gap-2 rounded-md bg-[#12312f] px-3 text-sm font-extrabold text-white transition hover:bg-[#1c4642] disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="!canSaveDraft"
            @click="saveEditedReport"
          >
            <Loader2 v-if="saving && activeSaveMode === 'edit'" class="h-4 w-4 animate-spin" />
            <Save v-else class="h-4 w-4" />
            {{ saving && activeSaveMode === 'edit' ? 'Saving...' : 'Save' }}
          </button>
          <button
            v-if="!editing"
            type="button"
            class="inline-flex h-9 items-center gap-2 rounded-md border border-[#d1e2dc] bg-white px-3 text-sm font-extrabold text-[#12312f] transition hover:bg-[#edf7f3] disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="generatingCandidates"
            @click="emit('generateCandidates')"
          >
            <Rows3 class="h-4 w-4" />
            {{ generatingCandidates ? 'Generating...' : 'Generate candidates' }}
          </button>
          <button
            v-if="!editing"
            type="button"
            class="inline-flex h-9 items-center gap-2 rounded-md bg-[#12312f] px-3 text-sm font-extrabold text-white transition hover:bg-[#1c4642] disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="deepExtracting"
            @click="emit('deepExtraction')"
          >
            <FileText class="h-4 w-4" />
            {{ deepExtracting ? 'Starting...' : 'Deep extraction' }}
          </button>
        </template>
      </div>
    </header>

    <div v-if="isReady" class="reading-report max-h-[30rem] overflow-y-auto px-5 py-4">
      <div v-if="saveError" class="mb-3 rounded-md border border-rose-100 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
        {{ saveError }}
      </div>
      <template v-if="editing">
        <textarea
          data-testid="reading-report-edit-mode"
          v-model="draftMarkdown"
          class="min-h-[18rem] w-full resize-y rounded-md border border-slate-200 bg-[#fbfcf8] px-4 py-3 font-mono text-sm leading-7 text-slate-800 outline-none transition focus:border-[#0f7c82] focus:bg-white focus:ring-2 focus:ring-teal-100"
          spellcheck="false"
          aria-label="Editable reading report"
        ></textarea>
      </template>
      <div
        v-else
        data-testid="reading-report-display-table"
        class="reading-report-table overflow-hidden rounded-md border border-slate-200 bg-white"
      >
        <table>
          <thead>
            <tr>
              <th>{{ displayReport.headers[0] }}</th>
              <th>{{ displayReport.headers[1] }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in displayReport.rows" :key="`${row.label}:${row.value}`">
              <td class="font-black text-slate-900">{{ row.label }}</td>
              <td v-html="renderReportCell(row.value)"></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
    <div v-else-if="isFailed" class="px-5 py-8">
      <div class="rounded-md border border-rose-100 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">
        {{ report?.error_message || 'The report failed. Retry when the model endpoint is available.' }}
      </div>
    </div>
    <div v-else class="px-5 py-8">
      <div class="h-2 overflow-hidden rounded-full bg-slate-100">
        <div class="h-full w-2/3 animate-pulse rounded-full bg-[#12312f]"></div>
      </div>
      <p class="mt-4 max-w-2xl text-sm font-medium leading-6 text-slate-500">
        The first pass is a readable model response: paper summary, experimental systems,
        key reported signals, and candidate rows worth reviewing.
      </p>
    </div>
  </section>
</template>

<style scoped>
.reading-report {
  scrollbar-color: #cbd5e1 transparent;
}

.reading-report :deep(h2) {
  margin-top: 1.25rem;
  margin-bottom: 0.6rem;
  border-top: 1px solid #e2e8f0;
  padding-top: 1rem;
  font-size: 1.02rem;
  line-height: 1.35;
  font-weight: 900;
  color: #0f172a;
}

.reading-report :deep(h2:first-child) {
  margin-top: 0;
  border-top: 0;
  padding-top: 0;
}

.reading-report :deep(h3) {
  margin-top: 1rem;
  margin-bottom: 0.35rem;
  font-size: 0.95rem;
  line-height: 1.35;
  font-weight: 900;
  color: #0f172a;
}

.reading-report :deep(p),
.reading-report :deep(li) {
  max-width: 72ch;
  font-size: 0.9rem;
  line-height: 1.75;
  color: #3b465a;
}

.reading-report--reader :deep(p),
.reading-report--reader :deep(li) {
  font-size: 0.88rem;
}

.reading-report :deep(ul),
.reading-report :deep(ol) {
  margin: 0.35rem 0 0.9rem 1.15rem;
}

.reading-report :deep(strong) {
  color: #0f172a;
}

.reading-report :deep(table) {
  display: block;
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: separate;
  border-spacing: 0;
  margin: 0.75rem 0 1rem;
  border: 1px solid #dbe3ee;
  border-radius: 0.55rem;
  font-size: 0.82rem;
  background: #fff;
}

.reading-report :deep(th),
.reading-report :deep(td) {
  border-bottom: 1px solid #e2e8f0;
  padding: 0.52rem 0.65rem;
  text-align: left;
  vertical-align: top;
  min-width: 11rem;
  line-height: 1.55;
  color: #334155;
}

.reading-report :deep(th) {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #f8fafc;
  font-size: 0.74rem;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: #0f7c82;
}

.reading-report :deep(tr:last-child td) {
  border-bottom: 0;
}

.reading-report :deep(hr) {
  margin: 1.1rem 0;
  border: 0;
  border-top: 1px solid #e2e8f0;
}
</style>
