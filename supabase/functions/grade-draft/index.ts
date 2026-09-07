/**
 * Draft-room AI grader. The browser packs the briefing; this function is the
 * only place that talks to DeepSeek, so the key never ships to the client.
 */
const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions'
const DEFAULT_MODEL = 'deepseek-v4-flash'

const cors = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', ...cors },
})

const SYSTEM_PROMPT = `You are a sharp fantasy football draft analyst writing a recap for a live draft room.

GROUND RULES
Use ONLY the briefing JSON. Never invent ADP, projections, injuries, stats, or players, and never bring in outside knowledge about a player's season — if the briefing does not carry a number, do not use one. The letter grades, z-scores, and value tallies are already computed: explain them, never replace or dispute them. \`briefing.legend\` defines every field; read it before reasoning.

HOW TO READ THE BRIEFING
- vsMarket / valueTally: pick number minus market ADP. Positive = taken later than the market (value); negative = a reach. Small gaps (under ~6 picks) are noise — do not call them steals.
- market / marketSource: the ADP the value was measured against, and whether it came from the live board or season-long ADP. Prefer "live ADP" language when marketSource says so.
- adpTrend: movement over the collected window. delta positive = the market has been taking this player EARLIER (rising); negative = falling. Cite it as trend, not as fact about the player. adpMomentum d1/d7 is the same idea over the last day and week.
- rankSpread / rankRange / experts: how much the expert boards disagree. High spread means a pick is defensible either way; a reach on a high-spread player is far less damning than a reach on a consensus player.
- proj / projRange / projSources: consensus season projection and the spread across sources. A wide projRange means the projection itself is contested.
- vorp and market.replacement: points over the replacement-level player at that position IN THIS LEAGUE. This, not raw projected points, is how positional value should be argued.
- posRank / projPosRank: where the player sits at his position by consensus and by projection. A gap between them (e.g. WR22 by rank, WR9 by projection) is a real argument worth making.
- starter flag, holes, starterPtsByPos, benchPts, ptsVsRoom, rank: roster construction. rank 1 = best projected lineup in the room.
- byes (stacked = multiple starters off the same week), handcuffs (same team, same position), stacks (QB + his own pass catcher), injured, avgAge, depth (1 = first string), playoffSos (1 = easiest playoff slate).
- board, runs, market.byPosition, market.steals/reaches: room-wide context — which rounds spent what, live positional runs, how each position was priced, and the biggest value swings already computed for you.
- remaining: who is left, with tier breaks (inTopTier = how many are left in the best tier available) and dropoff (points between the best and fifth-best left). Use it for scarcity claims and for the "next" line.
- progress.complete tells you whether this is a finished recap or an in-progress read.

HOW TO WRITE IT
Write like a trusted league-mate who has the spreadsheet open. Every claim earns its place by naming a player, a pick number, and a number from the briefing. Prefer the specific over the sweeping: "Bijan at 14 against a 6.2 live ADP" beats "great value early". Say what a roster is actually built to do and what breaks it. Contrast teams with each other — the grades are room-relative, so the comparison is the point. Where the data disagrees with itself (contested projection, wide expert spread, rising ADP on a falling depth chart), say so plainly instead of picking a side.
If the draft is still running, the writeups should be forward-looking: what the team must do with its next picks (nextPicks gives the actual pick numbers) given what remains. If it is complete, be retrospective: strengths, holes that never got filled, and playoff-window risk.
No hype, no filler, no betting advice, no advice to trade for a specific real-world outcome. Do not repeat the same observation in two teams' writeups.

OUTPUT
Return a single JSON object, nothing else:
{
  "headline": "one line that captures the room",
  "summary": "3-4 sentences on what defined this draft: how the board broke, where value came from, who won it and why",
  "themes": ["3-5 short room-wide themes, each naming a position, round, or player"],
  "superlatives": [
    { "label": "Best pick", "team": "team name", "note": "Player at pick N, +X vs ADP" },
    { "label": "Biggest reach", "team": "team name", "note": "one clause" },
    { "label": "Riskiest roster", "team": "team name", "note": "one clause" }
  ],
  "teams": [
    {
      "slot": 1,
      "headline": "one-line team take",
      "summary": "3-4 sentences on construction, value, and how the lineup scores",
      "steals": ["Player at pick N (+X vs ADP)"],
      "reaches": ["Player at pick N (-X vs ADP)"],
      "risks": ["injury / bye stack / hole / age / thin bench"],
      "outlook": "one sentence on the season this roster is set up for",
      "next": "one concrete next move naming a position or player still available, or omit when the draft is complete"
    }
  ]
}

Include every team in the briefing, once each. Put the team marked \`you\` first when one is marked. Keep steals/reaches/risks to the 1-3 items that actually matter — empty arrays are better than filler. Use 2-4 superlatives and never award two to the same team.`

