import { describe, expect, it } from 'vitest'

import { buildManualDiffusionCandidatePayload } from '@/lib/manualDiffusionEstimate'

describe('buildManualDiffusionCandidatePayload', () => {
  it('builds a figure-estimated diffusion candidate payload', () => {
    const payload = buildManualDiffusionCandidatePayload({
      systemName: '[BuPy][NTf2] in graphene slit',
      ionicLiquid: '[BuPy][NTf2]',
      diffusingIon: 'cation',
      coefficientField: 'd_cation',
      coefficientValue: '1.2',
      dUnit: '10^-10 m2/s',
      sourcePage: '6',
      sourceFigure: 'Fig. 10',
      evidence: 'Estimated from cation curve.',
    })

    expect(payload).toMatchObject({
      systemName: '[BuPy][NTf2] in graphene slit',
      ionicLiquid: '[BuPy][NTf2]',
      diffusingIon: 'cation',
      dCation: 1.2,
      dUnit: '10^-10 m2/s',
      sourcePage: 6,
      sourceFigure: 'Fig. 10',
    })
  })

  it('requires at least one diffusion coefficient value', () => {
    expect(() => buildManualDiffusionCandidatePayload({
      systemName: 'System',
      coefficientField: 'd_total',
      coefficientValue: '',
      dUnit: 'm2/s',
    })).toThrow(/扩散值/)
  })
})
