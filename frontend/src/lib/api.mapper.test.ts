import { describe, expect, it } from 'vitest'

import { mapRecordToPayload, type TribologyData } from './api'

describe('mapRecordToPayload', () => {
  it('keeps speed units instead of syncing a bare numeric value', () => {
    const payload = mapRecordToPayload({
      material_name: 'Au(111)',
      ionic_liquid: '[BMIM][AOT]',
      cof: '0.001',
      load: '10 nN',
      speed: '6 μm/s',
      speed_conditions: {
        sliding_velocity_um_s: 6,
        scan_size_nm: 500,
        scan_rate_hz: 6,
      },
    } as TribologyData)

    expect(payload.speedValue).toBe('6 μm/s')
    expect(payload.speedRaw).toBe('6 μm/s')
    expect(payload.speedConditions).toMatchObject({
      sliding_velocity_um_s: 6,
      scan_size_nm: 500,
      scan_rate_hz: 6,
    })
  })
})
