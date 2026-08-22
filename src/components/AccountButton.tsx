import { useState, type FormEvent } from 'react'
import { useAuth } from '../supabase/AuthProvider'

type Mode = 'password' | 'signup' | 'link' | 'reset'

const TITLES: Record<Mode, string> = {
  password: 'Sign in',
  signup: 'Create an account',
  link: 'Email me a link',
  reset: 'Reset your password',
}

const SUBMIT: Record<Mode, string> = {
  password: 'Sign in',
  signup: 'Create account',
  link: 'Send sign-in link',
  reset: 'Send reset link',
}

const field = 'mt-1 w-full rounded-md border border-line bg-bg px-3 py-2 text-sm'
const label = 'mt-3 block text-[11px] font-semibold uppercase tracking-wide text-muted'
const linkButton = 'text-[11px] text-muted underline underline-offset-2'

export function AccountButton({ compact = false }: { compact?: boolean }) {
  const auth = useAuth()
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  if (!auth.configured) return <button type="button" disabled title="Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to enable accounts" className="rounded-md border border-line px-2.5 py-1.5 text-xs text-muted disabled:cursor-help disabled:opacity-70">Sign in</button>

  function switchTo(next: Mode) {
    setMode(next); setNotice(null); setMessage(null)
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setMessage(null); setNotice(null)
    const address = email.trim()
    try {
      if (mode === 'password') await auth.signInWithPassword(address, password)
      else if (mode === 'signup') {
        const { needsConfirmation } = await auth.signUpWithPassword(address, password)
        setNotice(needsConfirmation ? 'Check your email to confirm the account, then sign in.' : 'Account created — you are signed in.')
      }
      else if (mode === 'link') { await auth.signInWithEmail(address); setNotice('Check your email for the secure sign-in link.') }
      else { await auth.sendPasswordReset(address); setNotice('Check your email for a password reset link.') }
      if (mode !== 'signup') setPassword('')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not complete that request')
    } finally {
      setBusy(false)
    }
  }

  if (auth.user) return <div className="relative">
    <button type="button" onClick={() => setOpen((value) => !value)} className="max-w-44 truncate rounded-md border border-line px-2.5 py-1.5 text-xs text-muted" title={auth.user.email}>{compact ? 'Account' : auth.user.email ?? 'Account'}</button>
    {open ? <div className="absolute right-0 top-full z-[120] mt-2 w-64 rounded-lg border border-line bg-panel p-3 shadow-2xl">
      <p className="m-0 truncate text-xs text-muted">{auth.user.email}</p>
      <p className="mt-1 text-[11px] text-muted">{auth.syncing ? 'Loading your leagues…' : 'Signed in'}</p>
      <button type="button" className="mt-3 w-full rounded-md border border-line px-3 py-2 text-xs" onClick={() => void auth.signOut()}>Sign out</button>
    </div> : null}
  </div>

  return <div className="relative">
    <button type="button" onClick={() => setOpen((value) => !value)} className="rounded-md border border-line px-2.5 py-1.5 text-xs text-muted">Sign in</button>
    {open ? <div className="absolute right-0 top-full z-[120] mt-2 w-72 rounded-lg border border-line bg-panel p-4 text-left shadow-2xl">
      <h2 className="m-0 text-sm font-semibold">{TITLES[mode]}</h2>
      <p className="mt-1 text-[11px] leading-4 text-muted">Pin leagues, keepers, and rankings to this account.</p>

      <form onSubmit={submit}>
        <label className={label}>Email
          <input type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={field} />
        </label>
        {mode === 'password' || mode === 'signup' ? <label className={label}>Password
          <input
            type="password"
            required
            minLength={8}
            autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={field}
          />
        </label> : null}
        {mode === 'signup' ? <p className="mt-1 text-[10px] text-muted">At least 8 characters.</p> : null}
        <button type="submit" disabled={busy} className="mt-3 w-full rounded-md bg-accent px-3 py-2 text-xs font-semibold text-black disabled:opacity-60">{busy ? 'Working…' : SUBMIT[mode]}</button>
      </form>

      <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1">
        {mode !== 'password' ? <button type="button" className={linkButton} onClick={() => switchTo('password')}>Sign in with password</button> : null}
        {mode !== 'signup' ? <button type="button" className={linkButton} onClick={() => switchTo('signup')}>Create an account</button> : null}
        {mode !== 'link' ? <button type="button" className={linkButton} onClick={() => switchTo('link')}>Email a link instead</button> : null}
        {mode === 'password' ? <button type="button" className={linkButton} onClick={() => switchTo('reset')}>Forgot password</button> : null}
      </div>

      {notice ? <p className="mt-2 text-xs leading-5 text-muted">{notice}</p> : null}
      {message || auth.error ? <p role="alert" className="mt-2 text-xs text-red-400">{message ?? auth.error}</p> : null}
    </div> : null}
  </div>
}
