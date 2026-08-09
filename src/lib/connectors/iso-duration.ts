// Pure ISO-8601 duration parser — no imports. Supports the subset YouTube's
// contentDetails.duration field uses: days, hours, minutes, seconds
// (e.g. "PT4M13S", "P1DT2H"). Years/months are intentionally unsupported —
// video durations never carry them.

const SECONDS_PER_DAY = 86400
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_MINUTE = 60

// Target is ES2017 (tsconfig.json) — no named capturing groups (ES2018+).
// Positional groups: 1=days, 2=hours, 3=minutes, 4=seconds.
const ISO_DURATION_PATTERN = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/

export class IsoDurationParseError extends Error {
  constructor(input: string) {
    super(`Invalid ISO-8601 duration: ${JSON.stringify(input)}`)
    this.name = 'IsoDurationParseError'
  }
}

export function parseIsoDuration(duration: string): number {
  const match = ISO_DURATION_PATTERN.exec(duration)
  const [, daysGroup, hoursGroup, minutesGroup, secondsGroup] = match ?? []

  if (!match || (!daysGroup && !hoursGroup && !minutesGroup && !secondsGroup)) {
    throw new IsoDurationParseError(duration)
  }

  const days = daysGroup ? Number(daysGroup) : 0
  const hours = hoursGroup ? Number(hoursGroup) : 0
  const minutes = minutesGroup ? Number(minutesGroup) : 0
  const seconds = secondsGroup ? Number(secondsGroup) : 0

  return days * SECONDS_PER_DAY + hours * SECONDS_PER_HOUR + minutes * SECONDS_PER_MINUTE + seconds
}
