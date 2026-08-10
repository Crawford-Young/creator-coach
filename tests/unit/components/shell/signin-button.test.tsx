import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { signIn } from 'next-auth/react'
import { SigninButton } from '@/components/shell/signin-button'

vi.mock('next-auth/react', () => ({ signIn: vi.fn().mockResolvedValue(undefined) }))

const mockSignIn = vi.mocked(signIn)

beforeEach(() => mockSignIn.mockClear())

describe('SigninButton', () => {
  it('renders a button inviting the user to continue with Twitch', () => {
    render(<SigninButton />)

    expect(screen.getByRole('button', { name: /continue with twitch/i })).toBeInTheDocument()
  })

  it('calls signIn("twitch") with a redirect target on click', async () => {
    const user = userEvent.setup()
    render(<SigninButton />)

    await user.click(screen.getByRole('button', { name: /continue with twitch/i }))

    expect(mockSignIn).toHaveBeenCalledWith('twitch', { redirectTo: '/' })
  })
})
