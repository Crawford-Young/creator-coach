import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'

export default auth(function middleware() {
  // Route protection will be implemented in subsequent tasks
  return NextResponse.next()
})

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
}
