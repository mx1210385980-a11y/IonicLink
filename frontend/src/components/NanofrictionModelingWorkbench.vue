<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Activity,
  Atom,
  CheckCircle2,
  Database,
  FlaskConical,
  Loader2,
  Play,
  RefreshCcw,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
} from 'lucide-vue-next'
import {
  getModelTrainingTask,
  importWffThesisDatasets,
  listCleanedDatasets,
  listModelTrainingRuns,
  startModelTraining,
  type ModelTrainingRunListItem,
  type ModelTrainingTaskSnapshot,
  type SavedCleanedDatasetSummary,
} from '@/lib/api'
import {
  NANOFriction_CANDIDATE_MODELS,
  NANOFriction_EXTERNAL_SAMPLES,
  NANOFriction_FEATURE_INSIGHTS,
  NANOFriction_PUBLIC_COPY,
  NANOFriction_TARGET_METRICS,
  buildNanofrictionStartPayload,
} from '@/lib/nanofrictionModule'

const props = defineProps<{
  activeScopeLabel: string
  operatorName: string
}>()

type EvidenceTab = 'overview' | 'split' | 'models' | 'external' | 'factors'

const evidenceTabs: Array<{ key: EvidenceTab; label: string }> = [
  { key: 'overview', label: '成果总览' },
  { key: 'split', label: '固定划分' },
  { key: 'models', label: '候选模型' },
  { key: 'external', label: '外部验证' },
  { key: 'factors', label: '影响因素' },
]

const savedDatasets = ref<SavedCleanedDatasetSummary[]>([])
const trainingRuns = ref<ModelTrainingRunListItem[]>([])
const activeTask = ref<ModelTrainingTaskSnapshot | null>(null)
const activeTab = ref<EvidenceTab>('overview')
const loading = ref(true)
const preparing = ref(false)
const starting = ref(false)
const refreshing = ref(false)
const message = ref('')
const errorMessage = ref('')
let pollTimer: number | null = null

const thesisDataset = computed(() => savedDatasets.value.find((dataset) => {
  return dataset.import_metadata?.wff_dataset_key === 'dataset_b'
    || dataset.name.includes('Dataset-B')
    || dataset.name.includes('含膜厚')
}))

const latestCompletedRun = computed(() => trainingRuns.value.find((run) => {
  return run.status === 'completed'
    && run.algorithm === 'high_cof_segmented'
    && run.split_strategy === 'wff_thesis'
    && (!thesisDataset.value || run.cleaned_dataset_id === thesisDataset.value.id)
}) || null)

const runningTask = computed(() => activeTask.value && ['queued', 'running'].includes(activeTask.value.status)
  ? activeTask.value
  : null)

const currentTask = computed(() => activeTask.value?.status === 'completed' ? activeTask.value : null)

const resultSourceLabel = computed(() => {
  if (currentTask.value) return '本次复现'
  if (latestCompletedRun.value) return '最近复现'
  return '论文目标'
})

const testingMetric = computed(() => ({
  r2: currentTask.value?.test_metrics?.test_r2 ?? latestCompletedRun.value?.test_r2 ?? NANOFriction_TARGET_METRICS.testing.r2,
  mae: currentTask.value?.test_metrics?.test_mae ?? latestCompletedRun.value?.test_mae ?? NANOFriction_TARGET_METRICS.testing.mae,
  rmse: currentTask.value?.test_metrics?.test_rmse ?? latestCompletedRun.value?.test_rmse ?? NANOFriction_TARGET_METRICS.testing.rmse,
}))

const externalMetric = computed(() => {
  const activeExternal = currentTask.value?.insights?.external_metrics
  return {
    r2: activeExternal?.external_r2 ?? NANOFriction_TARGET_METRICS.external.r2,
    mae: activeExternal?.external_mae ?? NANOFriction_TARGET_METRICS.external.mae,
    rmse: activeExternal?.external_rmse ?? NANOFriction_TARGET_METRICS.external.rmse,
  }
})

