<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  ArrowRight,
  BookMarked,
  BookOpenText,
  BrainCircuit,
  ChevronRight,
  Clock3,
  FilePenLine,
  FolderTree,
  Menu,
  Search,
  Sparkles,
  X,
} from 'lucide-vue-next'

import { blogArticles, blogSections, type BlogArticle } from '@/lib/blogContent'

const fallbackArticle = blogArticles[0]

if (!fallbackArticle) {
  throw new Error('Blog content is empty. Add markdown files under src/content.')
}

const searchInput = ref<HTMLInputElement | null>(null)
const mobileMenuOpen = ref(false)
const searchQuery = ref('')
const scrollY = ref(0)
const activeHeadingId = ref('')
const activeSlug = ref(resolveInitialSlug())
const heroReady = ref(false)

const topNav = [
  { id: 'home', label: '首页' },
  { id: 'articles', label: '文章' },
  { id: 'roadmap', label: '路线' },
  { id: 'about', label: '关于' },
] as const

const siteNotices = [
  { title: '编辑必读：内容目录说明', body: '平台说明放在 src/content/guide，AI 知识与实验记录放在 src/content/ai。' },
  { title: '优先使用 Frontmatter', body: '每篇文章建议补全 title、summary、date、tags、order，侧栏和检索会自动读取。' },
  { title: '长期维护建议', body: '把问题定义、实验过程、失败结论都写进文档，知识沉淀比结果截图更有价值。' },
] as const

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
  const current = blogArticles.find((article) => article.slug === activeSlug.value)
  if (current) {
    return current
  }

  return visibleArticles.value[0] ?? fallbackArticle
})

const relatedArticles = computed(() => {
  return blogArticles
    .filter((article) => article.slug !== activeArticle.value.slug && article.sectionKey === activeArticle.value.sectionKey)
    .slice(0, 3)
})

const quickStats = computed(() => [
  { label: '文章', value: `${blogArticles.length.toString().padStart(2, '0')} 篇` },
  { label: '栏目', value: `${blogSections.length.toString().padStart(2, '0')} 个` },
  { label: '阅读', value: `${blogArticles.reduce((total, article) => total + article.readingMinutes, 0)} 分钟` },
])

const latestArticles = computed(() => blogArticles.slice(0, 3))

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
  if (typeof window === 'undefined') {
    return blogArticles[0]?.slug ?? ''
  }

  const hash = decodeURIComponent(window.location.hash.replace(/^#/, '').trim())
  return blogArticles.some((article) => article.slug === hash) ? hash : (blogArticles[0]?.slug ?? '')
}

function selectArticle(slug: string) {
  activeSlug.value = slug
  mobileMenuOpen.value = false

  if (typeof window !== 'undefined') {
    const nextHash = `#${encodeURIComponent(slug)}`
    if (window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextHash)
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
}

function syncFromHash() {
  const slug = resolveInitialSlug()
  if (slug) {
    activeSlug.value = slug
  }
}

function focusSearch() {
  searchInput.value?.focus()
  searchInput.value?.select()
}

function handleKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault()
    focusSearch()
  }
}

