import { useMemo, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CURRENT_SEASON, type LeagueSummary } from '../providers/types'
import { sleeperProvider } from '../providers/sleeperProvider'
import {
  DEMO_DRAFT_ID,
  DEMO_USER_ID,
  initDemoDraft,
} from '../providers/demoProvider'
import { useEspnBridge } from '../espn/useEspnBridge'
import { isEspnTransientRoomUrl, mapEspnLeague } from '../espn/mapEspn'
import { ESPN_PRACTICE_LOBBY_URL, espnTeamPageUrl, parseEspnRef, requestExitEspnPractice, requestOpenEspn } from '../espn/bridge'
import { useSiteBridge } from '../sites/useSiteBridge'
import { mapSiteLeague } from '../sites/mapSite'
import { parseSiteRef, requestOpenSite } from '../sites/bridge'
import type { SiteProviderId } from '../sites/types'
import { AccountButton } from '../components/AccountButton'
import { Select } from '../components/Select'
import { SavedLeaguesPanel } from '../components/SavedLeaguesPanel'
import { draftStatusLabel, playersHrefForSavedLeague, providerLabel, scoringLabel, openedLabel } from '../leagues/labels'
import { useSavedLeagues } from '../leagues/useSavedLeagues'
import { savedLeagueFrom, savedLeagueHref, savedLeagueKey, type SavedLeague } from '../leagues/savedLeagues'
import { useAuth } from '../supabase/AuthProvider'
import { saveProviderConnection } from '../supabase/cloudStore'
import './leagues.css'

const LAST_USER_KEY = 'draft-assistant:sleeper-username'
const LAST_ESPN_LEAGUE_KEY = 'draft-assistant:espn-league-id'
const LAST_YAHOO_LEAGUE_KEY = 'draft-assistant:yahoo-league-id'
const LAST_NFL_LEAGUE_KEY = 'draft-assistant:nfl-league-id'

type Pane = { type: 'league'; key: string } | { type: 'add' } | { type: 'demo' } | { type: 'empty' }

function statusRank(league: LeagueSummary) {
  if (league.draftStatus === 'drafting') return 0
  if (league.draftStatus === 'paused') return 1
  if (league.draftStatus === 'pre_draft') return 2
  return 3
}

function firstLeaguePane(leagues: SavedLeague[]): Pane {
  const first = leagues[0]
  return first ? { type: 'league', key: savedLeagueKey(first) } : { type: 'empty' }
}

