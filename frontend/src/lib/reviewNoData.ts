import type { BatchFile } from '@/lib/api'

export type ReviewNoDataDiagnostic = {
  kind: 'empty' | 'diffusion_figure_estimate'
  title: string
  message: string
  hints: string[]
  primaryActionLabel?: string
  primaryActionDescription?: string
}

function statusOf(file: Pick<BatchFile, 'status'> | null | undefined) {
  return String(file?.status || '').trim().toLowerCase()
}

export function shouldHydrateReviewFile(file: Pick<BatchFile, 'status' | 'records'> | null | undefined) {
  if (!file) return false
  const status = statusOf(file)
  const records = Array.isArray(file.records) ? file.records : []
  return ['success'].includes(status) && records.length === 0
}

export function isEmptyNoDataReviewFile(file: Pick<BatchFile, 'status' | 'records'> | null | undefined) {
  if (!file) return false
  const records = Array.isArray(file.records) ? file.records : []
  return statusOf(file) === 'no_data' && records.length === 0
}

export function reviewNoDataDiagnostic(file: Pick<BatchFile, 'extractor_type' | 'errorMessage' | 'progressMessage' | 'name'> | null | undefined): ReviewNoDataDiagnostic {
  const isDiffusion = file?.extractor_type === 'diffusion'
  const fallbackMessage = isDiffusion
    ? '未找到带有明确数值和单位、可直接入库的扩散系数记录。'
    : '未找到可直接入库的提取记录。'
  const rawMessage = String(file?.errorMessage || file?.progressMessage || '').trim()
  const message = rawMessage && !/^loaded from literature library$/i.test(rawMessage)
    ? rawMessage
    : fallbackMessage
  const normalizedMessage = message.toLowerCase()
  const needsFigureEstimate = isDiffusion && (
    normalizedMessage.includes('no explicit diffusion coefficient')
    || normalizedMessage.includes('no valid diffusion records')
    || normalizedMessage.includes('no extractable diffusion records')
    || normalizedMessage.includes('没有显式')
    || normalizedMessage.includes('没有可直接入库')
  )

  if (needsFigureEstimate) {
    return {
      kind: 'diffusion_figure_estimate',
      title: '需要图表估读',
      message: '没有找到可直接入库的表格/正文数值。若扩散系数只在曲线图里，请翻到图表页，用原始轴单位录入估读值；不要把图注文字当作单位。',
      hints: ['翻到图表页', '录入原始轴单位', '保存为待审候选'],
      primaryActionLabel: '用当前页估读',
      primaryActionDescription: '把当前 PDF 页作为证据来源，手动录入曲线读数。',
    }
  }

  return {
    kind: 'empty',
    title: isDiffusion ? '没有可审阅的扩散记录' : '没有可审阅记录',
    message,
    hints: isDiffusion
      ? ['保留原文 PDF 供核查。', '图表曲线里的数值先进入人工录入或估读流程。', '如果文中有表格数值，可以重新运行扩散抽取。']
      : ['保留原文 PDF 供核查。', '可返回抽取页重新运行，或换一篇文献继续。'],
  }
}