const stepStatuses = computed(() => [
  {
    label: '载入内置数据',
    description: thesisDataset.value ? '含膜厚数据集已准备' : '等待载入含膜厚数据集',
    done: Boolean(thesisDataset.value),
    active: preparing.value,
  },
  {
    label: '校验固定划分',
    description: `${NANOFriction_TARGET_METRICS.dataset.trainingRows} 训练 / ${NANOFriction_TARGET_METRICS.dataset.testingRows} 检验 / ${NANOFriction_TARGET_METRICS.dataset.externalRows} 外部文献`,
    done: Boolean(thesisDataset.value),
    active: false,
  },
  {
    label: '复现候选模型',
    description: runningTask.value ? runningTask.value.status_message : '三模型融合与二模型对照',
    done: Boolean(currentTask.value || latestCompletedRun.value),
    active: Boolean(runningTask.value),
  },
  {
    label: '确认最优模型',
    description: '比较检验集与外部文献验证表现',
    done: Boolean(currentTask.value || latestCompletedRun.value),
    active: false,
  },
])

const statusLabel = computed(() => {
  if (runningTask.value) return NANOFriction_PUBLIC_COPY.status.running
  if (currentTask.value || latestCompletedRun.value) return NANOFriction_PUBLIC_COPY.status.completed
  if (thesisDataset.value) return NANOFriction_PUBLIC_COPY.status.ready
  return NANOFriction_PUBLIC_COPY.status.notReady
})

const canStart = computed(() => !preparing.value && !starting.value && !runningTask.value)

function metricText(value: number | null | undefined, digits = 3) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(digits) : '等待复现'
}

function percentWidth(value: number | null | undefined, target: number) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric) || target <= 0) return '0%'
  return `${Math.max(4, Math.min(100, (numeric / target) * 100)).toFixed(1)}%`
}

function modelTone(model: typeof NANOFriction_CANDIDATE_MODELS[number]) {
  return model.recommended ? 'is-recommended' : ''
}

async function refreshModuleState(silent = false) {
  if (silent) refreshing.value = true
  else loading.value = true
  errorMessage.value = ''
  try {
    const [datasetsResponse, runsResponse] = await Promise.all([
      listCleanedDatasets(),
      listModelTrainingRuns(30),
    ])
    savedDatasets.value = datasetsResponse.items
    trainingRuns.value = runsResponse.items
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.detail || error?.message || '暂时无法读取建模状态。'
  } finally {
    loading.value = false
    refreshing.value = false
  }
}

async function ensureDataset() {
  if (thesisDataset.value) return thesisDataset.value
  preparing.value = true
  message.value = '正在载入含膜厚数据集...'
  errorMessage.value = ''
  try {
    const response = await importWffThesisDatasets()
    savedDatasets.value = response.items
    const dataset = response.items.find((item) => item.import_metadata?.wff_dataset_key === 'dataset_b')
      || response.items.find((item) => item.name.includes('含膜厚'))
      || response.items[0]
    if (!dataset) {
      throw new Error('未找到含膜厚数据集。')
    }
    message.value = '数据已准备，可以开始复现论文模型。'
    return dataset
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.detail || error?.message || '载入数据失败。'
    return null
  } finally {
    preparing.value = false
  }
}

async function handlePrepareData() {
  await ensureDataset()
  await refreshModuleState(true)
}

async function handleStartReplication() {
  if (!canStart.value) return
  const dataset = await ensureDataset()
  if (!dataset) return

  starting.value = true
  message.value = '正在启动论文模型复现...'
  errorMessage.value = ''
  try {
    const target = dataset.target_column || dataset.target?.label || 'μ'
    const response = await startModelTraining(buildNanofrictionStartPayload(dataset.id, target))
    activeTask.value = response.task
    message.value = response.task.status_message || '模型复现已启动。'
    startPolling(response.task.task_id)
  } catch (error: any) {
    errorMessage.value = error?.response?.data?.detail || error?.message || '启动复现失败，请检查建模依赖。'
  } finally {
    starting.value = false
  }
}

function startPolling(taskId: string) {
  stopPolling()
  pollTimer = window.setInterval(async () => {
    try {
      const response = await getModelTrainingTask(taskId)
      activeTask.value = response.task
      message.value = response.task.status_message || message.value
      if (['completed', 'failed', 'cancelled'].includes(response.task.status)) {
        stopPolling()
        await refreshModuleState(true)
      }
    } catch (error: any) {
      stopPolling()
      errorMessage.value = error?.response?.data?.detail || error?.message || '读取复现进度失败。'
    }
  }, 2500)
}

function stopPolling() {
  if (pollTimer != null) {
    window.clearInterval(pollTimer)
    pollTimer = null
  }
}

onMounted(() => {
  void refreshModuleState()
})

onBeforeUnmount(() => {
  stopPolling()
})

void props.activeScopeLabel
void props.operatorName
</script>

