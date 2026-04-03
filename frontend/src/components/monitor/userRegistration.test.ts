import { describe, expect, it } from 'vitest'

import {
  buildRegistrationSuccessState,
  createEmptyRegistrationForm,
  normalizeRegistrationPayload,
  prioritizeHighlightedUser,
  validateRegistrationForm,
} from '@/components/monitor/userRegistration'

describe('user registration helpers', () => {
  it('rejects usernames shorter than 3 characters', () => {
    const form = {
      ...createEmptyRegistrationForm(),
      username: 'ab',
      displayName: '测试成员',
      password: 'Password123',
      confirmPassword: 'Password123',
    }

    expect(validateRegistrationForm(form).username).toBe('用户名至少需要 3 个字符。')
  })

  it('rejects passwords shorter than 8 characters', () => {
    const form = {
      ...createEmptyRegistrationForm(),
      username: 'tester',
      displayName: '测试成员',
      password: 'short',
      confirmPassword: 'short',
    }

    expect(validateRegistrationForm(form).password).toBe('密码至少需要 8 位。')
  })

  it('rejects mismatched confirm passwords', () => {
    const form = {
      ...createEmptyRegistrationForm(),
      username: 'tester',
      displayName: '测试成员',
      password: 'Password123',
      confirmPassword: 'Password456',
    }

    expect(validateRegistrationForm(form).confirmPassword).toBe('两次输入的密码不一致。')
  })

  it('normalizes trimmed payloads for the existing createUser api', () => {
    const payload = normalizeRegistrationPayload({
      username: '  tester  ',
      displayName: '  测试成员  ',
      password: 'Password123',
      confirmPassword: 'Password123',
      role: 'researcher',
    })

    expect(payload).toEqual({
      username: 'tester',
      displayName: '测试成员',
      password: 'Password123',
      role: 'researcher',
    })
  })

  it('returns a success state with workspace information', () => {
    expect(buildRegistrationSuccessState({
      id: 12,
      username: 'tester',
      displayName: '测试成员',
      role: 'viewer',
      workspaceId: 88,
    })).toEqual({
      id: 12,
      username: 'tester',
      displayName: '测试成员',
      role: 'viewer',
      workspaceId: 88,
    })
  })

  it('prioritizes the newest highlighted user at the top of the list', () => {
    const ordered = prioritizeHighlightedUser([
      { user_id: 1 },
      { user_id: 2 },
      { user_id: 3 },
    ], 2)

    expect(ordered.map((item) => item.user_id)).toEqual([2, 1, 3])
  })
})
