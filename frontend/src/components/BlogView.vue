<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  ArrowLeft,
  BookOpenText,
  CalendarDays,
  ChevronRight,
  Clock3,
  FileText,
  FolderTree,
  Github,
  Search,
  ShieldAlert,
  UserRound,
} from 'lucide-vue-next'
import { useRoute, useRouter } from 'vue-router'

import { blogArticles, blogSections, type BlogArticle } from '@/lib/blogContent'

const props = defineProps<{
  operatorName: string
}>()

const emit = defineEmits<{
  exit: []
}>()

const fallbackArticle = blogArticles[0]
const route = useRoute()
const router = useRouter()

if (!fallbackArticle) {
  throw new Error('Blog content is empty. Add markdown files under src/content.')
}

const initialArticle: BlogArticle = fallbackArticle
const searchInput = ref<HTMLInputElement | null>(null)
const articlePaneRef = ref<HTMLElement | null>(null)
const searchQuery = ref('')
const activeHeadingId = ref('')
const activeSlug = ref(resolveInitialSlug())

const topNav = [
  { key: 'home', label: '首页' },
  { key: 'articles', label: '文章' },
  { key: 'calendar', label: '校历' },
  { key: 'guide', label: '指南' },
  { key: 'about', label: '关于' },
] as const

const spaceNotices = [
  '新生必读：常见问题汇总',
  '个人知识库持续更新中',
  '平台说明与 AI 笔记已归档到这里',
]

const filteredSections = computed(() => {
  const keyword = searchQuery.value.trim().toLowerCase()
  if (!keyword) {
    return blogSections
  }

  return blogSections
    .map((section) => ({
      ...section,
      articles: section.articles.filter((article) => article.searchText.includes(keyword)),
    }))
    .filter((section) => section.articles.length > 0)
})

const visibleArticles = computed(() => filteredSections.value.flatMap((section) => section.articles))

const activeArticle = computed<BlogArticle>(() => {
  return blogArticles.find((article) => article.slug === activeSlug.value)
    || visibleArticles.value[0]
    || initialArticle
})

const latestArticles = computed(() => {
  return [...blogArticles]
    .sort((left, right) => {
      if (left.dateSort !== right.dateSort) {
        return right.dateSort - left.dateSort
      }
      return left.order - right.order
    })
    .slice(0, 4)
})

const activeSection = computed(() => {
  return blogSections.find((section) => section.key === activeArticle.value.sectionKey) || blogSections[0]
})

watch(visibleArticles, (articles) => {
  if (!articles.some((article) => article.slug === activeSlug.value) && articles[0]) {
    activeSlug.value = articles[0].slug
  }
}, { immediate: true })

watch(activeArticle, async () => {
  await nextTick()
  updateActiveHeading()
}, { immediate: true })