export function ConnectPage() {
  const navigate = useNavigate()
  const [username, setUsername] = useState(
    () => localStorage.getItem(LAST_USER_KEY) ?? '',
  )
  const [season, setSeason] = useState(CURRENT_SEASON)
  const [loading, setLoading] = useState(false)
  const [demoLoading, setDemoLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const [userId, setUserId] = useState<string | null>(null)
  const [leagues, setLeagues] = useState<LeagueSummary[] | null>(null)
  const [espnLeagueId, setEspnLeagueId] = useState(
    () => localStorage.getItem(LAST_ESPN_LEAGUE_KEY) ?? '',
  )
  const [connectTab, setConnectTab] = useState<'sleeper' | 'espn' | 'yahoo' | 'nfl'>('sleeper')
  const [query, setQuery] = useState('')
  const { installed: espnInstalled, snapshot: espnSnapshot } = useEspnBridge()
  const yahooBridge = useSiteBridge('yahoo')
  const nflBridge = useSiteBridge('nfl')
  const [yahooLeagueId, setYahooLeagueId] = useState(() => localStorage.getItem(LAST_YAHOO_LEAGUE_KEY) ?? '')
  const [nflLeagueId, setNflLeagueId] = useState(() => localStorage.getItem(LAST_NFL_LEAGUE_KEY) ?? '')
  const { leagues: savedLeagues, remember, forget } = useSavedLeagues()
  const auth = useAuth()
  const [pane, setPane] = useState<Pane>(() => firstLeaguePane(savedLeagues))

  const espnLeague = useMemo(() => {
    if (!espnSnapshot?.league) return null
    try {
      return mapEspnLeague(espnSnapshot)
    } catch {
      return null
    }
  }, [espnSnapshot])

  const yahooLeague = useMemo(() => {
    if (!yahooBridge.snapshot?.league) return null
    try { return mapSiteLeague(yahooBridge.snapshot) } catch { return null }
  }, [yahooBridge.snapshot])

  const nflLeague = useMemo(() => {
    if (!nflBridge.snapshot?.league) return null
    try { return mapSiteLeague(nflBridge.snapshot) } catch { return null }
  }, [nflBridge.snapshot])

  const sortedLeagues = useMemo(() => {
    if (!leagues) return []
    return [...leagues].sort((a, b) => statusRank(a) - statusRank(b))
  }, [leagues])

  const visibleSaved = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return savedLeagues
    return savedLeagues.filter((league) =>
      `${league.name} ${league.teamName ?? ''} ${league.provider}`.toLowerCase().includes(needle),
    )
  }, [query, savedLeagues])

  const view = pane.type === 'league' && !savedLeagues.some((league) => savedLeagueKey(league) === pane.key)
    ? firstLeaguePane(savedLeagues)
    : pane
  const selectedLeague = view.type === 'league'
    ? savedLeagues.find((league) => savedLeagueKey(league) === view.key) ?? null
    : null

  async function loadLeagues(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const trimmed = username.trim()
      if (!trimmed) {
        throw new Error('Enter a Sleeper username')
      }
      const result = await sleeperProvider.getLeagues(trimmed, season)
      localStorage.setItem(LAST_USER_KEY, trimmed)
      setDisplayName(result.user.displayName)
      setUserId(result.user.userId)
      setLeagues(result.leagues)
      void saveProviderConnection('sleeper', result.user.userId, result.user.displayName, null, { username: trimmed, season })
      if (result.leagues.length === 0) {
        setError(
          `No NFL leagues for ${season}. Try another season if this account has not joined yet.`,
        )
      }
    } catch (err) {
      setLeagues(null)
      setUserId(null)
      setDisplayName(null)
      setError(err instanceof Error ? err.message : 'Could not load leagues')
    } finally {
      setLoading(false)
    }
  }

  function pinSleeper(league: LeagueSummary, requireAuth: boolean) {
    if (!userId) {
      setError('Find leagues before saving a Sleeper seat.')
      return null
    }
    const saved = savedLeagueFrom('sleeper', league, userId, displayName)
    void saveProviderConnection('sleeper', userId, displayName, league.id, { season: league.season })
    if (auth.user) remember(saved)
    else if (requireAuth) setError('Sign in to pin this league.')
    return saved
  }

  function saveSleeperLeague(league: LeagueSummary) {
    const saved = pinSleeper(league, true)
    if (!saved || !auth.user) return
    setPane({ type: 'league', key: savedLeagueKey(saved) })
    setError(null)
  }

  function enterSleeperDraft(league: LeagueSummary) {
    if (!league.draftId || !userId) {
      setError('This league does not have a draft id yet.')
      return
    }
    if (!pinSleeper(league, false)) return
    navigate(
      `/draft/sleeper/${encodeURIComponent(league.draftId)}?userId=${encodeURIComponent(userId)}`,
    )
  }

  const espnAvailable = espnSnapshot?.availableLeagues ?? []

  function openEspn(raw?: string, page: 'home' | 'team' | 'practice' = 'team') {
    if (page === 'practice') {
      requestOpenEspn({ page: 'practice', url: ESPN_PRACTICE_LOBBY_URL })
      return
    }
    if (page === 'home' && !raw) {
      const saved = parseEspnRef(espnLeagueId)
      if (saved && !isEspnTransientRoomUrl(saved.url)) {
        requestOpenEspn({
          leagueId: saved.leagueId,
          season: saved.season,
          teamId: saved.teamId,
          url: espnTeamPageUrl(saved.leagueId, saved.season, saved.teamId),
          page: 'team',
        })
        return
      }
      requestOpenEspn({ page: 'home' })
      return
    }
    const parsed = parseEspnRef(raw ?? espnLeagueId)
    if (!parsed) {
      setError('Paste an ESPN team URL or a league ID.')
      return
    }
    setEspnLeagueId(parsed.url)
    localStorage.setItem(LAST_ESPN_LEAGUE_KEY, parsed.url)
    void saveProviderConnection('espn', parsed.teamId ?? parsed.leagueId, null, parsed.leagueId, { season: parsed.season, url: parsed.url })
    requestOpenEspn({
      leagueId: parsed.leagueId,
      season: parsed.season,
      teamId: parsed.teamId,
      url: parsed.url,
      page: 'team',
    })
  }

  function openSiteLeague(provider: SiteProviderId, raw?: string, page: 'home' | 'team' = 'team') {
    const stored = provider === 'yahoo' ? yahooLeagueId : nflLeagueId
    const storageKey = provider === 'yahoo' ? LAST_YAHOO_LEAGUE_KEY : LAST_NFL_LEAGUE_KEY
    if (page === 'home' && !raw) {
      requestOpenSite(provider, { page: 'home' })
      return
    }
    const parsed = parseSiteRef(provider, raw ?? stored)
    if (!parsed) {
      setError(provider === 'yahoo' ? 'Paste a Yahoo league URL or league ID.' : 'Paste an NFL.com league URL or league ID.')
      return
    }
    if (provider === 'yahoo') setYahooLeagueId(parsed.url)
    else setNflLeagueId(parsed.url)
    localStorage.setItem(storageKey, parsed.url)
    void saveProviderConnection(provider, parsed.teamId ?? parsed.leagueId, null, parsed.leagueId, { season: parsed.season, url: parsed.url })
    requestOpenSite(provider, {
      leagueId: parsed.leagueId,
      season: parsed.season,
      teamId: parsed.teamId,
      url: parsed.url,
      page: 'team',
    })
  }

  function enterSiteDraft(provider: SiteProviderId, teamId: string) {
    const snapshot = provider === 'yahoo' ? yahooBridge.snapshot : nflBridge.snapshot
    const league = provider === 'yahoo' ? yahooLeague : nflLeague
    if (!league?.draftId || !snapshot) return
    const team = league.teams?.find((item) => item.id === teamId)
    if (auth.user) remember(savedLeagueFrom(provider, league, teamId, team?.name ?? null))
    navigate(`/draft/${provider}/${encodeURIComponent(league.draftId)}?userId=${encodeURIComponent(teamId)}`)
  }

  function enterEspnDraft(teamId: string) {
    if (!espnLeague?.draftId) return
    const team = espnLeague.teams?.find((item) => item.id === teamId)
    if (auth.user && !espnLeague.isPractice) remember(savedLeagueFrom('espn', espnLeague, teamId, team?.name ?? null))
    navigate(
      `/draft/espn/${encodeURIComponent(espnLeague.draftId)}?userId=${encodeURIComponent(teamId)}`,
    )
  }

  async function startDemo() {
    setError(null)
    setDemoLoading(true)
    try {
      await sleeperProvider.getPlayers()
      initDemoDraft()
      navigate(
        `/draft/demo/${DEMO_DRAFT_ID}?userId=${encodeURIComponent(DEMO_USER_ID)}`,
      )
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Could not load NFL players for the demo',
      )
    } finally {
      setDemoLoading(false)
    }
  }

  function openSaved(league: SavedLeague) {
    remember({ ...league, lastOpenedAt: Date.now() })
  }

  const listMeta = savedLeagues.length
    ? `${savedLeagues.length} saved`
    : auth.user ? 'Nothing pinned yet' : 'Sign in to pin leagues'

  return (
    <div className="leagues-page">
      <header className="lg-topbar">
        <Link to="/" className="lg-brand"><span className="lg-mark">»</span>Draft Assistant</Link>
        <div className="lg-page-title"><small>Home</small><b>Leagues</b></div>
        <div className="lg-top-actions">
          <nav>
            <Link className="active" to="/">Leagues</Link>
            <Link to="/players">Players</Link>
            <Link to="/players#market">Rankings</Link>
          </nav>
          <AccountButton compact />
        </div>
      </header>

      <div className="lg-workspace">
        <aside className="lg-list">
          <div className="lg-list-head">
            <div className="lg-eyebrow">{CURRENT_SEASON} season</div>
            <h1>Leagues</h1>
            <p>{listMeta}</p>
          </div>
          {savedLeagues.length ? (
            <label className="lg-search">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Filter leagues…"
                aria-label="Filter leagues"
              />
            </label>
          ) : null}
          <div className="lg-rows">
            <SavedLeaguesPanel
              leagues={visibleSaved}
              selectedKey={view.type === 'league' ? view.key : null}
              onSelect={(league) => { setError(null); setPane({ type: 'league', key: savedLeagueKey(league) }) }}
            />
          </div>
          <div className="lg-list-foot">
            <button
              type="button"
              className={`lg-add-row ${view.type === 'add' ? 'on' : ''}`}
              onClick={() => { setError(null); setPane({ type: 'add' }) }}
            >
              + Add league
              <span>Sleeper or ESPN</span>
            </button>
            <button
              type="button"
              className={`lg-demo-row ${view.type === 'demo' ? 'on' : ''}`}
              onClick={() => { setError(null); setPane({ type: 'demo' }) }}
            >
              Demo draft
              <span>No league needed</span>
            </button>
          </div>
        </aside>

        <main className="lg-main">
          {view.type === 'add' ? (
            <AddPane
              connectTab={connectTab}
              setConnectTab={setConnectTab}
              username={username}
              setUsername={setUsername}
              season={season}
              setSeason={setSeason}
              loading={loading}
              loadLeagues={loadLeagues}
              displayName={displayName}
              sortedLeagues={sortedLeagues}
              enterSleeperDraft={enterSleeperDraft}
              saveSleeperLeague={saveSleeperLeague}
              espnInstalled={espnInstalled}
              espnLeague={espnLeague}
              espnSnapshotError={espnSnapshot?.error ?? null}
              espnPageUrl={espnSnapshot?.pageUrl}
              espnAvailable={espnAvailable}
              espnLeagueId={espnLeagueId}
              setEspnLeagueId={setEspnLeagueId}
              openEspn={openEspn}
              enterEspnDraft={enterEspnDraft}
              yahooInstalled={yahooBridge.installed}
              yahooLeague={yahooLeague}
              yahooError={yahooBridge.snapshot?.error ?? null}
              yahooPageUrl={yahooBridge.snapshot?.pageUrl}
              yahooAvailable={yahooBridge.snapshot?.availableLeagues ?? []}
              yahooLeagueId={yahooLeagueId}
              setYahooLeagueId={setYahooLeagueId}
              nflInstalled={nflBridge.installed}
              nflLeague={nflLeague}
              nflError={nflBridge.snapshot?.error ?? null}
              nflPageUrl={nflBridge.snapshot?.pageUrl}
              nflAvailable={nflBridge.snapshot?.availableLeagues ?? []}
              nflLeagueId={nflLeagueId}
              setNflLeagueId={setNflLeagueId}
              openSiteLeague={openSiteLeague}
              enterSiteDraft={enterSiteDraft}
              error={error}
            />
          ) : view.type === 'demo' ? (
            <section className="lg-pane">
              <div className="lg-kicker"><span className="lg-eyebrow">Practice room</span><span className="muted">No league connected</span></div>
              <h2>Try the draft room first</h2>
              <p className="lg-sub">12-team PPR snake · built-in ranks · demo controls</p>
              <p className="lg-note">Use this to learn the board, queue, and recs before connecting a real league.</p>
              <div className="lg-actions">
                <button type="button" className="lg-primary" onClick={() => void startDemo()} disabled={demoLoading}>
                  {demoLoading ? 'Starting demo…' : 'Start demo draft'}
                </button>
              </div>
              {error ? <p className="lg-error">{error}</p> : null}
            </section>
          ) : selectedLeague ? (
            <LeaguePane
              league={selectedLeague}
              onOpen={openSaved}
              onForget={() => forget(selectedLeague)}
            />
          ) : (
            <section className="lg-pane">
              <div className="lg-kicker"><span className="lg-eyebrow">No saved leagues</span></div>
              <h2>Connect a draft to sit next to.</h2>
              <p className="lg-note">{auth.user
                ? 'Nothing is pinned yet. Add a Sleeper username or open ESPN, Yahoo, or NFL.com from the left rail. The next room you enter is saved to your account.'
                : 'Sign in to pin leagues. You can still open a draft for this session without an account.'}</p>
              <div className="lg-actions">
                <button type="button" className="lg-primary" onClick={() => setPane({ type: 'add' })}>Add a league</button>
                <button type="button" className="lg-ghost" onClick={() => setPane({ type: 'demo' })}>Try the demo</button>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  )
}

function LeaguePane({ league, onOpen, onForget }: {
  league: SavedLeague
  onOpen: (league: SavedLeague) => void
  onForget: () => void
}) {
  const href = savedLeagueHref(league)
  const provider = providerLabel(league.provider)
  return (
    <section className="lg-pane">
      <div className="lg-kicker">
        <span className="lg-eyebrow">Selected league</span>
        <span className={href ? 'ready' : 'muted'}>{href ? '● Draft ready' : '● No draft yet'}</span>
      </div>
      <h2>{league.name}</h2>
      <p className="lg-sub">
        <span className={`lg-provider ${league.provider}`}>{provider}</span>
        {league.season}
        <i />
        {scoringLabel(league)}
        {league.teamCount ? <><i />{league.teamCount} teams</> : null}
      </p>
      <div className="lg-actions">
        {href
          ? <Link className="lg-primary" to={href} onClick={() => onOpen(league)}>Open draft room</Link>
          : <button type="button" className="lg-primary" disabled>No draft yet</button>}
        <Link className="lg-ghost" to={playersHrefForSavedLeague(league)}>Players</Link>
        <button type="button" className="lg-quiet" onClick={onForget} aria-label={`Forget ${league.name}`}>Forget</button>
      </div>
      <div className="lg-facts">
        <div><small>Your team</small><b>{league.teamName || 'Seat remembered'}</b><span>Opens with this seat</span></div>
        <div><small>Scoring</small><b>{scoringLabel(league)}</b><span>{league.season} season</span></div>
        <div><small>Last opened</small><b>{openedLabel(league.lastOpenedAt).replace(/^Opened /, '')}</b><span>Most recent first</span></div>
        <div><small>Draft</small><b>{href ? 'Ready' : 'Missing'}</b><span>{href ? 'Room ready' : 'No draft id'}</span></div>
      </div>
      <p className="lg-note">
        {league.provider === 'sleeper'
          ? 'Sleeper stays read-only from the public API.'
          : `${providerLabel(league.provider)} syncs from the extension on your logged-in tab. No cookie paste.`}
        {' '}Rankings use the lists you already enabled.
      </p>
    </section>
  )
}

function AddPane({
  connectTab, setConnectTab, username, setUsername, season, setSeason, loading, loadLeagues,
  displayName, sortedLeagues, enterSleeperDraft, saveSleeperLeague, espnInstalled, espnLeague,
  espnSnapshotError, espnPageUrl, espnAvailable,   espnLeagueId, setEspnLeagueId, openEspn, enterEspnDraft,
  yahooInstalled, yahooLeague, yahooError, yahooPageUrl, yahooAvailable, yahooLeagueId, setYahooLeagueId,
  nflInstalled, nflLeague, nflError, nflPageUrl, nflAvailable, nflLeagueId, setNflLeagueId,
  openSiteLeague, enterSiteDraft, error,
}: {
  connectTab: 'sleeper' | 'espn' | 'yahoo' | 'nfl'
  setConnectTab: (tab: 'sleeper' | 'espn' | 'yahoo' | 'nfl') => void
  username: string
  setUsername: (value: string) => void
  season: string
  setSeason: (value: string) => void
  loading: boolean
  loadLeagues: (event: FormEvent) => void
  displayName: string | null
  sortedLeagues: LeagueSummary[]
  enterSleeperDraft: (league: LeagueSummary) => void
  saveSleeperLeague: (league: LeagueSummary) => void
  espnInstalled: boolean
  espnLeague: LeagueSummary | null
  espnSnapshotError: string | null
  espnPageUrl: string | undefined
  espnAvailable: { leagueId: string; name?: string | null }[]
  espnLeagueId: string
  setEspnLeagueId: (value: string) => void
  openEspn: (raw?: string, page?: 'home' | 'team' | 'practice') => void
  enterEspnDraft: (teamId: string) => void
  yahooInstalled: boolean
  yahooLeague: LeagueSummary | null
  yahooError: string | null
  yahooPageUrl: string | undefined
  yahooAvailable: { leagueId: string; name?: string }[]
  yahooLeagueId: string
  setYahooLeagueId: (value: string) => void
  nflInstalled: boolean
  nflLeague: LeagueSummary | null
  nflError: string | null
  nflPageUrl: string | undefined
  nflAvailable: { leagueId: string; name?: string }[]
  nflLeagueId: string
  setNflLeagueId: (value: string) => void
  openSiteLeague: (provider: SiteProviderId, raw?: string, page?: 'home' | 'team') => void
  enterSiteDraft: (provider: SiteProviderId, teamId: string) => void
  error: string | null
}) {
  return (
    <section className="lg-pane">
      <div className="lg-kicker">
        <span className="lg-eyebrow">New connection</span>
        <span className="muted">{connectTab === 'sleeper' ? 'Public API' : 'Extension'}</span>
      </div>
      <h2>Add a league</h2>
      <p className="lg-sub">Sleeper from a username. ESPN, Yahoo, and NFL.com from the tab you are logged into.</p>
      <div className="lg-seg four">
        <button type="button" className={connectTab === 'sleeper' ? 'on' : ''} onClick={() => setConnectTab('sleeper')}>Sleeper</button>
        <button type="button" className={connectTab === 'espn' ? 'on' : ''} onClick={() => setConnectTab('espn')}>ESPN</button>
        <button type="button" className={connectTab === 'yahoo' ? 'on' : ''} onClick={() => setConnectTab('yahoo')}>Yahoo</button>
        <button type="button" className={connectTab === 'nfl' ? 'on' : ''} onClick={() => setConnectTab('nfl')}>NFL.com</button>
      </div>

      {connectTab === 'sleeper' ? (
        <>
          <form className="lg-form" onSubmit={loadLeagues}>
            <label className="lg-field">
              <span>Username</span>
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="your-sleeper-name"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
            </label>
            <div className="lg-row2">
              <label className="lg-field">
                <span>Season</span>
                <Select value={season} onChange={(event) => setSeason(event.target.value)}>
                  <option value="2026">2026</option>
                  <option value="2025">2025</option>
                  <option value="2024">2024</option>
                </Select>
              </label>
              <div className="lg-field">
                <span>&nbsp;</span>
                <button type="submit" className="lg-primary" disabled={loading} style={{ minWidth: 0, width: '100%', height: 38, fontSize: 13 }}>
                  {loading ? 'Loading…' : 'Find leagues'}
                </button>
              </div>
            </div>
          </form>
          <p className="lg-help">Sleeper is read-only. You still make picks on the league site.</p>
          {sortedLeagues.length ? (
            <div className="lg-found">
              <h3>Found for {displayName ?? 'that username'}</h3>
              {sortedLeagues.map((league) => (
                <div className="lg-found-row" key={league.id}>
                  <div>
                    <b>{league.name}</b>
                    <small>{league.teamCount} teams · {scoringLabel(league)} · {draftStatusLabel(league)}</small>
                  </div>
                  {league.draftId
                    ? <button type="button" className="lg-mini" onClick={() => enterSleeperDraft(league)}>Enter</button>
                    : <span className="lg-status">No draft</span>}
                  <button type="button" className="lg-mini" onClick={() => saveSleeperLeague(league)}>Save</button>
                </div>
              ))}
            </div>
          ) : null}
        </>
      ) : connectTab === 'espn' ? (
        <EspnConnect
          installed={espnInstalled}
          league={espnLeague}
          error={espnSnapshotError}
          pageUrl={espnPageUrl}
          available={espnAvailable}
          leagueId={espnLeagueId}
          setLeagueId={setEspnLeagueId}
          onOpen={openEspn}
          onEnter={enterEspnDraft}
        />
      ) : (
        <SiteConnect
          provider={connectTab}
          installed={connectTab === 'yahoo' ? yahooInstalled : nflInstalled}
          league={connectTab === 'yahoo' ? yahooLeague : nflLeague}
          error={connectTab === 'yahoo' ? yahooError : nflError}
          pageUrl={connectTab === 'yahoo' ? yahooPageUrl : nflPageUrl}
          available={connectTab === 'yahoo' ? yahooAvailable : nflAvailable}
          leagueId={connectTab === 'yahoo' ? yahooLeagueId : nflLeagueId}
          setLeagueId={connectTab === 'yahoo' ? setYahooLeagueId : setNflLeagueId}
          onOpen={openSiteLeague}
          onEnter={enterSiteDraft}
        />
      )}

      {error ? <p className="lg-error">{error}</p> : null}
      <p className="lg-legal">
        Sleeper data is read-only and for non-commercial use. ESPN, Yahoo, and NFL.com sync from the tab you are logged into via the extension — no cookie paste. Rankings come from lists you import plus built-in Sleeper rank / ESPN draft rank.
      </p>
    </section>
  )
}

function extensionSteps(action: string) {
  return (
    <ol className="lg-steps">
      <li>Open <code>chrome://extensions</code> and turn on Developer mode.</li>
      <li>Load unpacked and select this repo&apos;s <code>extension</code> folder.</li>
      <li>Reload the extension if it was already loaded, refresh this tab, then {action}.</li>
    </ol>
  )
}

function EspnConnect({
  installed, league, error, pageUrl, available, leagueId, setLeagueId, onOpen, onEnter,
}: {
  installed: boolean
  league: LeagueSummary | null
  error: string | null
  pageUrl: string | undefined
  available: { leagueId: string; name?: string | null }[]
  leagueId: string
  setLeagueId: (value: string) => void
  onOpen: (raw?: string, page?: 'home' | 'team' | 'practice') => void
  onEnter: (teamId: string) => void
}) {
  if (!installed) return extensionSteps('use Open ESPN Fantasy')
  return (
    <div>
      <p className="lg-note">Open your ESPN team page or practice draft room while logged in. Paste the clubhouse URL if you already have it.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="lg-ghost lg-compact" onClick={() => onOpen(undefined, 'home')}>Open ESPN Fantasy</button>
        <button type="button" className="lg-ghost lg-compact" onClick={() => onOpen(undefined, 'practice')}>Open practice lobby</button>
      </div>
      <label className="lg-field" style={{ maxWidth: 460, marginTop: 14 }}>
        <span>Team URL or league ID</span>
        <input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} placeholder="https://fantasy.espn.com/football/team?leagueId=…" />
      </label>
      <button type="button" className="lg-mini" style={{ marginTop: 8 }} disabled={!leagueId.trim()} onClick={() => onOpen(leagueId, 'team')}>Open team</button>
      {error ? <p className="lg-error">{error}</p> : null}
      {available.length > 0 && !league ? (
        <div className="lg-teams">
          {available.map((item) => (
            <button key={item.leagueId} type="button" className="lg-team" onClick={() => onOpen(item.leagueId, 'team')}>
              <span>{item.name || `League ${item.leagueId}`}</span>
              <small>Open team</small>
            </button>
          ))}
        </div>
      ) : null}
      {!league && !error && available.length === 0 ? (
        <p className="lg-help">Stay logged into ESPN in Chrome. After the tab loads, this pane will list your leagues. For a practice draft, start it on ESPN first — the extension follows that new room.</p>
      ) : null}
      {league ? <DetectedLeague label="ESPN" league={league} onOpenTeam={() => onOpen(isEspnTransientRoomUrl(pageUrl) ? undefined : (pageUrl || league.id), isEspnTransientRoomUrl(pageUrl) ? 'home' : 'team')} onEnter={onEnter} onLeavePractice={requestExitEspnPractice} /> : null}
    </div>
  )
}

