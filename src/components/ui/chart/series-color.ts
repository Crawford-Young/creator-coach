import type { TrendSeries } from '@/components/ui/chart/trend-chart'

/**
 * The series palette, in a module with no `'use client'` banner so server and
 * client surfaces share ONE definition. `trend-chart.tsx` is a client module,
 * and a Server Component that dots into a client module's non-component export
 * throws at runtime ("dot into a client module from a server component") — so
 * the card's sparklines could not have read this from there. The `TrendSeries`
 * import is type-only, hence erased: no cycle survives to runtime.
 *
 * P-18: a new series id needs `--series-<id>` defined in BOTH themes in
 * globals.css. An undefined custom property is invalid at computed-value time
 * and falls back to the initial paint, which no gate in this repo can see.
 */
export const SERIES_COLOR: Readonly<Record<TrendSeries['id'], string>> = {
  twitch: 'var(--series-twitch)',
  youtube: 'var(--series-youtube)',
}
