import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'FileUpload.vue'), 'utf-8')
const i18nSource = readFileSync(resolve(__dirname, '../composables/useI18n.ts'), 'utf-8')

describe('FileUpload extraction status display', () => {
  it('does not present no-data extraction results as completed', () => {
    expect(source).toContain("if (file.status === 'no_data') return t('status.no_data')")
    expect(source).toContain("if (file.status === 'no_data') return 'text-amber-600'")
    expect(source.indexOf("if (file.status === 'no_data') return t('status.no_data')")).toBeLessThan(
      source.indexOf("if (file.status === 'success')"),
    )
    expect(i18nSource).toContain("'status.no_data': 'No data'")
    expect(i18nSource).toContain("'status.no_data': '无数据'")
  })
})
