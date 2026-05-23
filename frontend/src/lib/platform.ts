export type AppView =
  | 'home'
  | 'pipeline'
  | 'review'
  | 'knowledge'
  | 'quality'
  | 'modeling'
  | 'admin'
  | 'help'
  | 'blog'

export type LegacyAppView =
  | 'dashboard'
  | 'workspace'
  | 'cleaning'
  | 'predict'
  | 'monitor'
  | 'literature'
  | 'grounding'
  | 'guide'
  | 'mentor'
  | 'blog'

export type AppSection =
  | 'today'
  | 'alerts'
  | 'actions'
  | 'upload'
  | 'runs'
  | 'batch'
  | 'inbox'
  | 'record-review'
  | 'grounding'
  | 'queue'
  | 'explorer'
  | 'snapshots'
  | 'insights'
  | 'sources'
  | 'graph'
  | 'cleaning'
  | 'datasets'
  | 'overview'
  | 'training'
  | 'nanofriction'
  | 'evaluation'
  | 'registry'
  | 'runtime'
  | 'users'
  | 'metrics'
  | 'quick-start'
  | 'workflow'
  | 'content'
  | 'articles'

export type AppRoute = {
  view: AppView
  section: AppSection
}

export const DEFAULT_SECTION_BY_VIEW: Record<AppView, AppSection> = {
  home: 'today',
  pipeline: 'upload',
  review: 'inbox',
  knowledge: 'explorer',
  quality: 'overview',
  modeling: 'training',
  admin: 'runtime',
  help: 'quick-start',
  blog: 'articles',
}

export const SECTION_OPTIONS_BY_VIEW: Record<AppView, AppSection[]> = {
  home: ['today', 'alerts', 'actions'],
  pipeline: ['upload', 'runs', 'batch'],
  review: ['inbox', 'record-review', 'grounding', 'queue'],
  knowledge: ['explorer', 'snapshots', 'insights', 'sources', 'graph', 'cleaning', 'datasets'],
  quality: ['overview'],
  modeling: ['training', 'nanofriction', 'evaluation', 'registry'],
  admin: ['runtime', 'users', 'metrics'],
  help: ['quick-start', 'workflow', 'content'],
  blog: ['articles'],
}

const LEGACY_ROUTE_MAP: Record<LegacyAppView, AppRoute> = {
  dashboard: { view: 'pipeline', section: 'upload' },
  workspace: { view: 'pipeline', section: 'upload' },
  cleaning: { view: 'knowledge', section: 'cleaning' },
  predict: { view: 'modeling', section: 'training' },
  monitor: { view: 'admin', section: 'runtime' },
  literature: { view: 'review', section: 'inbox' },
  grounding: { view: 'review', section: 'grounding' },
  guide: { view: 'help', section: 'quick-start' },
  mentor: { view: 'home', section: 'alerts' },
  blog: { view: 'blog', section: 'articles' },
}

export function isAppView(value: string | null | undefined): value is AppView {
  return Boolean(value && value in DEFAULT_SECTION_BY_VIEW)
}

export function normalizeSection(view: AppView, section?: string | null): AppSection {
  const normalized = String(section || '').trim().toLowerCase() as AppSection
  const validSections = SECTION_OPTIONS_BY_VIEW[view]
  return validSections.includes(normalized) ? normalized : DEFAULT_SECTION_BY_VIEW[view]
}

export function resolveRoute(
  view?: string | null,
  section?: string | null,
): AppRoute {
  const normalizedView = String(view || '').trim().toLowerCase()

  if (isAppView(normalizedView)) {
    return {
      view: normalizedView,
      section: normalizeSection(normalizedView, section),
    }
  }

  if (normalizedView && normalizedView in LEGACY_ROUTE_MAP) {
    const legacyRoute = LEGACY_ROUTE_MAP[normalizedView as LegacyAppView]
    return {
      view: legacyRoute.view,
      section: normalizeSection(legacyRoute.view, section || legacyRoute.section),
    }
  }

  return {
    view: 'pipeline',
    section: DEFAULT_SECTION_BY_VIEW.pipeline,
  }
}
