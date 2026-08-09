import { NextResponse } from 'next/server'
import { requireCreator, UnauthorizedError } from '@/lib/tenant'
import {
  buildGoogleAuthUrl,
  generateState,
  GOOGLE_STATE_COOKIE,
  GOOGLE_STATE_COOKIE_MAX_AGE_SECONDS,
} from '@/lib/connections/google-link'
import { env } from '@/env'

export async function GET(): Promise<NextResponse> {
  try {
    await requireCreator()
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    throw error
  }

  const state = generateState()
  const response = NextResponse.redirect(buildGoogleAuthUrl(state))
  response.cookies.set(GOOGLE_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.NODE_ENV === 'production',
    maxAge: GOOGLE_STATE_COOKIE_MAX_AGE_SECONDS,
    path: '/api/connections/google',
  })
  return response
}
