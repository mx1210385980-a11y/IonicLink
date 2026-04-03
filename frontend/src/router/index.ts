import { h } from 'vue'
import {
  createRouter,
  createWebHistory,
  type LocationQueryRaw,
  type RouteLocationNormalized,
  type RouteRecordRaw,
} from 'vue-router'

import {
  DEFAULT_SECTION_BY_VIEW,
  normalizeSection,
  resolveRoute,
  type AppView,
} from '@/lib/platform'

const RouteStub = { render: () => h('div') }

function sanitizeQuery(query: LocationQueryRaw) {
  const nextQuery: LocationQueryRaw = { ...query }
  delete nextQuery.view
  delete nextQuery.section
  return nextQuery
}

function paramsFor(view: AppView, route: Pick<RouteLocationNormalized, 'params'>) {
  const currentSection = typeof route.params.section === 'string' ? route.params.section : undefined
  const normalizedSection = normalizeSection(view, currentSection)
  return normalizedSection === DEFAULT_SECTION_BY_VIEW[view]
    ? {}
    : { section: normalizedSection }
}

function createViewRoute(view: AppView): RouteRecordRaw {
  return {
    path: `/${view}/:section?`,
    name: view,
    component: RouteStub,
    beforeEnter: (to) => {
      const nextParams = paramsFor(view, to)
      const incomingSection = typeof to.params.section === 'string' ? to.params.section : undefined
      const normalizedSection = Object.prototype.hasOwnProperty.call(nextParams, 'section')
        ? String(nextParams.section)
        : undefined

      if (incomingSection === normalizedSection || (!incomingSection && !normalizedSection)) {
        return true
      }

      return {
        name: view,
        params: nextParams,
        query: sanitizeQuery(to.query),
        hash: to.hash,
      }
    },
  }
}

const legacyRedirects: Array<{ path: string; view: AppView }> = [
  { path: '/dashboard', view: 'home' },
  { path: '/workspace', view: 'pipeline' },
  { path: '/cleaning', view: 'knowledge' },
  { path: '/predict', view: 'modeling' },
  { path: '/monitor', view: 'admin' },
  { path: '/literature', view: 'review' },
  { path: '/grounding', view: 'review' },
  { path: '/guide', view: 'help' },
  { path: '/mentor', view: 'home' },
]

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: (to) => {
      const resolved = resolveRoute(
        typeof to.query.view === 'string' ? to.query.view : undefined,
        typeof to.query.section === 'string' ? to.query.section : undefined,
      )

      return {
        name: resolved.view,
        params: resolved.section === DEFAULT_SECTION_BY_VIEW[resolved.view]
          ? {}
          : { section: resolved.section },
        query: sanitizeQuery(to.query),
        hash: to.hash,
      }
    },
  },
  createViewRoute('home'),
  createViewRoute('pipeline'),
  createViewRoute('review'),
  createViewRoute('knowledge'),
  createViewRoute('modeling'),
  createViewRoute('admin'),
  createViewRoute('help'),
  createViewRoute('blog'),
  ...legacyRedirects.map(({ path, view }) => ({
    path,
    redirect: {
      name: view,
    },
  })),
  {
    path: '/:pathMatch(.*)*',
    redirect: {
      name: 'home',
    },
  },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

export default router
