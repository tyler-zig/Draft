export type RankingSet = {
  id: string
  label: string
  scoring: string
  sourceUrl: string
  fetchedAt: number
  meta: Record<string, unknown>
  rows: Array<Record<string, unknown>>
}

const USER_AGENT = 'DraftAssistantRankingsCollector/3.0'
const TEAM_ALIASES: Record<string, string> = { JAC: 'JAX', WAS: 'WSH', WASHINGTON: 'WSH', LA: 'LAR', STL: 'LAR', SD: 'LAC', OAK: 'LV', ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU' }
const PRO_TEAMS: Record<number, string | null> = { 0: null, 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU' }
const POSITIONS: Record<number, string> = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' }

const clean = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim()
const number = (value: unknown) => { const parsed = Number(String(value ?? '').replace(/[^0-9.-]/g, '')); return Number.isFinite(parsed) ? parsed : null }
const team = (value: unknown) => { const normalized = clean(value).toUpperCase(); return !normalized || ['FA', 'DST', 'DEF'].includes(normalized) ? null : TEAM_ALIASES[normalized] ?? normalized }
const position = (value: unknown) => { const normalized = clean(value).toUpperCase(); return normalized === 'DST' || normalized === 'D/ST' ? 'DEF' : normalized === 'PK' ? 'K' : normalized || null }
const name = (value: unknown) => clean(value).toLowerCase().replace(/[.'’`-]/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/\s+/g, ' ').trim()
const playerKey = (playerName: unknown, playerTeam: unknown, playerPosition: unknown) => {
  const pos = position(playerPosition) ?? '', club = team(playerTeam)
  return pos === 'DEF' && club ? `|${club}|DEF` : `${name(playerName)}|${club ?? ''}|${pos}`
}
const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

function readPublished(text: string) {
  return text.match(/"published"\s*:\s*"([^"]+)"/)?.[1] ?? null
}

function previousPublished(set?: RankingSet | null) {
  return clean(set?.meta?.lastUpdated) || null
}

function canReuseSet(set: RankingSet | null | undefined, minRows: number) {
  if (!set || !Array.isArray(set.rows) || set.rows.length < minRows) return false
  return set.rows.some((row) => row.adpLastOne != null || row.adpLastSeven != null)
}

function reusePreviousSet(previous: RankingSet, published: string | null): RankingSet {
  const now = Date.now()
  return {
    ...previous,
    fetchedAt: now,
    meta: { ...previous.meta, lastUpdated: published ?? previous.meta.lastUpdated ?? null, reused: true, checkedAt: now },
  }
}

async function readJsonUnlessPublished(response: Response, previous: string | null): Promise<{ unchanged: true; published: string } | { unchanged: false; data: Record<string, unknown> }> {
  if (!previous || !response.body) {
    const data = await response.json() as Record<string, unknown>
    const published = clean(data.published) || null
    if (previous && published === previous) return { unchanged: true, published }
    return { unchanged: false, data }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let text = ''
  let decided = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      text += decoder.decode(value, { stream: true })
      if (decided) continue
      const published = readPublished(text)
      if (!published) continue
      decided = true
      if (published === previous) {
        await reader.cancel()
        return { unchanged: true, published }
      }
    }
    text += decoder.decode()
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
  return { unchanged: false, data: JSON.parse(text) as Record<string, unknown> }
}

async function request(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let last: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { ...init, headers: { 'user-agent': USER_AGENT, accept: 'text/html,application/json', ...init.headers }, signal: AbortSignal.timeout(30_000) })
      if (response.ok) return response
      if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === attempts) throw new Error(`HTTP ${response.status}`)
      last = new Error(`HTTP ${response.status}`)
    } catch (error) { last = error }
    await sleep(500 * 2 ** (attempt - 1))
  }
  throw last instanceof Error ? last : new Error('request failed')
}

async function allowed(url: string): Promise<{ allowed: boolean; delayMs: number }> {
  try {
    const target = new URL(url)
    const text = await (await request(`${target.origin}/robots.txt`, {}, 1)).text()
    let applies = false, delayMs = 0
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*$/, '').trim(), split = line.indexOf(':')
      if (split < 0) continue
      const key = line.slice(0, split).trim().toLowerCase(), value = line.slice(split + 1).trim()
      if (key === 'user-agent') applies = value === '*' || USER_AGENT.toLowerCase().includes(value.toLowerCase())
      else if (applies && key === 'disallow' && value && target.pathname.startsWith(value)) return { allowed: false, delayMs }
      else if (applies && key === 'crawl-delay') delayMs = Math.max(delayMs, (number(value) ?? 0) * 1000)
    }
    return { allowed: true, delayMs }
  } catch { return { allowed: true, delayMs: 0 } }
}