<template>
  <div class="nano-shell">
    <section class="nano-hero">
      <div class="hero-copy">
        <p class="hero-kicker">Modeling / Nano-friction</p>
        <h1>{{ NANOFriction_PUBLIC_COPY.moduleTitle }}</h1>
        <p class="hero-subtitle">{{ NANOFriction_PUBLIC_COPY.moduleSubtitle }}</p>
        <div class="hero-meta">
          <span><Database class="meta-icon" /> {{ props.activeScopeLabel }}</span>
          <span><Atom class="meta-icon" /> 离子液体 / 固体界面</span>
          <span><ShieldCheck class="meta-icon" /> {{ resultSourceLabel }}</span>
        </div>
      </div>
      <div class="hero-actions">
        <p class="status-pill" :class="{ 'is-running': runningTask }">
          <Loader2 v-if="runningTask" class="spin-icon" />
          <CheckCircle2 v-else-if="currentTask || latestCompletedRun || thesisDataset" class="meta-icon" />
          <Activity v-else class="meta-icon" />
          {{ statusLabel }}
        </p>
        <div class="action-row">
          <button type="button" class="ghost-action" :disabled="preparing || loading" @click="handlePrepareData">
            <Loader2 v-if="preparing" class="button-icon spin-icon" />
            <Database v-else class="button-icon" />
            {{ preparing ? '正在载入' : NANOFriction_PUBLIC_COPY.prepareAction }}
          </button>
          <button type="button" class="primary-action" :disabled="!canStart" @click="handleStartReplication">
            <Loader2 v-if="starting || runningTask" class="button-icon spin-icon" />
            <Play v-else class="button-icon" />
            {{ runningTask ? '复现进行中' : NANOFriction_PUBLIC_COPY.primaryAction }}
          </button>
        </div>
      </div>
    </section>

    <section class="metric-grid">
      <article class="metric-tile">
        <p>含膜厚数据集</p>
        <strong>{{ NANOFriction_TARGET_METRICS.dataset.totalRows }}</strong>
        <span>{{ NANOFriction_TARGET_METRICS.dataset.featureCount }} 个描述符</span>
      </article>
      <article class="metric-tile">
        <p>固定划分</p>
        <strong>{{ NANOFriction_TARGET_METRICS.dataset.trainingRows }}/{{ NANOFriction_TARGET_METRICS.dataset.testingRows }}/{{ NANOFriction_TARGET_METRICS.dataset.externalRows }}</strong>
        <span>训练 / 检验 / 外部文献</span>
      </article>
      <article class="metric-tile is-highlighted">
        <p>检验集拟合度 R2</p>
        <strong>{{ metricText(testingMetric.r2) }}</strong>
        <span>MAE {{ metricText(testingMetric.mae) }} · RMSE {{ metricText(testingMetric.rmse) }}</span>
      </article>
      <article class="metric-tile is-highlighted">
        <p>外部文献拟合度 R2</p>
        <strong>{{ metricText(externalMetric.r2) }}</strong>
        <span>MAE {{ metricText(externalMetric.mae) }} · RMSE {{ metricText(externalMetric.rmse) }}</span>
      </article>
    </section>

    <div v-if="message || errorMessage" class="notice-row">
      <p v-if="message" class="notice success"><Sparkles class="notice-icon" /> {{ message }}</p>
      <p v-if="errorMessage" class="notice error"><TriangleAlert class="notice-icon" /> {{ errorMessage }}</p>
    </div>

    <div class="work-grid">
      <aside class="step-rail">
        <div class="rail-title">
          <FlaskConical class="rail-icon" />
          <div>
            <p>复现实验链</p>
            <span>从数据到模型证据</span>
          </div>
          <button type="button" class="icon-button" :disabled="refreshing" title="刷新状态" @click="refreshModuleState(true)">
            <RefreshCcw class="h-4 w-4" :class="{ 'animate-spin': refreshing }" />
          </button>
        </div>
        <ol class="step-list">
          <li v-for="(step, index) in stepStatuses" :key="step.label" :class="{ done: step.done, active: step.active }">
            <span class="step-index">{{ index + 1 }}</span>
            <div>
              <strong>{{ step.label }}</strong>
              <p>{{ step.description }}</p>
            </div>
          </li>
        </ol>
      </aside>

      <section class="evidence-panel">
        <nav class="evidence-tabs" aria-label="纳米摩擦建模证据视图">
          <button
            v-for="tab in evidenceTabs"
            :key="tab.key"
            type="button"
            :class="{ active: activeTab === tab.key }"
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </nav>

        <div v-if="loading" class="loading-panel">
          <Loader2 class="h-5 w-5 animate-spin" />
          正在读取建模状态...
        </div>

        <div v-else-if="activeTab === 'overview'" class="overview-layout">
          <article class="result-card">
            <p class="section-label">最优模型</p>
            <h2>分区混合预测模型</h2>
            <p>先判断低、中、高摩擦区间，再用对应的三模型融合方案给出纳米摩擦系数预测。</p>
            <div class="model-flow">
              <span>区间判断</span>
              <i />
              <span>三模型融合</span>
              <i />
              <span>摩擦系数 μ</span>
            </div>
          </article>
          <article class="result-card">
            <p class="section-label">论文目标对照</p>
            <div class="score-bars">
              <div>
                <div class="score-head"><span>检验集 R2</span><strong>{{ metricText(testingMetric.r2) }}</strong></div>
                <span class="score-track"><b :style="{ width: percentWidth(testingMetric.r2, NANOFriction_TARGET_METRICS.testing.r2) }" /></span>
              </div>
              <div>
                <div class="score-head"><span>外部文献 R2</span><strong>{{ metricText(externalMetric.r2) }}</strong></div>
                <span class="score-track"><b :style="{ width: percentWidth(externalMetric.r2, NANOFriction_TARGET_METRICS.external.r2) }" /></span>
              </div>
            </div>
          </article>
        </div>

        <div v-else-if="activeTab === 'split'" class="split-layout">
          <article class="split-card train">
            <p>训练集</p>
            <strong>{{ NANOFriction_TARGET_METRICS.dataset.trainingRows }}</strong>
            <span>用于学习材料、表面和工况之间的关系</span>
          </article>
          <article class="split-card test">
            <p>检验集</p>
            <strong>{{ NANOFriction_TARGET_METRICS.dataset.testingRows }}</strong>
            <span>用于检验未参与训练样本的预测表现</span>
          </article>
          <article class="split-card external">
            <p>外部文献验证</p>
            <strong>{{ NANOFriction_TARGET_METRICS.dataset.externalRows }}</strong>
            <span>用于观察跨离子液体和固体界面的外推能力</span>
          </article>
        </div>

        <div v-else-if="activeTab === 'models'" class="model-list">
          <article
            v-for="model in NANOFriction_CANDIDATE_MODELS"
            :key="model.key"
            class="candidate-row"
            :class="modelTone(model)"
          >
            <div>
              <p class="section-label">{{ model.simpleLabel }}</p>
              <h3>{{ model.label }}</h3>
              <span>{{ model.summary }}</span>
            </div>
            <div class="candidate-metrics">
              <span>检验 R2 <strong>{{ metricText(model.testing.r2) }}</strong></span>
              <span>外部 R2 <strong>{{ metricText(model.external.r2) }}</strong></span>
            </div>
          </article>
        </div>

        <div v-else-if="activeTab === 'external'" class="external-table">
          <div class="table-head">
            <span>离子组合</span>
            <span>固体表面</span>
            <span>电位</span>
            <span>真实 μ</span>
          </div>
          <div v-for="sample in NANOFriction_EXTERNAL_SAMPLES" :key="`${sample.cation}-${sample.anion}-${sample.surface}`" class="table-row">
            <span>{{ sample.cation }} / {{ sample.anion }}</span>
            <span>{{ sample.surface }}</span>
            <span>{{ sample.potential }}</span>
            <strong>{{ metricText(sample.actual) }}</strong>
          </div>
        </div>

        <div v-else class="factor-grid">
          <article v-for="insight in NANOFriction_FEATURE_INSIGHTS" :key="insight.region" class="factor-card">
            <p class="section-label">{{ insight.range }}</p>
            <h3>{{ insight.region }}</h3>
            <p>{{ insight.explanation }}</p>
            <div class="factor-tags">
              <span v-for="factor in insight.leadingFactors" :key="factor">{{ factor }}</span>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.nano-shell {
  --ink: #10191d;
  --muted: #64737a;
  --line: #cfdbdf;
  --paper: #f4f8f8;
  --surface: #ffffff;
  --deep: #0d1518;
  --teal: #20b795;
  --teal-soft: #dff8f1;
  --amber: #d89b23;
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  overflow: auto;
  background:
    linear-gradient(135deg, rgba(32, 183, 149, 0.10), transparent 28rem),
    radial-gradient(circle at 85% 10%, rgba(216, 155, 35, 0.12), transparent 22rem),
    var(--paper);
  color: var(--ink);
  padding: 16px;
}