function resolveInitialSlug() {
  const articleParam = typeof route.query.article === 'string' ? route.query.article.trim() : ''
  if (articleParam && blogArticles.some((article) => article.slug === articleParam)) {
    return articleParam
  }

  const legacyHash = decodeURIComponent(String(route.hash || '').replace(/^#/, '').trim())
  if (legacyHash && blogArticles.some((article) => article.slug === legacyHash)) {
    return legacyHash
  }

  return initialArticle.slug
}

function syncLocation(slug: string) {
  void router.replace({
    name: 'blog',
    query: {
      ...route.query,
      article: slug,
    },
    hash: '',
  })
}

function selectArticle(slug: string) {
  activeSlug.value = slug
  syncLocation(slug)
  articlePaneRef.value?.scrollTo({ top: 0, behavior: 'smooth' })
}

function syncFromRoute() {
  activeSlug.value = resolveInitialSlug()
}

function focusSearch() {
  searchInput.value?.focus()
  searchInput.value?.select()
}

function updateActiveHeading() {
  const container = articlePaneRef.value
  if (!container) {
    return
  }

  const headings = Array.from(container.querySelectorAll<HTMLElement>('[data-article-heading="true"]'))
  if (!headings.length) {
    activeHeadingId.value = ''
    return
  }

  const containerTop = container.getBoundingClientRect().top
  const offset = 28
  let current = headings[0]

  for (const heading of headings) {
    if (heading.getBoundingClientRect().top - containerTop - offset <= 0) {
      current = heading
    } else {
      break
    }
  }

  activeHeadingId.value = current?.id || ''
}

function handleArticleScroll() {
  updateActiveHeading()
}

function scrollToHeading(id: string) {
  const container = articlePaneRef.value
  const target = container?.querySelector<HTMLElement>(`[id="${id}"]`)
  if (!container || !target) {
    return
  }
  container.scrollTo({ top: Math.max(0, target.offsetTop - 24), behavior: 'smooth' })
}

onMounted(() => {
  syncLocation(activeSlug.value)
  updateActiveHeading()
})

watch(
  () => [route.query.article, route.hash] as const,
  () => {
    syncFromRoute()
  },
)
</script>

<template>
  <div class="personal-space min-h-screen text-[#173042]">
    <div class="space-watermark" />

    <header class="space-header sticky top-0 z-40">
      <div class="mx-auto flex max-w-[1920px] items-center gap-4 px-5 py-4">
        <button type="button" class="space-brand" @click="emit('exit')">
          <div class="space-brand-mark">
            <BookOpenText class="h-5 w-5" />
          </div>
          <div class="text-left">
            <p class="space-brand-kicker">IonicLink Personal Space</p>
            <h1 class="space-brand-title">个人空间</h1>
          </div>
        </button>

        <div class="space-search hidden lg:flex">
          <Search class="h-4 w-4 text-[#69849a]" />
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            class="space-search-input"
            placeholder="搜索文档"
          />
          <span class="space-search-key">Ctrl K</span>
        </div>

        <nav class="ml-auto hidden items-center gap-6 xl:flex">
          <button
            v-for="item in topNav"
            :key="item.key"
            type="button"
            class="space-top-link"
            @click="item.key === 'articles' ? focusSearch() : undefined"
          >
            {{ item.label }}
          </button>
        </nav>

        <a
          href="https://github.com/mx1210385980-a11y/IonicLink/tree/main"
          target="_blank"
          rel="noreferrer"
          class="space-icon-button"
        >
          <Github class="h-5 w-5" />
        </a>

        <button type="button" class="space-return-button" @click="emit('exit')">
          <ArrowLeft class="h-4 w-4" />
          返回平台
        </button>
      </div>
    </header>

    <div class="mx-auto flex max-w-[1920px] gap-0">
      <aside class="space-left hidden xl:flex xl:w-[320px] xl:shrink-0 xl:flex-col">
        <div class="space-left-inner">
          <section class="space-section-head">
            <div class="flex items-center gap-3">
              <div class="space-mini-mark">
                <UserRound class="h-4 w-4" />
              </div>
              <div>
                <p class="space-meta-label">个人入口</p>
                <p class="text-sm font-semibold text-[#173042]">{{ props.operatorName }}</p>
              </div>
            </div>
            <p class="mt-4 text-sm leading-7 text-[#597286]">
              这里不是平台功能页，而是你的长期知识空间。平台说明、AI 笔记、方法总结和持续积累的文章，都从这里进入。
            </p>
          </section>

          <div class="space-divider" />

          <label class="space-left-search">
            <Search class="h-4 w-4 text-[#7892a6]" />
            <input
              v-model="searchQuery"
              type="text"
              class="space-search-input"
              placeholder="搜索文章"
            />
          </label>

          <div class="mt-8 space-y-8">
            <section v-for="section in filteredSections" :key="section.key">
              <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[#7c93a3]">
                <FolderTree class="h-3.5 w-3.5" />
                {{ section.label }}
              </div>
              <div class="mt-4 space-y-1">
                <button
                  v-for="article in section.articles"
                  :key="article.slug"
                  type="button"
                  class="space-sidebar-link"
                  :class="{ 'is-active': article.slug === activeArticle.slug }"
                  @click="selectArticle(article.slug)"
                >
                  <span>{{ article.title }}</span>
                  <ChevronRight class="h-4 w-4 shrink-0" />
                </button>
              </div>
            </section>
          </div>
        </div>
      </aside>

      <main ref="articlePaneRef" class="space-main min-h-screen flex-1 overflow-auto" @scroll="handleArticleScroll">
        <section class="mx-auto max-w-[900px] px-6 pb-16 pt-10 lg:px-12">
          <div class="flex flex-wrap items-center gap-3 text-sm text-[#2b8bb6]">
            <span>首页</span>
            <ChevronRight class="h-4 w-4 text-[#a4b6c3]" />
            <span>{{ activeSection?.label }}</span>
            <ChevronRight class="h-4 w-4 text-[#a4b6c3]" />
            <span class="text-[#597286]">{{ activeArticle.title }}</span>
          </div>

          <div class="mt-7 flex flex-wrap items-center gap-3">
            <span class="space-chip">{{ activeArticle.sectionLabel }}</span>
            <span class="space-chip-muted">
              <Clock3 class="h-3.5 w-3.5" />
              约 {{ activeArticle.readingMinutes }} 分钟
            </span>
            <span class="space-chip-muted">
              <CalendarDays class="h-3.5 w-3.5" />
              {{ activeArticle.dateLabel }}
            </span>
          </div>

          <h2 class="mt-8 text-5xl font-semibold leading-[1.08] tracking-[-0.06em] text-[#112636]">
            {{ activeArticle.title }}
          </h2>
          <p class="mt-6 max-w-3xl text-lg leading-9 text-[#567082]">
            {{ activeArticle.summary }}
          </p>

          <div class="mt-8 flex flex-wrap gap-2">
            <span
              v-for="tag in activeArticle.tags"
              :key="tag"
              class="space-tag"
            >
              {{ tag }}
            </span>
          </div>

          <div class="space-alert mt-10">
            <div class="flex items-start gap-3">
              <ShieldAlert class="mt-0.5 h-5 w-5 shrink-0 text-[#c2475c]" />
              <div>
                <p class="text-lg font-semibold text-[#70283a]">重要提醒</p>
                <p class="mt-3 text-base leading-8 text-[#7d4a55]">
                  个人空间承载的是长期可回看的知识，而不是一次性的聊天记录。把能复用的结构、提示词、工作流和平台说明沉淀到文章里，后面才有真正的个人方法库。
                </p>
              </div>
            </div>
          </div>

          <div class="space-article mt-12" v-html="activeArticle.html" />
        </section>
      </main>

      <aside class="space-right hidden 2xl:block 2xl:w-[360px] 2xl:shrink-0">
        <div class="space-right-inner">
          <section>
            <div class="flex items-center gap-2 text-sm font-semibold text-[#173042]">
              <FileText class="h-4 w-4 text-[#7f94a2]" />
              此页内容
            </div>
            <div class="mt-5 space-y-1">
              <button
                v-for="heading in activeArticle.headings"
                :key="heading.id"
                type="button"
                class="space-toc-link"
                :class="{ 'is-active': heading.id === activeHeadingId }"
                @click="scrollToHeading(heading.id)"
              >
                {{ heading.text }}
              </button>
            </div>
          </section>

          <section class="space-notice-box mt-10">
            <div class="flex items-center justify-between">
              <h3 class="text-3xl font-semibold text-[#173042]">站点公告</h3>
              <span class="text-sm text-[#93a7b4]">×</span>
            </div>

            <div class="mt-8 space-y-4 text-[15px] leading-8 text-[#1e8cb1]">
              <p v-for="notice in spaceNotices" :key="notice" class="underline decoration-[#d7e4ea] underline-offset-4">
                {{ notice }}
              </p>
            </div>

            <div class="mt-8 border-t border-[#e1e8ec] pt-6 text-base leading-8 text-[#5c7283]">
              <p>如果你喜欢这个页面，就继续把有用内容写进来。</p>
              <p>这不是博客入口的装饰页，而是长期积累的个人知识场。</p>
            </div>
          </section>

          <section class="mt-10">
            <p class="space-meta-label">最近更新</p>
            <div class="mt-4 space-y-3">
              <button
                v-for="article in latestArticles"
                :key="article.slug"
                type="button"
                class="space-latest-link"
                @click="selectArticle(article.slug)"
              >
                <p class="text-xs uppercase tracking-[0.18em] text-[#92a6b4]">{{ article.dateLabel }}</p>
                <p class="mt-2 text-left text-sm font-semibold text-[#173042]">{{ article.title }}</p>
              </button>
            </div>
          </section>
        </div>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.personal-space {
  position: relative;
  overflow: hidden;
  background:
    radial-gradient(circle at top left, rgba(86, 190, 223, 0.12), transparent 18%),
    radial-gradient(circle at top right, rgba(255, 194, 120, 0.12), transparent 22%),
    linear-gradient(180deg, #f6f2ea 0%, #f4f8fb 52%, #f8f5ef 100%);
}

.space-watermark {
  position: fixed;
  inset: 0;
  pointer-events: none;
  background-image:
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='360' height='240' viewBox='0 0 360 240'%3E%3Cg fill='rgba(18,40,58,0.06)' font-family='Segoe UI,Arial,sans-serif' font-size='18'%3E%3Ctext x='34' y='94' transform='rotate(-28 34 94)'%3EIONICLINK PERSONAL SPACE%3C/text%3E%3Ctext x='32' y='128' transform='rotate(-28 32 128)'%3E%E4%B8%AA%E4%BA%BA%E7%A9%BA%E9%97%B4%3C/text%3E%3C/g%3E%3C/svg%3E");
  opacity: 0.32;
}

.space-header {
  border-bottom: 1px solid rgba(25, 49, 66, 0.08);
  background: rgba(248, 244, 236, 0.86);
  backdrop-filter: blur(20px);
}

.space-brand {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 0.85rem;
  color: #173042;
}

.space-brand-mark,
.space-mini-mark {
  display: grid;
  place-items: center;
  border-radius: 0.85rem;
  border: 1px solid rgba(62, 150, 186, 0.22);
  background: linear-gradient(135deg, rgba(124, 214, 241, 0.32), rgba(255, 255, 255, 0.9));
  color: #1e8cb1;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.92);
}

.space-brand-mark {
  height: 2.9rem;
  width: 2.9rem;
}

.space-mini-mark {
  height: 2.2rem;
  width: 2.2rem;
}

.space-brand-kicker,
.space-meta-label {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.26em;
  text-transform: uppercase;
  color: rgba(23, 48, 66, 0.46);
}

.space-brand-title {
  margin-top: 0.15rem;
  font-size: 1.45rem;
  font-weight: 700;
  color: #112636;
}

.space-search {
  min-width: 0;
  width: min(100%, 22rem);
  align-items: center;
  gap: 0.8rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(24, 49, 66, 0.08);
  background: rgba(255, 255, 255, 0.72);
  padding: 0.8rem 0.95rem;
  box-shadow: 0 20px 60px -42px rgba(25, 49, 66, 0.28);
}

.space-search-input {
  min-width: 0;
  flex: 1 1 auto;
  border: 0;
  background: transparent;
  color: #173042;
  outline: none;
}

.space-search-input::placeholder {
  color: rgba(23, 48, 66, 0.36);
}

.space-search-key {
  border-radius: 0.65rem;
  border: 1px solid rgba(23, 48, 66, 0.08);
  padding: 0.22rem 0.45rem;
  font-size: 0.8rem;
  color: rgba(23, 48, 66, 0.54);
}

.space-top-link {
  color: rgba(23, 48, 66, 0.8);
  transition: color 160ms ease;
}

.space-top-link:hover {
  color: #1e8cb1;
}

.space-icon-button,
.space-return-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.9rem;
  border: 1px solid rgba(23, 48, 66, 0.08);
  background: rgba(255, 255, 255, 0.68);
  color: rgba(23, 48, 66, 0.78);
  transition: border-color 160ms ease, color 160ms ease, background-color 160ms ease, transform 160ms ease;
  box-shadow: 0 18px 50px -42px rgba(25, 49, 66, 0.24);
}

.space-icon-button {
  height: 2.8rem;
  width: 2.8rem;
}

.space-return-button {
  gap: 0.5rem;
  padding: 0.75rem 1rem;
}

.space-icon-button:hover,
.space-return-button:hover {
  transform: translateY(-1px);
  border-color: rgba(30, 140, 177, 0.22);
  color: #173042;
  background: rgba(255, 255, 255, 0.92);
}

.space-left,
.space-right {
  border-right: 1px solid rgba(23, 48, 66, 0.07);
}

.space-right {
  border-right: 0;
  border-left: 1px solid rgba(23, 48, 66, 0.07);
}

.space-left-inner,
.space-right-inner {
  position: sticky;
  top: 5.35rem;
  max-height: calc(100svh - 5.35rem);
  overflow: auto;
  padding: 2rem 1.6rem 3rem;
}

.space-section-head {
  padding-top: 0.35rem;
}

.space-divider {
  margin-top: 1.6rem;
  border-top: 1px solid rgba(23, 48, 66, 0.08);
}

.space-left-search {
  display: flex;
  align-items: center;
  gap: 0.7rem;
  margin-top: 1.6rem;
  border-radius: 0.95rem;
  border: 1px solid rgba(23, 48, 66, 0.08);
  background: rgba(255, 255, 255, 0.72);
  padding: 0.75rem 0.9rem;
  box-shadow: 0 18px 48px -42px rgba(25, 49, 66, 0.18);
}

.space-sidebar-link {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 0.8rem;
  border-radius: 0.95rem;
  padding: 0.75rem 0.9rem;
  color: #5b7385;
  transition: transform 160ms ease, background-color 160ms ease, color 160ms ease;
}

.space-sidebar-link:hover,
.space-sidebar-link.is-active {
  background: rgba(255, 255, 255, 0.74);
  color: #173042;
  transform: translateX(2px);
}

.space-main {
  scroll-behavior: smooth;
}

.space-chip,
.space-chip-muted,
.space-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0.35rem 0.75rem;
  font-size: 0.78rem;
}

.space-chip {
  border: 1px solid rgba(227, 177, 93, 0.28);
  background: rgba(255, 206, 136, 0.18);
  color: #a36d11;
}

.space-chip-muted,
.space-tag {
  border: 1px solid rgba(23, 48, 66, 0.08);
  background: rgba(255, 255, 255, 0.68);
  color: #607788;
}

.space-alert {
  border: 1px solid rgba(196, 71, 92, 0.14);
  border-radius: 1.2rem;
  background: linear-gradient(135deg, rgba(255, 234, 236, 0.92), rgba(255, 242, 236, 0.92));
  padding: 1.4rem 1.5rem;
  box-shadow: 0 26px 60px -46px rgba(138, 63, 74, 0.24);
}

.space-article {
  font-size: 1.05rem;
  line-height: 1.96;
  color: #334c5f;
}

.space-article > :first-child {
  margin-top: 0;
}

.space-article :deep(h1),
.space-article :deep(h2),
.space-article :deep(h3),
.space-article :deep(h4) {
  margin-top: 2.7rem;
  margin-bottom: 1rem;
  color: #112636;
  font-weight: 700;
  line-height: 1.2;
  scroll-margin-top: 2rem;
}

.space-article :deep(h1) {
  font-size: 2.35rem;
}

.space-article :deep(h2) {
  font-size: 1.9rem;
}

.space-article :deep(h3) {
  font-size: 1.45rem;
}

.space-article :deep(p),
.space-article :deep(ul),
.space-article :deep(ol),
.space-article :deep(pre),
.space-article :deep(blockquote),
.space-article :deep(hr) {
  margin: 1.2rem 0;
}

.space-article :deep(ul),
.space-article :deep(ol) {
  padding-left: 1.3rem;
}

.space-article :deep(a) {
  color: #1e8cb1;
  text-decoration: underline;
  text-underline-offset: 0.18rem;
}

.space-article :deep(code) {
  border-radius: 0.45rem;
  border: 1px solid rgba(23, 48, 66, 0.08);
  background: rgba(255, 255, 255, 0.72);
  padding: 0.15rem 0.42rem;
  font-size: 0.92em;
  color: #9a6110;
}

.space-article :deep(pre) {
  overflow-x: auto;
  border-radius: 1rem;
  border: 1px solid rgba(23, 48, 66, 0.08);
  background: #f3f7f9;
  padding: 1rem 1.05rem;
}

.space-article :deep(pre code) {
  border: 0;
  background: transparent;
  padding: 0;
  color: #29475a;
}

.space-article :deep(blockquote) {
  border-left: 2px solid rgba(43, 139, 182, 0.45);
  padding-left: 1rem;
  color: #5a7385;
}

.space-article :deep(hr) {
  border: 0;
  border-top: 1px solid rgba(23, 48, 66, 0.08);
}

.space-article :deep(.callout) {
  margin: 1.3rem 0;
  border-radius: 1rem;
  padding: 1rem 1.05rem;
}

.space-article :deep(.callout.note) {
  border: 1px solid rgba(111, 205, 255, 0.18);
  background: rgba(217, 244, 251, 0.92);
}

.space-article :deep(.callout.tip) {
  border: 1px solid rgba(71, 206, 142, 0.18);
  background: rgba(226, 248, 237, 0.92);
}

.space-article :deep(.callout.warning),
.space-article :deep(.callout.important) {
  border: 1px solid rgba(232, 162, 113, 0.18);
  background: rgba(255, 243, 230, 0.95);
}

.space-toc-link {
  display: block;
  width: 100%;
  border-left: 2px solid transparent;
  padding: 0.45rem 0 0.45rem 0.85rem;
  text-align: left;
  color: #728897;
  transition: transform 160ms ease, color 160ms ease, border-color 160ms ease;
}

.space-toc-link:hover,
.space-toc-link.is-active {
  border-left-color: #2b8bb6;
  color: #173042;
  transform: translateX(2px);
}

.space-notice-box {
  border-radius: 1rem;
  border: 1px solid rgba(115, 202, 228, 0.3);
  background:
    linear-gradient(rgba(255, 255, 255, 0.9), rgba(255, 255, 255, 0.9)) padding-box,
    linear-gradient(135deg, rgba(89, 211, 233, 0.82), rgba(255, 167, 104, 0.82)) border-box;
  padding: 1.4rem 1.45rem;
  box-shadow: 0 28px 70px -50px rgba(25, 49, 66, 0.22);
}

.space-latest-link {
  display: block;
  width: 100%;
  border-radius: 0.95rem;
  border: 1px solid rgba(23, 48, 66, 0.08);
  background: rgba(255, 255, 255, 0.72);
  padding: 0.95rem 1rem;
  transition: transform 160ms ease, border-color 160ms ease, background-color 160ms ease;
  box-shadow: 0 18px 48px -42px rgba(25, 49, 66, 0.16);
}

.space-latest-link:hover {
  transform: translateY(-1px);
  border-color: rgba(43, 139, 182, 0.2);
  background: rgba(255, 255, 255, 0.96);
}

@media (max-width: 1535px) {
  .space-right {
    display: none;
  }
}

@media (max-width: 1279px) {
  .space-left {
    display: none;
  }

  .space-main section {
    max-width: 100%;
  }
}

@media (max-width: 767px) {
  .space-brand-title {
    font-size: 1.2rem;
  }

  .space-return-button {
    padding-inline: 0.85rem;
  }

  .space-article :deep(h1) {
    font-size: 2rem;
  }

  .space-article :deep(h2) {
    font-size: 1.65rem;
  }
}
</style>
