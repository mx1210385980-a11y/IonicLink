import type { TribologyData, ValidationStatus } from '@/lib/api'

export interface ValidationIssue {
    field: string
    message: string
    severity: 'error' | 'warning'
}

export interface ValidationResult {
    status: ValidationStatus
    message?: string
    issues: ValidationIssue[]
}

export interface UnitValue {
    value: number
    unit: string
}

/**
 * Parse a value with unit (e.g., "55 mN", "100 µN") into numeric value and unit
 */
export function parseUnitValue(valueWithUnit: string | undefined): UnitValue | null {
    if (!valueWithUnit || typeof valueWithUnit !== 'string') return null

    // Clean the string and extract numeric part
    const match = valueWithUnit.match(/([\d.]+)\s*([a-zA-Zµ]+)/)
    if (!match || match.length < 3) return null

    const value = parseFloat(match[1]!)
    const unit = match[2]!

    if (isNaN(value)) return null

    return { value, unit }
}

/**
 * Convert force values to Newtons for standard comparison
 */
export function convertToNewtons(valueWithUnit: string | undefined): number | null {
    const parsed = parseUnitValue(valueWithUnit)
    if (!parsed) return null

    const { value, unit } = parsed

    // Conversion factors to Newtons
    const conversions: Record<string, number> = {
        'N': 1,
        'mN': 0.001,
        'µN': 0.000001,
        'uN': 0.000001, // Alternative representation
        'nN': 0.000000001,
    }

    const factor = conversions[unit]
    if (factor === undefined) return null

    return value * factor
}

/**
 * Validate COF value
 */
export function validateCOF(cof: string | undefined): ValidationIssue | null {
    // Check if COF is missing
    if (!cof || cof === '-' || cof.trim() === '') {
        return {
            field: 'cof',
            message: 'Missing COF value',
            severity: 'warning'
        }
    }

    // Extract numeric value (handle "< 0.02" format)
    const numericStr = cof.replace(/[^\\d.]/g, '')
    const cofValue = parseFloat(numericStr)

    if (isNaN(cofValue)) {
        return {
            field: 'cof',
            message: 'Invalid COF format',
            severity: 'warning'
        }
    }

    // Physical constraint: COF should be between 0 and 1.5
    if (cofValue < 0) {
        return {
            field: 'cof',
            message: 'COF cannot be negative',
            severity: 'error'
        }
    }

    if (cofValue > 1.5) {
        return {
            field: 'cof',
            message: 'COF > 1.5 is physically unusual',
            severity: 'warning'
        }
    }

    return null
}

/**
 * Validate load value
 */
export function validateLoad(load: string | undefined): ValidationIssue | null {
    if (!load) return null

    const parsed = parseUnitValue(load)
    if (!parsed) {
        return {
            field: 'load',
            message: 'Load value must include unit (e.g., 5 N, 100 mN)',
            severity: 'warning'
        }
    }

    // Check if convertible to Newtons
    const newtons = convertToNewtons(load)
    if (newtons === null) {
        return {
            field: 'load',
            message: 'Unsupported unit for load',
            severity: 'warning'
        }
    }

    return null
}

/**
 * Validate friction force value
 */
export function validateFrictionForce(force: string | undefined): ValidationIssue | null {
    if (!force) return null

    const parsed = parseUnitValue(force)
    if (!parsed) {
        return {
            field: 'friction_force',
            message: 'Force value must include unit (e.g., 5 N, 100 mN)',
            severity: 'warning'
        }
    }

    return null
}

/**
 * Main validation function for a complete record
 */
export function validateRecord(record: TribologyData): ValidationResult {
    const issues: ValidationIssue[] = []

    // Validate COF
    const cofIssue = validateCOF(record.cof)
    if (cofIssue) issues.push(cofIssue)

    // Validate load
    const loadIssue = validateLoad(record.load)
    if (loadIssue) issues.push(loadIssue)

    // Validate friction force
    const forceIssue = validateFrictionForce(record.friction_force)
    if (forceIssue) issues.push(forceIssue)

    // Determine overall status
    let status: ValidationStatus = record.validationStatus || 'unverified'

    // If there are errors or warnings, set status accordingly
    const hasErrors = issues.some(i => i.severity === 'error')
    const hasWarnings = issues.some(i => i.severity === 'warning')

    if (hasErrors || hasWarnings) {
        status = 'warning'
    }

    // Keep verified/modified status if already set and no errors
    if (!hasErrors && (record.validationStatus === 'verified' || record.validationStatus === 'modified')) {
        status = record.validationStatus
    }

    return {
        status,
        message: issues.length > 0 && issues[0] ? issues[0].message : undefined,
        issues
    }
}

/**
 * Validate an entire batch of records
 */
export function validateBatch(records: TribologyData[]): Map<string, ValidationResult> {
    const results = new Map<string, ValidationResult>()

    records.forEach(record => {
        if (record.id) {
            results.set(record.id, validateRecord(record))
        }
    })

    return results
}

/**
 * Composable for using validation in components
 */
export function useValidation() {
    return {
        validateRecord,
        validateBatch,
        validateCOF,
        validateLoad,
        validateFrictionForce,
        parseUnitValue,
        convertToNewtons
    }
}
