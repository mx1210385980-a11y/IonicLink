import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { api, listLiterature } from '@/lib/api'
import { clearSession, sessionState, setSession, type AuthUser } from '@/lib/session'

function createUser(): AuthUser {
  return {
    id: 1,
    username: 'admin',
    displayName: 'Group Admin',
    role: 'principal_investigator',
    group: {
      id: 1,
      name: 'IonicLink Research Group',
      slug: 'ioniclink-research-group',
    },
    personalWorkspaceId: 1,
    availableScopes: [
      {
        type: 'group_library',
        key: 'group_library',
        label: '课题组文献库',
        workspaceId: null,
        ownerUserId: null,
        isPersonal: false,
        writable: true,
      },
      {
        type: 'workspace',
        key: 'workspace:1',
        label: 'Personal Workspace',
        workspaceId: 1,
        ownerUserId: 1,
        isPersonal: true,
        writable: true,
      },
    ],
  }
}

function headerValue(headers: any, key: string) {
  if (!headers) return undefined
  if (typeof headers.get === 'function') return headers.get(key)
  return headers[key] ?? headers[key.toLowerCase()]
}

describe('library API scope', () => {
  const originalAdapter = api.defaults.adapter

  beforeEach(() => {
    window.localStorage.clear()
    sessionState.token = ''
    sessionState.user = null
    sessionState.activeScopeKey = ''
    setSession('test-token', createUser())
  })

  afterEach(() => {
    api.defaults.adapter = originalAdapter
    clearSession()
  })

  it('can force the shared group library even when the active scope is a workspace', async () => {
    let capturedHeaders: any = null
    api.defaults.adapter = async (config) => {
      capturedHeaders = config.headers
      return {
        data: [],
        status: 200,
        statusText: 'OK',
        headers: {},
        config,
      }
    }

    await listLiterature(0, 1000, { scope: 'group_library' })

    expect(headerValue(capturedHeaders, 'Authorization')).toBe('Bearer test-token')
    expect(headerValue(capturedHeaders, 'X-Scope-Type')).toBe('group_library')
    expect(headerValue(capturedHeaders, 'X-Workspace-Id')).toBeUndefined()
  })
})
