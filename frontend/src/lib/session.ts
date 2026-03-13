import { reactive } from 'vue'

export type ScopeType = 'workspace' | 'group_library'

export interface ScopeSummary {
  type: ScopeType
  key: string
  label: string
  workspaceId: number | null
  ownerUserId: number | null
  isPersonal: boolean
  writable: boolean
}

export interface AuthGroup {
  id: number
  name: string
  slug: string
}

export interface AuthUser {
  id: number
  username: string
  displayName: string
  role: string
  group: AuthGroup
  personalWorkspaceId: number | null
  availableScopes: ScopeSummary[]
}

const TOKEN_STORAGE_KEY = 'ioniclink-access-token'
const SCOPE_KEY_STORAGE_KEY = 'ioniclink-scope-key'

function loadStoredToken(): string {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

function loadStoredScopeKey(): string {
  try {
    return window.localStorage.getItem(SCOPE_KEY_STORAGE_KEY) || ''
  } catch {
    return ''
  }
}

export const sessionState = reactive({
  token: loadStoredToken(),
  user: null as AuthUser | null,
  activeScopeKey: loadStoredScopeKey(),
  ready: false,
})

function persistToken(token: string) {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token)
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY)
    }
  } catch {
    // Ignore storage failures.
  }
}

function persistScopeKey(scopeKey: string) {
  try {
    if (scopeKey) {
      window.localStorage.setItem(SCOPE_KEY_STORAGE_KEY, scopeKey)
    } else {
      window.localStorage.removeItem(SCOPE_KEY_STORAGE_KEY)
    }
  } catch {
    // Ignore storage failures.
  }
}

export function getSessionToken(): string {
  return sessionState.token
}

export function getActiveScope(user: AuthUser | null = sessionState.user): ScopeSummary | null {
  if (!user?.availableScopes?.length) return null
  const explicit = user.availableScopes.find((scope) => scope.key === sessionState.activeScopeKey)
  if (explicit) return explicit

  const preferredWorkspace = user.availableScopes.find(
    (scope) => scope.type === 'workspace' && scope.workspaceId === user.personalWorkspaceId,
  )
  return preferredWorkspace || user.availableScopes[0] || null
}

export function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {}
  if (sessionState.token) {
    headers.Authorization = `Bearer ${sessionState.token}`
  }

  const scope = getActiveScope()
  if (scope) {
    headers['X-Scope-Type'] = scope.type
    if (scope.type === 'workspace' && scope.workspaceId != null) {
      headers['X-Workspace-Id'] = String(scope.workspaceId)
    }
  }
  return headers
}

export function setActiveScope(scope: ScopeSummary | null) {
  sessionState.activeScopeKey = scope?.key || ''
  persistScopeKey(sessionState.activeScopeKey)
}

export function setSession(token: string, user: AuthUser) {
  sessionState.token = token
  sessionState.user = user
  persistToken(token)
  setActiveScope(getActiveScope(user))
}

export function setCurrentUser(user: AuthUser | null) {
  sessionState.user = user
  if (!user) {
    setActiveScope(null)
    return
  }
  setActiveScope(getActiveScope(user))
}

export function clearSession() {
  sessionState.token = ''
  sessionState.user = null
  sessionState.activeScopeKey = ''
  persistToken('')
  persistScopeKey('')
}

export function markSessionReady() {
  sessionState.ready = true
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers || {})
  Object.entries(getAuthHeaders()).forEach(([key, value]) => {
    if (!headers.has(key)) {
      headers.set(key, value)
    }
  })
  const response = await fetch(input, { ...init, headers })
  if (response.status === 401) {
    clearSession()
  }
  return response
}
