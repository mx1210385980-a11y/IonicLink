/**
 * Highlight rectangle type for Source Grounding.
 * Coordinates use standard PDF Points (72 DPI).
 */
export interface HighlightRect {
    /** Unique highlight identifier */
    id: string
    /** 1-based page number */
    page: number
    /** Optional RGBA color for PDF overlay highlight */
    color?: string
    /** Bounding box in PDF points (origin: top-left) */
    coords: {
        x: number // Left
        y: number // Top
        w: number // Width
        h: number // Height
    }
}

/**
 * Data extracted from PDF matching a highlight.
 */
export interface ExtractedData {
    id: string
    position: {
        pageNumber: number
        boundingRect: { x1: number; y1: number; x2: number; y2: number }
        rects?: { x1: number; y1: number; x2: number; y2: number }[]
    }
}
