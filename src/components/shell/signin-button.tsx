'use client'

import { signIn } from 'next-auth/react'
import { Button } from '@/lib/ui'

const SIGNIN_REDIRECT = '/'

export function SigninButton(): React.JSX.Element {
  async function handleSignIn(): Promise<void> {
    await signIn('twitch', { redirectTo: SIGNIN_REDIRECT })
  }

  return (
    <Button type="button" onClick={handleSignIn}>
      Continue with Twitch
    </Button>
  )
}
