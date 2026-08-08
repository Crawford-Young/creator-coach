import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getPersonaProfile } from '@/lib/persona/get'
import { PersonaWizard } from '@/components/onboarding/persona-wizard'

export default async function OnboardingPage(): Promise<React.JSX.Element> {
  const session = await auth()
  if (!session?.user) redirect('/')
  const profile = await getPersonaProfile()
  if (profile) redirect('/')

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-4xl font-bold">Set up your creator profile</h1>
      <PersonaWizard />
    </main>
  )
}
