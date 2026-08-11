import { Alert, AlertDescription, Button } from '@/lib/ui'
import { SigninButton } from '@/components/shell/signin-button'
import { PLATFORM_LABEL } from '@/lib/platform-labels'
import type { Platform } from '@/db'
import type { PlatformAccountSummary } from '@/lib/platform-accounts'

const GOOGLE_RELINK_PATH = '/api/connections/google/start'

interface ReauthActionProps {
  readonly platform: Platform
}

function ReauthAction({ platform }: ReauthActionProps): React.JSX.Element | null {
  if (platform === 'twitch') {
    // Signing in with Twitch again is the re-link: the Auth.js signIn event
    // flips the account back to active (W1 #6).
    return <SigninButton />
  }
  if (platform === 'youtube') {
    return (
      <Button asChild variant="outline">
        {/* A plain anchor, not next/link: this href is a route handler that
            starts the Google OAuth flow and sets a state cookie, so a Link
            prefetch would fire the flow on hover. */}
        <a href={GOOGLE_RELINK_PATH}>Reconnect YouTube</a>
      </Button>
    )
  }
  // TikTok and Instagram have no connector yet, so there is no re-link route to
  // offer. The banner still reports the problem rather than hiding it.
  return null
}

export interface ReauthBannerProps {
  readonly accounts: readonly PlatformAccountSummary[]
}

/**
 * One alert per platform account whose tokens stopped working. Renders nothing
 * at all when every link is healthy — an empty container above the cards would
 * push the dashboard down for no reason.
 */
export function ReauthBanner({ accounts }: ReauthBannerProps): React.JSX.Element | null {
  const stale = accounts.filter((account) => account.status === 'reauth_required')
  if (stale.length === 0) return null

  return (
    <div className="flex flex-col gap-3">
      {stale.map((account) => (
        <Alert key={account.id} variant="warning" className="flex flex-wrap items-center gap-3">
          <AlertDescription className="flex-1">
            {PLATFORM_LABEL[account.platform]} access for {account.handle} expired. Reconnect to
            keep your stats up to date.
          </AlertDescription>
          <ReauthAction platform={account.platform} />
        </Alert>
      ))}
    </div>
  )
}