function SiteConnect({
  provider, installed, league, error, pageUrl, available, leagueId, setLeagueId, onOpen, onEnter,
}: {
  provider: SiteProviderId
  installed: boolean
  league: LeagueSummary | null
  error: string | null
  pageUrl: string | undefined
  available: { leagueId: string; name?: string }[]
  leagueId: string
  setLeagueId: (value: string) => void
  onOpen: (provider: SiteProviderId, raw?: string, page?: 'home' | 'team') => void
  onEnter: (provider: SiteProviderId, teamId: string) => void
}) {
  const label = provider === 'yahoo' ? 'Yahoo' : 'NFL.com'
  const placeholder = provider === 'yahoo'
    ? 'https://football.fantasysports.yahoo.com/f1/…'
    : 'https://fantasy.nfl.com/league/…'
  if (!installed) return extensionSteps(`use Open ${label}`)
  return (
    <div>
      <p className="lg-note">Open your {label} league while logged in. The extension reads that tab — no cookie paste.</p>
      <button type="button" className="lg-ghost lg-compact" onClick={() => onOpen(provider, undefined, 'home')}>Open {label}</button>
      <label className="lg-field" style={{ maxWidth: 460, marginTop: 14 }}>
        <span>League URL or ID</span>
        <input value={leagueId} onChange={(event) => setLeagueId(event.target.value)} placeholder={placeholder} />
      </label>
      <button type="button" className="lg-mini" style={{ marginTop: 8 }} disabled={!leagueId.trim()} onClick={() => onOpen(provider, leagueId, 'team')}>Open league</button>
      {error ? <p className="lg-error">{error}</p> : null}
      {available.length > 0 && !league ? (
        <div className="lg-teams">
          {available.map((item) => (
            <button key={item.leagueId} type="button" className="lg-team" onClick={() => onOpen(provider, item.leagueId, 'team')}>
              <span>{item.name || `League ${item.leagueId}`}</span>
              <small>Open league</small>
            </button>
          ))}
        </div>
      ) : null}
      {!league && !error && available.length === 0 ? (
        <p className="lg-help">Stay logged into {label} in Chrome. After the tab loads, this pane will list your leagues.</p>
      ) : null}
      {league ? <DetectedLeague label={label} league={league} onOpenTeam={() => onOpen(provider, pageUrl || league.id, 'team')} onEnter={(teamId) => onEnter(provider, teamId)} /> : null}
    </div>
  )
}