function extractObject(html: string, marker: string): Record<string, unknown> {
  const start = html.indexOf(marker), open = html.indexOf('{', start)
  if (start < 0 || open < 0) throw new Error(`${marker} block not found`)
  let depth = 0, quoted = false, escaped = false
  for (let index = open; index < html.length; index += 1) {
    const char = html[index]
    if (escaped) { escaped = false; continue }
    if (char === '\\') { escaped = true; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (quoted) continue
    if (char === '{') depth += 1
    if (char === '}' && --depth === 0) return JSON.parse(html.slice(open, index + 1))
  }
  throw new Error(`${marker} block was not terminated`)
}

async function fantasyPros(): Promise<RankingSet[]> {
  const boards = [
    ['fantasypros-ppr', 'FantasyPros ECR (PPR)', 'ppr', '/nfl/rankings/ppr-cheatsheets.php'],
    ['fantasypros-half', 'FantasyPros ECR (Half PPR)', 'half', '/nfl/rankings/half-point-ppr-cheatsheets.php'],
    ['fantasypros-standard', 'FantasyPros ECR (Standard)', 'standard', '/nfl/rankings/cheatsheets.php'],
  ]
  const verdict = await allowed(`https://www.fantasypros.com${boards[0][3]}`)
  if (!verdict.allowed) throw new Error('robots.txt disallows FantasyPros rankings')
  const sets: RankingSet[] = []
  for (const [id, label, scoring, path] of boards) {
    const sourceUrl = `https://www.fantasypros.com${path}`
    const data = extractObject(await (await request(sourceUrl)).text(), 'var ecrData')
    const players = Array.isArray(data.players) ? data.players as Array<Record<string, unknown>> : []
    const rows = players.flatMap((entry) => {
      const overall = number(entry.rank_ecr), playerName = clean(entry.player_name)
      if (!overall || !playerName) return []
      return [{ name: playerName, team: team(entry.player_team_id), position: position(entry.player_position_id), overall, best: number(entry.rank_min), worst: number(entry.rank_max), average: number(entry.rank_ave), stdDev: number(entry.rank_std), tier: number(entry.tier), positionRank: clean(entry.pos_rank) || null, byeWeek: number(entry.player_bye_week), fantasyProsId: entry.player_id == null ? undefined : String(entry.player_id) }]
    })
    if (rows.length < 50) throw new Error(`only ${rows.length} rows parsed from ${id}`)
    sets.push({ id, label, scoring, sourceUrl, fetchedAt: Date.now(), meta: { experts: number(data.total_experts), lastUpdated: clean(data.last_updated) || null, season: clean(data.year) || null }, rows })
    if (verdict.delayMs) await sleep(verdict.delayMs)
  }
  return sets
}

/**
 * FantasyPros real-time ADP. The page fetches expert-rankings.php (id 7556)
 * and prints rank_adp_raw as ADP. Consensus-rankings is a different board.
 * Mirrors scripts/lib/sources/fantasypros-adp.mjs; keep the two in sync.
 */
const RT_ADP_BOARDS = [
  { id: 'fantasypros-rtadp', key: 'redraft-half', slug: '', label: 'FantasyPros Real-Time ADP (Half PPR)', scoring: 'half', type: 'adp', scoringParam: 'HALF', minRows: 100 },
  { id: 'fantasypros-rtadp-ppr', key: 'redraft-ppr', slug: 'ppr', label: 'FantasyPros Real-Time ADP (PPR)', scoring: 'ppr', type: 'adp', scoringParam: 'PPR', minRows: 100 },
  { id: 'fantasypros-rtadp-std', key: 'redraft-std', slug: 'std', label: 'FantasyPros Real-Time ADP (Standard)', scoring: 'standard', type: 'adp', scoringParam: 'STD', minRows: 100 },
  { id: 'fantasypros-rtadp-dynasty', key: 'dynasty', slug: 'dynasty', label: 'FantasyPros Real-Time ADP (Dynasty)', scoring: 'dynasty', type: 'dynadp', scoringParam: 'PPR', minRows: 100 },
  { id: 'fantasypros-rtadp-rookie', key: 'rookie', slug: 'rookie', label: 'FantasyPros Real-Time ADP (Rookie)', scoring: 'rookie', type: 'rkadp', scoringParam: 'HALF', minRows: 25 },
] as const

async function fantasyProsAdp(previousSets: RankingSet[] = []): Promise<RankingSet[]> {
  const season = new Date().getUTCMonth() >= 4 ? new Date().getUTCFullYear() : new Date().getUTCFullYear() - 1
  const page = 'https://www.fantasypros.com/nfl/real-time-adp/'
  if (!(await allowed(page)).allowed) throw new Error('robots.txt disallows the FantasyPros real-time ADP page')
  const previousById = new Map(previousSets.map((set) => [set.id, set]))
  const sets: RankingSet[] = []
  const failures: string[] = []
  for (const board of RT_ADP_BOARDS) {
    const sourceUrl = board.slug ? `${page}${board.slug}/` : page
    const params = new URLSearchParams({ id: '7556', year: String(season), position: 'ALL', type: board.type, scoring: board.scoringParam })
    const apiUrl = `https://partners.fantasypros.com/api/v1/expert-rankings.php?${params.toString()}`
    const previous = previousById.get(board.id) ?? null
    const knownPublished = canReuseSet(previous, board.minRows) ? previousPublished(previous) : null
    try {
      const result = await readJsonUnlessPublished(await request(apiUrl, { headers: { referer: sourceUrl, accept: 'application/json' } }), knownPublished)
      if (result.unchanged && previous) {
        sets.push(reusePreviousSet(previous, result.published))
        continue
      }
      const data = result.unchanged ? {} : result.data
      if (typeof data.message === 'string') throw new Error(`FantasyPros API: ${data.message}`)
      const players = Array.isArray(data.players) ? data.players as Array<Record<string, unknown>> : []
      const rows = players.flatMap((entry) => {
        const overall = number(entry.rank) ?? number(entry.rank_adp_overall)
        const playerName = clean(entry.player_name)
        if (!overall || !playerName) return []
        const adp = number(entry.rank_adp_raw) ?? overall
        return [{
          name: playerName, team: team(entry.player_team_id), position: position(entry.player_position_id ?? entry.player_positions), overall,
          adp, adpLastOne: number(entry.rank_last_one), adpLastSeven: number(entry.rank_last_seven),
          adpVsLastOne: number(entry.rank_vs_last_one), adpVsLastSeven: number(entry.rank_vs_last_seven),
          best: number(entry.rank_ecr_min ?? entry.rank_min), worst: number(entry.rank_ecr_max ?? entry.rank_max), average: adp,
          stdDev: number(entry.rank_std), tier: null, positionRank: clean(entry.pos_rank) || null,
          byeWeek: number(entry.bye_week ?? entry.player_bye_week), fantasyProsId: entry.player_id == null ? undefined : String(entry.player_id),
          ownedAvg: number(entry.player_owned_avg), ownedEspn: number(entry.player_owned_espn), ownedYahoo: number(entry.player_owned_yahoo),
        }]
      })
      if (rows.length < board.minRows) throw new Error(`only ${rows.length} rows parsed`)
      sets.push({
        id: board.id, label: board.label, scoring: board.scoring, sourceUrl, fetchedAt: Date.now(),
        meta: { format: board.key, season: clean(data.year) || null, lastUpdated: clean(data.published) || null, type: clean(data.type) || null, scoringParam: clean(data.scoring) || null, positionId: clean(data.position_id) || null, count: number(data.count) },
        rows,
      })
    } catch (error) {
      failures.push(`${board.key}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  if (!sets.length) throw new Error(`FantasyPros real-time ADP failed for every format: ${failures.join('; ')}`)
  return sets
}

const LIVE_ADP_TEAM_COUNTS = [8, 10, 12, 14, 16] as const
const LIVE_ADP_FORMATS = [
  { slug: 'half', scoring: 'half', label: 'Half PPR', minRows: 50 },
  { slug: 'ppr', scoring: 'ppr', label: 'PPR', minRows: 50 },
  { slug: 'std', scoring: 'standard', label: 'Standard', minRows: 50 },
  { slug: 'rookie', scoring: 'rookie', label: 'Rookie', minRows: 20 },
] as const

function overallPickFromRoundPick(value: number | null, teams: number) {
  if (value == null || !(value > 0) || !(teams > 0)) return null
  const round = Math.floor(value)
  let slot = Math.round((value - round) * 100)
  if (slot <= 0) slot = 1
  if (slot > teams) slot = teams
  return (round - 1) * teams + slot
}

function parseDraftWizardAdp(html: string, teams: number) {
  const table = html.split('id="adpTable"')[1]
  if (!table) return []
  const body = table.split(/<tbody[^>]*>/i)[1]
  if (!body) return []
  return body.split('<tr').slice(1).flatMap((block) => {
    const cells = [...block.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1])
    if (cells.length < 5) return []
    const nameMatch = String(cells[2] ?? '').match(/\/nfl\/players\/([^"/]+)\.php"[^>]*>([^<]+)/)
    const playerName = clean(nameMatch?.[2])
    if (!playerName) return []
    const playerPosition = position(clean(String(cells[0] ?? '').replace(/<[^>]*>/g, ' ')).replace(/\d+/g, ''))
    const playerTeam = team(clean(String(cells[3] ?? '').replace(/<[^>]*>/g, ' ')).replace(/\(\d+\)/g, ''))
    const overallRank = number(cells[1])
    const avgPick = number(cells[4])
    const adp = overallPickFromRoundPick(avgPick, teams) ?? overallRank
    if (adp == null || adp <= 0) return []
    return [{
      name: playerName, team: playerTeam, position: playerPosition, overall: overallRank ?? adp, adp,
      best: overallPickFromRoundPick(number(cells[5]), teams), worst: overallPickFromRoundPick(number(cells[6]), teams),
      average: adp, stdDev: number(cells[7]), tier: null,
      positionRank: clean(String(cells[0] ?? '').replace(/<[^>]*>/g, ' ')) || null,
      byeWeek: number((clean(String(cells[3] ?? '').replace(/<[^>]*>/g, ' ')).match(/\((\d+)\)/) ?? [])[1]),
      fantasyProsSlug: nameMatch?.[1] ?? undefined,
    }]
  })
}

async function draftWizardAdp(): Promise<RankingSet[]> {
  const verdict = await allowed('https://draftwizard.fantasypros.com/football/adp/mock-drafts/')
  if (!verdict.allowed) throw new Error('robots.txt disallows Draft Wizard ADP')
  const sets: RankingSet[] = []
  const failures: string[] = []
  for (const format of LIVE_ADP_FORMATS) {
    for (const teams of LIVE_ADP_TEAM_COUNTS) {
      const sourceUrl = `https://draftwizard.fantasypros.com/football/adp/mock-drafts/overall/default-${format.slug}-${teams}-teams`
      try {
        const rows = parseDraftWizardAdp(await (await request(sourceUrl)).text(), teams)
        if (rows.length < format.minRows) throw new Error(`only ${rows.length} rows parsed`)
        sets.push({
          id: format.slug === 'half' ? `draftwizard-adp-${teams}` : `draftwizard-adp-${format.slug}-${teams}`,
          label: format.slug === 'half' ? `Draft Wizard ADP (${teams}-team)` : `Draft Wizard ADP (${teams}-team ${format.label})`,
          scoring: format.scoring, sourceUrl, fetchedAt: Date.now(),
          meta: { teams, scoring: format.slug, format: format.slug === 'rookie' ? 'rookie' : `redraft-${format.slug}`, count: rows.length },
          rows,
        })
      } catch (error) {
        failures.push(`${format.slug}-${teams}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
  if (!sets.length) throw new Error(`Draft Wizard ADP failed for every board: ${failures.join('; ')}`)
  return sets
}

function parseRotoWireBoard(html: string) {
  return html.split('<tr').slice(1).flatMap((block) => {
    const overall = number((block.match(/rh-board__col--rank"[^>]*>([^<]*)</) ?? [])[1])
    const foundName = block.match(/rh-player__name"[^>]*href="([^"]*)"[^>]*>([^<]+)</)
    if (!overall || !foundName) return []
    const teamHtml = (block.match(/rh-player__team"[^>]*>([\s\S]*?)<\/span>/) ?? [])[1] ?? ''
    return [{ name: clean(foundName[2]), team: team(clean(teamHtml.replace(/<[^>]*>/g, ''))), position: position((block.match(/rh-player__pos--([A-Z]+)/) ?? [])[1]), overall, adp: number((block.match(/rh-board__col--adp"[^>]*>([^<]*)</) ?? [])[1]), rotowireId: (foundName[1].match(/-(\d+)(?:\?|$)/) ?? [])[1] }]
  })
}

async function rotoWire(): Promise<RankingSet[]> {
  const page = 'https://www.rotowire.com/football/rankings.php'
  if (!(await allowed(page)).allowed) throw new Error('robots.txt disallows RotoWire rankings')
  const html = await (await request(page)).text()
  const marker = 'rhBoardAvailability"', start = html.indexOf(marker), open = html.indexOf('>', start), close = html.indexOf('</script>', open)
  if (start < 0 || open < 0 || close < 0) throw new Error('RotoWire availability matrix not found')
  const availability = JSON.parse(html.slice(open + 1, close)) as Record<string, boolean>
  const targets = Object.entries(availability).filter(([, present]) => present).flatMap(([key]) => {
    const [source, format] = key.split('|')
    return ['OV', 'QB', 'RB', 'WR', 'TE'].map((pos) => ({ source, format, pos }))
  })
  const sets: RankingSet[] = []
  for (let offset = 0; offset < targets.length; offset += 4) {
    const results = await Promise.allSettled(targets.slice(offset, offset + 4).map(async ({ source, format, pos }) => {
      const sourceUrl = `https://www.rotowire.com/football/ajax/get-rankings-board.php?source=${source}&format=${format}&pos=${pos}`
      const payload = await (await request(sourceUrl, { headers: { accept: 'application/json' } })).json() as Record<string, unknown>
      if (!payload.success || payload.source !== source || payload.format !== format || payload.pos !== pos) return null
      const rows = parseRotoWireBoard(String(payload.boardHTML ?? ''))
      if (!rows.length) return null
      const labels: Record<string, string> = { consensus: 'Consensus', official: 'RotoWire Official', gremminger: 'Gremminger', hartitz: 'Hartitz', may: 'May', erickson: 'Erickson', coventry: 'Coventry' }
      return { id: `rotowire-${source}-${format}-${pos.toLowerCase()}`, label: `RotoWire ${labels[source] ?? source} ${format.toUpperCase()} ${pos}`, scoring: ({ ppr: 'ppr', 'half-ppr': 'half', standard: 'standard' } as Record<string, string>)[format] ?? 'unknown', sourceUrl, fetchedAt: Date.now(), meta: { expert: source, position: pos, boardTitle: clean(payload.boardTitle) || null }, rows } satisfies RankingSet
    }))
    for (const result of results) if (result.status === 'fulfilled' && result.value) sets.push(result.value)
  }
  return sets
}

async function espnCrosswalk() {
  const now = new Date(), season = now.getUTCMonth() >= 4 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  const sourceUrl = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}/players?scoringPeriodId=0&view=players_wl`
  const filter = { players: { limit: 20_000, filterActive: { value: true } } }
  const players = await (await request(sourceUrl, { headers: { 'x-fantasy-filter': JSON.stringify(filter), accept: 'application/json' } })).json() as Array<Record<string, unknown>>
  const byKey = new Map<string, string>(), collisions = new Set<string>()
  for (const player of players) {
    const playerName = clean(player.fullName), pos = POSITIONS[Number(player.defaultPositionId)]
    if (!playerName || !pos || player.id == null) continue
    const key = playerKey(playerName, PRO_TEAMS[Number(player.proTeamId)] ?? null, pos), id = String(player.id), previous = byKey.get(key)
    if (previous && previous !== id) collisions.add(key); else byKey.set(key, id)
  }
  for (const key of collisions) byKey.delete(key)
  if (byKey.size < 500) throw new Error(`only ${byKey.size} ESPN player identities parsed`)
  return { map: byKey, meta: { season, sourceUrl, fetchedAt: Date.now(), players: players.length, keys: byKey.size } }
}

function aggregate(sets: RankingSet[]) {
  const players = new Map<string, Record<string, unknown> & { ranks: number[]; sources: string[] }>()
  for (const set of sets) for (const row of set.rows) {
    const key = playerKey(row.name, row.team, row.position)
    const entry = players.get(key) ?? { name: row.name, team: row.team, position: row.position, espnId: row.espnId, ranks: [], adp: null, tier: null, byeWeek: null, sources: [] }
    if (typeof row.overall === 'number') entry.ranks.push(row.overall)
    if (typeof row.adp === 'number') entry.adp = entry.adp == null ? row.adp : Math.min(Number(entry.adp), row.adp)
    if (entry.tier == null && row.tier != null) entry.tier = row.tier
    if (entry.byeWeek == null && row.byeWeek != null) entry.byeWeek = row.byeWeek
    if (!entry.sources.includes(set.id)) entry.sources.push(set.id)
    players.set(key, entry)
  }
  return [...players.values()].map(({ ranks, ...entry }) => {
    const sorted = ranks.sort((a, b) => a - b), middle = Math.floor(sorted.length / 2)
    return { ...entry, best: sorted[0] ?? null, worst: sorted.at(-1) ?? null, median: sorted.length % 2 ? sorted[middle] : sorted.length ? (sorted[middle - 1] + sorted[middle]) / 2 : null, sampleCount: sorted.length }
  }).sort((a, b) => Number(a.median ?? Infinity) - Number(b.median ?? Infinity))
}

function previousAdpSets(previous?: { sets?: RankingSet[] } | null) {
  return Array.isArray(previous?.sets) ? previous.sets : []
}

/**
 * Live ADP alone: the real-time board plus ESPN identity enrichment. The
 * dedicated 15-minute job stores this under its own `live_adp` field. When
 * every FantasyPros board is still on the same `published` stamp, Draft
 * Wizard is reused too.
 */
export async function collectAdp(previous?: { sets?: RankingSet[] } | null) {
  const prior = previousAdpSets(previous)
  const failures: Array<{ source: string; error: string }> = []
  const sets: RankingSet[] = []
  const [adp, espn] = await Promise.allSettled([fantasyProsAdp(prior), espnCrosswalk()])
  if (adp.status === 'fulfilled') sets.push(...adp.value)
  else failures.push({ source: 'fantasypros-adp', error: String(adp.reason) })
  const fpUnchanged = adp.status === 'fulfilled' && adp.value.length > 0 && adp.value.every((set) => set.meta.reused === true)
  const previousDw = prior.filter((set) => String(set.id).startsWith('draftwizard-adp-'))
  if (fpUnchanged && previousDw.length) {
    sets.push(...previousDw.map((set) => reusePreviousSet(set, previousPublished(set))))
  } else {
    const sized = await draftWizardAdp().then((value) => ({ status: 'fulfilled' as const, value }), (reason) => ({ status: 'rejected' as const, reason }))
    if (sized.status === 'fulfilled') sets.push(...sized.value)
    else failures.push({ source: 'draftwizard-adp', error: String(sized.reason) })
  }
  if (!sets.length) throw new Error(`Live ADP collection failed: ${failures.map((item) => item.error).join('; ')}`)
  let enriched = 0
  if (espn.status === 'fulfilled') {
    for (const set of sets) for (const row of set.rows) {
      const id = espn.value.map.get(playerKey(row.name, row.team, row.position))
      if (id) { row.espnId = id; enriched += 1 }
    }
  } else failures.push({ source: 'espn-crosswalk', error: String(espn.reason) })
  const digest = sets.filter((set) => set.id === 'fantasypros-rtadp' || set.id === 'draftwizard-adp-12')
  const players = aggregate(digest.length ? digest : sets), fetchedAt = Date.now()
  const skipped = sets.filter((set) => set.meta.reused === true).length
  return { schemaVersion: 2, fetchedAt, stats: { sets: sets.length, rows: sets.reduce((sum, set) => sum + set.rows.length, 0), players: players.length, espnIdsAttached: enriched, failures: failures.length, skipped }, sets, players, failures }
}

export async function collectRankings(previousAdp?: { sets?: RankingSet[] } | null) {
  const failures: Array<{ source: string; error: string }> = [], sets: RankingSet[] = []
  const [fantasy, adp, sized, roto, espn] = await Promise.allSettled([fantasyPros(), fantasyProsAdp(previousAdpSets(previousAdp)), draftWizardAdp(), rotoWire(), espnCrosswalk()])
  if (fantasy.status === 'fulfilled') sets.push(...fantasy.value); else failures.push({ source: 'fantasypros', error: String(fantasy.reason) })
  if (adp.status === 'fulfilled') sets.push(...adp.value); else failures.push({ source: 'fantasypros-adp', error: String(adp.reason) })
  if (sized.status === 'fulfilled') sets.push(...sized.value); else failures.push({ source: 'draftwizard-adp', error: String(sized.reason) })
  if (roto.status === 'fulfilled') sets.push(...roto.value); else failures.push({ source: 'rotowire', error: String(roto.reason) })
  let crosswalk: Record<string, unknown> | null = null, enriched = 0
  if (espn.status === 'fulfilled') {
    crosswalk = espn.value.meta
    for (const set of sets) for (const row of set.rows) { const id = espn.value.map.get(playerKey(row.name, row.team, row.position)); if (id) { row.espnId = id; enriched += 1 } }
  } else failures.push({ source: 'espn-crosswalk', error: String(espn.reason) })
  if (!sets.length) throw new Error(`No ranking source produced data: ${JSON.stringify(failures)}`)
  const players = aggregate(sets), fetchedAt = Date.now()
  return { schemaVersion: 2, fetchedAt, stats: { sets: sets.length, rows: sets.reduce((sum, set) => sum + set.rows.length, 0), players: players.length, espnIdsAttached: enriched, failures: failures.length, skipped: 0 }, crosswalk, sets, players, failures, skipped: [] }
}

const MARKET_ADP_HISTORY_START = Date.parse('2026-08-22T19:00:00.000Z')
const recordsMarketAdp = (fetchedAt: number) => Number.isFinite(fetchedAt) && fetchedAt >= MARKET_ADP_HISTORY_START

export function appendRankingHistory(previous: Record<string, unknown> | null, snapshot: Awaited<ReturnType<typeof collectRankings>>) {
  const at = snapshot.fetchedAt
  const liveByEspn = new Map<string, number>()
  const liveByKey = new Map<string, number>()
  for (const row of snapshot.sets.find((set) => set.id === 'fantasypros-rtadp')?.rows ?? []) {
    const adp = number(row.adp)
    if (adp == null || adp <= 0) continue
    if (row.espnId) liveByEspn.set(String(row.espnId), adp)
    liveByKey.set(playerKey(row.name, row.team, row.position), adp)
  }
  const liveAdpFor = (player: Record<string, unknown>) => {
    if (player.espnId && liveByEspn.has(String(player.espnId))) return liveByEspn.get(String(player.espnId)) ?? null
    return liveByKey.get(playerKey(player.name, player.team, player.position)) ?? null
  }
  const observations = [...(Array.isArray(previous?.snapshots) ? previous.snapshots as Array<{ at: number }> : []), { at }]
    .filter((item, index, all) => Number.isFinite(item.at) && all.findIndex((candidate) => candidate.at === item.at) === index)
    .sort((left, right) => left.at - right.at)
    .slice(-120)
  const retained = new Set(observations.map((item) => item.at))
  const records = new Map<string, Record<string, unknown> & { points: Array<Record<string, unknown>> }>()
  for (const item of Array.isArray(previous?.players) ? previous.players as Array<Record<string, unknown>> : []) {
    const key = String(item.key ?? (item.espnId ? `espn:${item.espnId}` : `name:${name(item.name)}|${team(item.team) ?? ''}|${position(item.position) ?? ''}`))
    records.set(key, {
      ...item,
      key,
      points: (Array.isArray(item.points) ? item.points as Array<Record<string, unknown>> : [])
        .filter((point) => retained.has(Number(point.at)))
        .map((point) => recordsMarketAdp(Number(point.at)) ? point : { ...point, adp: null, liveAdp: null }),
    })
  }
  for (const player of snapshot.players) {
    const key = player.espnId ? `espn:${player.espnId}` : `name:${name(player.name)}|${team(player.team) ?? ''}|${position(player.position) ?? ''}`
    const record = records.get(key) ?? { key, name: player.name, team: player.team ?? null, position: player.position ?? null, espnId: player.espnId == null ? null : String(player.espnId), points: [] }
    const keepMarket = recordsMarketAdp(at)
    record.points = [...record.points.filter((point) => Number(point.at) !== at), { at, rank: Number.isFinite(Number(player.median)) ? player.median : null, adp: keepMarket && Number.isFinite(Number(player.adp)) ? player.adp : null, liveAdp: keepMarket ? liveAdpFor(player) : null, low: Number.isFinite(Number(player.best)) ? player.best : null, high: Number.isFinite(Number(player.worst)) ? player.worst : null, sourceCount: Number(player.sampleCount) || 0 }]
    records.set(key, record)
  }
  return { schemaVersion: 1, generatedAt: Date.now(), series: 'Collected ranking median', snapshots: observations, players: [...records.values()].filter((record) => record.points.length).sort((left, right) => String(left.name).localeCompare(String(right.name))) }
}

function decodeHtml(value: unknown) {
  return clean(String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#0?39;|&apos;/gi, "'").replace(/&quot;/gi, '"').replace(/&ndash;/gi, '–').replace(/&mdash;/gi, '—'))
}

function expertDirectory(html: string) {
  const found = new Map<string, string>()
  for (const match of html.matchAll(/<a\b[^>]*href=["']\/nfl\/rankings\/([a-z0-9-]+)\.php\?type=draft[^"']*["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (!found.has(match[1])) found.set(match[1], decodeHtml(match[2]).replace(/^View rankings for\s*/i, ''))
  }
  if (found.size < 10) throw new Error(`only ${found.size} FantasyPros experts found`)
  return [...found].map(([slug, label]) => ({ slug, label }))
}

function parseExpertRows(html: string) {
  const table = (html.match(/<table\b[^>]*id=["']data["'][^>]*>([\s\S]*?)<\/table>/i) ?? [])[1] ?? ''
  return table.split(/<tr\b/i).slice(1).flatMap((rowHtml) => {
    const cells = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => match[1])
    if (cells.length < 6) return []
    const overall = number(decodeHtml(cells[0])), playerLink = cells[1].match(/<a\b[^>]*class=["']([^"']*fp-player-link[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i)
    const playerName = decodeHtml(playerLink?.[2] ?? cells[1])
    if (!overall || !playerName) return []
    const positionRank = decodeHtml(cells[2]), foundPosition = positionRank.match(/^([A-Za-z/]+)/)
    return [{ overall, name: playerName, position: position(foundPosition?.[1]), team: team(decodeHtml(cells[3])), byeWeek: number(decodeHtml(cells[4])), ecr: number(decodeHtml(cells[5])), vsEcr: number(decodeHtml(cells[6])), adp: number(decodeHtml(cells[7])), vsAdp: number(decodeHtml(cells[8])), fantasyProsId: (playerLink?.[1].match(/fp-id-(\d+)/) ?? [])[1] }]
  })
}

export async function collectExpertBatch(scoring: 'ppr' | 'half' | 'standard', previous: Record<string, unknown> | null, cursor: number, batchSize = 5) {
  const directoryUrl = 'https://www.fantasypros.com/nfl/rankings/'
  const verdict = await allowed(directoryUrl)
  if (!verdict.allowed) throw new Error('robots.txt disallows the FantasyPros rankings directory')
  const directory = expertDirectory(await (await request(directoryUrl)).text())
  const start = cursor >= directory.length ? 0 : cursor
  const targets = [...directory.slice(start, start + batchSize), ...directory.slice(0, Math.max(0, start + batchSize - directory.length))]
  const experts = new Map<string, Record<string, unknown>>((Array.isArray(previous?.experts) ? previous.experts : []).map((entry) => [String((entry as Record<string, unknown>).slug), entry as Record<string, unknown>]))
  const players = { ...((previous?.players && typeof previous.players === 'object') ? previous.players as Record<string, Record<string, unknown>> : {}) }
  const failures: Array<{ expert: string; error: string }> = [], notPublished: string[] = []
  const scoringParam = { ppr: 'PPR', half: 'HALF', standard: 'STD' }[scoring]

  for (const target of targets) {
    try {
      const sourceUrl = `${directoryUrl}${target.slug}.php?type=draft&scoring=${scoringParam}`
      const html = await (await request(sourceUrl)).text()
      const identity = decodeHtml((html.match(/<title>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '').match(/^(.*?)\s*\((.*?)\)\s*\|/)
      const rows = parseExpertRows(html)
      if (!identity || !rows.length) { experts.delete(target.slug); notPublished.push(target.slug) }
      else {
        if (rows.length < 25) throw new Error(`only ${rows.length} rows parsed`)
        const ranks: Array<[string, number]> = []
        for (const row of rows) {
          const key = playerKey(row.name, row.team, row.position)
          players[key] = { n: row.name, t: row.team, p: row.position, b: row.byeWeek ?? null, ecr: row.ecr ?? null, adp: row.adp ?? null }
          ranks.push([key, Number(row.overall)])
        }
        experts.set(target.slug, { slug: target.slug, name: clean(identity[1]), outlet: clean(identity[2]), fetchedAt: Date.now(), count: ranks.length, ranks })
      }
    } catch (error) { failures.push({ expert: target.slug, error: error instanceof Error ? error.message : String(error) }) }
    if (verdict.delayMs) await sleep(verdict.delayMs)
  }

  const surviving = [...experts.values()]
  const referenced = new Set(surviving.flatMap((entry) => (entry.ranks as Array<[string, number]>).map(([key]) => key)))
  for (const key of Object.keys(players)) if (!referenced.has(key)) delete players[key]
  const payload = { schemaVersion: 1, scoring, fetchedAt: Date.now(), expertCount: surviving.length, playerCount: Object.keys(players).length, experts: surviving.sort((left, right) => String(left.name).localeCompare(String(right.name))), players, failures, notPublished }
  return { payload, nextCursor: failures.length === targets.length ? start : (start + targets.length) % directory.length, processed: targets.length, directorySize: directory.length, failures }
}
