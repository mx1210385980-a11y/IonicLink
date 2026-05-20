import type { CreateUserRequest } from '@/lib/api'

export interface RegistrationFormState {
  username: string
  displayName: string
  password: string
  confirmPassword: string
  role: string
}

export interface RegistrationFormErrors {
  username?: string
  displayName?: string
  password?: string
  confirmPassword?: string
  role?: string
}

export interface RegistrationSuccessState {
  id: number
  username: string
  displayName: string
  role: string
  workspaceId: number
}

export interface UserListItem {
  user_id: number
}

export const registrationRoleOptions = [
  { value: 'workspace_researcher', label: '独立工作区研究员', description: '适合学弟学长协作；只在自己的工作区上传、抽取和审阅。' },
  { value: 'researcher', label: '课题组研究员', description: '可写入课题组文献库，也可维护个人工作区。' },
  { value: 'viewer', label: '查看者', description: '仅可查看组内数据，不可写入或发起处理。' },
  { value: 'group_admin', label: '组管理员', description: '可管理成员账号与共享资源。' },
] as const

const roleLabels: Record<string, string> = {
  principal_investigator: '课题负责人',
  group_admin: '组管理员',
  researcher: '课题组研究员',
  workspace_researcher: '独立工作区研究员',
  viewer: '查看者',
}

export function createEmptyRegistrationForm(): RegistrationFormState {
  return {
    username: '',
    displayName: '',
    password: '',
    confirmPassword: '',
    role: 'workspace_researcher',
  }
}

export function validateRegistrationForm(form: RegistrationFormState): RegistrationFormErrors {
  const errors: RegistrationFormErrors = {}
  const username = form.username.trim()
  const displayName = form.displayName.trim()
  const role = form.role.trim()

  if (!username) {
    errors.username = '请输入用户名。'
  } else if (username.length < 3) {
    errors.username = '用户名至少需要 3 个字符。'
  }

  if (!displayName) {
    errors.displayName = '请输入显示名称。'
  }

  if (!form.password) {
    errors.password = '请输入初始密码。'
  } else if (form.password.length < 8) {
    errors.password = '密码至少需要 8 位。'
  }

  if (!form.confirmPassword) {
    errors.confirmPassword = '请再次输入密码。'
  } else if (form.confirmPassword !== form.password) {
    errors.confirmPassword = '两次输入的密码不一致。'
  }

  if (!registrationRoleOptions.some((option) => option.value === role)) {
    errors.role = '请选择有效的成员角色。'
  }

  return errors
}

export function normalizeRegistrationPayload(form: RegistrationFormState): CreateUserRequest {
  return {
    username: form.username.trim(),
    displayName: form.displayName.trim(),
    password: form.password,
    role: form.role.trim() || 'workspace_researcher',
  }
}

export function buildRegistrationSuccessState(user: RegistrationSuccessState): RegistrationSuccessState {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    workspaceId: user.workspaceId,
  }
}

export function prioritizeHighlightedUser<T extends UserListItem>(
  users: T[],
  highlightedUserId: number | null,
): T[] {
  if (highlightedUserId == null) {
    return [...users]
  }

  const highlighted = users.find((user) => user.user_id === highlightedUserId)
  if (!highlighted) {
    return [...users]
  }

  return [highlighted, ...users.filter((user) => user.user_id !== highlightedUserId)]
}

export function getRoleLabel(role: string): string {
  return roleLabels[role] || role
}
