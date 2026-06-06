export type ReviewBadgeTone = 'reviewed' | 'needs-review'

export interface ReviewBadge {
  label: string
  tone: ReviewBadgeTone
}

type ReviewBadgePaper = {
  submissionStatus?: string | null
  reviewedAt?: string | null
  candidateCount?: number | null
  tribologyCandidateCount?: number | null
  diffusionCandidateCount?: number | null
}

export function isPaperReviewed(paper: ReviewBadgePaper): boolean {
  const submissionStatus = String(paper.submissionStatus || '').toLowerCase()
  return submissionStatus === 'approved' || Boolean(paper.reviewedAt)
}

export function reviewBadgesForPaper(paper: ReviewBadgePaper): ReviewBadge[] {
  const badges: ReviewBadge[] = []
  const candidateCount = Number(paper.tribologyCandidateCount || 0)
    + Number(paper.diffusionCandidateCount || 0)
    + Number(
      paper.tribologyCandidateCount || paper.diffusionCandidateCount
        ? 0
        : paper.candidateCount || 0,
    )
  if (candidateCount > 0) {
    badges.push({ label: 'Needs review', tone: 'needs-review' })
  }

  return badges
}
