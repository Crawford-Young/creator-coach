import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/lib/ui'
import { SigninButton } from '@/components/shell/signin-button'

// Sits outside the (app) group — no sidebar shell. Twitch is the only
// sign-IN provider (src/lib/auth.ts); Google is link-only, never rendered
// here.
export default function SigninPage(): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in to Creator Coach</CardTitle>
          <CardDescription>Connect your Twitch account to continue.</CardDescription>
        </CardHeader>
        <CardContent>
          <SigninButton />
        </CardContent>
      </Card>
    </main>
  )
}
