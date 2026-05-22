import { describe, expect, it } from 'vitest'

import { originalDiffusionValueFromText } from '@/lib/diffusionReview'

describe('originalDiffusionValueFromText', () => {
  it('keeps the coefficient mantissa separate from a spaced scientific unit exponent', () => {
    const parsed = originalDiffusionValueFromText(
      'Table II reports D_tot for BuPy+ as 1.506 × 10 ^ - 10 m2/s and for NTf2- as 1.176 × 10 ^ - 10 m2/s.',
    )

    expect(parsed).toMatchObject({
      mantissa: '1.506',
      value: '1.506',
      unit: '10⁻¹⁰ m²/s',
    })
  })

  it('does not use the base 10 from a scientific unit as the diffusion value', () => {
    const parsed = originalDiffusionValueFromText('D_tot = 1.506 × 10^-10 m2/s')

    expect(parsed?.mantissa).toBe('1.506')
    expect(parsed?.value).not.toBe('10')
  })
})
