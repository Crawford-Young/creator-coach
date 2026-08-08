import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https:",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      // Chrome enforces form-action on the WHOLE redirect chain of a form
      // submission: the sign-in form posts to self, 302s to Twitch's authorize
      // page, and (when not already logged into Twitch) 302s again to the
      // twitch.tv login page — every host in that chain must be allow-listed
      // or the browser silently blocks the submission. Chrome's console error
      // names the original action URL, not the violating hop.
      "form-action 'self' https://id.twitch.tv https://www.twitch.tv",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; '),
  },
]

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: '/(.*)', headers: securityHeaders }]
  },
}

export default nextConfig
