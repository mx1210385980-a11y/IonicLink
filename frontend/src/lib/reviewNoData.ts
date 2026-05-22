import type { BatchFile } from '@/lib/api'

export type ReviewNoDataDiagnostic = {
  title: string
  message: string
  hints: string[]
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

  return {
    title: isDiffusion ? '没有可审阅的扩散记录' : '没有可审阅记录',
    message,
    hints: isDiffusion
      ? ['保留原文 PDF 供核查。', '图表曲线里的数值先进入人工录入或估读流程。', '如果文中有表格数值，可以重新运行扩散抽取。']
      : ['保留原文 PDF 供核查。', '可返回抽取页重新运行，或换一篇文献继续。'],
  }
}
