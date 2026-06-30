'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, FormControl, FormField, FormLabel, FormMessage, Input, toast } from '@/lib/ui'
import { personaProfileSchema, type PersonaProfile } from '@/lib/persona/schema'
import { savePersonaProfile } from '@/lib/actions/persona'

const WILDCARD_MIN = 0
const WILDCARD_MAX = 10
const WILDCARD_DEFAULT = '5'

type FieldType = 'text' | 'number' | 'list'

interface FieldDef {
  readonly key: string
  readonly label: string
  readonly type: FieldType
  readonly required?: boolean
}

interface StepDef {
  readonly title: string
  readonly fields: readonly FieldDef[]
}

const STEPS: readonly StepDef[] = [
  {
    title: 'Identity',
    fields: [
      { key: 'mainDraw', label: 'Main draw', type: 'text', required: true },
      { key: 'archetype', label: 'Archetype', type: 'text', required: true },
    ],
  },
  {
    title: 'Content pillars',
    fields: [
      { key: 'anchorName', label: 'Anchor name', type: 'text', required: true },
      { key: 'anchorMode', label: 'Anchor mode', type: 'text', required: true },
      { key: 'rotation', label: 'Rotation', type: 'list' },
    ],
  },
  {
    title: 'Voice',
    fields: [
      { key: 'toneWords', label: 'Tone words', type: 'list' },
      { key: 'sampleLines', label: 'Sample lines', type: 'list' },
      { key: 'dos', label: 'Dos', type: 'list' },
      { key: 'donts', label: "Don'ts", type: 'list' },
      { key: 'wildcardDial', label: 'Wildcard dial', type: 'number', required: true },
    ],
  },
  {
    title: 'Philosophy',
    fields: [
      { key: 'values', label: 'Values', type: 'list' },
      { key: 'statement', label: 'Statement', type: 'text', required: true },
    ],
  },
  {
    title: 'Audience',
    fields: [
      { key: 'description', label: 'Description', type: 'text', required: true },
      { key: 'servesWho', label: 'Serves who', type: 'text', required: true },
    ],
  },
  {
    title: 'Constraints',
    fields: [
      { key: 'timezone', label: 'Timezone', type: 'text', required: true },
      { key: 'weeklySchedule', label: 'Weekly schedule', type: 'text', required: true },
      { key: 'collabAvailability', label: 'Collab availability', type: 'text', required: true },
    ],
  },
  {
    title: 'Sustainability',
    fields: [
      { key: 'energyPatterns', label: 'Energy patterns', type: 'text', required: true },
      { key: 'burnoutTriggers', label: 'Burnout triggers', type: 'list' },
      { key: 'restNeeds', label: 'Rest needs', type: 'text', required: true },
    ],
  },
  {
    title: 'Platforms',
    fields: [
      { key: 'platformType', label: 'Platform type', type: 'text', required: true },
      { key: 'handle', label: 'Handle', type: 'text', required: true },
      { key: 'clipTargets', label: 'Clip targets', type: 'list' },
    ],
  },
]

type WizardState = Record<string, string>

const INITIAL_STATE: WizardState = {
  mainDraw: '',
  archetype: '',
  anchorName: '',
  anchorMode: '',
  rotation: '',
  toneWords: '',
  sampleLines: '',
  dos: '',
  donts: '',
  wildcardDial: WILDCARD_DEFAULT,
  values: '',
  statement: '',
  description: '',
  servesWho: '',
  timezone: '',
  weeklySchedule: '',
  collabAvailability: '',
  energyPatterns: '',
  burnoutTriggers: '',
  restNeeds: '',
  platformType: '',
  handle: '',
  clipTargets: '',
}

function toArray(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
}

function validateStep(step: StepDef, state: WizardState): string[] {
  const errors: string[] = []
  for (const field of step.fields) {
    if (field.type === 'number') {
      const parsed = Number(state[field.key])
      if (!Number.isInteger(parsed) || parsed < WILDCARD_MIN || parsed > WILDCARD_MAX) {
        errors.push(`${field.label} must be a whole number from ${WILDCARD_MIN} to ${WILDCARD_MAX}`)
      }
    } else if (field.required && !state[field.key].trim()) {
      errors.push(`${field.label} is required`)
    }
  }
  return errors
}

function assembleProfile(state: WizardState): PersonaProfile {
  return {
    identity: { mainDraw: state.mainDraw, archetype: state.archetype },
    contentPillars: {
      anchor: { name: state.anchorName, mode: state.anchorMode },
      rotation: toArray(state.rotation),
    },
    voice: {
      toneWords: toArray(state.toneWords),
      sampleLines: toArray(state.sampleLines),
      dos: toArray(state.dos),
      donts: toArray(state.donts),
      wildcardDial: Number(state.wildcardDial),
    },
    philosophy: { values: toArray(state.values), statement: state.statement },
    audience: { description: state.description, servesWho: state.servesWho },
    constraints: {
      timezone: state.timezone,
      weeklySchedule: state.weeklySchedule,
      collabAvailability: state.collabAvailability,
    },
    sustainability: {
      energyPatterns: state.energyPatterns,
      burnoutTriggers: toArray(state.burnoutTriggers),
      restNeeds: state.restNeeds,
    },
    platforms: {
      primary: { type: state.platformType, handle: state.handle },
      clipTargets: toArray(state.clipTargets),
    },
  }
}

export function PersonaWizard(): React.JSX.Element {
  const router = useRouter()
  const [stepIndex, setStepIndex] = useState(0)
  const [state, setState] = useState<WizardState>(INITIAL_STATE)
  const [errors, setErrors] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)

  const step = STEPS[stepIndex]
  const isLastStep = stepIndex === STEPS.length - 1

  function setField(key: string, value: string): void {
    setState((prev) => ({ ...prev, [key]: value }))
  }

  function handleNext(): void {
    const stepErrors = validateStep(step, state)
    if (stepErrors.length > 0) {
      setErrors(stepErrors)
      return
    }
    setErrors([])
    setStepIndex((prev) => prev + 1)
  }

  function handleBack(): void {
    setErrors([])
    setStepIndex((prev) => prev - 1)
  }

  async function handleSubmit(): Promise<void> {
    const stepErrors = validateStep(step, state)
    if (stepErrors.length > 0) {
      setErrors(stepErrors)
      return
    }
    const profile = personaProfileSchema.parse(assembleProfile(state))
    setSubmitting(true)
    try {
      await savePersonaProfile(profile)
      toast.success('Persona profile saved')
      router.push('/')
    } catch {
      setSubmitting(false)
      toast.error('Could not save your persona profile')
    }
  }

  return (
    <div>
      <p>
        Step {stepIndex + 1} of {STEPS.length}: {step.title}
      </p>

      {errors.map((error) => (
        <FormMessage key={error} role="alert">
          {error}
        </FormMessage>
      ))}

      {step.fields.map((field) => (
        <FormField key={field.key}>
          <FormLabel>{field.label}</FormLabel>
          <FormControl>
            <Input
              type={field.type === 'number' ? 'number' : 'text'}
              value={state[field.key]}
              onChange={(event) => setField(field.key, event.target.value)}
            />
          </FormControl>
        </FormField>
      ))}

      <div>
        {stepIndex > 0 && (
          <Button type="button" variant="outline" onClick={handleBack}>
            Back
          </Button>
        )}
        {isLastStep ? (
          <Button type="button" onClick={handleSubmit} disabled={submitting}>
            Submit
          </Button>
        ) : (
          <Button type="button" onClick={handleNext}>
            Next
          </Button>
        )}
      </div>
    </div>
  )
}
