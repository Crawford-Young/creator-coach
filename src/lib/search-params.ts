/** The shape Next hands a page for `searchParams`, once awaited. */
export type RawSearchParams = Record<string, string | string[] | undefined>

/**
 * Normalizes Next's awaited `searchParams` record into a `URLSearchParams`, so
 * every surface reads and rewrites the query through one type. A repeated param
 * arrives as an array and is re-appended in order rather than collapsed.
 */
export function toSearchParams(raw: RawSearchParams): URLSearchParams {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item)
    }
  }
  return params
}
