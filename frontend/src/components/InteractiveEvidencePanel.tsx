/** @jsxImportSource react */

import {
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FileStack,
  ImageIcon,
  Info,
  X,
  ScanSearch,
  ZoomIn,
} from 'lucide-react'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'

import { cn } from '@/lib/utils'

export interface EvidenceSnippet {
  page: number
  section: string
  type: 'text' | 'image'
  text?: string
  target?: string
  highlightTargets?: string[]
  previewLabel?: string
  previewHtml?: string
  imageUrl?: string
  boundingBox?: number[]
}

export interface EvidenceMap {
  cof: EvidenceSnippet
  ionicLiquid?: EvidenceSnippet
  surface?: EvidenceSnippet
  speed?: EvidenceSnippet
  load?: EvidenceSnippet
  condition?: EvidenceSnippet
  temperature?: EvidenceSnippet
}

export interface RowData {
  id: string | number
  evidenceType: 'multi-snippet'
  evidenceMap: EvidenceMap
  highlight: string
}

export const evidenceTagOrder = [
  'cof',
  'ionicLiquid',
  'surface',
  'speed',
  'load',
  'condition',
  'temperature',
] as const

export type EvidenceTagType = (typeof evidenceTagOrder)[number]

type TagColorClasses = {
  bg: string
  text: string
  ring: string
  pillBg: string
  pillText: string
  pillMutedBg: string
  pillMutedText: string
  glow: string
}

export const tagColors: Record<EvidenceTagType, TagColorClasses> = {
  cof: {
    bg: 'bg-blue-100/90',
    text: 'text-blue-700',
    ring: 'ring-blue-300/80',
    pillBg: 'bg-blue-50',
    pillText: 'text-blue-700',
    pillMutedBg: 'bg-slate-100',
    pillMutedText: 'text-slate-500',
    glow: 'shadow-[0_0_0_1px_rgba(59,130,246,0.45),0_0_36px_rgba(59,130,246,0.18)]',
  },
  ionicLiquid: {
    bg: 'bg-indigo-100/90',
    text: 'text-indigo-700',
    ring: 'ring-indigo-300/80',
    pillBg: 'bg-indigo-50',
    pillText: 'text-indigo-700',
    pillMutedBg: 'bg-slate-100',
    pillMutedText: 'text-slate-500',
    glow: 'shadow-[0_0_0_1px_rgba(99,102,241,0.42),0_0_36px_rgba(99,102,241,0.15)]',
  },
  surface: {
    bg: 'bg-orange-100/90',
    text: 'text-orange-700',
    ring: 'ring-orange-300/80',
    pillBg: 'bg-orange-50',
    pillText: 'text-orange-700',
    pillMutedBg: 'bg-slate-100',
    pillMutedText: 'text-slate-500',
    glow: 'shadow-[0_0_0_1px_rgba(249,115,22,0.42),0_0_36px_rgba(249,115,22,0.14)]',
  },
  speed: {
    bg: 'bg-sky-100/90',
    text: 'text-sky-700',
    ring: 'ring-sky-300/80',
    pillBg: 'bg-sky-50',
    pillText: 'text-sky-700',
    pillMutedBg: 'bg-slate-100',
    pillMutedText: 'text-slate-500',
    glow: 'shadow-[0_0_0_1px_rgba(14,165,233,0.42),0_0_36px_rgba(14,165,233,0.15)]',
  },
  load: {
    bg: 'bg-cyan-100/90',
    text: 'text-cyan-700',
    ring: 'ring-cyan-300/80',
    pillBg: 'bg-cyan-50',
    pillText: 'text-cyan-700',
    pillMutedBg: 'bg-slate-100',
    pillMutedText: 'text-slate-500',
    glow: 'shadow-[0_0_0_1px_rgba(6,182,212,0.42),0_0_36px_rgba(6,182,212,0.15)]',
  },
  condition: {
    bg: 'bg-emerald-100/90',
    text: 'text-emerald-700',
    ring: 'ring-emerald-300/80',
    pillBg: 'bg-emerald-50',
    pillText: 'text-emerald-700',
    pillMutedBg: 'bg-slate-100',
    pillMutedText: 'text-slate-500',
    glow: 'shadow-[0_0_0_1px_rgba(16,185,129,0.42),0_0_36px_rgba(16,185,129,0.14)]',
  },
  temperature: {
    bg: 'bg-rose-100/90',
    text: 'text-rose-700',
    ring: 'ring-rose-300/80',
    pillBg: 'bg-rose-50',
    pillText: 'text-rose-700',
    pillMutedBg: 'bg-slate-100',
    pillMutedText: 'text-slate-500',
    glow: 'shadow-[0_0_0_1px_rgba(244,63,94,0.42),0_0_36px_rgba(244,63,94,0.14)]',
  },
}