.nano-hero {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 18px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  background:
    linear-gradient(135deg, rgba(32, 183, 149, 0.18), transparent 46%),
    linear-gradient(90deg, #0d1518, #132227);
  color: #eaf5f3;
  padding: 24px;
  box-shadow: 0 24px 60px -42px rgba(13, 21, 24, 0.9);
}

.hero-kicker,
.section-label {
  color: var(--teal);
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.14em;
  text-transform: uppercase;
}

.hero-copy h1 {
  margin-top: 8px;
  font-size: 34px;
  font-weight: 850;
  line-height: 1.05;
}

.hero-subtitle {
  margin-top: 10px;
  max-width: 720px;
  color: #abc1c2;
  font-size: 14px;
  line-height: 1.75;
}

.hero-meta,
.action-row,
.notice-row,
.rail-title,
.score-head,
.candidate-row,
.candidate-metrics {
  display: flex;
  align-items: center;
}

.hero-meta {
  flex-wrap: wrap;
  gap: 9px;
  margin-top: 16px;
}

.hero-meta span,
.status-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #d7e5e4;
  font-size: 12px;
  font-weight: 700;
  padding: 7px 10px;
}

.hero-actions {
  display: flex;
  min-width: 300px;
  flex-direction: column;
  align-items: flex-end;
  gap: 14px;
}

