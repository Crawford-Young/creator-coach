import NextAuth, { type NextAuthConfig } from 'next-auth'
import Twitch from 'next-auth/providers/twitch'
import { MongoDBAdapter } from '@auth/mongodb-adapter'
import { getClient } from '@/db'
import { env } from '@/env'
import { provisionCreator } from '@/lib/provision'
import { syncTwitchAccount } from '@/lib/connections/twitch-sync'

export const authConfig: NextAuthConfig = {
  adapter: MongoDBAdapter(getClient(), { databaseName: env.MONGODB_DB }),
  providers: [
    Twitch({
      clientId: env.AUTH_TWITCH_ID,
      clientSecret: env.AUTH_TWITCH_SECRET,
      authorization: {
        params: {
          // openid is required: the provider is OIDC, and overriding `scope`
          // replaces (not extends) the default `openid user:read:email` set —
          // without it Twitch omits id_token and the callback route 500s.
          scope:
            'openid user:read:email channel:manage:broadcast channel:read:subscriptions moderator:read:followers',
        },
      },
    }),
  ],
  session: {
    strategy: 'database',
  },
  events: {
    signIn: async ({ user }) => {
      if (user.id) {
        await provisionCreator(user.id, user.name ?? '')
        await syncTwitchAccount(user.id, user.name ?? '')
      }
    },
  },
}

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig)
