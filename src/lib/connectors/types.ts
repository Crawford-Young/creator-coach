import type { ContentItemDoc, PlatformAccountDoc } from '@/db'

export interface PlatformConnector {
  syncChannel(account: PlatformAccountDoc): Promise<void>
  syncContent(account: PlatformAccountDoc): Promise<void>
  syncMetrics(account: PlatformAccountDoc, items: ContentItemDoc[]): Promise<void>
}

export interface FreshToken {
  accessToken: string // PLAINTEXT, in-memory only — never persisted
}

// ORCHESTRATOR AMENDMENT to the checklist signatures: forceRefresh lets a
// caller force a refresh after a provider 401 even when the stored expiry
// still looks fresh — without it, a fresh-looking token skips refresh and
// the caller's retry loops forever.
export interface RefreshOptions {
  forceRefresh?: boolean
}
