import Link from 'next/link'
import { Button } from '@/lib/ui'
import { rangeHref, RANGE_PRESETS, type RangePreset } from '@/lib/metrics/range'

const RANGE_LABEL: Readonly<Record<RangePreset, string>> = {
  '7d': '7 days',
  '30d': '30 days',
  '90d': '90 days',
  all: 'All time',
}

export interface RangePickerProps {
  readonly active: RangePreset
  /** The current search string, so switching range preserves sibling params. */
  readonly params?: URLSearchParams
}

/**
 * Range selection with no client state: each preset is a link that rewrites the
 * range param, so the server refetches the series and re-renders. Query-only
 * hrefs keep whichever pathname the picker is mounted on.
 */
export function RangePicker({ active, params }: RangePickerProps): React.JSX.Element {
  return (
    <nav aria-label="Date range" className="flex flex-wrap gap-1">
      {RANGE_PRESETS.map((preset) => (
        <Button key={preset} asChild size="sm" variant={preset === active ? 'secondary' : 'ghost'}>
          <Link
            href={rangeHref(preset, params)}
            aria-current={preset === active ? 'page' : undefined}
          >
            {RANGE_LABEL[preset]}
          </Link>
        </Button>
      ))}
    </nav>
  )
}
