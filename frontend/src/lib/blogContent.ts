export interface BlogHeading {
  id: string
  level: number
  text: string
}

export interface BlogArticle {
  slug: string
  title: string
  summary: string
  dateLabel: string
  dateSort: number
  order: number
  sectionKey: string
  sectionLabel: string
  tags: string[]
  readingMinutes: number
  headings: BlogHeading[]
  html: string
  searchText: string
}

interface Frontmatter {
  title?: string
  summary?: string
  date?: string
  tags?: string[] | string
  order?: number | string
  section?: string
}

interface BlogSection {
  key: string
  label: string
  articles: BlogArticle[]
}

const sectionLabels: Record<string, string> = {
  ai: 'AI 知识',
  guide: '平台说明',
}

const rawModules = import.meta.glob('../content/**/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
}) as Record<string, string>

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function slugify(value: string, fallback = 'section') {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')

  return slug || fallback
}

function parseFrontmatter(raw: string) {
  const normalized = raw.replace(/\r\n/g, '\n')
  if (!normalized.startsWith('---\n')) {
    return {
      body: normalized.trim(),
      frontmatter: {} as Frontmatter,
    }
  }

  const closingIndex = normalized.indexOf('\n---\n', 4)
  if (closingIndex === -1) {
    return {
      body: normalized.trim(),
      frontmatter: {} as Frontmatter,
    }
  }

  const frontmatterBlock = normalized.slice(4, closingIndex)
  const body = normalized.slice(closingIndex + 5).trim()
  const frontmatter: Record<string, string | string[]> = {}

  for (const line of frontmatterBlock.split('\n')) {
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) {
      continue
    }

    const key = line.slice(0, separatorIndex).trim()
    const rawValue = line.slice(separatorIndex + 1).trim()
    if (!rawValue) {
      continue
    }

    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
      frontmatter[key] = rawValue
        .slice(1, -1)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      continue
    }

    frontmatter[key] = rawValue
  }

  return { body, frontmatter: frontmatter as Frontmatter }
}

function formatInlineMarkdown(input: string) {
  const placeholders: string[] = []
  let output = escapeHtml(input)

  output = output.replace(/`([^`]+)`/g, (_, code: string) => {
    const token = `@@CODE${placeholders.length}@@`
    placeholders.push(`<code>${escapeHtml(code)}</code>`)
    return token
  })

  output = output.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, href: string) => {
    const safeHref = escapeHtml(href)
    return `<a href="${safeHref}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`
  })

  output = output.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  output = output.replace(/\*([^*]+)\*/g, '<em>$1</em>')
  output = output.replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return output.replace(/@@CODE(\d+)@@/g, (_, index: string) => placeholders[Number(index)] ?? '')
}

