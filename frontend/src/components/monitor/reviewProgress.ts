import type { ChartData } from 'chart.js'

import type { ExtractionReviewProgressTrendItem } from '@/lib/api'

export function formatReviewCompletion(value: number | null | undefined): string {
  const numeric = Number(value || 0)
  if (!Number.isFinite(numeric) || numeric <= 0) return '0%'
  return `${Math.round(numeric * 100)}%`
}

function shortDate(value: string): string {
  const date = new Date(`${value}T00:00:00`)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit' })
}

export function buildReviewProgressChartData(
  trend: ExtractionReviewProgressTrendItem[],
): ChartData<'line' | 'bar', number[], string> {
  return {
    labels: trend.map((item) => shortDate(item.date)),
    datasets: [
      {
        type: 'line' as const,
        label: 'Review completion',
        data: trend.map((item) => Math.round(Number(item.reviewCompletionRate || 0) * 100)),
        borderColor: '#0f766e',
        backgroundColor: 'rgba(15, 118, 110, 0.12)',
        tension: 0.32,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
        yAxisID: 'yCompletion',
      },
      {
        type: 'bar' as const,
        label: 'Approved records',
        data: trend.map((item) => Number(item.approvedRecords || 0)),
        backgroundColor: '#38bdf8',
        borderRadius: 4,
        barPercentage: 0.48,
        yAxisID: 'yRecords',
      },
    ],
  }
}
