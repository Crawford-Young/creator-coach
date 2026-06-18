import { z } from 'zod'

const identitySchema = z.object({
  mainDraw: z.string().min(1),
  archetype: z.string().min(1),
})

const contentPillarsSchema = z.object({
  anchor: z.object({
    name: z.string().min(1),
    mode: z.string().min(1),
  }),
  rotation: z.array(z.string()),
})

const voiceSchema = z.object({
  toneWords: z.array(z.string()),
  sampleLines: z.array(z.string()),
  dos: z.array(z.string()),
  donts: z.array(z.string()),
  wildcardDial: z.number().int().min(0).max(10),
})

const philosophySchema = z.object({
  values: z.array(z.string()),
  statement: z.string().min(1),
})

const audienceSchema = z.object({
  description: z.string().min(1),
  servesWho: z.string().min(1),
})

const constraintsSchema = z.object({
  timezone: z.string().min(1),
  weeklySchedule: z.string().min(1),
  collabAvailability: z.string().min(1),
})

const sustainabilitySchema = z.object({
  energyPatterns: z.string().min(1),
  burnoutTriggers: z.array(z.string()),
  restNeeds: z.string().min(1),
})

const platformsSchema = z.object({
  primary: z.object({
    type: z.string().min(1),
    handle: z.string().min(1),
  }),
  clipTargets: z.array(z.string()),
})

export const personaProfileSchema = z.object({
  identity: identitySchema,
  contentPillars: contentPillarsSchema,
  voice: voiceSchema,
  philosophy: philosophySchema,
  audience: audienceSchema,
  constraints: constraintsSchema,
  sustainability: sustainabilitySchema,
  platforms: platformsSchema,
})

export type PersonaProfile = z.infer<typeof personaProfileSchema>
