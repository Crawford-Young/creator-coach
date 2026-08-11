/** Plain thousands-separated integers — the default for every metric figure. */
export const NUMBER_FORMAT = new Intl.NumberFormat('en-US')

/** Always-signed, for a change figure where the sign carries the meaning. */
export const DELTA_FORMAT = new Intl.NumberFormat('en-US', { signDisplay: 'exceptZero' })
