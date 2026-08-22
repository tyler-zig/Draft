import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { AccountButton } from './AccountButton'
import * as auth from '../supabase/AuthProvider'

function submitSignIn() {
  const buttons = screen.getAllByRole('button', { name: 'Sign in' })
  return buttons[buttons.length - 1]!
}

function stubAuth(overrides: Partial<ReturnType<typeof auth.useAuth>> = {}) {
  const value = {
    configured: true, ready: true, syncing: false, session: null, user: null, error: null,
    signInWithEmail: vi.fn(async () => {}),
    signInWithPassword: vi.fn(async () => {}),
    signUpWithPassword: vi.fn(async () => ({ needsConfirmation: false })),
    sendPasswordReset: vi.fn(async () => {}),
    signOut: vi.fn(async () => {}),
    ...overrides,
  }
  vi.spyOn(auth, 'useAuth').mockReturnValue(value)
  return value
}

describe('AccountButton', () => {
  it('disables sign-in when Supabase is not configured', () => {
    render(<AccountButton />)
    const button = screen.getByRole('button', { name: 'Sign in' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('title', expect.stringContaining('VITE_SUPABASE_URL'))
  })

  it('signs in with a password by default', async () => {
    const value = stubAuth()
    const user = userEvent.setup()
    render(<AccountButton />)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.type(screen.getByLabelText('Email'), 'drafter@example.com')
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2')
    await user.click(submitSignIn())
    expect(value.signInWithPassword).toHaveBeenCalledWith('drafter@example.com', 'hunter2hunter2')
  })

  it('tells a new account to confirm its email instead of pretending it is signed in', async () => {
    const value = stubAuth({ signUpWithPassword: vi.fn(async () => ({ needsConfirmation: true })) })
    const user = userEvent.setup()
    render(<AccountButton />)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.click(screen.getByRole('button', { name: 'Create an account' }))
    await user.type(screen.getByLabelText('Email'), 'new@example.com')
    await user.type(screen.getByLabelText('Password'), 'hunter2hunter2')
    await user.click(screen.getByRole('button', { name: 'Create account' }))
    expect(value.signUpWithPassword).toHaveBeenCalled()
    expect(await screen.findByText(/Check your email to confirm/)).toBeInTheDocument()
  })

  it('still offers the magic link', async () => {
    const value = stubAuth()
    const user = userEvent.setup()
    render(<AccountButton />)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.click(screen.getByRole('button', { name: 'Email a link instead' }))
    await user.type(screen.getByLabelText('Email'), 'drafter@example.com')
    await user.click(screen.getByRole('button', { name: 'Send sign-in link' }))
    expect(value.signInWithEmail).toHaveBeenCalledWith('drafter@example.com')
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('reports a failed sign-in rather than swallowing it', async () => {
    stubAuth({ signInWithPassword: vi.fn(async () => { throw new Error('Invalid login credentials') }) })
    const user = userEvent.setup()
    render(<AccountButton />)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await user.type(screen.getByLabelText('Email'), 'drafter@example.com')
    await user.type(screen.getByLabelText('Password'), 'wrongpassword')
    await user.click(submitSignIn())
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid login credentials')
  })

  it('offers sign-out when signed in', async () => {
    const value = stubAuth({ user: { id: 'u1', email: 'drafter@example.com' } as never, syncing: true })
    const user = userEvent.setup()
    render(<AccountButton />)
    await user.click(screen.getByRole('button', { name: 'drafter@example.com' }))
    const panel = screen.getByText('Loading your leagues…').parentElement as HTMLElement
    await user.click(within(panel).getByRole('button', { name: 'Sign out' }))
    expect(value.signOut).toHaveBeenCalled()
  })
})