function scrollToSection(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function handleScroll() {
  scrollY.value = window.scrollY
  updateActiveHeading()
}

function updateActiveHeading() {
  if (typeof window === 'undefined') {
    return
  }

  const headings = Array.from(document.querySelectorAll<HTMLElement>('[data-article-heading="true"]'))
  if (!headings.length) {
    activeHeadingId.value = ''
    return
  }

  const offset = 140
  const firstHeading = headings[0]
  if (!firstHeading) {
    activeHeadingId.value = ''
    return
  }
  let current = firstHeading

  for (const heading of headings) {
    if (heading.getBoundingClientRect().top - offset <= 0) {
      current = heading
    } else {
      break
    }
  }

  activeHeadingId.value = current.id
}

onMounted(() => {
  syncFromHash()
  heroReady.value = true
  window.addEventListener('hashchange', syncFromHash)
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('scroll', handleScroll, { passive: true })
  updateActiveHeading()
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', syncFromHash)
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('scroll', handleScroll)
})
</script>

<template>
  <div class="blog-shell min-h-screen">
    <div class="blog-ambient" />

    <header class="blog-header sticky top-0 z-50">
      <div class="mx-auto flex max-w-[1880px] items-center gap-3 px-3 py-3 sm:px-4 lg:px-6">
        <button
          type="button"
          class="nav-icon xl:hidden"
          @click="mobileMenuOpen = true"
        >
          <Menu class="h-5 w-5" />
        </button>

        <button
          type="button"
          class="flex min-w-0 items-center gap-3"
          @click="scrollToSection('home')"
        >
          <div class="brand-mark">IL</div>
          <div class="min-w-0 text-left">
            <p class="brand-kicker">IonicLink Notes</p>
            <p class="truncate text-sm text-white/78">个人学习博客 / 平台说明 / AI 知识笔记</p>
          </div>
        </button>

        <div class="search-shell ml-auto hidden min-w-0 flex-1 items-center md:flex lg:max-w-xl">
          <Search class="h-4 w-4 text-white/40" />
          <input
            ref="searchInput"
            v-model="searchQuery"
            type="text"
            class="search-input"
            placeholder="搜索文章、标签与说明"
          />
          <span class="search-key">Ctrl K</span>
        </div>

        <nav class="hidden items-center gap-1 lg:flex">
          <button
            v-for="item in topNav"
            :key="item.id"
            type="button"
            class="top-link"
            @click="scrollToSection(item.id)"
          >
            {{ item.label }}
          </button>
        </nav>
      </div>
    </header>

    <transition name="drawer-fade">
      <div
        v-if="mobileMenuOpen"
        class="fixed inset-0 z-[70] bg-black/70 xl:hidden"
        @click="mobileMenuOpen = false"
      />
    </transition>

    <transition name="drawer-slide">
      <aside
        v-if="mobileMenuOpen"
        class="mobile-drawer fixed left-0 top-0 z-[80] h-full w-[88vw] max-w-[360px] xl:hidden"
      >
        <div class="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <p class="brand-kicker">IonicLink Notes</p>
            <p class="mt-1 text-sm text-white/68">Markdown 驱动知识库</p>
          </div>
          <button type="button" class="nav-icon" @click="mobileMenuOpen = false">
            <X class="h-5 w-5" />
          </button>
        </div>

        <div class="px-5 pb-6 pt-5">
          <div class="search-shell flex items-center md:hidden">
            <Search class="h-4 w-4 text-white/40" />
            <input
              v-model="searchQuery"
              type="text"
              class="search-input"
              placeholder="搜索文章"
            />
          </div>

          <div class="mt-6 space-y-6">
            <section v-for="section in filteredSections" :key="section.key">
              <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
                <FolderTree class="h-3.5 w-3.5" />
                {{ section.label }}
              </div>
              <div class="mt-3 space-y-1">
                <button
                  v-for="article in section.articles"
                  :key="article.slug"
                  type="button"
                  class="sidebar-link w-full text-left"
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
    </transition>

    <div class="mx-auto flex max-w-[1880px] gap-6 px-3 pb-10 pt-4 sm:px-4 lg:px-6">
      <aside class="hidden w-[300px] shrink-0 xl:block">
        <div class="sticky top-24 space-y-4">
          <section class="side-panel px-5 py-5">
            <p class="brand-kicker">Knowledge Base</p>
            <h2 class="mt-3 text-2xl font-semibold tracking-[-0.04em] text-white">IonicLink 个人学习博客</h2>
            <p class="mt-3 text-sm leading-7 text-white/64">
              把平台解释、AI 学习、实验记录和方法总结都沉淀成可检索的文档页面。
            </p>
          </section>

          <section class="side-panel px-5 py-5">
            <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
              <BookMarked class="h-3.5 w-3.5" />
              编辑方式
            </div>
            <ul class="mt-4 space-y-3 text-sm leading-7 text-white/68">
              <li>平台说明：`frontend/src/content/guide`</li>
              <li>AI 知识：`frontend/src/content/ai`</li>
              <li>新增文章后会自动出现在侧栏与搜索结果里</li>
            </ul>
          </section>

          <section class="side-panel px-5 py-5">
            <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
              <FolderTree class="h-3.5 w-3.5" />
              文档目录
            </div>

            <div class="mt-4 space-y-6">
              <section v-for="section in filteredSections" :key="section.key">
                <div class="flex items-center justify-between">
                  <h3 class="text-sm font-semibold text-white">{{ section.label }}</h3>
                  <span class="text-xs text-white/38">{{ section.articles.length }}</span>
                </div>

                <div class="mt-3 space-y-1">
                  <button
                    v-for="article in section.articles"
                    :key="article.slug"
                    type="button"
                    class="sidebar-link w-full text-left"
                    :class="{ 'is-active': article.slug === activeArticle.slug }"
                    @click="selectArticle(article.slug)"
                  >
                    <span>{{ article.title }}</span>
                    <ChevronRight class="h-4 w-4 shrink-0" />
                  </button>
                </div>
              </section>
            </div>
          </section>
        </div>
      </aside>

      <main class="min-w-0 flex-1">
        <section id="home" class="hero-panel overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
          <div class="grid items-end gap-10 xl:grid-cols-[minmax(0,1.1fr)_360px]">
            <div
              class="transition duration-700 ease-out"
              :style="{
                opacity: heroReady ? 1 : 0,
                transform: heroReady ? 'translateY(0)' : 'translateY(18px)',
              }"
            >
              <div class="inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.26em] text-[#98d8ff]">
                <Sparkles class="h-3.5 w-3.5" />
                文档化学习系统
              </div>

              <div class="mt-5 flex flex-wrap items-center gap-3 text-sm text-white/44">
                <span>首页</span>
                <ChevronRight class="h-4 w-4" />
                <span>{{ activeArticle.sectionLabel }}</span>
                <ChevronRight class="h-4 w-4" />
                <span class="text-white/68">{{ activeArticle.title }}</span>
              </div>

              <h1 class="mt-5 max-w-4xl text-4xl font-semibold tracking-[-0.06em] text-white sm:text-5xl xl:text-[4.4rem]">
                让你的平台同时成为
                <span class="text-[#8ed8ff]">个人知识库</span>
                与
                <span class="text-[#ffd38a]">AI 学习博客</span>
              </h1>

              <p class="mt-5 max-w-3xl text-base leading-8 text-white/66 sm:text-lg">
                保留文档站的秩序感，用 Markdown 持续记录平台解释、实验过程、提示词设计、RAG 笔记与方法论，把一次次零散尝试变成长期可复用的知识资产。
              </p>

              <div class="mt-8 flex flex-wrap gap-3">
                <button type="button" class="primary-action" @click="scrollToSection('articles')">
                  开始阅读
                  <ArrowRight class="h-4 w-4" />
                </button>
                <button type="button" class="secondary-action" @click="focusSearch">
                  站内搜索
                </button>
              </div>
            </div>

            <div
              class="hero-plane transition duration-700 ease-out"
              :style="{
                opacity: heroReady ? 1 : 0,
                transform: `translate3d(0, ${Math.min(scrollY * 0.05, 18)}px, 0)`,
              }"
            >
              <div class="hero-grid">
                <div class="hero-grid-line" />
                <div class="hero-grid-line" />
                <div class="hero-grid-line" />
                <div class="hero-grid-line" />
              </div>

              <div class="relative z-10 space-y-6">
                <div>
                  <p class="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/38">Current Focus</p>
                  <h2 class="mt-3 text-2xl font-semibold text-white">{{ activeArticle.title }}</h2>
                  <p class="mt-3 text-sm leading-7 text-white/60">{{ activeArticle.summary }}</p>
                </div>

                <div class="space-y-3 border-t border-white/10 pt-5">
                  <div v-for="stat in quickStats" :key="stat.label" class="flex items-end justify-between gap-4">
                    <span class="text-sm text-white/42">{{ stat.label }}</span>
                    <span class="text-lg font-semibold text-white">{{ stat.value }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section id="articles" class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_290px] xl:grid-cols-[minmax(0,1fr)_320px]">
          <article class="doc-panel px-5 py-6 sm:px-7 sm:py-7">
            <div class="flex flex-wrap items-start justify-between gap-4 border-b border-white/10 pb-6">
              <div>
                <div class="inline-flex items-center gap-2 rounded-full border border-[#5c4a20] bg-[#241d0f] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em] text-[#f8c873]">
                  <BookOpenText class="h-3.5 w-3.5" />
                  {{ activeArticle.sectionLabel }}
                </div>
                <h2 class="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white sm:text-[2.7rem]">
                  {{ activeArticle.title }}
                </h2>
                <p class="mt-4 max-w-3xl text-[15px] leading-8 text-white/64">
                  {{ activeArticle.summary }}
                </p>
              </div>

              <div class="min-w-[14rem] space-y-3 text-sm text-white/54">
                <div class="flex items-center gap-2">
                  <Clock3 class="h-4 w-4 text-white/34" />
                  约 {{ activeArticle.readingMinutes }} 分钟
                </div>
                <div class="flex items-center gap-2">
                  <FilePenLine class="h-4 w-4 text-white/34" />
                  {{ activeArticle.dateLabel }}
                </div>
              </div>
            </div>

            <div class="mt-5 flex flex-wrap gap-2">
              <span
                v-for="tag in activeArticle.tags"
                :key="tag"
                class="inline-flex rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/56"
              >
                {{ tag }}
              </span>
            </div>

            <div class="doc-prose mt-8" v-html="activeArticle.html" />

            <section v-if="relatedArticles.length" class="mt-10 border-t border-white/10 pt-8">
              <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
                <BrainCircuit class="h-3.5 w-3.5" />
                同栏目继续阅读
              </div>

              <div class="mt-4 grid gap-3 md:grid-cols-3">
                <button
                  v-for="article in relatedArticles"
                  :key="article.slug"
                  type="button"
                  class="related-link text-left"
                  @click="selectArticle(article.slug)"
                >
                  <p class="text-xs uppercase tracking-[0.22em] text-white/34">{{ article.sectionLabel }}</p>
                  <h3 class="mt-3 text-lg font-semibold text-white">{{ article.title }}</h3>
                  <p class="mt-3 text-sm leading-7 text-white/58">{{ article.summary }}</p>
                </button>
              </div>
            </section>
          </article>

          <aside class="space-y-4">
            <section class="side-panel hidden px-5 py-5 lg:block">
              <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
                <BookMarked class="h-3.5 w-3.5" />
                此页内容
              </div>

              <div class="mt-4 space-y-1">
                <a
                  v-for="heading in activeArticle.headings"
                  :key="heading.id"
                  class="toc-link"
                  :class="{ 'is-active': heading.id === activeHeadingId }"
                  :href="`#${heading.id}`"
                >
                  {{ heading.text }}
                </a>
              </div>
            </section>

            <section class="notice-panel px-5 py-5">
              <div class="flex items-center justify-between">
                <h3 class="text-2xl font-semibold text-white">站点公告</h3>
                <span class="text-xs uppercase tracking-[0.24em] text-white/32">Notice</span>
              </div>

              <div class="mt-5 space-y-5">
                <div v-for="notice in siteNotices" :key="notice.title">
                  <h4 class="text-lg font-semibold text-[#a4ecff]">{{ notice.title }}</h4>
                  <p class="mt-2 text-sm leading-7 text-white/68">{{ notice.body }}</p>
                </div>
              </div>
            </section>

            <section class="side-panel px-5 py-5">
              <div class="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">
                <Clock3 class="h-3.5 w-3.5" />
                最近更新
              </div>

              <div class="mt-4 space-y-3">
                <button
                  v-for="article in latestArticles"
                  :key="article.slug"
                  type="button"
                  class="update-link w-full text-left"
                  @click="selectArticle(article.slug)"
                >
                  <p class="text-xs uppercase tracking-[0.2em] text-white/32">{{ article.dateLabel }}</p>
                  <p class="mt-2 text-sm font-semibold text-white">{{ article.title }}</p>
                </button>
              </div>
            </section>
          </aside>
        </section>

        <section id="roadmap" class="mt-6 grid gap-4 md:grid-cols-3">
          <section class="side-panel px-5 py-5">
            <p class="brand-kicker">01</p>
            <h3 class="mt-3 text-xl font-semibold text-white">记录平台说明</h3>
            <p class="mt-3 text-sm leading-7 text-white/62">
              用文章解释系统模块、数据流、部署说明和常见问题，避免平台知识散落在聊天记录里。
            </p>
          </section>

          <section class="side-panel px-5 py-5">
            <p class="brand-kicker">02</p>
            <h3 class="mt-3 text-xl font-semibold text-white">沉淀 AI 知识</h3>
            <p class="mt-3 text-sm leading-7 text-white/62">
              从提示词设计、数据清洗到 RAG 与评估策略，把有效做法写成可回看的知识节点。
            </p>
          </section>

          <section class="side-panel px-5 py-5">
            <p class="brand-kicker">03</p>
            <h3 class="mt-3 text-xl font-semibold text-white">形成长期博客</h3>
            <p class="mt-3 text-sm leading-7 text-white/62">
              每次迭代都产生新文章，最终平台不仅可用，还拥有清晰的文档语境和方法论沉淀。
            </p>
          </section>
        </section>

        <section id="about" class="mt-6 about-panel px-5 py-6 sm:px-7 sm:py-7">
          <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div>
              <p class="brand-kicker">About The System</p>
              <h2 class="mt-4 text-3xl font-semibold tracking-[-0.05em] text-white">一个面向长期学习的 Markdown 文档站</h2>
              <p class="mt-4 max-w-3xl text-base leading-8 text-white/64">
                这个版本不是简单的文章列表，而是更接近文档系统与个人博客的结合体：左侧负责知识结构，中间负责阅读体验，右侧负责内容目录与站点提示。你后续只需要维护 Markdown，本体界面会自动把它组织成完整的信息架构。
              </p>
            </div>

            <div class="side-panel px-5 py-5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/42">Workflow</p>
              <ol class="mt-4 space-y-3 text-sm leading-7 text-white/66">
                <li>1. 新建一篇 `.md` 文章并补充 Frontmatter</li>
                <li>2. 写正文与分节标题，右侧目录会自动生成</li>
                <li>3. 通过搜索、侧栏和最近更新入口继续维护知识库</li>
              </ol>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>
</template>
