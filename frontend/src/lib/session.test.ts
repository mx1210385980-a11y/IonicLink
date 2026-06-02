import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  authFetch,
  clearSession,
  getActiveScope,
  getAuthHeaders,
  sessionState,
  setCurrentUser,
  setSession,
  type AuthUser,
} from '@/lib/session'

function createUser(): AuthUser {
  return {
    id: 7,
    username: 'tester',
    displayName: 'Test User',
    role: 'admin',
    group: {
      id: 1,
      name: 'Core Lab',
      slug: 'core-lab',
    },
    personalWorkspaceId: 42,
    availableScopes: [
      {
        type: 'group_library',
        key: 'group:1',
        label: 'Group Library',
        workspaceId: null,
        ownerUserId: null,
        isPersonal: false,
        writable: false,
      },
      {
        type: 'workspace',
        key: 'workspace:42',
        label: 'Personal Workspace',
        workspaceId: 42,
        ownerUserId: 7,
        isPersonal: true,
        writable: true,
      },
    ],
  }
}

describe('session state', () => {
  beforeEach(() => {
    window.localStorage.clear()
    sessionState.token = ''
    sessionState.user = null
    sessionState.activeScopeKey = ''
    sessionState.ready = false
  })

  it('prefers the personal workspace when no explicit scope is selected', () => {
    const user = createUser()

    expect(getActiveScope(user)?.key).toBe('workspace:42')
  })

  it('persists token and resolved scope when setting a session', () => {
    const user = createUser()

    setSession('secret-token', user)

    expect(sessionState.token).toBe('secret-token')
    expect(sessionState.activeScopeKey).toBe('workspace:42')
    expect(window.localStorage.getItem('ioniclink-access-token')).toBe('secret-token')
    expect(window.localStorage.getItem('ioniclink-scope-key')).toBe('workspace:42')
  })

  it('builds authorization and scope headers from the active session', () => {
    setSession('secret-token', createUser())

    expect(getAuthHeaders()).toEqual({
      Authorization: 'Bearer secret-token',
      'X-Scope-Type': 'workspace',
      'X-Workspace-Id': '42',
    })
  })

  it('clears persisted state when the user signs out', () => {
    setSession('secret-token', createUser())

    clearSession()

    expect(sessionState.token).toBe('')
    expect(sessionState.user).toBeNull()
    expect(sessionState.activeScopeKey).toBe('')
    expect(window.localStorage.getItem('ioniclink-access-token')).toBeNull()
    expect(window.localStorage.getItem('ioniclink-scope-key')).toBeNull()
  })

  it('drops the session after an unauthorized fetch', async () => {
    setSession('secret-token', createUser())
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 401 }))

    const response = await authFetch('http://example.test/api/ping')

    expect(response.status).toBe(401)
    expect(sessionState.token).toBe('')
    expect(sessionState.user).toBeNull()
  })

  it('recomputes scope when the current user changes', () => {
    const user = createUser()
    setSession('secret-token', user)

    setCurrentUser({
      ...user,
      personalWorkspaceId: 99,
      availableScopes: [
        {
          type: 'workspace',
          key: 'workspace:99',
          label: 'Replacement Workspace',
          workspaceId: 99,
          ownerUserId: 7,
          isPersonal: true,
          writable: true,
        },
      ],
    })

    expect(sessionState.activeScopeKey).toBe('workspace:99')
  })
})