function DetectedLeague({
  label, league, onOpenTeam, onEnter, onLeavePractice,
}: {
  label: string
  league: LeagueSummary
  onOpenTeam: () => void
  onEnter: (teamId: string) => void
  onLeavePractice?: () => void
}) {
  return (
    <div>
      <div className="lg-facts" style={{ maxWidth: 460, gridTemplateColumns: '1fr 1fr 1fr' }}>
        <div><small>League</small><b>{league.name}</b><span>{label}</span></div>
        <div><small>Scoring</small><b>{scoringLabel(league)}</b><span>{league.teamCount} teams</span></div>
        <div><small>Draft</small><b>{draftStatusLabel(league)}</b><span>{league.draftId ? 'Room ready' : 'No draft id'}</span></div>
      </div>
      <button type="button" className="lg-ghost lg-compact" onClick={onOpenTeam}>Open league</button>
      {league.isPractice ? (
        <p className="lg-help">
          This is an ESPN practice or mock room, not your real draft. Picks here do not count.
          {onLeavePractice ? <>{' '}<button type="button" className="lg-mini" onClick={onLeavePractice}>Open my real league</button></> : null}
        </p>
      ) : null}
      <p className="lg-help" style={{ marginTop: 18, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', fontSize: 10, color: 'var(--lg-muted)' }}>Which team is yours?</p>
      <div className="lg-teams">
        {[...(league.teams ?? [])]
          .sort((a, b) => Number(b.isYou) - Number(a.isYou))
          .map((team) => (
            <button
              key={team.id}
              type="button"
              className={`lg-team ${team.isYou ? 'you' : ''}`}
              onClick={() => onEnter(team.id)}
              disabled={!league.draftId}
            >
              <span>{team.name}</span>
              <small style={team.isYou ? undefined : { color: 'var(--lg-muted)' }}>{team.isYou ? 'Detected' : 'Enter'}</small>
            </button>
          ))}
      </div>
    </div>
  )
}
