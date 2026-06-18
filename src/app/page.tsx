import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getPersonaProfile } from '@/lib/persona/get'

export default async function HomePage(): Promise<React.JSX.Element> {
  const session = await auth()
  if (session?.user) {
    const profile = await getPersonaProfile()
    if (!profile) redirect('/onboarding')
  }
  return (
    <main className="flex min-h-screen flex-col items-center justify-center">
      <h1 className="text-4xl font-bold">Creator Coach</h1>
      <p className="mt-4 text-muted-foreground">Coming soon.</p>
    </main>
  )
}
