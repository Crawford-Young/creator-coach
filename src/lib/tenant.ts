import { eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/db'
import { creators } from '@/db/schema'

export class UnauthorizedError extends Error {
  constructor(message = 'Not authenticated') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export async function requireCreator(): Promise<typeof creators.$inferSelect> {
  const session = await auth()
  if (!session?.user?.id) throw new UnauthorizedError()
  const [creator] = await db
    .select()
    .from(creators)
    .where(eq(creators.userId, session.user.id))
    .limit(1)
  if (!creator) throw new UnauthorizedError('No creator tenant for user')
  return creator
}
