(() => {
  const PAGE_SOURCE = 'draft-assistant-espn-page'
  const DEFAULT_SEASON = '2026'
  let playersCache = null
  let playersAt = 0
  let timer = null
  let lastKey = ''
  let lastPosted = ''
  let lastError = ''
  let inFlight = false
  let cachedLeague = null
  let cachedLeagueKey = ''
  let draftObserver = null
  const liveSelections = []
  /**
   * Live pick clock. ESPN's league API only publishes the configured timeout
   * (`pickTimeout`); remaining seconds live on the draft-room page and socket.
   * `endsAt` lets the app tick locally so a one-second DOM change does not
   * force another snapshot across the bridge.
   */
  const CLOCK_MAX_SECONDS = 30 * 60
  let liveClock = null
  let lastDomRemaining = null
  let lastDomAt = 0
  let clockTicker = null

  /**
   * ESPN's placeholder id for an unmade pick. Not a sign test: team defenses
   * have negative ids of their own (-16034 is the Texans D/ST), so `> 0` drops
   * every drafted defense along with the placeholders.
   */
  const EMPTY_PICK_PLAYER_ID = -1

  function pickHasPlayer(pick) {
    const id = Number(pick?.playerId)
    return Number.isFinite(id) && id !== EMPTY_PICK_PLAYER_ID && id !== 0
  }

  function isPracticePath(value) {
    return /\/(?:mockdraftlobby|waitingroom)(?:\/|$)/i.test(value || '')
  }

  // ESPN changes mock-lobby -> waiting-room -> draft with pushState. Once the
  // URL reaches /draft it no longer says "mock", so retain where that SPA
  // navigation originated. A full navigation also leaves the lobby in referrer.
  let practicePageHint = isPracticePath(location.pathname) || isPracticePath(document.referrer)

  function readCookie(name) {
    const match = document.cookie.match(
      new RegExp(`(?:^|; )${name}=([^;]*)`),
    )
    return match ? decodeURIComponent(match[1]) : null
  }

  function uniqueLeagues(list) {
    const map = new Map()
    for (const item of list) {
      if (!item?.leagueId) continue
      const leagueId = String(item.leagueId)
      const prev = map.get(leagueId)
      map.set(leagueId, {
        leagueId,
        name: item.name || prev?.name,
        season: String(item.season || prev?.season || DEFAULT_SEASON),
      })
    }
    return [...map.values()]
  }

  function pageIds() {
    const url = new URL(location.href)
    let leagueId =
      url.searchParams.get('leagueId') ||
      url.searchParams.get('leagueid')
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash
    if (!leagueId && hash) {
      try {
        leagueId = new URLSearchParams(hash.replace(/^\/?/, '')).get('leagueId')
      } catch {
        /* ignore */
      }
      const hashMatch = hash.match(/leagueId=(\d+)/i)
      if (!leagueId && hashMatch) leagueId = hashMatch[1]
    }
    if (!leagueId) {
      const pathMatch = location.pathname.match(
        /\/(?:league|draft|team)(?:office)?\/(\d{4,})/i,
      )
      if (pathMatch) leagueId = pathMatch[1]
    }
    const season =
      url.searchParams.get('seasonId') ||
      url.searchParams.get('seasonid') ||
      DEFAULT_SEASON
    const teamId =
      url.searchParams.get('teamId') ||
      url.searchParams.get('fromTeamId') ||
      url.searchParams.get('teamid')
    const memberId =
      url.searchParams.get('memberId') ||
      url.searchParams.get('memberid')
    return { leagueId, season, teamId, memberId }
  }

  function isPracticeLeague(league) {
    const name = String(league?.settings?.name ?? league?.name ?? '')
    if (/\b(?:practice|mock)\s+draft\b/i.test(name)) return true
    const subtype = league?.settings?.leagueSubType ?? league?.leagueSubType
    const normalized = typeof subtype === 'string' ? subtype.trim().toUpperCase().replace(/[ -]+/g, '_') : subtype
    if (typeof normalized === 'string' && (normalized.includes('MOCK') || normalized.includes('PRACTICE'))) return true
    if (Number(normalized) === 4 || Number(normalized) === 5) return true
    const subtypeId = league?.settings?.leagueSubTypeId ?? league?.leagueSubTypeId
    return Number(subtypeId) === 4 || Number(subtypeId) === 5
  }

  /**
   * ESPN announces live picks on its draft-room socket before mDraftDetail's
   * read model catches up. Observe those read-only frames so a practice pick
   * can update the assistant immediately, then let the API reconcile it.
   */
  function scheduleLivePulls() {
    lastPosted = ''
    for (const delay of [0, 150, 500]) {
      window.setTimeout(() => { void pull() }, delay)
    }
  }

  function rememberLiveSelection(teamId, playerId, rosterSlotIndex, draftInfo = {}, schedule = true) {
    if (!teamId || !playerId) return
    const playerKey = String(playerId)
    const existing = liveSelections.find((pick) => pick.playerId === playerKey)
    if (existing) {
      Object.assign(existing, draftInfo)
      return
    }
    liveSelections.push({
      teamId: String(teamId),
      playerId: playerKey,
      rosterSlotIndex: Number(rosterSlotIndex) || 0,
      ...draftInfo,
    })
    if (schedule) scheduleLivePulls()
  }

  function applyClockSeconds(seconds, paused = false) {
    const value = Number(seconds)
    if (!Number.isFinite(value) || value < 0 || value > CLOCK_MAX_SECONDS) return false
    const remaining = Math.round(value)
    const now = Date.now()
    liveClock = {
      remaining,
      endsAt: paused ? null : now + remaining * 1000,
      paused: Boolean(paused),
      at: now,
    }
    return true
  }

  function parseClockText(text) {
    const trimmed = String(text || '').trim()
    const mmss = trimmed.match(/^(\d{1,2}):([0-5]\d)$/)
    if (mmss) {
      const seconds = Number(mmss[1]) * 60 + Number(mmss[2])
      return seconds <= CLOCK_MAX_SECONDS ? seconds : null
    }
    return null
  }

  function clockSecondsFromValue(value) {
    if (!value || typeof value !== 'object') return null
    const keys = [
      'timeRemaining',
      'secondsRemaining',
      'secondsLeft',
      'remainingTime',
      'pickTimeRemaining',
      'clockSeconds',
      'timerSeconds',
    ]
    for (const key of keys) {
      const raw = Number(value[key])
      if (!Number.isFinite(raw) || raw < 0) continue
      const seconds = raw > CLOCK_MAX_SECONDS && raw <= CLOCK_MAX_SECONDS * 1000
        ? Math.round(raw / 1000)
        : Math.round(raw)
      if (seconds <= CLOCK_MAX_SECONDS) return seconds
    }
    return null
  }

  function readClockFromReact(root) {
    if (!root || typeof root !== 'object') return null
    const fiberKey = Object.keys(root).find((key) => (
      key.startsWith('__reactFiber') || key.startsWith('__reactInternalInstance')
    ))
    if (!fiberKey) return null
    const seen = new Set()
    const queue = [root[fiberKey]]
    let steps = 0
    while (queue.length && steps < 400) {
      const node = queue.shift()
      steps += 1
      if (!node || seen.has(node)) continue
      seen.add(node)
      const props = node.memoizedProps || node.pendingProps
      const seconds = clockSecondsFromValue(props) ?? clockSecondsFromValue(node.memoizedState)
      if (seconds != null) {
        return {
          remaining: seconds,
          paused: Boolean(props?.paused || props?.isPaused || props?.isDraftPaused),
        }
      }
      if (node.child) queue.push(node.child)
      if (node.sibling) queue.push(node.sibling)
      if (node.return) queue.push(node.return)
    }
    return null
  }

  function readClockFromDom() {
    const root = document.querySelector?.('.draftContainer')
      || document.querySelector?.('main')
      || document.body
    if (!root?.querySelectorAll) return null
    const blob = String(root.textContent || '')
    const paused = /\bpaused\b|draft is paused/i.test(blob)
    const labeled = root.querySelectorAll([
      '[class*="clock" i]',
      '[class*="timer" i]',
      '[class*="countdown" i]',
      '[aria-label*="clock" i]',
      '[aria-label*="time remaining" i]',
      '[data-testid*="clock" i]',
    ].join(','))
    for (const node of labeled) {
      const seconds = parseClockText(node.textContent)
      if (seconds != null) return { remaining: seconds, paused }
    }
    const header = root.querySelector?.(
      '[class*="on-the-clock" i], [class*="ontheclock" i], [class*="draft-header" i], [class*="draftHeader" i]',
    )
    const headerMatch = String(header?.textContent || '').match(/\b(\d{1,2}:[0-5]\d)\b/)
    if (headerMatch) {
      const seconds = parseClockText(headerMatch[1])
      if (seconds != null) return { remaining: seconds, paused }
    }
    return readClockFromReact(root)
  }

  function ingestDomClock(fromDom) {
    if (!fromDom) return
    const now = Date.now()
    let paused = fromDom.paused
    if (lastDomRemaining === fromDom.remaining && now - lastDomAt > 2500) paused = true
    if (lastDomRemaining !== fromDom.remaining) lastDomAt = now
    lastDomRemaining = fromDom.remaining
    applyClockSeconds(fromDom.remaining, paused)
  }

  function currentClock() {
    const fromDom = readClockFromDom()
    const socketAge = liveClock ? Date.now() - liveClock.at : Infinity
    if (fromDom && (!liveClock || socketAge > 2000)) ingestDomClock(fromDom)
    if (!liveClock) return undefined
    if (liveClock.paused) {
      return { remaining: liveClock.remaining, endsAt: null, paused: true }
    }
    const remaining = Math.max(0, Math.ceil((liveClock.endsAt - Date.now()) / 1000))
    return { remaining, endsAt: liveClock.endsAt, paused: false }
  }

  function clockStamp(clock) {
    if (!clock) return ''
    if (clock.paused) return `p${Math.round(clock.remaining)}`
    if (clock.endsAt) return `e${Math.round(clock.endsAt / 2000)}`
    return `r${Math.round(clock.remaining)}`
  }

  function scheduleClockPost() {
    window.setTimeout(() => {
      if (!cachedLeague) return
      const { leagueId, season, teamId, memberId } = pageIds()
      if (!leagueId) return
      const clock = currentClock()
      const stamp = fingerprint(leagueId, season, teamId, cachedLeague, clock)
      if (stamp === lastPosted) return
      lastPosted = stamp
      const practice = isPracticeLeague(cachedLeague) || practicePageHint || isPracticePath(location.pathname)
      post({
        leagueId: String(leagueId),
        season: String(season),
        teamId: teamId ? String(teamId) : undefined,
        pageUrl: location.href,
        swid: readCookie('SWID') || memberId || undefined,
        fetchedAt: Date.now(),
        isPractice: practice,
        clock,
        league: trimRosters(cachedLeague),
      })
    }, 0)
  }

  function resetClockFromSettings() {
    const timeout = Number(cachedLeague?.settings?.draftSettings?.pickTimeout)
    if (timeout > 0 && timeout <= CLOCK_MAX_SECONDS) applyClockSeconds(timeout, false)
  }

  function inspectDraftSocketFrame(data) {
    if (typeof data !== 'string') return
    for (const line of data.split(/[\r\n]+/)) {
      const trimmed = line.trim()
      if (!trimmed) continue
      // The player id may be negative -- ESPN numbers team defenses that way.
      const selected = trimmed.match(/^SELECTED\s+(\d+)\s+(-?\d+)\s+(\d+)(?:\s+.*)?$/i)
      if (selected) {
        rememberLiveSelection(selected[1], selected[2], selected[3])
        resetClockFromSettings()
        continue
      }
      const clock = trimmed.match(/^(?:CLOCK|TIMER|TIME|TIMELEFT|TIME_REMAINING)\s+(\d+(?:\.\d+)?)(?:\s+(\w+))?$/i)
      if (clock) {
        applyClockSeconds(Number(clock[1]), /pause/i.test(clock[2] || ''))
        scheduleClockPost()
        continue
      }
      if (/^PAUSED$/i.test(trimmed)) {
        if (liveClock) {
          liveClock = { ...liveClock, paused: true, endsAt: null, at: Date.now() }
          scheduleClockPost()
        }
        continue
      }
      if (/^RESUM(?:E|ED)$/i.test(trimmed)) {
        if (liveClock && liveClock.remaining != null) {
          applyClockSeconds(liveClock.remaining, false)
          scheduleClockPost()
        }
        continue
      }
      if (trimmed.startsWith('{')) {
        try {
          const json = JSON.parse(trimmed)
          const seconds = clockSecondsFromValue(json)
          if (seconds != null) {
            applyClockSeconds(seconds, Boolean(json.paused || json.isPaused))
            scheduleClockPost()
          }
        } catch {
          /* a draft socket line that just happened to start with a brace */
        }
      }
    }
  }

  function installDraftSocketObserver() {
    const NativeWebSocket = window.WebSocket
    if (typeof NativeWebSocket !== 'function' || window.__draftAssistantEspnSocketObserver) return
    window.__draftAssistantEspnSocketObserver = true

    function ObservedWebSocket(...args) {
      const socket = new NativeWebSocket(...args)
      const url = String(args[0] ?? '')
      if (url.includes('fantasydraft.espn.com')) {
        socket.addEventListener('message', (event) => {
          if (typeof event.data === 'string') {
            inspectDraftSocketFrame(event.data)
          } else if (typeof event.data?.text === 'function') {
            void event.data.text().then(inspectDraftSocketFrame).catch(() => {})
          }
        })
      }
      return socket
    }

    ObservedWebSocket.prototype = NativeWebSocket.prototype
    Object.setPrototypeOf(ObservedWebSocket, NativeWebSocket)
    window.WebSocket = ObservedWebSocket
  }

  function normalizedName(value) {
    return String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[.'’-]/g, '')
      .replace(/\s+(?:jr|sr|ii|iii|iv)$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function activityPlayerId(message, playerName) {
    const imageUrl = message.querySelector?.('.player-headshot img')?.getAttribute?.('src') || ''
    const imageId = imageUrl.match(/(?:full|players)\/(\d+)(?:\.|\/)/i)?.[1]
    if (imageId) return imageId
    const wanted = normalizedName(playerName)
    const match = (playersCache ?? []).find((entry) => {
      const player = entry?.player ?? entry
      return normalizedName(player?.fullName || `${player?.firstName || ''} ${player?.lastName || ''}`) === wanted
    })
    return match?.player?.id ?? match?.id ?? null
  }

  const normalizeTeamLabel = (value) =>
    String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '')

  /** Every label a team might be listed under in the pick history. */
  function teamLabelIndex(league) {
    const index = new Map()
    for (const team of league?.teams ?? []) {
      if (team?.id == null) continue
      const labels = [
        team.name,
        `${team.location ?? ''} ${team.nickname ?? ''}`,
        team.abbrev,
      ]
      for (const label of labels) {
        const key = normalizeTeamLabel(label)
        if (key && !index.has(key)) index.set(key, team.id)
      }
    }
    return index
  }

  /**
   * ESPN's pick-history tables, which carry the whole board.
   *
   * The API's read model (`mDraftDetail`) publishes only keepers while a draft
   * is live -- every unmade row stays `playerId: -1` until the draft ends --
   * so the socket is normally the only source of live picks. That leaves a
   * hole: anything drafted while the tab was disconnected, or before the
   * observer attached, is never seen at all. The draft room renders the full
   * history in the DOM, so read it and let `mergeLiveSelections` reconcile.
   *
   * The fantasy team is read from the row rather than derived from the pick
   * number. That matters in keeper leagues: keeper rounds are assigned in a
   * flat order rather than snaked, so the snake's parity is offset and any
   * round-based slot arithmetic attributes picks to the wrong team.
   */
  function scanPickHistory(league) {
    const tables = document.querySelectorAll?.('.pick-history-table') ?? []
    if (!tables.length) return
    const teamCount = Number(league?.settings?.size || league?.teams?.length || 0)
    if (!teamCount) return
    const teamIds = teamLabelIndex(league)
    if (!teamIds.size) return

    for (const table of tables) {
      const caption = table.querySelector?.('[class*="caption"]')?.textContent || ''
      const captionRound = Number((caption.match(/Round\s+(\d+)/i) || [])[1]) || 0
      for (const row of table.querySelectorAll?.('[class*="rowWrapper"]') ?? []) {
        // The headshot filename is the player id. Anchor on it rather than the
        // first digits in the URL: ESPN serves these through a combiner whose
        // query string carries its own numbers.
        const source = row.querySelector?.('img')?.getAttribute('src') || ''
        const playerId = (/\/(\d{2,10})\.png/.exec(source) || /(\d{4,10})/.exec(source) || [])[1]
        if (!playerId) continue

        // Each column is rendered twice (fixed and scrolling groups), so
        // collapse the repeats rather than assuming how many groups exist.
        const cells = []
        for (const cell of row.querySelectorAll?.('[class*="cellContent"]') ?? []) {
          const text = cell.textContent.replace(/\s+/g, ' ').trim()
          if (cells[cells.length - 1] !== text) cells.push(text)
        }
        const overall = Number(cells[0])
        if (!(overall > 0)) continue
        const teamId = teamIds.get(normalizeTeamLabel(cells[2]))
        if (!teamId) continue

        rememberLiveSelection(
          teamId,
          playerId,
          0,
          {
            overallPickNumber: overall,
            roundId: captionRound || Math.ceil(overall / teamCount),
            roundPickNumber: ((overall - 1) % teamCount) + 1,
          },
          false,
        )
      }
    }
  }

  /**
   * ESPN's activity column updates for user picks and auto-picks. This is the
   * fallback when a socket was opened before the extension could observe it.
   */
  function scanDraftActivity(league) {
    const messages = document.querySelectorAll?.('.draft-column .pick-message__container') ?? []
    const teamCount = Number(league?.settings?.size || league?.teams?.length || 0)
    if (!messages.length || !teamCount) return
    for (const message of messages) {
      if (message.classList?.contains('is-rolled-back')) continue
      const info = message.querySelector?.('.pick-info')?.textContent || ''
      const parsed = info.match(/R(\d+)\s*,\s*P(\d+)\s*-\s*(.*)/i)
      if (!parsed) continue
      const round = Number(parsed[1])
      const roundPick = Number(parsed[2])
      const playerName = message.querySelector?.('.playerinfo__playername')?.textContent?.trim()
      if (!playerName) continue
      const playerId = activityPlayerId(message, playerName)
      if (!playerId) continue
      const draftSlot = round % 2 === 1 ? roundPick : teamCount - roundPick + 1
      const pickOrder = league?.settings?.draftSettings?.pickOrder ?? []
      const orderedTeamId = pickOrder[draftSlot - 1]
      const team = (league.teams ?? []).find((entry) => Number(entry.draftPosition) === draftSlot)
      const teamId = orderedTeamId ?? team?.id
      if (!teamId) continue
      rememberLiveSelection(
        teamId,
        playerId,
        0,
        {
          overallPickNumber: (round - 1) * teamCount + roundPick,
          roundId: round,
          roundPickNumber: roundPick,
        },
        false,
      )
    }
  }

  function ensureDraftObserver() {
    if (draftObserver || typeof window.MutationObserver !== 'function') return
    const board = document.querySelector?.('.draftContainer')
    if (!board) return
    draftObserver = new window.MutationObserver(() => scheduleLivePulls())
    draftObserver.observe(board, { childList: true, subtree: true, characterData: true })
  }

  function mergeLiveSelections(league) {
    if (!league?.draftDetail || !liveSelections.length) return league
    const apiPicks = Array.isArray(league.draftDetail.picks)
      ? league.draftDetail.picks
      : []
    const confirmed = new Set(
      apiPicks.filter(pickHasPlayer).map((pick) => String(pick.playerId)),
    )
    for (let index = liveSelections.length - 1; index >= 0; index -= 1) {
      if (confirmed.has(liveSelections[index].playerId)) liveSelections.splice(index, 1)
    }
    if (!liveSelections.length) return league

    const teamCount = Number(league.settings?.size || league.teams?.length || 0)
    /**
     * The board slot a pick holds. Keeper reservations are the reason this is
     * not just `overallPickNumber`: ESPN leaves that field empty until the
     * draft actually reaches the slot, so a keeper looks like an open pick and
     * the next live selection is handed a number its team does not own. Round
     * and round-pick are stamped from the moment the keeper is reserved, and
     * ESPN numbers `roundPickNumber` in board order, so they rebuild it.
     */
    const boardOverall = (pick) => {
      const overall = Number(pick?.overallPickNumber)
      if (overall > 0) return overall
      const round = Number(pick?.roundId)
      const roundPick = Number(pick?.roundPickNumber)
      if (!(round > 0) || !(roundPick > 0) || !teamCount) return 0
      return (round - 1) * teamCount + roundPick
    }
    const occupied = new Set(
      apiPicks
        .filter(pickHasPlayer)
        .map(boardOverall)
        .filter((overall) => overall > 0),
    )
    // Its own cursor, not the last number handed out: a selection that arrives
    // carrying its overall must not drag the search for open slots past picks
    // that are still open behind it.
    let cursor = 0
    const nextOpenOverall = () => {
      do { cursor += 1 } while (occupied.has(cursor))
      occupied.add(cursor)
      return cursor
    }
    const picks = [...apiPicks]
    for (const selection of liveSelections) {
      if (confirmed.has(selection.playerId)) continue
      const suppliedOverall = Number(selection.overallPickNumber)
      const overall = suppliedOverall > 0 && !occupied.has(suppliedOverall)
        ? suppliedOverall
        : nextOpenOverall()
      occupied.add(overall)
      picks.push({
        playerId: Number(selection.playerId),
        teamId: Number(selection.teamId),
        overallPickNumber: overall,
        roundId: Number(selection.roundId) || (teamCount ? Math.ceil(overall / teamCount) : undefined),
        roundPickNumber: Number(selection.roundPickNumber) || (teamCount ? ((overall - 1) % teamCount) + 1 : undefined),
        lineupSlotId: selection.rosterSlotIndex,
        draftAssistantLive: true,
      })
      confirmed.add(selection.playerId)
    }
    return { ...league, draftDetail: { ...league.draftDetail, picks } }
  }

  function leaguesFromDom() {
    const found = []
    for (const a of document.querySelectorAll('a[href*="leagueId="], a[href*="leagueid="]')) {
      try {
        const href = new URL(a.getAttribute('href') || '', location.origin)
        const leagueId =
          href.searchParams.get('leagueId') || href.searchParams.get('leagueid')
        if (!leagueId) continue
        const name = (a.textContent || '').replace(/\s+/g, ' ').trim()
        found.push({
          leagueId,
          name: name.length > 1 && name.length < 80 ? name : undefined,
          season:
            href.searchParams.get('seasonId') ||
            href.searchParams.get('seasonid') ||
            DEFAULT_SEASON,
        })
      } catch {
        /* ignore */
      }
    }
    return uniqueLeagues(found)
  }

  function collectLeagues(root) {
    const out = new Map()
    const seen = new Set()
    const stack = [root]
    while (stack.length) {
      const node = stack.pop()
      if (!node || typeof node !== 'object') continue
      if (seen.has(node)) continue
      seen.add(node)
      const leagueId = node.leagueId ?? node.league_id
      if (leagueId != null && String(leagueId).match(/^\d{4,}$/)) {
        const name = node.leagueName ?? node.league_name ?? node.name
        out.set(String(leagueId), {
          leagueId: String(leagueId),
          name: typeof name === 'string' ? name : undefined,
          season: String(node.seasonId ?? node.season ?? DEFAULT_SEASON),
        })
      }
      const values = Array.isArray(node) ? node : Object.values(node)
      for (const value of values) stack.push(value)
    }
    return [...out.values()]
  }

  /**
   * lm-api-reads is first because fantasy.espn.com no longer serves /apis/
   * -- it fails at the network layer even same-origin with a valid session,
   * so trying it first burned a guaranteed-failed request on every poll. It is
   * kept as a fallback in case that flips back.
   */
  function leagueBases(season, leagueId) {
    const path = `/apis/v3/games/ffl/seasons/${season}/segments/0/leagues/${leagueId}`
    return [
      `https://lm-api-communication.fantasy.espn.com${path}`,
      `https://lm-api-reads.fantasy.espn.com${path}`,
      `https://fantasy.espn.com${path}`,
    ]
  }

  async function fetchJson(url, headers) {
    const res = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      headers: {
        accept: 'application/json',
        'x-fantasy-source': 'kona',
        'x-fantasy-platform': 'kona-PROD-1.0.0',
        ...(headers ?? {}),
      },
    })
    if (!res.ok) {
      if (res.status === 401 || res.status === 403) {
        throw new Error(
          'ESPN needs you logged in on this tab. Open the team page while signed in, then try again.',
        )
      }
      throw new Error(`ESPN ${res.status}`)
    }
    return res.json()
  }

  async function fetchFirst(urls, headers) {
    let lastErr = new Error('ESPN request failed')
    for (const url of urls) {
      try {
        return await fetchJson(url, headers)
      } catch (err) {
        lastErr = err instanceof Error ? err : lastErr
      }
    }
    throw lastErr
  }

  async function fetchLeague(season, leagueId, query) {
    // ESPN's read CDN can cache mDraftDetail long enough to miss several live
    // practice picks. The timestamp makes every two-second poll a fresh read.
    const bust = `_draftAssistantAt=${Date.now()}`
    return fetchFirst(leagueBases(season, leagueId).map((base) => `${base}?${query}&${bust}`))
  }

  async function fetchNavLeagues(season) {
    const urls = [
      `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}?view=mNav`,
      `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${season}?view=mNav`,
    ]
    for (const url of urls) {
      try {
        const data = await fetchJson(url)
        const leagues = collectLeagues(data)
        if (leagues.length) return leagues
      } catch {
        /* try next */
      }
    }
    return []
  }

  /**
   * kona_player_info records carry season stats, outlooks and ownership that
   * this app never reads -- about 7 MB for 2500 players. That does not fit in
   * chrome.storage.session's 10 MB budget and is far too much to push across
   * two message hops every poll, so keep only the fields mapEspnPlayers uses.
   * Measured reduction: ~91%.
   */
  function trimPlayer(entry) {
    const p = entry?.player ?? entry
    if (!p || p.id == null) return null
    return {
      player: {
        id: p.id,
        defaultPositionId: p.defaultPositionId,
        firstName: p.firstName,
        lastName: p.lastName,
        fullName: p.fullName,
        proTeamId: p.proTeamId,
        jersey: p.jersey,
        injuryStatus: p.injuryStatus,
        draftRanksByRankType: p.draftRanksByRankType,
        // The one ownership field the app reads: ESPN's real average draft
        // position. The rest of that object (percent owned, start/sit trends)
        // is what makes the record fat, so only this number is kept.
        ownership: p.ownership?.averageDraftPosition == null
          ? undefined
          : { averageDraftPosition: p.ownership.averageDraftPosition },
      },
    }
  }

  async function fetchPlayers(season, leagueId, scoringKey) {
    const filter = JSON.stringify({
      players: {
        limit: 2500,
        sortDraftRanks: {
          sortPriority: 1,
          sortAsc: true,
          value: scoringKey,
        },
      },
    })
    const query = 'view=kona_player_info&scoringPeriodId=0'
    const data = await fetchFirst(
      [
        ...leagueBases(season, leagueId),
        `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players`,
        `https://fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players`,
      ].map((base) => `${base}?${query}`),
      { 'x-fantasy-filter': filter },
    )
    const list = Array.isArray(data.players) ? data.players : []
    return list.map(trimPlayer).filter(Boolean)
  }

  function scoringKeyFromLeague(league) {
    const items = league?.settings?.scoringSettings?.scoringItems ?? []
    const rec = items.find((item) => item.statId === 53)
    if (rec && rec.points >= 0.9) return 'PPR'
    return 'STANDARD'
  }

  function post(payload) {
    window.postMessage({ source: PAGE_SOURCE, ...payload }, '*')
  }

  /**
   * Cheap summary of everything the app reacts to. Polling runs every two
   * seconds but picks land far less often, so re-posting an identical snapshot
   * just burns message bandwidth and storage writes.
   */
  /**
   * Rosters and keeper prices move independently of the pick list before the
   * draft, so they need their own signal or the keeper editor never sees a
   * commissioner's changes.
   */
  function keeperStamp(league) {
    let entries = 0
    let value = 0
    for (const team of league?.teams ?? []) {
      for (const entry of team?.roster?.entries ?? []) {
        entries += 1
        value += (entry?.playerPoolEntry?.keeperValue ?? 0) + (entry?.playerId ?? 0) % 97
      }
    }
    const keepers = (league?.draftDetail?.picks ?? []).filter((pick) => pick?.keeper || pick?.reservedForKeeper).length
    return `${entries}.${value}.${keepers}`
  }

  function fingerprint(leagueId, season, teamId, league, clock) {
    const picks = league?.draftDetail?.picks ?? []
    const last = picks[picks.length - 1]
    return [
      leagueId,
      season,
      teamId ?? '',
      picks.length,
      last?.overallPickNumber ?? '',
      last?.roundId ?? '',
      last?.roundPickNumber ?? '',
      last?.teamId ?? '',
      last?.playerId ?? '',
      league?.draftDetail?.drafted ?? '',
      league?.draftDetail?.inProgress ?? '',
      league?.teams?.length ?? '',
      league?.settings?.draftSettings?.keeperCount ?? '',
      keeperStamp(league),
      playersAt,
      clockStamp(clock),
    ].join(':')
  }

  function normalizeDraftPicks(league) {
    const picks = league?.draftDetail?.picks
    if (!picks || Array.isArray(picks)) return league
    if (typeof picks !== 'object') return league
    return { ...league, draftDetail: { ...league.draftDetail, picks: Object.values(picks) } }
  }

  /**
   * mRoster ships every rostered player's full profile, which would roughly
   * double the snapshot for two fields the app actually reads. Keep the id and
   * the keeper price, drop the rest.
   */
  function trimRosters(league) {
    if (!league?.teams) return league
    return {
      ...league,
      teams: league.teams.map((team) =>
        team?.roster?.entries
          ? {
              ...team,
              roster: {
                entries: team.roster.entries.map((entry) => ({
                  playerId: entry?.playerId ?? entry?.playerPoolEntry?.id,
                  lineupSlotId: entry?.lineupSlotId,
                  playerPoolEntry: {
                    id: entry?.playerPoolEntry?.id,
                    keeperValue: entry?.playerPoolEntry?.keeperValue,
                    keeperValueFuture: entry?.playerPoolEntry?.keeperValueFuture,
                  },
                })),
              },
            }
          : team,
      ),
    }
  }

  async function pullLeague(leagueId, season, teamId, memberId) {
    // mRoster carries each team's keeper prices (playerPoolEntry.keeperValue),
    // which is the only pre-draft source for who is keepable and at what cost.
    // Practice / mock clones often 400 or 401 on mRoster (or on combined
    // views). Keep trying slimmer view sets before giving up.
    const viewSets = [
      'view=mDraftDetail&view=mSettings&view=mTeam&view=mStatus&view=mRoster',
      'view=mDraftDetail&view=mSettings&view=mTeam&view=mStatus',
      'view=mDraftDetail&view=mSettings&view=mTeam',
      'view=mDraftDetail&view=mSettings',
      'view=mDraftDetail',
    ]
    let league
    let lastErr = new Error('Could not read this ESPN league from the tab.')
    for (const query of viewSets) {
      try {
        league = normalizeDraftPicks(await fetchLeague(season, leagueId, query))
        lastErr = null
        break
      } catch (err) {
        lastErr = err instanceof Error ? err : lastErr
      }
    }
    const leagueKey = `${season}:${leagueId}`
    if (!league && cachedLeagueKey === leagueKey && liveSelections.length) {
      league = cachedLeague
    }
    if (!league) throw lastErr
    const scoringKey = scoringKeyFromLeague(league)
    const stale = Date.now() - playersAt > 10 * 60 * 1000
    let playersChanged = false
    if (!playersCache || stale) {
      try {
        playersCache = await fetchPlayers(season, leagueId, scoringKey)
        playersAt = Date.now()
        playersChanged = true
      } catch {
        playersCache = playersCache || []
      }
    }

    ensureDraftObserver()
    // History first: it is the most complete source, and the activity column
    // only reaches back as far as its visible messages.
    scanPickHistory(league)
    scanDraftActivity(league)
    league = mergeLiveSelections(league)
    cachedLeague = league
    cachedLeagueKey = leagueKey

    const clock = currentClock()
    const stamp = fingerprint(leagueId, season, teamId, league, clock)
    if (stamp === lastPosted) return
    lastPosted = stamp
    lastError = ''

    const practice = isPracticeLeague(league) || practicePageHint || isPracticePath(location.pathname)
    if (practice) practicePageHint = true
    post({
      leagueId: String(leagueId),
      season: String(season),
      teamId: teamId ? String(teamId) : undefined,
      pageUrl: location.href,
      swid: readCookie('SWID') || memberId || undefined,
      fetchedAt: Date.now(),
      isPractice: practice,
      clock,
      league: trimRosters(league),
      // Omitted when unchanged; the worker keeps serving the last list it saw.
      players: playersChanged ? playersCache : undefined,
      playersVersion: playersAt,
    })
  }

  async function pull() {
    if (inFlight) return
    inFlight = true
    try {
      const { leagueId, season, teamId, memberId } = pageIds()
      const domLeagues = leaguesFromDom()
      const key = `${leagueId || ''}:${season}:${teamId || ''}:${domLeagues.map((l) => l.leagueId).join(',')}`
      if (leagueId) {
        lastKey = key
        try {
          await pullLeague(leagueId, season, teamId, memberId)
        } catch (err) {
          const message =
            err instanceof Error
              ? err.message
              : 'Could not read this ESPN league from the tab.'
          // Force the next success to re-post, and report a given failure once
          // rather than every two seconds for as long as it persists.
          lastPosted = ''
          const stamp = `error:${leagueId}:${message}`
          if (stamp === lastError) return
          lastError = stamp
          post({
            error: message,
            leagueId: String(leagueId),
            season: String(season),
            teamId: teamId ? String(teamId) : undefined,
            pageUrl: location.href,
            fetchedAt: Date.now(),
            isPractice: practicePageHint || isPracticePath(location.pathname),
          })
        }
        return
      }

      let availableLeagues = domLeagues
      if (!availableLeagues.length) {
        availableLeagues = await fetchNavLeagues(season)
      }
      if (availableLeagues.length === 1) {
        const only = availableLeagues[0]
        lastKey = key
        try {
          await pullLeague(only.leagueId, only.season || season, teamId, memberId)
          return
        } catch {
          /* fall through to list */
        }
      }

      if (key === lastKey && availableLeagues.length === 0) return
      lastKey = key
      post({
        waiting: true,
        season,
        pageUrl: location.href,
        fetchedAt: Date.now(),
        availableLeagues,
      })
    } finally {
      inFlight = false
    }
  }

  // The relay asks for a fresh player list when the worker has none cached.
  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    if (event.data?.source !== 'draft-assistant-espn-bridge') return
    if (event.data.type !== 'RESEND_PLAYERS') return
    playersAt = 0
    lastPosted = ''
    void pull()
  })

  function hookHistory() {
    const wrap = (fn) =>
      function hooked(...args) {
        const result = fn.apply(this, args)
        if (isPracticePath(location.pathname)) practicePageHint = true
        else if (/\/(?:football\/)?(?:team|league)(?:\/|$)/i.test(location.pathname)) practicePageHint = false
        window.setTimeout(() => {
          void pull()
        }, 50)
        return result
      }
    history.pushState = wrap(history.pushState.bind(history))
    history.replaceState = wrap(history.replaceState.bind(history))
    window.addEventListener('popstate', () => {
      void pull()
    })
  }

  const onLivePage = /\/(?:draft|team|league|waitingroom)/i.test(location.pathname)
  const interval = onLivePage ? 2000 : 4000
  installDraftSocketObserver()
  hookHistory()
  void pull()
  timer = window.setInterval(() => {
    void pull()
  }, interval)
  // The clock ticks every second; the league poll does not. Read the page
  // clock on that cadence and post only when endsAt jumps (new pick / pause).
  if (/\/(?:football\/)?draft(?:\/|$)/i.test(location.pathname)) {
    clockTicker = window.setInterval(() => {
      const fromDom = readClockFromDom()
      if (fromDom) ingestDomClock(fromDom)
      scheduleClockPost()
    }, 1000)
  }
  window.addEventListener('beforeunload', () => {
    if (timer) window.clearInterval(timer)
    if (clockTicker) window.clearInterval(clockTicker)
  })
})()
