import { collections } from '@/db'
import { checkLive } from '@/lib/connectors/twitch'
import { runIsolated, type IngestSummary } from '@/lib/ingest/run-daily'

const TWITCH_PLATFORM = 'twitch'
const ACTIVE_STATUS = 'active'

/**
 * Polls live status for every active twitch account. Youtube has no
 * equivalent live signal in W1, and non-active accounts are excluded by the
 * same `status: 'active'` filter runDailyIngest uses.
 */
export async function runLivePoll(): Promise<IngestSummary> {
  const { platformAccounts } = collections()
  const accounts = await platformAccounts
    .find({ status: ACTIVE_STATUS, platform: TWITCH_PLATFORM })
    .toArray()

  return runIsolated(accounts, checkLive, 'runLivePoll: account check failed')
}