function renderCallout(kind: string, lines: string[]) {
  const labels: Record<string, string> = {
    important: 'Important',
    note: 'Note',
    tip: 'Tip',
    warning: 'Warning',
  }

  const safeKind = kind.toLowerCase()
  const title = labels[safeKind] ?? 'Note'
  const content = lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${formatInlineMarkdown(line)}</p>`)
    .join('')

  return `<aside class="callout ${safeKind}"><div class="callout-label">${title}</div>${content}</aside>`
}

function renderQuote(lines: string[]) {
  return `<blockquote>${lines.map((line) => `<p>${formatInlineMarkdown(line.trim())}</p>`).join('')}</blockquote>`
}

function splitMarkdownTableRow(line: string) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  return trimmed.split('|').map((cell) => cell.trim())
}

function isMarkdownTableSeparator(line: string) {
  const cells = splitMarkdownTableRow(line)
  return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell))
}

function isMarkdownTableRow(line: string) {
  return line.includes('|') && splitMarkdownTableRow(line).length >= 2
}

function renderMarkdownTable(rows: string[][]) {
  if (rows.length < 2) return ''
  const header = rows[0] ?? []
  const bodyRows = rows.slice(1)
  const thead = `<thead><tr>${header.map((cell) => `<th>${formatInlineMarkdown(cell)}</th>`).join('')}</tr></thead>`
  const tbody = `<tbody>${bodyRows.map((row) => `<tr>${row.map((cell) => `<td>${formatInlineMarkdown(cell)}</td>`).join('')}</tr>`).join('')}</tbody>`
  return `<table>${thead}${tbody}</table>`
}

export function renderMarkdown(markdown: string) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  const headings: BlogHeading[] = []
  const headingCounts = new Map<string, number>()

  let index = 0
  let paragraphBuffer: string[] = []
  let listItems: string[] = []
  let listType: 'ul' | 'ol' | null = null

  const flushParagraph = () => {
    if (!paragraphBuffer.length) {
      return
    }
    html.push(`<p>${formatInlineMarkdown(paragraphBuffer.join(' '))}</p>`)
    paragraphBuffer = []
  }

  const flushList = () => {
    if (!listItems.length || !listType) {
      return
    }
    html.push(`<${listType}>${listItems.join('')}</${listType}>`)
    listItems = []
    listType = null
  }

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      flushParagraph()
      flushList()
      index += 1
      continue
    }

    if (/^```/.test(trimmed)) {
      flushParagraph()
      flushList()
      const language = trimmed.slice(3).trim()
      const codeLines: string[] = []
      index += 1

      while (index < lines.length) {
        const codeLine = lines[index] ?? ''
        if (/^```/.test(codeLine.trim())) {
          break
        }
        codeLines.push(codeLine)
        index += 1
      }

      html.push(`<pre><code${language ? ` data-lang="${escapeHtml(language)}"` : ''}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
      index += 1
      continue
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/)
    if (headingMatch) {
      flushParagraph()
      flushList()
      const level = headingMatch[1]?.length ?? 1
      const text = headingMatch[2]?.trim() ?? ''
      const baseId = slugify(text)
      const count = headingCounts.get(baseId) ?? 0
      const id = count ? `${baseId}-${count + 1}` : baseId
      headingCounts.set(baseId, count + 1)
      if (level <= 3) {
        headings.push({ id, level, text })
      }
      html.push(`<h${level} id="${id}" data-article-heading="true">${formatInlineMarkdown(text)}</h${level}>`)
      index += 1
      continue
    }

    if (/^---+$/.test(trimmed)) {
      flushParagraph()
      flushList()
      html.push('<hr />')
      index += 1
      continue
    }

    if (
      isMarkdownTableRow(trimmed)
      && index + 1 < lines.length
      && isMarkdownTableSeparator(lines[index + 1] ?? '')
    ) {
      flushParagraph()
      flushList()
      const tableRows = [splitMarkdownTableRow(trimmed)]
      index += 2
      while (index < lines.length) {
        const rowLine = lines[index]?.trim() ?? ''
        if (!rowLine || !isMarkdownTableRow(rowLine)) {
          break
        }
        tableRows.push(splitMarkdownTableRow(rowLine))
        index += 1
      }
      html.push(renderMarkdownTable(tableRows))
      continue
    }

    if (trimmed.startsWith('>')) {
      flushParagraph()
      flushList()
      const quoteLines: string[] = []

      while (index < lines.length) {
        const quoteLine = lines[index] ?? ''
        if (!quoteLine.trim().startsWith('>')) {
          break
        }
        quoteLines.push(quoteLine.trim().replace(/^>\s?/, ''))
        index += 1
      }

      const calloutMatch = quoteLines[0]?.match(/^\[!(NOTE|TIP|WARNING|IMPORTANT)\]\s*(.*)$/i)
      if (calloutMatch) {
        const kind = calloutMatch[1] ?? 'NOTE'
        const lead = calloutMatch[2] ?? ''
        const content = [lead, ...quoteLines.slice(1)].filter(Boolean)
        html.push(renderCallout(kind, content))
      } else {
        html.push(renderQuote(quoteLines))
      }
      continue
    }

    const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/)
    const unorderedMatch = trimmed.match(/^[-*]\s+(.+)$/)
    if (orderedMatch || unorderedMatch) {
      flushParagraph()
      const nextListType = orderedMatch ? 'ol' : 'ul'
      const itemText = (orderedMatch?.[2] ?? unorderedMatch?.[1] ?? '').trim()
      if (listType && listType !== nextListType) {
        flushList()
      }
      listType = nextListType
      listItems.push(`<li>${formatInlineMarkdown(itemText)}</li>`)
      index += 1
      continue
    }

    paragraphBuffer.push(trimmed)
    index += 1
  }

  flushParagraph()
  flushList()

  return { html: html.join('\n'), headings }
}

function normalizeTags(tags: Frontmatter['tags']) {
  if (Array.isArray(tags)) {
    return tags
  }

  if (typeof tags === 'string') {
    return tags.split(',').map((tag) => tag.trim()).filter(Boolean)
  }

  return []
}

function createArticle(path: string, raw: string): BlogArticle {
  const { body, frontmatter } = parseFrontmatter(raw)
  const segments = path.split('/')
  const fileName = segments[segments.length - 1]?.replace(/\.md$/, '') ?? 'article'
  const sectionKey = String(frontmatter.section || segments[segments.length - 2] || 'guide').trim().toLowerCase()
  const sectionLabel = sectionLabels[sectionKey] ?? sectionKey
  const title = String(frontmatter.title || fileName).trim()
  const summary = String(frontmatter.summary || '未提供摘要').trim()
  const slug = slugify(fileName)
  const { html, headings } = renderMarkdown(body)
  const tags = normalizeTags(frontmatter.tags)
  const dateLabel = String(frontmatter.date || '未标注日期').trim()
  const timestamp = Number.isNaN(Date.parse(dateLabel)) ? 0 : Date.parse(dateLabel)
  const readingMinutes = Math.max(1, Math.round(body.replace(/\s+/g, '').length / 260))
  const order = Number(frontmatter.order ?? 999)

  return {
    slug,
    title,
    summary,
    dateLabel,
    dateSort: timestamp,
    order: Number.isFinite(order) ? order : 999,
    sectionKey,
    sectionLabel,
    tags,
    readingMinutes,
    headings,
    html,
    searchText: `${title} ${summary} ${tags.join(' ')} ${body}`.toLowerCase(),
  }
}

export const blogArticles = Object.entries(rawModules)
  .map(([path, raw]) => createArticle(path, raw))
  .sort((left, right) => {
    if (left.sectionKey !== right.sectionKey) {
      return left.sectionKey.localeCompare(right.sectionKey)
    }
    if (left.order !== right.order) {
      return left.order - right.order
    }
    return right.dateSort - left.dateSort
  })

export const blogSections: BlogSection[] = Array.from(
  blogArticles.reduce((map, article) => {
    const current = map.get(article.sectionKey)
    if (current) {
      current.articles.push(article)
    } else {
      map.set(article.sectionKey, {
        key: article.sectionKey,
        label: article.sectionLabel,
        articles: [article],
      })
    }

    return map
  }, new Map<string, BlogSection>()),
).map(([, section]) => section)