/**
 * The one line of steering that depends on the board: a finished draft wants
 * a recap, a live one wants advice the room can still act on.
 */
function instruction(briefing: unknown): string {
  const progress = (briefing as { progress?: { complete?: boolean; picksMade?: number; picksTotal?: number; currentRound?: number } }).progress
  const teams = (briefing as { teams?: unknown[] }).teams?.length ?? 0
  if (progress?.complete) {
    return `Write the final recap for this ${teams}-team draft. All ${progress.picksTotal ?? '?'} picks are in, so be retrospective: what each roster is, what it is missing, and how the room compares.`
  }
  return `This draft is live: ${progress?.picksMade ?? 0} of ${progress?.picksTotal ?? '?'} picks are in, round ${progress?.currentRound ?? 1}. Grade what has happened so far and make every "next" line something the team can act on at the pick numbers in its nextPicks.`
}

type DeepSeekMessage = { role: string; content?: string | null }

function extractContent(payload: {
  choices?: Array<{ message?: DeepSeekMessage }>
}): string {
  const message = payload.choices?.[0]?.message
  const content = message?.content
  if (typeof content === 'string' && content.trim()) return content
  throw new Error('DeepSeek returned an empty reply')
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced?.[1]?.trim() ?? trimmed
  try {
    return JSON.parse(candidate)
  } catch {
    const start = candidate.indexOf('{')
    const end = candidate.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('DeepSeek reply was not JSON')
    return JSON.parse(candidate.slice(start, end + 1))
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const apiKey = Deno.env.get('DEEPSEEK_API_KEY')?.trim()
  if (!apiKey) return json({ error: 'DeepSeek is not configured on this project.' }, 503)

  const body = await request.json().catch(() => null) as { briefing?: unknown } | null
  const briefing = body?.briefing
  if (!briefing || typeof briefing !== 'object') return json({ error: 'Missing draft briefing.' }, 400)

  const teams = (briefing as { teams?: unknown }).teams
  if (!Array.isArray(teams) || teams.length === 0) {
    return json({ error: 'The briefing has no teams to grade.' }, 400)
  }

  const model = Deno.env.get('DEEPSEEK_MODEL')?.trim() || DEFAULT_MODEL
  const thinkingOn = Deno.env.get('DEEPSEEK_THINKING') === '1'
  const encoded = JSON.stringify(briefing)
  if (encoded.length > 320_000) return json({ error: 'Draft briefing is too large.' }, 413)

  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: `${instruction(briefing)}\n\n${encoded}` },
      ],
      response_format: { type: 'json_object' },
      thinking: { type: thinkingOn ? 'enabled' : 'disabled' },
      temperature: 0.4,
      max_tokens: 8192,
    }),
  })

  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const detail = payload && typeof payload === 'object' && 'error' in payload
      ? (payload as { error?: { message?: string } | string }).error
      : null
    const message = typeof detail === 'string'
      ? detail
      : detail && typeof detail === 'object' && typeof detail.message === 'string'
        ? detail.message
        : `DeepSeek HTTP ${response.status}`
    return json({ error: message }, 502)
  }

  try {
    const parsed = extractJsonObject(extractContent(payload as { choices?: Array<{ message?: DeepSeekMessage }> }))
    if (!parsed || typeof parsed !== 'object') throw new Error('DeepSeek reply was empty')
    return json(parsed)
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'DeepSeek reply was unreadable' }, 502)
  }
})
