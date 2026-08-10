import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { collections, toCreator, type Creator } from '@/db'

// Dashboard-lane sibling of requireCreator (src/lib/tenant.ts): redirects
// instead of throwing, since callers here are pages, not server actions.
//
// It does NOT compose requireCreator, and the reason is the failure taxonomy,
// not redirect() mechanics: requireCreator throws the SAME UnauthorizedError
// for "no session" and "no creator tenant", differing only in message. The
// dashboard has to send those two to different places (/signin vs /onboarding),
// so composing it would mean branching on an error message string — a contract
// nothing enforces. Splitting the checks here keeps each destination tied to
// the condition that earns it. Cost: the session + creator lookup is duplicated
// from tenant.ts; keep the two in step by hand.
//
// No try/catch anywhere in this function: redirect() signals by throwing
// NEXT_REDIRECT, so a catch straddling it could swallow the redirect.
export async function requireDashboardCreator(): Promise<Creator> {
  const session = await auth()
  if (!session?.user?.id) redirect('/signin')

  const creatorDoc = await collections().creators.findOne({ userId: session.user.id })
  if (!creatorDoc) redirect('/onboarding')

  const creator = toCreator(creatorDoc)
  // Existence check only — the profile payload is never read here, so project
  // it away rather than pulling PersonaProfile over the wire on every request
  // to every (app) page.
  const profileDoc = await collections().personaProfiles.findOne(
    { creatorId: creator.id },
    { projection: { _id: 1 } },
  )
  if (!profileDoc) redirect('/onboarding')

  return creator
}
