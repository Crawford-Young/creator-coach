import { auth } from '@/lib/auth'
import { collections, toCreator, type Creator } from '@/db/mongo'

export class UnauthorizedError extends Error {
  constructor(message = 'Not authenticated') {
    super(message)
    this.name = 'UnauthorizedError'
  }
}

export async function requireCreator(): Promise<Creator> {
  const session = await auth()
  if (!session?.user?.id) throw new UnauthorizedError()
  const doc = await collections().creators.findOne({ userId: session.user.id })
  if (!doc) throw new UnauthorizedError('No creator tenant for user')
  return toCreator(doc)
}
