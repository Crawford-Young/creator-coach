import { NextResponse, type NextRequest } from 'next/server'
import { requireCreator, UnauthorizedError } from '@/lib/tenant'
import {
  handleGoogleCallback,
  StateMismatchError,
  GOOGLE_STATE_COOKIE,
} from '@/lib/connections/google-link'
import { logger } from '@/lib/logger'

export async function GET(request: NextRequest): Promise<NextResponse> {
  let creatorId: string
  try {
    creatorId = (await requireCreator()).id
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    throw error
  }

  const code = request.nextUrl.searchParams.get('code') ?? ''
  const state = request.nextUrl.searchParams.get('state') ?? ''
  const stateCookie = request.cookies.get(GOOGLE_STATE_COOKIE)?.value ?? ''

  try {
    await handleGoogleCallback({ code, state, stateCookie, creatorId })
  } catch (error) {
    if (error instanceof StateMismatchError) {
      return NextResponse.json({ error: error.message }, { status: 403 })
    }
    logger.warn(
      { creatorId, reason: error instanceof Error ? error.name : 'unknown' },
      'google callback link failed',
    )
    const response = NextResponse.redirect(new URL('/?googleLinkError=1', request.url))
    response.cookies.delete(GOOGLE_STATE_COOKIE)
    return response
  }

  const response = NextResponse.redirect(new URL('/', request.url))
  response.cookies.delete(GOOGLE_STATE_COOKIE)
  return response
}
