import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(resolve(__dirname, 'AdminPage.vue'), 'utf8')

describe('Admin member usage page', () => {
  it('renders the member usage admin surface instead of the old monitor wrapper', () => {
    expect(source).toContain('成员使用情况')
    expect(source).toContain('memberRows')
    expect(source).toContain('memberComparisonRows')
    expect(source).toContain('待管理员处理')
    expect(source).toContain('成员对比')
    expect(source).toContain('详情')
    expect(source).toContain('账号')
    expect(source).toContain('活动')
    expect(source).toContain('程远舟')
    expect(source).toContain('朱俊宇')
    expect(source).toContain('Julyanffzz')
    expect(source).toContain('扩散模块')
    expect(source).toContain('电导模块')
    expect(source).toContain('整体模块')
    expect(source).not.toContain('MonitorView')
    expect(source).not.toContain('PlatformSectionHeader')
    expect(source).not.toContain('吴沐秋')
    expect(source).not.toContain('Anna Smith')
  })

  it('keeps AI-style analysis embedded as short system notes', () => {
    expect(source).toContain('adminNote')
    expect(source).toContain('重点看账号权限、抽取流程和模块之间的数据衔接')
    expect(source).not.toContain('研究使用画像')
    expect(source).not.toContain('AI 分析面板')
  })
})