const tagLabels: Record<EvidenceTagType, string> = {
  cof: 'COF',
  ionicLiquid: 'Lubricant',
  surface: 'Surface',
  speed: 'Speed',
  load: 'Load',
  condition: 'Condition',
  temperature: 'Temp',
}

function collectMatchRanges(
  text: string,
  target: string,
  ignoreCase: boolean,
): Array<{ start: number; end: number }> {
  if (!target) return []

  const haystack = ignoreCase ? text.toLocaleLowerCase() : text
  const needle = ignoreCase ? target.toLocaleLowerCase() : target
  const ranges: Array<{ start: number; end: number }> = []

  let cursor = 0
  while (cursor < haystack.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) break

    const nextRange = { start: index, end: index + needle.length }
    if (isAcceptableTextMatch(text, nextRange.start, nextRange.end, target)) {
      ranges.push(nextRange)
      cursor = nextRange.end
      continue
    }

    cursor = index + 1
  }

  return ranges
}

function isWordCharacter(char: string | undefined): boolean {
  return Boolean(char && /[A-Za-z0-9]/.test(char))
}

function shouldRequireWordBoundaries(target: string): boolean {
  const normalized = target.trim()
  return /^[A-Za-z]{2,}(?:\s+[A-Za-z]{2,})*$/.test(normalized)
}

function isAcceptableTextMatch(
  text: string,
  start: number,
  end: number,
  target: string,
): boolean {
  if (!shouldRequireWordBoundaries(target)) return true

  return !isWordCharacter(text[start - 1]) && !isWordCharacter(text[end])
}

export function renderHighlightedText(
  text: string | undefined,
  target: string | string[] | undefined,
  activeTagType: EvidenceTagType,
  activeTagColors: Record<EvidenceTagType, TagColorClasses>,
): ReactNode {
  if (!text) return null

  const normalizedTargets = (Array.isArray(target) ? target : [target])
    .map((item) => item?.trim() || '')
    .filter(Boolean)
  if (!normalizedTargets.length) return text

  const resolvedRanges: Array<{ start: number; end: number }> = []
  for (const candidate of [...normalizedTargets].sort((a, b) => b.length - a.length)) {
    const exactRanges = collectMatchRanges(text, candidate, false)
    const candidateRanges = exactRanges.length
      ? exactRanges
      : collectMatchRanges(text, candidate, true)
    for (const range of candidateRanges) {
      const overlaps = resolvedRanges.some(
        (existing) => range.start < existing.end && existing.start < range.end,
      )
      if (!overlaps) {
        resolvedRanges.push(range)
      }
    }
  }

  if (resolvedRanges.length === 0) return text
  resolvedRanges.sort((a, b) => a.start - b.start)

  const colors = activeTagColors[activeTagType]
  const nodes: ReactNode[] = []
  let cursor = 0

  resolvedRanges.forEach((range, index) => {
    if (range.start > cursor) {
      nodes.push(text.slice(cursor, range.start))
    }

    nodes.push(
      <span
        key={`${activeTagType}-${range.start}-${index}`}
        className={cn(
          'inline rounded-md px-1.5 py-0.5 font-semibold ring-1 ring-inset transition-all duration-150',
          colors.bg,
          colors.text,
          colors.ring,
        )}
      >
        {text.slice(range.start, range.end)}
      </span>,
    )

    cursor = range.end
  })

  if (cursor < text.length) {
    nodes.push(text.slice(cursor))
  }

  return nodes
}

function getSnippetPreview(snippet?: EvidenceSnippet): ReactNode {
  if (!snippet) return '--'

  if (snippet.previewHtml?.trim()) {
    return <span dangerouslySetInnerHTML={{ __html: snippet.previewHtml }} />
  }

  if (snippet.previewLabel?.trim()) return snippet.previewLabel.trim()

  if (snippet.target?.trim()) return snippet.target.trim()
  if (snippet.text?.trim()) {
    return snippet.text.trim().slice(0, 32) + (snippet.text.trim().length > 32 ? '...' : '')
  }
  if (snippet.type === 'image') return 'Image snippet'

  return '--'
}