.status-pill.is-running {
  color: #d8fff6;
}

.meta-icon,
.button-icon,
.notice-icon,
.rail-icon {
  height: 16px;
  width: 16px;
}

.spin-icon {
  animation: spin 0.9s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.action-row {
  gap: 10px;
}

.primary-action,
.ghost-action,
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 800;
  transition: transform 0.18s ease, background 0.18s ease, border-color 0.18s ease;
}

.primary-action {
  border: 0;
  background: var(--teal);
  color: #06100d;
  padding: 11px 14px;
}

.ghost-action {
  border: 1px solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.08);
  color: #eaf5f3;
  padding: 10px 13px;
}

.primary-action:not(:disabled):hover,
.ghost-action:not(:disabled):hover,
.icon-button:not(:disabled):hover {
  transform: translateY(-1px);
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.55;
}

.metric-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.metric-tile,
.step-rail,
.evidence-panel,
.result-card,
.split-card,
.candidate-row,
.factor-card {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.88);
}

.metric-tile {
  padding: 14px;
}

.metric-tile p,
.split-card p {
  color: var(--muted);
  font-size: 12px;
  font-weight: 800;
}

.metric-tile strong,
.split-card strong {
  display: block;
  margin-top: 5px;
  color: var(--ink);
  font-size: 25px;
  font-weight: 850;
}

.metric-tile span,
.split-card span {
  margin-top: 4px;
  display: block;
  color: #718188;
  font-size: 12px;
}

.metric-tile.is-highlighted {
  border-color: rgba(32, 183, 149, 0.45);
  background: linear-gradient(180deg, #ffffff, var(--teal-soft));
}

.notice-row {
  align-items: stretch;
  gap: 10px;
}

.notice {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 7px;
  font-size: 13px;
  font-weight: 700;
  padding: 10px 12px;
}

.notice.success {
  border: 1px solid rgba(32, 183, 149, 0.34);
  background: var(--teal-soft);
  color: #0f6858;
}

.notice.error {
  border: 1px solid rgba(220, 38, 38, 0.25);
  background: #fff1f2;
  color: #a82036;
}

.work-grid {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 14px;
  min-height: 520px;
}

.step-rail,
.evidence-panel {
  padding: 14px;
}

.rail-title {
  justify-content: space-between;
  gap: 10px;
  border-bottom: 1px solid #e1e8eb;
  padding-bottom: 12px;
}

.rail-title > div {
  flex: 1;
}

.rail-title p {
  font-size: 14px;
  font-weight: 850;
}

.rail-title span {
  color: var(--muted);
  font-size: 12px;
}

.icon-button {
  height: 32px;
  width: 32px;
  border: 1px solid var(--line);
  background: #fff;
  color: #506168;
}

.step-list {
  margin-top: 14px;
  display: grid;
  gap: 10px;
}

.step-list li {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 10px;
  border-radius: 8px;
  background: #f8fbfb;
  padding: 10px;
}

.step-list li.done {
  background: var(--teal-soft);
}

.step-list li.active {
  outline: 2px solid rgba(32, 183, 149, 0.35);
}

.step-index {
  display: flex;
  height: 28px;
  width: 28px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: var(--deep);
  color: #fff;
  font-size: 12px;
  font-weight: 850;
}

.step-list strong {
  font-size: 13px;
}

.step-list p {
  margin-top: 3px;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.5;
}

.evidence-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  border-bottom: 1px solid #e1e8eb;
  padding-bottom: 12px;
}

