import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getProvider } from '../providers'
import { DEMO_DRAFT_ID, demoPick, demoProvider, demoTick, initDemoDraft } from '../providers/demoProvider'
import { recommendPicks, suggestionSet } from '../draft/recommend'
import { fillRoster } from '../draft/rosterNeeds'
import { byeWeekDistribution, formatByePositions } from '../draft/byeWeeks'
import { livePickNumber, nextPickNumberForSlot, ownerSlotForPick, picksUntilSlot } from '../draft/snake'
import { loadQueue, moveQueueItem, resolveQueuePlayerIds, saveQueue, subscribeQueue } from '../draft/queue'
import { keeperPicks, keeperStorageKey, loadKeepers, loadKeepersCostRoundPicks, mergeKeepers, occupiedPickNumbers, saveKeepers, saveKeepersCostRoundPicks, withKeeperPicks } from '../draft/keepers'
import { draftFrontier, normalizePickSlots } from '../draft/pickSlots'
import { clearMockLeagueSeed, loadMockLeagueSeed, mockTemplateFrom, saveMockLeagueSeed } from '../draft/mockLeague'
import { playerDraftContext } from '../draft/playerContext'
import { clearCurrentDraft, playerIntelligenceHrefForSession, saveCurrentDraft } from '../draft/currentDraft'
import { PlayerTable, isBoardPositionFilter, type PositionFilter } from '../components/PlayerTable'
import { DraftBoard } from '../components/DraftBoard'
import { TeamLogo } from '../components/TeamLogo'
import { BestAvailable } from '../components/BestAvailable'
import { PlayerPhoto } from '../components/PlayerPhoto'
import { KeeperPanel } from '../components/KeeperPanel'
import { RankingsSheet } from '../components/RankingsSheet'
import { SettingsSheet, type MockDraftSettings } from '../components/SettingsSheet'
import { DraftGrades } from '../components/DraftGrades'
import { AppScreen } from '../components/ui'
import { Select } from '../components/Select'
import { useEspnBridge } from '../espn/useEspnBridge'
import { espnDraftId, isEspnPracticeSnapshot, mapEspnKeeperCandidates, parseEspnDraftId, shouldFollowEspnSnapshot } from '../espn/mapEspn'
import { publishEspnValuations, requestExitEspnPractice, requestOpenEspn } from '../espn/bridge'
import { useSiteBridge } from '../sites/useSiteBridge'
import { parseSiteDraftId, siteDraftId } from '../sites/mapSite'
import { requestOpenSite } from '../sites/bridge'
import type { SiteProviderId } from '../sites/types'
import { builtinSet, applyConsensusRanks } from '../rankings/consensus'
import { applyLiveAdp, liveAdpQuery } from '../rankings/liveAdp'
import { buildValuations } from '../extension/playerValuations'
import { loadImportedSets, loadRankSettings } from '../rankings/store'
import { loadDraftSounds, loadTableColumns, loadTheme, saveDraftSounds, saveTableColumns, saveTheme, type AppTheme, type TableColumnKey } from '../preferences'
import { formatPickClock, remainingPickSeconds } from '../draft/clock'
import { useDraftSounds } from '../draft/sounds'
import { sleeperProvider } from '../providers/sleeperProvider'
import { DEFAULT_PLAYOFF_WEEKS } from '../providers/types'
import type { DraftPick, DraftSession, KeeperEntry, Player, ScoringType } from '../providers/types'
import type { RankSet } from '../rankings/types'
import { CHOPPED_EARLY_WEEKS } from '../draft/chopped'
import { attachPlayoffSos, attachProjectedPoints, applyScheduleByes, enrichPlayersWithDirectory } from '../intelligence/players'
import { attachProjectedAdp, getNflProjections, projectionPointsPool, projectionSeason } from '../api/playerProjections'
import { getPublishedSchedule, getPublishedScheduleModel } from '../api/playerHistorical'
import { withVorp } from '../draft/vorp'
import { AccountButton } from '../components/AccountButton'
import './command-center.css'

const EMPTY_PLAYERS: Player[] = []
const EMPTY_PICKS: DraftPick[] = []
const EMPTY_KEEPERS: KeeperEntry[] = []

/**
 * Shown in the room header because it is load-bearing and was invisible:
 * scoring picks the expert board, drives projections and VORP, and decides
 * which market ADP comes from. When it reads "Scoring n/a" those all fall back
 * to a blend across formats, and nothing on screen said so.
 */
function scoringLabel(scoring: ScoringType) {
  if (scoring === 'ppr') return 'PPR'
  if (scoring === 'half_ppr') return 'Half PPR'
  if (scoring === 'std') return 'Standard'
  return 'Scoring n/a'
}
const positionClass = (position: string) => `cc-${position.toLowerCase().replace('/', '')}`

function useNow(enabled: boolean, intervalMs = 250) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!enabled) return
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [enabled, intervalMs])
  return now
}

