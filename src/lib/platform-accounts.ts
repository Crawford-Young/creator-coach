import { collections, type Platform, type PlatformAccountStatus } from '@/db'

/**
 * The client-safe projection of a `PlatformAccountDoc`. The document carries
 * `accessToken`/`refreshToken`/`scopes`; dashboard components receive this
 * shape as props, so returning the raw doc would ship platform tokens to the
 * browser. Widening this interface means re-checking that claim.
 */
export interface PlatformAccountSummary {
  readonly id: string
  readonly platform: Platform
  readonly handle: string
  readonly status: PlatformAccountStatus
}

/**
 * Every platform account linked by one creator, ordered by platform so the
 * dashboard's cards and banners render in a stable order across requests.
 * Tenant scoping is the caller's `creatorId`, resolved from the session by
 * `requireDashboardCreator` — never from a parameter the client controls.
 */
export async function listPlatformAccounts(creatorId: string): Promise<PlatformAccountSummary[]> {
  const docs = await collections()
    .platformAccounts.find(
      { creatorId },
      // Defense in depth: the mapper below already drops the token fields, but
      // projecting them away keeps them off the wire from Atlas as well.
      { projection: { platform: 1, handle: 1, status: 1 }, sort: { platform: 1 } },
    )
    .toArray()

  return docs.map((doc) => ({
    id: doc._id.toHexString(),
    platform: doc.platform,
    handle: doc.handle,
    status: doc.status,
  }))
}
