import { useCallback, useEffect, useState } from 'react'
import { fetchSavedLeagues, persistUserLeagues } from '../supabase/cloudStore'
import { useAuth } from '../supabase/AuthProvider'
import { removeSavedLeague, savedLeagueKey, upsertSavedLeague, type SavedLeague } from './savedLeagues'

/**
 * Account-backed league list. Unsigned visitors see an empty list; pinning
 * writes to Supabase, not this device.
 */
export function useSavedLeagues() {
  const auth = useAuth()
  const [accountLeagues, setAccountLeagues] = useState<SavedLeague[]>([])
  const leagues = auth.user ? accountLeagues : []

  useEffect(() => {
    if (!auth.user) return
    let cancelled = false
    void fetchSavedLeagues().then((rows) => { if (!cancelled) setAccountLeagues(rows) })
    const reload = () => { void fetchSavedLeagues().then((rows) => { if (!cancelled) setAccountLeagues(rows) }) }
    window.addEventListener('draft-assistant:cloud-synced', reload)
    return () => {
      cancelled = true
      window.removeEventListener('draft-assistant:cloud-synced', reload)
    }
  }, [auth.user])

  const remember = useCallback((league: SavedLeague) => {
    if (!auth.user) return
    setAccountLeagues((current) => {
      const next = upsertSavedLeague(current, league)
      void persistUserLeagues(next)
      return next
    })
  }, [auth.user])

  const forget = useCallback((league: SavedLeague | string) => {
    if (!auth.user) return
    const key = typeof league === 'string' ? league : savedLeagueKey(league)
    setAccountLeagues((current) => {
      const next = removeSavedLeague(current, key)
      void persistUserLeagues(next)
      return next
    })
  }, [auth.user])

  return { leagues, remember, forget }
}