export function DraftRoom() {
  const navigate = useNavigate()
  const { providerId, draftId } = useParams()
  const [params] = useSearchParams()
  const userId = params.get('userId') ?? ''
  const [rankTick, setRankTick] = useState(0)
  const [importedSets, setImportedSets] = useState<RankSet[]>([])
  const [rankSettings, setRankSettings] = useState(loadRankSettings)
  const [theme, setTheme] = useState<AppTheme>(loadTheme)
  const [draftSounds, setDraftSounds] = useState(loadDraftSounds)
  const [visibleColumns, setVisibleColumns] = useState<TableColumnKey[]>(loadTableColumns)
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null)
  // A real pick is irreversible, and PlayerTable drafts on double-click. So a
  // provider write is staged here and only leaves on an explicit confirm.
  const [pendingPick, setPendingPick] = useState<{ playerId: string; pickNo: number } | null>(null)
  const [submittingPick, setSubmittingPick] = useState(false)
  const [pickError, setPickError] = useState<string | null>(null)
  const [queueOpen, setQueueOpen] = useState(false)
  const [fullBoardOpen, setFullBoardOpen] = useState(false)
  const [boardRound, setBoardRound] = useState<number | null>(null)
  const [rankingsOpen, setRankingsOpen] = useState(false)
  const [gradesOpen, setGradesOpen] = useState(false)
  const [keepersOpen, setKeepersOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewedSlot, setViewedSlot] = useState<number | null>(null)
  const [summaryView, setSummaryView] = useState<'positions' | 'byes'>('positions')
  const [positionFilter, setPositionFilter] = useState<PositionFilter>('ALL')
  const [mockSpeed, setMockSpeed] = useState<'slow' | 'normal' | 'fast'>('normal')
  const [mockTeams, setMockTeams] = useState(12)
  const [mockRounds, setMockRounds] = useState(15)
  const [mockYourSlot, setMockYourSlot] = useState(5)
  const [mockScoring, setMockScoring] = useState<ScoringType>('ppr')
  const [mockReach, setMockReach] = useState(50)
  const [mockAutoPick, setMockAutoPick] = useState(true)
  const queryClient = useQueryClient()
  const { hydrated: espnHydrated, snapshot: espnSnapshot, refresh: refreshEspn } = useEspnBridge()
  const yahooBridge = useSiteBridge('yahoo')
  const nflBridge = useSiteBridge('nfl')
  const siteId = providerId === 'yahoo' || providerId === 'nfl' ? providerId : null
  const siteBridge = siteId === 'yahoo' ? yahooBridge : siteId === 'nfl' ? nflBridge : null
  const provider = useMemo(() => { try { return providerId ? getProvider(providerId) : null } catch { return null } }, [providerId])

  const queueKey = `${providerId}:${draftId}`
  const [queueBag, setQueueBag] = useState(() => ({ key: queueKey, ids: loadQueue(queueKey) }))
  if (queueBag.key !== queueKey) setQueueBag({ key: queueKey, ids: loadQueue(queueKey) })
  const queuedIds = queueBag.key === queueKey ? queueBag.ids : loadQueue(queueKey)
  function setQueuedIds(ids: string[] | ((previous: string[]) => string[])) {
    const next = typeof ids === 'function' ? ids(queuedIds) : ids
    saveQueue(queueKey, next); setQueueBag({ key: queueKey, ids: next })
  }
  useEffect(() => subscribeQueue(queueKey, (ids) => setQueueBag({ key: queueKey, ids })), [queueKey])

  const keeperKey = keeperStorageKey(providerId, draftId)
  const [keeperBag, setKeeperBag] = useState(() => ({ key: keeperKey, entries: loadKeepers(keeperKey) }))
  if (keeperBag.key !== keeperKey) setKeeperBag({ key: keeperKey, entries: loadKeepers(keeperKey) })
  const storedKeepers = keeperBag.key === keeperKey ? keeperBag.entries : loadKeepers(keeperKey)
  function setStoredKeepers(entries: KeeperEntry[]) {
    saveKeepers(keeperKey, entries); setKeeperBag({ key: keeperKey, entries })
  }
  const [costBag, setCostBag] = useState(() => ({ key: keeperKey, value: loadKeepersCostRoundPicks(keeperKey) }))
  if (costBag.key !== keeperKey) setCostBag({ key: keeperKey, value: loadKeepersCostRoundPicks(keeperKey) })
  const keepersCostRoundPicks = costBag.key === keeperKey ? costBag.value : loadKeepersCostRoundPicks(keeperKey)
  function setKeepersCostRoundPicks(value: boolean) {
    saveKeepersCostRoundPicks(keeperKey, value)
    setCostBag({ key: keeperKey, value })
  }

  useEffect(() => {
    if (providerId !== 'espn') return
    void queryClient.invalidateQueries({ queryKey: ['draft', 'espn'] })
    void queryClient.invalidateQueries({ queryKey: ['picks', 'espn'] })
    void queryClient.invalidateQueries({ queryKey: ['players', 'espn'] })
    void queryClient.invalidateQueries({ queryKey: ['keepers', 'espn'] })
  }, [espnSnapshot, providerId, queryClient])
  useEffect(() => {
    if (providerId !== 'espn' || !draftId || !espnSnapshot?.league) return
    if (!shouldFollowEspnSnapshot(draftId, espnSnapshot)) return
    const liveId = espnDraftId(espnSnapshot.season || '2026', espnSnapshot.leagueId || '')
    const teamId = espnSnapshot.teamId || userId
    if (!teamId) return
    navigate(`/draft/espn/${encodeURIComponent(liveId)}?userId=${encodeURIComponent(teamId)}`, { replace: true })
  }, [providerId, draftId, espnSnapshot, userId, navigate])
  useEffect(() => {
    if (!siteId) return
    void queryClient.invalidateQueries({ queryKey: ['draft', siteId] })
    void queryClient.invalidateQueries({ queryKey: ['picks', siteId] })
    void queryClient.invalidateQueries({ queryKey: ['players', siteId] })
  }, [siteBridge?.snapshot, siteId, queryClient])

  const sleeperPlayersQuery = useQuery({ queryKey: ['players', 'sleeper'], queryFn: () => sleeperProvider.getPlayers(), staleTime: 86_400_000 })
  const espnSnapshotMatchesRoute = Boolean(
    espnSnapshot?.league &&
    draftId === espnDraftId(espnSnapshot.season || '2026', espnSnapshot.leagueId || ''),
  )
  const espnReady = providerId !== 'espn' || espnSnapshotMatchesRoute
  const siteReady = !siteId || Boolean(
    siteBridge?.snapshot?.league &&
    draftId === siteDraftId(siteBridge.snapshot.season || '2026', siteBridge.snapshot.leagueId || ''),
  )
  const roomReady = espnReady && siteReady
  const liveSite = providerId === 'espn' || Boolean(siteId)
  const playersQuery = useQuery({ queryKey: ['players', providerId, draftId], queryFn: () => provider!.getPlayers(draftId), enabled: Boolean(provider && roomReady), staleTime: liveSite ? 2000 : 86_400_000 })
  // Same reason as the picks query below: this one carries `status` and the
  // pick clock, so a hidden tab must not stop reading it either.
  const draftQuery = useQuery({ queryKey: ['draft', providerId, draftId, userId], queryFn: () => provider!.getDraft(draftId!, userId), enabled: Boolean(provider && draftId && userId && roomReady), refetchInterval: (query) => query.state.data?.status === 'complete' ? false : liveSite || providerId === 'sleeper' ? 2000 : 4000, refetchIntervalInBackground: true, refetchOnWindowFocus: true })
  const session = draftQuery.data
  const espnLiveClock = providerId === 'espn' && espnSnapshotMatchesRoute ? espnSnapshot?.clock : null
  const sleeperLiveClock = session?.clockEndsAt != null
    ? { remaining: 0, endsAt: session.clockEndsAt, paused: Boolean(session.clockPaused) }
    : null
  const liveClock = espnLiveClock ?? sleeperLiveClock
  const clockNow = useNow(Boolean(liveClock && !liveClock.paused && liveClock.endsAt))
  const clockSeconds = remainingPickSeconds(liveClock, clockNow)
  // `refetchIntervalInBackground` is the difference between a board that keeps
  // up and one that is frozen. React Query only fires a `refetchInterval` while
  // `document.visibilityState !== 'hidden'` unless this is set, and a draft
  // assistant is read from a *second tab* -- you make the pick on Sleeper, so
  // the assistant is hidden exactly when the picks it needs are landing. With
  // the app's global `refetchOnWindowFocus: false` there is not even a
  // catch-up read on the way back; the board just sits at whatever it last saw.
  // `refetchOnWindowFocus` is re-enabled here so returning to the tab repaints
  // immediately rather than waiting out the interval.
  const picksQuery = useQuery({ queryKey: ['picks', providerId, draftId], queryFn: () => provider!.getPicks(draftId!), enabled: Boolean(provider && draftId && roomReady), refetchInterval: session?.status !== 'complete' ? 1000 : false, refetchIntervalInBackground: true, refetchOnWindowFocus: true })
  const keepersQuery = useQuery({ queryKey: ['keepers', providerId, draftId], queryFn: () => provider!.getKeepers!(draftId!), enabled: Boolean(provider?.getKeepers && draftId && roomReady), refetchInterval: session?.status === 'pre_draft' ? 15_000 : false })

  useEffect(() => {
    if (session) saveCurrentDraft(session)
  }, [session])
  const askedLeagueRefresh = useRef<string | null>(null)
  useEffect(() => {
    if (!draftId) return
    const refreshKey = `${providerId}:${draftId}`
    if (askedLeagueRefresh.current === refreshKey) return
    if (providerId === 'espn') {
      if (!espnHydrated || espnReady) return
      askedLeagueRefresh.current = refreshKey
      const ref = parseEspnDraftId(draftId)
      requestOpenEspn({
        leagueId: ref.leagueId,
        season: ref.season,
        teamId: userId,
        page: 'team',
        returnToApp: true,
      })
      return
    }
    if (!siteId || !siteBridge?.hydrated || siteReady) return
    askedLeagueRefresh.current = refreshKey
    const ref = parseSiteDraftId(draftId)
    requestOpenSite(siteId, {
      leagueId: ref.leagueId,
      season: ref.season,
      teamId: userId,
      returnToApp: true,
    })
  }, [draftId, espnHydrated, espnReady, providerId, siteBridge?.hydrated, siteId, siteReady, userId])
  const refetchPicks = picksQuery.refetch
  const players = playersQuery.data ?? EMPTY_PLAYERS
  const madePicks = picksQuery.data ?? EMPTY_PICKS
  const sleeperPlayers = sleeperPlayersQuery.data ?? EMPTY_PLAYERS
  const syncedKeepers = keepersQuery.data ?? EMPTY_KEEPERS
  const manualKeepers = useMemo(() => storedKeepers.filter((entry) => entry.source === 'manual'), [storedKeepers])
  const merged = useMemo(() => mergeKeepers(manualKeepers, syncedKeepers), [manualKeepers, syncedKeepers])
  // The demo engine is client-side and cannot see stored keepers, so their
  // ids ride along to keep the simulation off them.
  const keptIds = useMemo(() => merged.keepers.map((keeper) => keeper.playerId), [merged.keepers])
  // ESPN alone publishes a per-player keeper price, so this sits outside the
  // shared provider interface and reads the extension snapshot directly.
  const keeperCandidates = useMemo(() => providerId === 'espn' && espnSnapshot ? mapEspnKeeperCandidates(espnSnapshot) : [], [providerId, espnSnapshot])

  useEffect(() => { void loadImportedSets().then(setImportedSets) }, [rankTick])
  const builtinSets = useMemo(() => {
    const sets: RankSet[] = []
    if (sleeperPlayers.length) {
      // Not "ADP": Sleeper's number is search_rank, a search-popularity
      // ordering. Calling it ADP invited it to be read as draft position.
      const sleeper = builtinSet('builtin:sleeper', 'Sleeper rank', sleeperPlayers)
      sleeper.fetchedAt = sleeperPlayersQuery.dataUpdatedAt
      sets.push(sleeper)
    }
    if (providerId === 'espn' && players.length) {
      const espn = builtinSet('builtin:espn', 'ESPN draft rank', players)
      espn.fetchedAt = playersQuery.dataUpdatedAt
      sets.push(espn)
    }
    return sets
  }, [sleeperPlayers, sleeperPlayersQuery.dataUpdatedAt, providerId, players, playersQuery.dataUpdatedAt])
  const projectedPointsQuery = useQuery({ queryKey: ['nfl-projections', projectionSeason(session?.season)], queryFn: ({ signal }) => getNflProjections(session!.season, signal), enabled: Boolean(session), staleTime: 3_600_000 })
  const scheduleQuery = useQuery({ queryKey: ['published-schedule'], queryFn: ({ signal }) => getPublishedSchedule(signal), staleTime: 86_400_000 })
  // Same artifact, different slice: the full matchup model for room-wide playoff SoS.
  const scheduleModelQuery = useQuery({ queryKey: ['published-schedule-model'], queryFn: ({ signal }) => getPublishedScheduleModel(signal), staleTime: 86_400_000 })
  const liveAdpSnapshotQuery = useQuery(liveAdpQuery)
  const playoffWeeks = session?.leagueFormat === 'chopped'
    ? null
    : (session?.playoffWeeks ?? DEFAULT_PLAYOFF_WEEKS)
  const sosWeeks = session?.leagueFormat === 'chopped'
    ? CHOPPED_EARLY_WEEKS
    : playoffWeeks
  const intelligencePlayers = useMemo(() => {
    const enriched = applyScheduleByes(enrichPlayersWithDirectory(players, sleeperPlayers), scheduleQuery.data)
    return attachPlayoffSos(enriched, scheduleModelQuery.data, session?.scoringType, sosWeeks)
  }, [players, sleeperPlayers, scheduleQuery.data, scheduleModelQuery.data, session?.scoringType, sosWeeks])
  const rankedPlayers = useMemo(() => applyConsensusRanks(intelligencePlayers, [...builtinSets, ...importedSets], rankSettings.enabledIds, rankSettings.method, session?.scoringType), [intelligencePlayers, builtinSets, importedSets, rankSettings, session?.scoringType])
  // RotoWire season projections via Sleeper, scored to the league's format, so
  // VORP can rank the pool by forecasted value. Players with no published row
  // stay blank rather than falling back to last year's actuals or rank math.
  const valuedPlayers = useMemo(() => {
    if (!session) return applyLiveAdp(rankedPlayers, liveAdpSnapshotQuery.data)
    const withPoints = attachProjectedPoints(rankedPlayers, projectionPointsPool(projectedPointsQuery.data, session.scoringType, session.scoringSettings))
    return applyLiveAdp(withVorp(attachProjectedAdp(withPoints, projectedPointsQuery.data, session.scoringType), session.slots, session.teams), liveAdpSnapshotQuery.data, session.teams, session.scoringType)
  }, [rankedPlayers, projectedPointsQuery.data, session, liveAdpSnapshotQuery.data])
  const playersById = useMemo(() => new Map(valuedPlayers.map((player) => [player.id, player])), [valuedPlayers])
  // Keepers ride the board as picks, so availability, roster, recs and the
  // board all account for them without knowing keepers exist. When the
  // league does not charge a round, those picks stay off the snake.
  // Normalised so every consumer -- roster, recommendations, grades, overlay --
  // reads the same team for a pick. Providers do not always report `draftSlot`
  // as the owning team's slot.
  const picks = useMemo(() => normalizePickSlots(withKeeperPicks(madePicks, merged.keepers, session, playersById, { costRoundPicks: keepersCostRoundPicks }), session), [madePicks, merged.keepers, session, playersById, keepersCostRoundPicks])
  const takenPickNos = useMemo(() => occupiedPickNumbers(picks), [picks])
  // Not picks.length + 1: keeper picks sit in later rounds, so the made picks
  // are not a contiguous run from pick 1.
  // Measured from the frontier, not from the first empty slot: a pick the
  // socket observer missed leaves a hole that would otherwise hold the room
  // at a pick it passed rounds ago.
  const frontier = useMemo(() => draftFrontier(picks), [picks])
  const nextPickNo = useMemo(() => session ? livePickNumber(takenPickNos, session.teams * session.rounds, frontier) : 1, [session, takenPickNos, frontier])
  const takenIds = useMemo(() => new Set(picks.map((pick) => pick.playerId)), [picks])
  const resolvedQueue = useMemo(() => resolveQueuePlayerIds(queuedIds, valuedPlayers), [queuedIds, valuedPlayers])
  const activeQueue = useMemo(() => resolvedQueue.filter((id) => !takenIds.has(id)), [resolvedQueue, takenIds])

  useEffect(() => {
    if (providerId !== 'demo' || !players.length) return
    const speed = mockSpeed === 'slow' ? 3000 : mockSpeed === 'fast' ? 500 : 1500
    const id = window.setInterval(() => { demoTick(players, keptIds); void refetchPicks() }, speed)
    return () => window.clearInterval(id)
  }, [providerId, players, refetchPicks, mockSpeed, keptIds])

  /**
   * A reload drops the mock engine's in-memory board, and `getDraft` restarts
   * it with no knowledge of keepers -- so the simulation would draft straight
   * over the picks keepers own, which is exactly the bug seeding fixes. Re-seed
   * a fresh engine from what is stored.
   *
   * Guarded on an empty board so this can only ever run against a mock that has
   * not started; a draft in progress is never rebuilt underneath itself.
   */
  const demoSeeded = useRef(false)
  useEffect(() => {
    if (providerId !== 'demo' || demoSeeded.current) return
    if (!session || madePicks.length > 0) return
    if (!storedKeepers.length) return
    demoSeeded.current = true
    void (async () => {
      const seed = loadMockLeagueSeed()
      const common = { reach: mockReach / 100, autoPickYourPicks: mockAutoPick }
      const shape = seed
        ? { template: seed.template, ...common }
        : { teams: mockTeams, rounds: mockRounds, yourSlot: mockYourSlot, scoringType: mockScoring, ...common }
      const entries = seed ? seed.keepers : storedKeepers
      const cost = seed ? seed.costRoundPicks : keepersCostRoundPicks
      // Build the room first so keeper entries resolve against its own order,
      // then reseed that same room with the picks they occupy.
      initDemoDraft(shape)
      const room = await demoProvider.getDraft(DEMO_DRAFT_ID, session.yourUserId)
      // Deliberately not cancelled on unmount. Seeding is idempotent and the
      // ref guard already prevents repeats; aborting it under StrictMode's
      // double-invoke would leave the engine unseeded and silently restore the
      // draft-over-keepers bug.
      initDemoDraft({ ...shape, keeperPicks: keeperPicks(entries, room, [], playersById, { costRoundPicks: cost }) })
      void queryClient.invalidateQueries({ queryKey: ['draft', 'demo'] })
      void queryClient.invalidateQueries({ queryKey: ['picks', 'demo'] })
    })()
  }, [providerId, session, madePicks.length, storedKeepers, keepersCostRoundPicks, playersById, queryClient, mockReach, mockAutoPick, mockTeams, mockRounds, mockYourSlot, mockScoring])

  // The end-of-mock report: when a demo draft completes, the grades sheet
  // opens itself so the payoff -- how every team graded out -- is the first
  // thing you see. Only fires on the transition, not on re-renders of a
  // finished draft.
  const previousStatus = useRef<string | null>(null)
  useEffect(() => {
    const status = session?.status ?? null
    const openedFor = previousStatus.current
    previousStatus.current = status
    if (openedFor !== 'complete' && status === 'complete' && providerId === 'demo') {
      setGradesOpen(true)
    }
  }, [session?.status, providerId])

  const yourNextPickNo = useMemo(
    () => session?.yourSlot == null ? null : nextPickNumberForSlot(nextPickNo, session.yourSlot, session.teams, session.rounds, session.type, takenPickNos, session.pickOwners),
    [session, nextPickNo, takenPickNos],
  )
  const yourFollowingPickNo = useMemo(
    () => session?.yourSlot == null || yourNextPickNo == null
      ? null
      : nextPickNumberForSlot(yourNextPickNo + 1, session.yourSlot, session.teams, session.rounds, session.type, takenPickNos, session.pickOwners),
    [session, yourNextPickNo, takenPickNos],
  )
  const waitingForPick = yourNextPickNo != null && yourNextPickNo > nextPickNo
  const recs = useMemo(() => session ? suggestionSet(recommendPicks({ players: valuedPlayers, picks, yourSlot: session.yourSlot, slots: session.slots, currentPickNo: nextPickNo, queuedIds: activeQueue, yourNextPickNo, yourFollowingPickNo, leagueFormat: session.leagueFormat, teams: session.teams, limit: 24 }), 5, { waitForPick: waitingForPick }) : [], [session, valuedPlayers, picks, nextPickNo, activeQueue, yourNextPickNo, yourFollowingPickNo, waitingForPick])
  const roster = useMemo(() => {
    if (!session) return []
    const slot = viewedSlot ?? session.yourSlot
    const selected = picks.filter((pick) => pick.draftSlot === slot).map((pick) => playersById.get(pick.playerId)).filter((player): player is Player => Boolean(player))
    return fillRoster(session.slots, selected)
  }, [session, playersById, picks, viewedSlot])
  // The modal needs the draft's own read on the selected player: where he sits
  // at his position, what his tier has left, and whether he lasts your turn.
  const selectedContext = useMemo(() => {
    const player = selectedPlayerId ? playersById.get(selectedPlayerId) : null
    if (!player || !session) return null
    return playerDraftContext({
      player,
      players: valuedPlayers,
      picks,
      slots: session.slots,
      yourSlot: session.yourSlot,
      currentPickNo: nextPickNo,
      yourNextPickNo,
      teamNameBySlot: new Map(session.order.map((slot) => [slot.slot, slot.teamName || slot.displayName])),
    })
  }, [selectedPlayerId, playersById, session, valuedPlayers, picks, nextPickNo, yourNextPickNo])
  const youAreOnClock = useMemo(() => Boolean(session && session.yourSlot != null && session.status !== 'complete' && picksUntilSlot(nextPickNo, session.yourSlot, session.teams, session.rounds, session.type, takenPickNos, session.pickOwners) === 0), [session, nextPickNo, takenPickNos])
  // The extension scores its own recommendations with the shared core, so what
  // it needs from here is the half it cannot see: projections, VORP, live ADP,
  // tiers. Those move with the rankings, not with every pick, so this publishes
  // on the player pool rather than on `nextPickNo` -- and the overlay stays
  // current between publishes because it rescores off its own live board.
  const valuations = useMemo(
    () => providerId === 'espn' && espnSnapshot?.leagueId
      ? buildValuations(valuedPlayers, String(espnSnapshot.leagueId), String(espnSnapshot.season || ''))
      : null,
    [providerId, espnSnapshot?.leagueId, espnSnapshot?.season, valuedPlayers],
  )
  useEffect(() => {
    if (!valuations || !session || !espnReady) return
    publishEspnValuations(valuations)
  }, [valuations, session, espnReady])
  useDraftSounds({
    draftKey: queueKey,
    picks: madePicks,
    youAreOnClock,
    enabled: draftSounds,
    primed: Boolean(session && picksQuery.isSuccess),
  })
  useEffect(() => { const onKey = (event: KeyboardEvent) => { if (event.key === '/' && !(event.target instanceof HTMLInputElement)) { event.preventDefault(); document.getElementById('player-search')?.focus() } }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }, [])
  useEffect(() => {
    if (!rankingsOpen && !settingsOpen && !menuOpen && !fullBoardOpen) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (selectedPlayerId) return
      setRankingsOpen(false)
      setSettingsOpen(false)
      setMenuOpen(false)
      setFullBoardOpen(false)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [fullBoardOpen, menuOpen, rankingsOpen, selectedPlayerId, settingsOpen])

  if (!provider || !draftId) return <AppScreen title="Unknown provider" body="This draft link is missing a platform." action={<Link to="/">Back to leagues</Link>} />
  if (!userId) return <AppScreen title="Missing team" body="Reconnect and pick your seat so recs and roster can track you." action={<Link to="/">Connect a league</Link>} />
  if (providerId === 'espn' && espnSnapshot?.league && shouldFollowEspnSnapshot(draftId, espnSnapshot)) {
    return <AppScreen
      busy
      title={isEspnPracticeSnapshot(espnSnapshot) ? 'Switching to ESPN practice draft' : 'Switching to your ESPN league'}
      body={isEspnPracticeSnapshot(espnSnapshot)
        ? 'The extension picked up a live practice or mock room. Following that tab.'
        : 'The practice room is gone. Returning to the league the extension is syncing.'}
    />
  }
  if (providerId === 'espn' && !espnReady) {
    const ref = parseEspnDraftId(draftId)
    const otherId = espnSnapshot?.leagueId
    return <AppScreen
      busy={!espnHydrated}
      title={espnHydrated ? 'Refreshing ESPN league' : 'Restoring ESPN sync'}
      body={espnHydrated
        ? otherId && otherId !== ref.leagueId
          ? `The extension is syncing ESPN league ${otherId}. Opening this league's tab so it can switch.`
          : 'Opening your ESPN league tab so the extension can pull a fresh snapshot.'
        : 'Asking the extension for your last saved league. If it is missing, the ESPN tab will refresh next.'}
      action={<div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent" onClick={refreshEspn}>Retry saved sync</button>
        {espnHydrated ? <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent" onClick={() => {
          requestOpenEspn({
            leagueId: ref.leagueId,
            season: ref.season,
            teamId: userId,
            page: 'team',
            returnToApp: true,
          })
        }}>Refresh ESPN tab</button> : null}
        <Link className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent" to="/">Back to leagues</Link>
      </div>}
    />
  }
  if (siteId && !siteReady) {
    const ref = parseSiteDraftId(draftId)
    const label = siteId === 'yahoo' ? 'Yahoo' : 'NFL.com'
    return <AppScreen
      busy={!siteBridge?.hydrated}
      title={siteBridge?.hydrated ? `Refreshing ${label} league` : `Restoring ${label} sync`}
      body={siteBridge?.hydrated
        ? `Opening your ${label} league tab so the extension can pull a fresh snapshot.`
        : `Asking the extension for your last saved ${label} league. If it is missing, that tab will refresh next.`}
      action={<div className="flex flex-wrap justify-center gap-2">
        <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent" onClick={() => siteBridge?.refresh()}>Retry saved sync</button>
        {siteBridge?.hydrated ? <button type="button" className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent" onClick={() => requestOpenSite(siteId as SiteProviderId, { leagueId: ref.leagueId, season: ref.season, teamId: userId, returnToApp: true })}>Refresh {label} tab</button> : null}
        <Link className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent" to="/">Back to leagues</Link>
      </div>}
    />
  }
  if (draftQuery.isError) return <AppScreen title="Could not load draft" body={draftQuery.error instanceof Error ? draftQuery.error.message : 'Failed to load draft'} action={<Link to="/">Back to leagues</Link>} />
  if (!session) return <AppScreen busy title="Loading draft room" body="Pulling the draft board." />
  if (session.type === 'auction') return <AppScreen title="Auction drafts are not in v1" body="Connect a snake draft instead." />

  const sleeperPickNote = providerId !== 'sleeper'
    ? null
    : picksQuery.isError
      ? `Could not load Sleeper picks. ${picksQuery.error instanceof Error ? picksQuery.error.message : 'Retrying…'}`
      : !session.isPractice && session.status === 'pre_draft' && madePicks.length === 0
        ? 'This official draft has not started. Find leagues lists live mocks, or paste the Sleeper mock URL on the connect page.'
        : null

  const currentPickNo = Math.min(nextPickNo, session.teams * session.rounds)
  const isPracticeRoom = Boolean(
    session.isPractice ||
    (providerId === 'espn' && espnSnapshotMatchesRoute && isEspnPracticeSnapshot(espnSnapshot)) ||
    /\b(?:practice|mock)\s+draft\b|\(Practice\)$/i.test(session.name),
  )
  const currentLocation = ownerSlotForPick(currentPickNo, session.teams, session.type, session.pickOwners)
  const until = session.yourSlot == null ? null : picksUntilSlot(currentPickNo, session.yourSlot, session.teams, session.rounds, session.type, takenPickNos, session.pickOwners)
  const yourTeam = session.order.find((slot) => slot.isYou)
  const rosterSlot = session.order.some((slot) => slot.slot === viewedSlot) ? viewedSlot! : (session.yourSlot ?? session.order[0]?.slot ?? 1)
  const viewedTeam = session.order.find((slot) => slot.slot === rosterSlot) ?? yourTeam
  const draftedCount = roster.filter((slot) => slot.player).length
  const queuedPlayers = activeQueue.map((id) => valuedPlayers.find((player) => player.id === id)).filter((player): player is Player => Boolean(player)).slice(0, 5)
  const viewedRound = boardRound ?? currentLocation.round
  const boardStart = (viewedRound - 1) * session.teams + 1
  const boardPicks = Array.from({ length: session.teams }, (_, index) => boardStart + index)
  const canMutateDraft = provider.capabilities.draftPick
  // The demo engine mutates a local board; a site write leaves the app. They
  // share a capability flag but must not share an affordance -- the demo can
  // be clicked any time, a real pick only on the clock.
  const writesToSite = providerId !== 'demo' && typeof provider.makePick === 'function'
  const canDraft = writesToSite ? youAreOnClock : canMutateDraft && youAreOnClock
  const pendingPlayer = pendingPick ? playersById.get(pendingPick.playerId) ?? null : null

  /**
   * Stages a site pick. Every guard is re-checked on confirm as well: the
   * board moves underneath this dialog, and the number shown here is the one
   * that gets submitted.
   */
  const requestSitePick = (playerId: string) => {
    setPickError(null)
    setPendingPick({ playerId, pickNo: currentPickNo })
  }

  const confirmSitePick = async () => {
    if (!pendingPick || submittingPick || !provider.makePick) return
    // Re-read the live board rather than trusting what was on screen when the
    // dialog opened. A pick that landed in between makes this one wrong.
    if (!youAreOnClock || pendingPick.pickNo !== currentPickNo) {
      setPickError('The board moved while this was open. Close and pick again.')
      return
    }
    if (takenIds.has(pendingPick.playerId)) {
      setPickError('That player is already gone.')
      return
    }
    setSubmittingPick(true)
    setPickError(null)
    try {
      const result = await provider.makePick({
        draftId: session.draftId,
        playerId: pendingPick.playerId,
        pickNo: pendingPick.pickNo,
      })
      if (!result.ok) {
        setPickError(result.error || 'Sleeper did not accept the pick.')
        return
      }
      setPendingPick(null)
      setSelectedPlayerId(null)
      void refetchPicks()
    } finally {
      setSubmittingPick(false)
    }
  }
  const updateTheme = (next: AppTheme) => { setTheme(next); saveTheme(next) }
  const updateDraftSounds = (next: boolean) => { setDraftSounds(next); saveDraftSounds(next) }
  const updateColumns = (next: TableColumnKey[]) => { setVisibleColumns(next); saveTableColumns(next) }
  // Only a mock room stands in for another league, so the seed is only read there.
  const mockLeagueSeed = providerId === 'demo' ? loadMockLeagueSeed() : null
  const mockDraft: MockDraftSettings | null = providerId === 'demo' ? { teams: mockTeams, rounds: mockRounds, yourSlot: mockYourSlot, scoring: mockScoring, reach: mockReach, speed: mockSpeed, autoPick: mockAutoPick } : null
  const updateMockDraft = (next: MockDraftSettings) => {
    setMockTeams(next.teams)
    setMockRounds(next.rounds)
    setMockYourSlot(next.yourSlot)
    setMockScoring(next.scoring)
    setMockReach(next.reach)
    setMockSpeed(next.speed)
    setMockAutoPick(next.autoPick)
  }
  const exitPracticeDraft = () => {
    clearCurrentDraft()
    if (providerId === 'espn') requestExitEspnPractice()
    navigate('/', { replace: true })
  }
  /**
   * Keepers as the mock engine needs them: resolved to the pick each one
   * occupies, so the simulation reserves those slots instead of drafting over
   * them. `keeperPicks` is the same resolver the live board uses, so a mock
   * and the room it came from agree on what a keeper costs.
   */
  const mockKeeperPicksFor = (
    forSession: DraftSession,
    entries: KeeperEntry[],
    costRoundPicks: boolean,
  ) => keeperPicks(entries, forSession, [], playersById, { costRoundPicks })

  const startMockDraft = () => {
    const seed = loadMockLeagueSeed()
    if (seed) {
      // Re-running a mock of a real league: rebuild from the seed rather than
      // the sliders, which describe a generated room.
      const seeded = { ...session, ...seed.template, order: seed.template.order } as DraftSession
      initDemoDraft({
        template: seed.template,
        reach: mockReach / 100,
        autoPickYourPicks: mockAutoPick,
        keeperPicks: mockKeeperPicksFor(seeded, seed.keepers, seed.costRoundPicks),
      })
      setViewedSlot(seed.template.yourSlot ?? 1)
    } else {
      initDemoDraft({
        teams: mockTeams,
        rounds: mockRounds,
        yourSlot: mockYourSlot,
        scoringType: mockScoring,
        reach: mockReach / 100,
        autoPickYourPicks: mockAutoPick,
        // Keepers entered against the mock room itself still count.
        keeperPicks: mockKeeperPicksFor(session, merged.keepers, keepersCostRoundPicks),
      })
      setViewedSlot(mockYourSlot)
    }
    setBoardRound(null)
    setGradesOpen(false)
    void queryClient.invalidateQueries({ queryKey: ['draft', 'demo'] })
    void queryClient.invalidateQueries({ queryKey: ['picks', 'demo'] })
  }

  /**
   * Run a mock of the league currently open: same teams, same roster ids, same
   * keepers. The keeper entries are copied onto the mock's own storage key so
   * the mock room's keeper panel edits the mock, never the real league.
   */
  const startLeagueMock = () => {
    const template = mockTemplateFrom(session)
    const entries = merged.keepers.map((entry) => ({ ...entry, source: 'manual' as const }))
    saveMockLeagueSeed({ template, keepers: entries, costRoundPicks: keepersCostRoundPicks, sourceKey: keeperKey })
    const mockKey = keeperStorageKey('demo', DEMO_DRAFT_ID)
    saveKeepers(mockKey, entries)
    saveKeepersCostRoundPicks(mockKey, keepersCostRoundPicks)
    initDemoDraft({
      template,
      reach: mockReach / 100,
      autoPickYourPicks: mockAutoPick,
      keeperPicks: mockKeeperPicksFor(session, merged.keepers, keepersCostRoundPicks),
    })
    setSettingsOpen(false)
    navigate(`/draft/demo/${DEMO_DRAFT_ID}?userId=${encodeURIComponent(template.yourUserId)}`)
  }

  /** Drop the seed so the next mock is a plain generated room again. */
  const clearLeagueMock = () => {
    clearMockLeagueSeed()
    initDemoDraft({ teams: mockTeams, rounds: mockRounds, yourSlot: mockYourSlot, scoringType: mockScoring, reach: mockReach / 100, autoPickYourPicks: mockAutoPick })
    setViewedSlot(mockYourSlot)
    setBoardRound(null)
    setGradesOpen(false)
    void queryClient.invalidateQueries({ queryKey: ['draft', 'demo'] })
    void queryClient.invalidateQueries({ queryKey: ['picks', 'demo'] })
  }
  const toggleQueue = (id: string) => setQueuedIds(() => resolvedQueue.includes(id) ? resolvedQueue.filter((item) => item !== id) : [...resolvedQueue, id])
  const filterByPosition = (key: string) => {
    if (!isBoardPositionFilter(key)) return
    setPositionFilter((current) => current === key ? 'ALL' : key)
  }
  const moveQueue = (id: string, direction: -1 | 1) => setQueuedIds(() => moveQueueItem(resolvedQueue, id, direction))
  const needRows = (['QB', 'RB', 'WR', 'TE', 'K', 'DEF'] as const).filter((position) => session.slots[position] > 0).map((position) => {
    const total = session.slots[position]
    const filled = roster.filter((slot) => slot.key === position && slot.player).length
    const openFlex = (position === 'RB' || position === 'WR' || position === 'TE') && roster.some((slot) => slot.key === 'FLEX' && !slot.player)
    const tone = filled < total ? 'high' : openFlex ? 'med' : 'low'
    return { position, total, filled, tone, label: filled < total ? `${total - filled} starter${total - filled === 1 ? '' : 's'} open` : openFlex ? 'Flex option' : 'Filled' }
  })
  const summaryRows = (['QB', 'RB', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'BN'] as const).filter((key) => session.slots[key] > 0).map((key) => {
    const total = session.slots[key]
    const filled = roster.filter((slot) => slot.key === key && slot.player).length
    return { key, label: key === 'SUPER_FLEX' ? 'SF' : key, total, filled, open: total - filled }
  })
  const byeRows = byeWeekDistribution(roster.map((slot) => slot.player))
  const byeTotal = byeRows.reduce((sum, row) => sum + row.count, 0)

  return <div className={`draft-command-center cc-${theme}`}>
    <header className="cc-topbar">
      <div className="cc-topbar-left"><div className="cc-menu-wrap"><button type="button" className="cc-icon" aria-label="Menu" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}>☰</button>{menuOpen ? <nav className="cc-nav-menu" aria-label="Draft Room navigation"><Link to="/" onClick={() => setMenuOpen(false)}>Leagues</Link><Link to={playerIntelligenceHrefForSession(session)} onClick={() => setMenuOpen(false)}>Players</Link><button type="button" onClick={() => { setRankingsOpen(true); setMenuOpen(false) }}>Rankings</button>{providerId === 'espn' ? <button type="button" onClick={exitPracticeDraft}>{isPracticeRoom ? 'Exit practice draft' : 'Exit ESPN draft'}</button> : isPracticeRoom ? <button type="button" onClick={exitPracticeDraft}>Exit mock draft</button> : null}{isPracticeRoom ? null : <button type="button" onClick={() => { setKeepersOpen(true); setMenuOpen(false) }}>Keepers</button>}</nav> : null}</div><Link to="/" className="cc-brand">Draft Assistant</Link><div className="cc-team-switch"><label className="cc-picker cc-team-picker"><TeamLogo src={viewedTeam?.avatar} label={viewedTeam?.teamName || viewedTeam?.displayName || 'Team'} /><Select aria-label="View team roster" value={rosterSlot} onChange={(event) => setViewedSlot(Number(event.target.value))}>{session.order.map((slot) => <option key={slot.slot} value={slot.slot}>{slot.teamName || slot.displayName}{slot.isYou ? ' (you)' : ''}</option>)}</Select></label><button type="button" className="cc-team-you" disabled={session.yourSlot == null || rosterSlot === session.yourSlot} onClick={() => setViewedSlot(session.yourSlot)} aria-label="View your team" title="View your team">You</button></div></div>
      <div className="cc-league">{session.name} <span>·</span> Round {currentLocation.round}, Pick {currentPickNo}<small className={`cc-provider-badge ${canMutateDraft ? 'cc-provider-demo' : ''}`}>{provider.label} · {isPracticeRoom ? 'Practice' : writesToSite ? 'Live picks' : canMutateDraft ? 'Demo controls' : 'Read-only'}{session.leagueFormat === 'chopped' ? ' · Chopped' : ''} · <span className={session.scoringType === 'unknown' ? 'cc-scoring-unknown' : undefined} title={session.scoringType === 'unknown' ? 'The league payload carried no scoring settings, so ADP and projections fall back to a cross-market blend.' : session.leagueFormat === 'chopped' ? 'Chopped is last-man-standing: no playoffs. Draft for a weekly floor.' : 'Detected from the league scoring settings'}>{scoringLabel(session.scoringType)}</span></small>{isPracticeRoom ? <button type="button" className="cc-rankings-button" onClick={exitPracticeDraft}>Exit practice</button> : null}</div>
      <div className="cc-topbar-right"><AccountButton compact /><Link className="cc-rankings-button" to={playerIntelligenceHrefForSession(session)}>Players</Link><button type="button" className="cc-rankings-button" onClick={() => setRankingsOpen(true)}>Rankings</button><button type="button" className="cc-rankings-button" onClick={() => setGradesOpen(true)}>Grades</button><div className={`cc-clock${youAreOnClock && clockSeconds != null && clockSeconds <= 10 ? ' cc-clock-low' : ''}`}>{youAreOnClock ? 'ON THE CLOCK' : 'YOUR PICK IN'} <b>{youAreOnClock ? (clockSeconds != null ? formatPickClock(clockSeconds) : session.pickTimer != null ? formatPickClock(session.pickTimer) : '—') : until ?? '—'}</b></div><button type="button" className="cc-icon" aria-label={draftSounds ? 'Mute draft sounds' : 'Unmute draft sounds'} title={draftSounds ? 'Mute draft sounds' : 'Unmute draft sounds'} onClick={() => updateDraftSounds(!draftSounds)}>{draftSounds ? '🔊' : '🔇'}</button><button type="button" className="cc-icon" aria-label={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`} title={`Use ${theme === 'dark' ? 'light' : 'dark'} theme`} onClick={() => updateTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? '☼' : '☾'}</button><button type="button" className="cc-icon" aria-label="Settings" onClick={() => setSettingsOpen(true)}>⚙</button></div>
    </header>

    <div className="cc-workspace">
      <aside className="cc-left">
        <section className="cc-section"><div className="cc-section-head"><div className="cc-eyebrow">Roster</div><div className="cc-count">{draftedCount}/{roster.length}</div></div><div className="cc-col-head"><span>Pos</span><span>Player</span><span>Bye</span></div>
          {roster.map((slot, index) => <div className={`cc-roster-row ${slot.key === 'BN' && (index === 0 || roster[index - 1]?.key !== 'BN') ? 'cc-bench-start' : ''}`} key={`${slot.key}-${index}`}><span className="cc-slot">{slot.label.replace(/\d$/, '')}</span>{slot.player ? <span className="cc-who"><PlayerPhoto player={slot.player} /><span>{slot.player.fullName}</span></span> : <span className="cc-empty">Empty</span>}<span className="cc-bye">{slot.player?.bye ?? '—'}</span></div>)}
        </section>
        <section className="cc-section"><div className="cc-section-head"><div className="cc-eyebrow">Roster needs</div></div>{needRows.map((need) => <div className="cc-need-row" key={need.position}><b>{need.position}</b><span className={`cc-need-bar cc-${need.tone}`}>{need.tone === 'high' ? 'High Need' : need.tone === 'med' ? 'Medium Need' : 'Low Need'}</span><span className="cc-starters">{need.label}</span></div>)}</section>
        <section className="cc-section" aria-label="Roster summary"><div className="cc-section-mode" role="tablist" aria-label="Summary view"><button type="button" role="tab" aria-selected={summaryView === 'positions'} className={summaryView === 'positions' ? 'active' : ''} onClick={() => setSummaryView('positions')}>Positions</button><button type="button" role="tab" aria-selected={summaryView === 'byes'} className={summaryView === 'byes' ? 'active' : ''} onClick={() => setSummaryView('byes')}>Byes</button></div>{summaryView === 'positions' ? <div className="cc-position-summary">{summaryRows.map((row) => <div key={row.key}>{isBoardPositionFilter(row.key) ? <button type="button" className={positionFilter === row.key ? 'cc-pos-filter active' : 'cc-pos-filter'} aria-pressed={positionFilter === row.key} aria-label={positionFilter === row.key ? `Clear ${row.label} filter` : `Filter board to ${row.label}`} onClick={() => filterByPosition(row.key)}>{row.label}</button> : <span>{row.label}</span>}<div><i style={{ width: `${row.total ? row.filled / row.total * 100 : 0}%` }} /></div><b>{row.filled}/{row.total}</b><small>{row.open ? `${row.open} open` : 'Filled'}</small></div>)}</div> : byeRows.length ? <div className="cc-position-summary cc-bye-summary">{byeRows.map((row) => <div key={row.week} className={row.stacked ? 'cc-bye-stack' : undefined}><span>WK {row.week}</span><div><i style={{ width: `${byeTotal ? row.count / byeTotal * 100 : 0}%` }} /></div><b>{row.count}</b><small>{formatByePositions(row.byPosition)}</small></div>)}</div> : <p className="cc-summary-empty">No rostered players have a bye week yet.</p>}</section>
      </aside>

      <PlayerTable players={valuedPlayers} picks={picks} canDraft={canDraft} canMutateDraft={canMutateDraft} providerLabel={provider.label} currentPickNo={currentPickNo} queuedIds={activeQueue} selectedId={selectedPlayerId} selectedContext={selectedContext} scoringType={session.scoringType} playoffWeeks={playoffWeeks} visibleColumnKeys={visibleColumns} onVisibleColumnKeysChange={updateColumns} onSelect={setSelectedPlayerId} onDraft={writesToSite ? (canDraft ? requestSitePick : undefined) : canMutateDraft ? (id) => { demoPick(id, players, keptIds); setSelectedPlayerId(null); void refetchPicks() } : undefined} onToggleQueue={toggleQueue} positionFilter={positionFilter} onPositionFilterChange={setPositionFilter} />

      <aside className="cc-right">
        <BestAvailable recs={recs} currentPickNo={currentPickNo} targetPickNo={yourNextPickNo} onSelect={setSelectedPlayerId} />
        <section className="cc-card"><div className="cc-card-head"><div className="cc-card-title">Draft queue</div></div>{queuedPlayers.length ? queuedPlayers.map((player, index) => <button type="button" className="cc-queue-row" key={player.id} onClick={() => setSelectedPlayerId(player.id)}><span className="cc-n">{index + 1}</span><PlayerPhoto player={player} /><span className="cc-nm">{player.fullName}</span><span className={`cc-p ${positionClass(player.position)}`}>{player.position}</span><span className="cc-t">Tier {player.tier ?? Math.max(1, Math.ceil(player.searchRank / 15))}</span></button>) : <div className="cc-empty-card">Star players to build your queue.</div>}</section>
        <button type="button" className="cc-wide" onClick={() => setQueueOpen(true)}>☷　Manage Queue</button>
      </aside>
    </div>

    <footer className="cc-footer">{sleeperPickNote ? <div className="cc-room-note" role="status">{sleeperPickNote}</div> : null}<div className="cc-footer-head"><div className="cc-eyebrow">Draft board</div><div className="cc-round-tabs" role="tablist" aria-label="Draft round">{Array.from({ length: session.rounds }, (_, index) => index + 1).map((round) => <button type="button" role="tab" key={round} className={`${viewedRound === round ? 'on' : ''} ${round === currentLocation.round ? 'live' : ''}`} aria-selected={viewedRound === round} aria-label={round === currentLocation.round ? `Round ${round}, current` : `Round ${round}`} onClick={() => setBoardRound(round === currentLocation.round ? null : round)}>{round}</button>)}</div><button type="button" className="cc-board-all" onClick={() => setFullBoardOpen(true)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" /></svg>View full board</button></div><div className="cc-picks" style={{ gridTemplateColumns: `repeat(${session.teams}, minmax(0, 1fr))` }}>{boardPicks.map((pickNo) => { const made = picks.find((pick) => pick.pickNo === pickNo); const loc = ownerSlotForPick(pickNo, session.teams, session.type, session.pickOwners); const owner = session.order.find((slot) => slot.slot === loc.slot); const player = made ? valuedPlayers.find((item) => item.id === made.playerId) : undefined; const isCurrent = pickNo === currentPickNo; const ownerName = owner?.teamName || owner?.displayName || `Slot ${loc.slot}`; const playerName = boardPlayerName(player, made); const position = player?.position || made?.meta?.position || ''; const nflTeam = player?.team ?? made?.meta?.team ?? null; return <div key={pickNo} className={`cc-pick ${isCurrent ? 'cc-you' : ''} ${made?.isKeeper ? 'cc-keeper-pick' : ''} ${!made && !isCurrent ? 'cc-future' : ''}`} title={playerName ? `${player?.fullName || playerName} · ${ownerName}` : ownerName}><span className="cc-no">{pickNo}{made?.isKeeper ? <i className="cc-keeper-tag">K</i> : null}</span>{player ? <PlayerPhoto player={player} className="cc-avatar-xl" /> : <TeamLogo className="cc-team-logo-xl" src={owner?.avatar} label={ownerName} />}{playerName ? <span className="cc-pn">{playerName}</span> : null}<span className="cc-tm">{playerName ? [position, nflTeam].filter(Boolean).join(' · ') || ownerName : ownerName}</span>{isCurrent ? <span className="cc-mine">{owner?.isYou ? 'YOUR PICK' : 'ON THE CLOCK'}</span> : null}</div> })}</div><div className="cc-next">Viewing round {viewedRound} · {until === 0 ? 'You are on the clock' : `${until ?? '—'} picks until your next pick`}</div></footer>

    {queueOpen ? <Modal title="Manage draft queue" onClose={() => setQueueOpen(false)}><p className="cc-modal-note">Your order is saved for this draft. Queue actions do not submit picks to {provider.label}.</p>{activeQueue.length ? <ol className="cc-manage-queue">{activeQueue.map((id, index) => { const player = valuedPlayers.find((item) => item.id === id); if (!player) return null; return <li key={id}><span className="cc-n">{index + 1}</span><PlayerPhoto player={player} /><button type="button" className="cc-queue-select" onClick={() => { setSelectedPlayerId(id); setQueueOpen(false) }}>{player.fullName}<small>{player.position} · {player.team ?? 'FA'}</small></button><button type="button" disabled={index === 0} onClick={() => moveQueue(id, -1)} aria-label={`Move ${player.fullName} up`}>↑</button><button type="button" disabled={index === activeQueue.length - 1} onClick={() => moveQueue(id, 1)} aria-label={`Move ${player.fullName} down`}>↓</button><button type="button" className="cc-remove" onClick={() => toggleQueue(id)} aria-label={`Remove ${player.fullName}`}>×</button></li> })}</ol> : <div className="cc-empty-card">Your queue is empty.</div>}</Modal> : null}
    {pendingPick && pendingPlayer ? <Modal title="Send this pick to Sleeper?" onClose={() => { if (!submittingPick) { setPendingPick(null); setPickError(null) } }}>
      <p className="cc-modal-note">This submits the pick to your real Sleeper draft. It cannot be undone from here.</p>
      <div className="cc-confirm-pick">
        <PlayerPhoto player={pendingPlayer} className="cc-avatar-xl" />
        <div>
          <h3>{pendingPlayer.fullName}</h3>
          <span>{pendingPlayer.position}{pendingPlayer.team ? ` · ${pendingPlayer.team}` : ''} · Round {currentLocation.round}, pick {pendingPick.pickNo}</span>
        </div>
      </div>
      {pickError ? <div className="cc-room-note" role="alert">{pickError}</div> : null}
      <div className="cc-confirm-actions">
        <button type="button" onClick={() => { setPendingPick(null); setPickError(null) }} disabled={submittingPick}>Cancel</button>
        <button type="button" className="cc-wide" onClick={() => { void confirmSitePick() }} disabled={submittingPick}>{submittingPick ? 'Sending…' : `Draft ${pendingPlayer.fullName}`}</button>
      </div>
    </Modal> : null}
    {fullBoardOpen ? <Modal title="Full draft board" wide onClose={() => setFullBoardOpen(false)}><DraftBoard session={session} picks={picks} players={valuedPlayers} currentPickNo={currentPickNo} onSelect={setSelectedPlayerId} /></Modal> : null}
    {rankingsOpen ? <RankingsSheet leagueName={session.name} leagueScoring={session.scoringType} receptionPremium={session.receptionPremium} directory={players} builtinSets={builtinSets} importedSets={importedSets} rankSettings={rankSettings} onClose={() => setRankingsOpen(false)} onChange={() => { setRankSettings(loadRankSettings()); setRankTick((tick) => tick + 1) }} /> : null}
    {keepersOpen ? <Modal title="Keepers" onClose={() => setKeepersOpen(false)}><KeeperPanel session={session} players={valuedPlayers} keepers={merged.keepers} manualKeepers={manualKeepers} conflicts={merged.conflicts} candidates={keeperCandidates} providerLabel={provider.label} syncing={keepersQuery.isFetching} costRoundPicks={keepersCostRoundPicks} onChange={setStoredKeepers} /></Modal> : null}
    {gradesOpen ? <Modal title="Draft grades" report onClose={() => setGradesOpen(false)}><DraftGrades session={session} picks={picks} players={valuedPlayers} highlightedSlot={session.yourSlot} note={providerId === 'demo' && session.status === 'complete' ? 'Mock draft complete' : undefined} /></Modal> : null}
    {settingsOpen ? <SettingsSheet leagueName={session.name} providerLabel={provider.label} scoringType={session.scoringType} theme={theme} draftSounds={draftSounds} visibleColumns={visibleColumns} rankSettings={rankSettings} builtinSets={builtinSets} importedSets={importedSets} keeperCount={merged.keepers.length} teamCount={session.teams} allowedKeepers={session.keeperCount} keepersCostRoundPicks={keepersCostRoundPicks} mock={mockDraft} onClose={() => setSettingsOpen(false)} onThemeChange={updateTheme} onDraftSoundsChange={updateDraftSounds} onColumnsChange={updateColumns} onKeepersCostChange={setKeepersCostRoundPicks} onOpenRankings={() => { setSettingsOpen(false); setRankingsOpen(true) }} onOpenKeepers={() => { setSettingsOpen(false); setKeepersOpen(true) }} onMockChange={updateMockDraft} onStartMock={startMockDraft} onMockLeague={providerId === 'demo' ? undefined : startLeagueMock} onClearMockLeague={mockLeagueSeed ? clearLeagueMock : undefined} mockLeagueName={mockLeagueSeed?.template.name ?? null} /> : null}
  </div>
}

function boardPlayerName(player?: Player, pick?: DraftPick) {
  const last = player?.lastName || pick?.meta?.lastName || ''
  if (last) return last
  if (player?.fullName) return player.fullName
  const first = player?.firstName || pick?.meta?.firstName || ''
  return `${first} ${last}`.trim()
}

function Modal({ title, wide = false, report = false, onClose, children }: { title: string; wide?: boolean; report?: boolean; onClose: () => void; children: React.ReactNode }) {
  return <div className="cc-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`cc-modal ${wide ? 'cc-modal-wide' : ''} ${report ? 'cc-modal-report' : ''}`} role="dialog" aria-modal="true" aria-label={title}><header><h2>{title}</h2><button type="button" onClick={onClose} aria-label={`Close ${title}`}>×</button></header><div className="cc-modal-body">{children}</div></section></div>
}
