// oxlint-disable react/only-export-components
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { hydrateCloudState } from './cloudStore'
import { supabase, supabaseConfigured } from './client'

interface AuthValue {
  configured: boolean
  ready: boolean
  syncing: boolean
  session: Session | null
  user: User | null
  error: string | null
  /** Passwordless: emails a one-time sign-in link. */
  signInWithEmail(email: string): Promise<void>
  signInWithPassword(email: string, password: string): Promise<void>
  /** Returns true when Supabase requires the address to be confirmed first. */
  signUpWithPassword(email: string, password: string): Promise<{ needsConfirmation: boolean }>
  sendPasswordReset(email: string): Promise<void>
  signOut(): Promise<void>
}

const localOnlyAuth: AuthValue = {
  configured: false, ready: true, syncing: false, session: null, user: null, error: null,
  async signInWithEmail() { throw new Error('Supabase is not configured') },
  async signInWithPassword() { throw new Error('Supabase is not configured') },
  async signUpWithPassword() { throw new Error('Supabase is not configured') },
  async sendPasswordReset() { throw new Error('Supabase is not configured') },
  async signOut() {},
}
const AuthContext = createContext<AuthValue>(localOnlyAuth)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(!supabaseConfigured)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!supabase) return
    let active = true
    async function accept(next: Session | null) {
      if (!active) return
      setSession(next)
      if (next?.user) {
        setSyncing(true)
        await hydrateCloudState(next.user.id)
        if (active) setSyncing(false)
      }
      if (active) setReady(true)
    }
    void supabase.auth.getSession().then(({ data, error: authError }) => {
      if (authError && active) setError(authError.message)
      return accept(data.session)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => { void accept(next) })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])

  const value = useMemo<AuthValue>(() => ({
    configured: supabaseConfigured,
    ready,
    syncing,
    session,
    user: session?.user ?? null,
    error,
    async signInWithEmail(email) {
      if (!supabase) throw new Error('Supabase is not configured')
      setError(null)
      const { error: authError } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: window.location.origin } })
      if (authError) { setError(authError.message); throw authError }
    },
    async signInWithPassword(email, password) {
      if (!supabase) throw new Error('Supabase is not configured')
      setError(null)
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
      if (authError) { setError(authError.message); throw authError }
    },
    async signUpWithPassword(email, password) {
      if (!supabase) throw new Error('Supabase is not configured')
      setError(null)
      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      })
      if (authError) { setError(authError.message); throw authError }
      // With email confirmation on, sign-up returns a user but no session --
      // treating that as signed in would strand the account on a blank screen.
      return { needsConfirmation: Boolean(data.user) && !data.session }
    },
    async sendPasswordReset(email) {
      if (!supabase) throw new Error('Supabase is not configured')
      setError(null)
      const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin,
      })
      if (authError) { setError(authError.message); throw authError }
    },
    async signOut() {
      if (!supabase) return
      const { error: authError } = await supabase.auth.signOut()
      if (authError) { setError(authError.message); throw authError }
    },
  }), [error, ready, session, syncing])

  if (!ready) return <div className="grid min-h-screen place-items-center bg-bg text-muted">Loading your draft data…</div>
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  return useContext(AuthContext)
}
