import { NextResponse } from 'next/server'
import { isAuthorizedCronRequest, runDailyIngest } from '@/lib/ingest/run-daily'

const HTTP_UNAUTHORIZED = 401

export async function GET(request: Request): Promise<NextResponse> {
  if (!isAuthorizedCronRequest(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: HTTP_UNAUTHORIZED })
  }
  const summary = await runDailyIngest()
  return NextResponse.json(summary)
}
