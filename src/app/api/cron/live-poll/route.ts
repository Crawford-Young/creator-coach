import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest } from '@/lib/ingest/run-daily'
import { runLivePoll } from '@/lib/ingest/run-live-poll'

const HTTP_UNAUTHORIZED = 401

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: HTTP_UNAUTHORIZED })
  }
  const summary = await runLivePoll()
  return NextResponse.json(summary)
}