function isRenderableSnippet(snippet?: EvidenceSnippet): boolean {
  if (!snippet) return false

  if (snippet.type === 'image') {
    return Boolean(snippet.imageUrl)
  }

  return Boolean(snippet.text?.trim()) && Boolean(snippet.target?.trim())
}

function getSnippetStyle(box?: number[]): CSSProperties | undefined {
  if (!box || box.length < 4) return undefined

  let left = box[0] ?? 0
  let top = box[1] ?? 0
  let width = box[2] ?? 0
  let height = box[3] ?? 0
  if (width > left && height > top) {
    width -= left
    height -= top
  }

  const looksNormalized =
    [left, top, width, height].every((value) => value >= 0 && value <= 1)
  const looksPercent =
    [left, top, width, height].every((value) => value >= 0 && value <= 100)

  if (!looksNormalized && !looksPercent) return undefined

  const multiplier = looksNormalized ? 100 : 1

  return {
    left: `${left * multiplier}%`,
    top: `${top * multiplier}%`,
    width: `${width * multiplier}%`,
    height: `${height * multiplier}%`,
  }
}

function getPanelGradient(activeTag: EvidenceTagType): string {
  switch (activeTag) {
    case 'surface':
      return 'from-slate-950 via-slate-950 to-orange-950/40'
    case 'speed':
      return 'from-slate-950 via-slate-950 to-sky-950/35'
    case 'load':
      return 'from-slate-950 via-slate-950 to-cyan-950/35'
    case 'condition':
      return 'from-slate-950 via-slate-950 to-emerald-950/35'
    case 'temperature':
      return 'from-slate-950 via-slate-950 to-rose-950/35'
    case 'ionicLiquid':
      return 'from-slate-950 via-slate-950 to-indigo-950/35'
    default:
      return 'from-slate-950 via-slate-950 to-blue-950/35'
  }
}

export interface InteractiveEvidencePanelProps {
  row: RowData
  className?: string
  title?: string
  pdfUrl?: string
  hoverDelay?: number
  onOpenPdf?: (
    page: number,
    snippet: EvidenceSnippet,
    activeTag: EvidenceTagType,
  ) => void
}

type ExpandedImageState = {
  src: string
  alt: string
  section: string
}

