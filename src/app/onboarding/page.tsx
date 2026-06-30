import { PersonaWizard } from '@/components/onboarding/persona-wizard'

export default function OnboardingPage(): React.JSX.Element {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-8 p-8">
      <h1 className="text-4xl font-bold">Set up your creator profile</h1>
      <PersonaWizard />
    </main>
  )
}