.evidence-tabs button {
  border: 1px solid var(--line);
  border-radius: 7px;
  background: #fff;
  color: #506168;
  font-size: 12px;
  font-weight: 800;
  padding: 8px 11px;
}

.evidence-tabs button.active {
  border-color: var(--deep);
  background: var(--deep);
  color: #fff;
}

.loading-panel {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 320px;
  color: var(--muted);
  font-size: 13px;
}

.overview-layout,
.split-layout,
.factor-grid {
  display: grid;
  gap: 12px;
  margin-top: 14px;
}

.overview-layout {
  grid-template-columns: 1.15fr 0.85fr;
}

.result-card,
.factor-card {
  padding: 16px;
}

.result-card h2,
.factor-card h3,
.candidate-row h3 {
  margin-top: 6px;
  color: var(--ink);
  font-size: 18px;
  font-weight: 850;
}

.result-card p,
.factor-card p {
  margin-top: 8px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.75;
}

.model-flow {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 18px;
}

.model-flow span {
  border-radius: 7px;
  background: var(--teal-soft);
  color: #0f6858;
  font-size: 12px;
  font-weight: 850;
  padding: 8px 10px;
}

.model-flow i {
  height: 1px;
  width: 22px;
  background: #9fb4ba;
}

.score-bars {
  display: grid;
  gap: 18px;
  margin-top: 14px;
}

.score-head {
  justify-content: space-between;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 850;
}

.score-head strong {
  color: var(--ink);
  font-size: 18px;
}

.score-track {
  display: block;
  height: 9px;
  overflow: hidden;
  border-radius: 999px;
  background: #e6eef0;
}

.score-track b {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, var(--teal), var(--amber));
}

.split-layout {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.split-card {
  padding: 16px;
}

.split-card.train {
  border-top: 4px solid var(--teal);
}

.split-card.test {
  border-top: 4px solid var(--amber);
}

.split-card.external {
  border-top: 4px solid #475569;
}

.model-list,
.external-table {
  display: grid;
  gap: 10px;
  margin-top: 14px;
}

.candidate-row {
  justify-content: space-between;
  gap: 18px;
  padding: 14px;
}

.candidate-row.is-recommended {
  border-color: rgba(32, 183, 149, 0.52);
  background: linear-gradient(90deg, var(--teal-soft), #fff);
}

.candidate-row span {
  color: var(--muted);
  font-size: 12px;
  line-height: 1.6;
}

.candidate-metrics {
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  min-width: 220px;
}

.candidate-metrics span {
  border-radius: 7px;
  background: #f2f6f7;
  color: #506168;
  font-weight: 800;
  padding: 8px 10px;
}

.candidate-metrics strong {
  color: var(--ink);
}

.table-head,
.table-row {
  display: grid;
  grid-template-columns: minmax(180px, 1.5fr) 1fr 0.7fr 0.6fr;
  gap: 10px;
  align-items: center;
  border-radius: 7px;
  padding: 10px 12px;
}

.table-head {
  background: var(--deep);
  color: #eaf5f3;
  font-size: 12px;
  font-weight: 850;
}

.table-row {
  border: 1px solid #e1e8eb;
  background: #fff;
  color: #506168;
  font-size: 12px;
}

.table-row strong {
  color: var(--ink);
}

.factor-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.factor-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 14px;
}

.factor-tags span {
  border-radius: 999px;
  background: #edf4f5;
  color: #44545b;
  font-size: 12px;
  font-weight: 800;
  padding: 7px 9px;
}

@media (max-width: 1180px) {
  .nano-hero,
  .work-grid,
  .overview-layout {
    grid-template-columns: 1fr;
  }

  .hero-actions {
    align-items: flex-start;
  }

  .metric-grid,
  .factor-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .nano-shell {
    padding: 10px;
  }

  .metric-grid,
  .split-layout,
  .factor-grid {
    grid-template-columns: 1fr;
  }

  .candidate-row,
  .action-row,
  .notice-row {
    align-items: stretch;
    flex-direction: column;
  }

  .table-head,
  .table-row {
    grid-template-columns: 1fr;
  }
}
</style>