export function InteractiveEvidencePanel({
  row,
  className,
  title = 'Context-Aware Evidence Locator',
  pdfUrl,
  hoverDelay = 150,
  onOpenPdf,
}: InteractiveEvidencePanelProps) {
  const [activeTag, setActiveTag] = useState<EvidenceTagType>('cof')
  const [isTransitioning, setIsTransitioning] = useState(false)
  const [showRationale, setShowRationale] = useState(false)
  const [expandedImage, setExpandedImage] = useState<ExpandedImageState | null>(null)
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cofSnippet = row.evidenceMap.cof

  const tagState = useMemo(
    () =>
      evidenceTagOrder.map((tag) => {
        const snippet = row.evidenceMap[tag]
        const disabled = tag !== 'cof' && !isRenderableSnippet(snippet)
        const offSite =
          Boolean(snippet) &&
          typeof snippet?.page === 'number' &&
          snippet.page !== row.evidenceMap.cof.page

        return {
          tag,
          snippet,
          disabled,
          offSite,
        }
      }),
    [row],
  )

  const activeSnippet = row.evidenceMap[activeTag] ?? cofSnippet
  const activeColors = tagColors[activeTag]
  const isViewingOffSite = activeSnippet.page !== cofSnippet.page
  const snippetStyle = getSnippetStyle(activeSnippet.boundingBox)

  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!expandedImage) return undefined

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setExpandedImage(null)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    const originalOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = originalOverflow
    }
  }, [expandedImage])

  useEffect(() => {
    const entry = tagState.find((state) => state.tag === activeTag)
    if (entry?.disabled) {
      setActiveTag('cof')
      setIsTransitioning(false)
    }
  }, [activeTag, tagState])

  function clearHoverTimer() {
    if (hoverTimerRef.current) {
      clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
  }

  function scheduleReset() {
    clearHoverTimer()
    setIsTransitioning(false)
    hoverTimerRef.current = setTimeout(() => {
      setActiveTag('cof')
    }, 80)
  }

  function handleTagEnter(tag: EvidenceTagType) {
    const state = tagState.find((entry) => entry.tag === tag)
    if (!state || state.disabled) return

    clearHoverTimer()

    if (state.offSite) {
      setIsTransitioning(true)
      hoverTimerRef.current = setTimeout(() => {
        setActiveTag(tag)
        setIsTransitioning(false)
      }, hoverDelay)
      return
    }

    setIsTransitioning(false)
    setActiveTag(tag)
  }

  function handleOpenPdf() {
    if (onOpenPdf) {
      onOpenPdf(activeSnippet.page, activeSnippet, activeTag)
      return
    }

    if (pdfUrl && typeof window !== 'undefined') {
      window.open(pdfUrl, '_blank', 'noopener,noreferrer')
    }
  }

  function handleExpandImage() {
    if (!activeSnippet.imageUrl) return

    setExpandedImage({
      src: activeSnippet.imageUrl,
      alt: activeSnippet.previewLabel || activeSnippet.target || activeSnippet.section,
      section: activeSnippet.section,
    })
  }

  return (
    <>
      <section
        className={cn(
          'overflow-hidden rounded-[28px] border border-slate-800/90 bg-gradient-to-br p-6 text-slate-100 shadow-[0_24px_60px_rgba(2,6,23,0.28)]',
          getPanelGradient(activeTag),
          className,
        )}
        onMouseLeave={scheduleReset}
      >
        <div className="mb-5 flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-2xl border border-slate-700/80 bg-slate-900/80">
            <ScanSearch className={cn('h-4.5 w-4.5', activeColors.text)} />
          </div>
          <div>
            <h2 className="text-[1.95rem] font-semibold tracking-tight text-slate-50">
              {title}
            </h2>
          </div>
        </div>

      <div className="mb-5 rounded-[22px] border border-slate-700/80 bg-slate-900/35 p-4">
        <div className="flex flex-wrap gap-2.5">
          {tagState.map(({ tag, snippet, disabled, offSite }) => {
            const colors = tagColors[tag]
            const isActive = tag === activeTag

            return (
              <button
                key={tag}
                type="button"
                disabled={disabled}
                onMouseEnter={() => handleTagEnter(tag)}
                onFocus={() => handleTagEnter(tag)}
                className={cn(
                  'group inline-flex items-center gap-2.5 rounded-2xl border px-3.5 py-2.5 text-left transition-all duration-150',
                  disabled
                    ? 'cursor-help border-slate-700 bg-slate-700/40 text-slate-500'
                    : isActive
                      ? cn(
                          'border-transparent',
                          colors.pillBg,
                          colors.pillText,
                          colors.glow,
                        )
                      : cn(
                          'border-slate-700/80 bg-slate-100 text-slate-500 opacity-60 hover:opacity-85',
                          colors.pillMutedBg,
                          colors.pillMutedText,
                        ),
                )}
                title={
                  disabled
                    ? 'Evidence snippet missing or target text unavailable for this tag.'
                    : undefined
                }
              >
                <div className="flex items-baseline gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    {tagLabels[tag]}
                  </span>
                  <span className="max-w-[11rem] truncate text-[1.05rem] font-semibold normal-case tracking-normal">
                    {getSnippetPreview(snippet)}
                  </span>
                </div>

                {offSite && !disabled ? (
                  <span
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ring-1 ring-inset',
                      colors.bg,
                      colors.text,
                      colors.ring,
                    )}
                  >
                    <ArrowUpRight className="h-3.5 w-3.5" />
                    Pg {snippet?.page}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
      </div>

      <div className="rounded-[22px] border border-slate-200/80 bg-white/95 text-slate-700 shadow-xl shadow-black/20 backdrop-blur">
        <div className="flex items-center justify-between gap-4 border-b border-slate-200 px-5 py-3">
          <div className="flex min-w-0 items-center gap-3 text-sm text-slate-500">
            <FileStack className={cn('h-4 w-4', activeColors.text)} />
            <span className="whitespace-nowrap">Viewing Snippet:</span>
            <span
              className={cn(
                'whitespace-nowrap font-semibold text-slate-700 transition-colors',
                isViewingOffSite && 'animate-pulse',
                activeColors.text,
              )}
            >
              Page {activeSnippet.page}
            </span>
            <span className="text-slate-300">|</span>
            <span className="truncate text-slate-500">{activeSnippet.section}</span>
          </div>

          <button
            type="button"
            onClick={handleOpenPdf}
            className="inline-flex shrink-0 items-center gap-2 text-sm font-medium text-slate-500 transition-colors hover:text-slate-800"
          >
            <ExternalLink className="h-4 w-4" />
            Open Original PDF
          </button>
        </div>

        <div className="min-h-[190px] p-6">
          <div
            key={`${row.id}-${activeTag}-${activeSnippet.page}-${activeSnippet.section}`}
            className={cn(
              'relative transition-opacity duration-150',
              isTransitioning ? 'opacity-0' : 'opacity-100',
            )}
          >
            {activeSnippet.type === 'image' && activeSnippet.imageUrl ? (
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <ImageIcon className={cn('h-4 w-4', activeColors.text)} />
                  <span>{activeSnippet.section}</span>
                </div>
                <button
                  type="button"
                  onClick={handleExpandImage}
                  className="group relative block w-full overflow-hidden rounded-3xl border border-slate-200 bg-slate-100 text-left transition hover:border-slate-300 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
                  title="Click to enlarge"
                >
                  <img
                    src={activeSnippet.imageUrl}
                    alt={activeSnippet.previewLabel || activeSnippet.target || activeSnippet.section}
                    className="h-auto w-full object-contain"
                  />
                  {snippetStyle ? (
                    <div
                      className={cn(
                        'pointer-events-none absolute rounded-2xl border-[3px] bg-white/10 shadow-[0_0_0_9999px_rgba(15,23,42,0.18)]',
                        activeColors.ring,
                      )}
                      style={snippetStyle}
                    />
                  ) : null}
                  <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-center justify-end">
                    <span className="inline-flex items-center gap-2 rounded-full bg-slate-950/72 px-3 py-1.5 text-xs font-semibold text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                      <ZoomIn className="h-3.5 w-3.5" />
                      Click to enlarge
                    </span>
                  </div>
                </button>
              </div>
            ) : (
              <div
                className={cn(
                  'relative overflow-hidden rounded-[20px] bg-slate-50 px-6 py-7 shadow-inner shadow-slate-200/60',
                  activeColors.glow,
                )}
              >
                <div
                  className={cn(
                    'absolute inset-y-7 left-0 w-1 rounded-r-full',
                    activeColors.bg,
                  )}
                />
                <p className="whitespace-pre-wrap pl-5 text-[clamp(1.05rem,1.5vw,1.32rem)] font-medium leading-[2.1] text-slate-500">
                  {renderHighlightedText(
                    activeSnippet.text,
                    activeSnippet.highlightTargets || activeSnippet.target,
                    activeTag,
                    tagColors,
                  )}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-5 border-t border-slate-800/80 pt-4">
        <div className="flex items-start gap-3 text-slate-300">
          <Info className="mt-0.5 h-4.5 w-4.5 flex-shrink-0 text-slate-500" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm">
                <span className="font-medium text-slate-100">Extraction Rationale</span>
              </p>
              <button
                type="button"
                onClick={() => setShowRationale((value) => !value)}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-400 transition hover:text-slate-200"
              >
                {showRationale ? 'Less' : 'More'}
                {showRationale ? (
                  <ChevronUp className="h-3.5 w-3.5" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <p className={cn('mt-1 text-sm italic text-slate-400', !showRationale && 'max-h-10 overflow-hidden')}>
              {row.highlight}
            </p>
          </div>
        </div>
        </div>
      </section>
      {expandedImage ? (
        <div
          className="fixed inset-0 z-[140] flex items-center justify-center bg-slate-950/82 p-5 backdrop-blur-sm"
          onClick={() => setExpandedImage(null)}
        >
          <div
            className="relative w-full max-w-7xl rounded-[28px] border border-white/12 bg-slate-950/92 p-4 shadow-[0_32px_120px_rgba(15,23,42,0.55)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-4 px-2">
              <div className="min-w-0">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">
                  PDF Crop Preview
                </p>
                <p className="truncate text-sm text-slate-200">{expandedImage.section}</p>
              </div>
              <button
                type="button"
                onClick={() => setExpandedImage(null)}
                className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300 transition hover:bg-white/10 hover:text-white"
                title="Close enlarged preview"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
            <div className="flex max-h-[calc(100vh-8rem)] items-center justify-center overflow-auto rounded-[22px] bg-slate-900/70 p-3">
              <img
                src={expandedImage.src}
                alt={expandedImage.alt}
                className="h-auto max-h-[calc(100vh-12rem)] w-auto max-w-full rounded-2xl object-contain"
              />
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}

export default InteractiveEvidencePanel
