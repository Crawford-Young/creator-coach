import NextAuth, { type NextAuthConfig } from 'next-auth'
import Twitch from 'next-auth/providers/twitch'
import { MongoDBAdapter } from '@auth/mongodb-adapter'
import { getClient } from '@/db/mongo'
import { env } from '@/env'
import { provisionCreator } from '@/lib/provision'

export const authConfig: NextAuthConfig = {
  adapter: MongoDBAdapter(getClient(), { databaseName: env.MONGODB_DB }),
  providers: [
    Twitch({
      clientId: env.AUTH_TWITCH_ID,
      clientSecret: env.AUTH_TWITCH_SECRET,
      authorization: {
        params: {
          scope: 'user:read:email channel:manage:broadcast channel:read:subscriptions',
        },
      },
    }),
  ],
  session: {
    strategy: 'database',
  },
  pages: {
    signIn: '/sign-in',
  },
  events: {
    signIn: async ({ user }) => {
      if (user.id) await provisionCreator(user.id, user.name ?? '')
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
