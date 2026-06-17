import NextAuth from 'next-auth'
import { DrizzleAdapter } from '@auth/drizzle-adapter'
import { db } from '@/db'

// Providers (e.g. Twitch) will be added in a subsequent task
export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db),
  providers: [],
  session: {
    strategy: 'database',
  },
  pages: {
    signIn: '/sign-in',
  },
})
