import { describe, it, expect } from 'vitest'
import { personaProfileSchema } from '@/lib/persona/schema'

const valid = {
  identity: { mainDraw: 'community heart', archetype: 'community-heart' },
  contentPillars: {
    anchor: { name: 'CS2', mode: 'ranked + squad nights' },
    rotation: ['Valorant'],
  },
  voice: {
    toneWords: ['calm'],
    sampleLines: ['gg'],
    dos: ['uplift'],
    donts: ['rage'],
    wildcardDial: 6,
  },
  philosophy: { values: ['care'], statement: 'people first' },
  audience: { description: 'the campfire', servesWho: 'regulars' },
  constraints: {
    timezone: 'Europe/London',
    weeklySchedule: 'eves',
    collabAvailability: 'weekends',
  },
  sustainability: {
    energyPatterns: 'morning low',
    burnoutTriggers: ['over-streaming'],
    restNeeds: '1 day/wk',
  },
  platforms: { primary: { type: 'twitch', handle: 'x' }, clipTargets: ['tiktok'] },
}

describe('personaProfileSchema', () => {
  it('accepts a complete profile', () => {
    expect(personaProfileSchema.parse(valid)).toBeTruthy()
  })

  it('rejects a missing identity.archetype', () => {
    const bad = { ...valid, identity: { mainDraw: 'x' } }
    expect(() => personaProfileSchema.parse(bad)).toThrow()
  })

  it('rejects wildcardDial > 10', () => {
    expect(() =>
      personaProfileSchema.parse({ ...valid, voice: { ...valid.voice, wildcardDial: 11 } }),
    ).toThrow()
  })

  it('rejects wildcardDial < 0', () => {
    expect(() =>
      personaProfileSchema.parse({ ...valid, voice: { ...valid.voice, wildcardDial: -1 } }),
    ).toThrow()
  })

  it('accepts wildcardDial at boundary 0', () => {
    expect(
      personaProfileSchema.parse({ ...valid, voice: { ...valid.voice, wildcardDial: 0 } }),
    ).toBeTruthy()
  })

  it('accepts wildcardDial at boundary 10', () => {
    expect(
      personaProfileSchema.parse({ ...valid, voice: { ...valid.voice, wildcardDial: 10 } }),
    ).toBeTruthy()
  })

  it('rejects non-integer wildcardDial', () => {
    expect(() =>
      personaProfileSchema.parse({ ...valid, voice: { ...valid.voice, wildcardDial: 6.5 } }),
    ).toThrow()
  })

  it('rejects empty string in identity.mainDraw', () => {
    expect(() =>
      personaProfileSchema.parse({ ...valid, identity: { mainDraw: '', archetype: 'x' } }),
    ).toThrow()
  })

  it('rejects missing contentPillars.anchor.name', () => {
    expect(() =>
      personaProfileSchema.parse({
        ...valid,
        contentPillars: { anchor: { mode: 'ranked' }, rotation: [] },
      }),
    ).toThrow()
  })

  it('rejects missing philosophy.statement', () => {
    expect(() =>
      personaProfileSchema.parse({
        ...valid,
        philosophy: { values: ['care'] },
      }),
    ).toThrow()
  })

  it('rejects empty string in audience.description', () => {
    expect(() =>
      personaProfileSchema.parse({
        ...valid,
        audience: { description: '', servesWho: 'regulars' },
      }),
    ).toThrow()
  })

  it('rejects missing platforms.primary.handle', () => {
    expect(() =>
      personaProfileSchema.parse({
        ...valid,
        platforms: { primary: { type: 'twitch' }, clipTargets: [] },
      }),
    ).toThrow()
  })
})
