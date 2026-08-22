(() => {
  const PAGE_SOURCE = 'draft-assistant-nfl-page'
  const DEFAULT_SEASON = '2026'
  let lastPosted = ''
  let inFlight = false

  function uniqueLeagues(list) {
    const map = new Map()
    for (const item of list) {
      if (!item?.leagueId) continue
      const leagueId = String(item.leagueId)
      const prev = map.get(leagueId)
      map.set(leagueId, { leagueId, name: item.name || prev?.name, season: String(item.season || prev?.season || DEFAULT_SEASON) })
    }
    return [...map.values()]
  }

  function pageIds() {
    const url = new URL(location.href)
    const leagueId = url.searchParams.get('leagueId') || location.pathname.match(/\/league\/(\d+)/)?.[1]
    const teamId = url.searchParams.get('teamId') || location.pathname.match(/\/team(?:home)?\/(\d+)/)?.[1]
    const season = url.searchParams.get('season') || url.searchParams.get('statSeason') || DEFAULT_SEASON
    return { leagueId, season, teamId }
  }

  function leaguesFromDom() {
    const found = []
    for (const a of document.querySelectorAll('a[href*="/league/"], a[href*="leagueId="]')) {
      try {
        const href = new URL(a.getAttribute('href') || '', location.origin)
        const leagueId = href.searchParams.get('leagueId') || href.pathname.match(/\/league\/(\d+)/)?.[1]
        if (!leagueId) continue
        const name = (a.textContent || '').replace(/\s+/g, ' ').trim()
        found.push({
          leagueId,
          name: name.length > 1 && name.length < 80 ? name : undefined,
          season: href.searchParams.get('season') || DEFAULT_SEASON,
        })
      } catch { /* ignore */ }
    }
    return uniqueLeagues(found)
  }

  function scoringFromText(text) {
    const blob = text.toLowerCase()
    if (blob.includes('half ppr') || blob.includes('0.5 ppr') || blob.includes('point per reception: 0.5')) return 'half_ppr'
    if (blob.includes('point per reception: 1') || /\bppr\b/.test(blob)) return 'ppr'
    if (blob.includes('standard')) return 'std'
    return 'unknown'
  }

  function statusFromText(text) {
    const blob = text.toLowerCase()
    if (blob.includes('on the clock') || blob.includes('draft in progress') || blob.includes('live draft')) return 'drafting'
    if (blob.includes('draft complete') || blob.includes('draft results')) return 'complete'
    if (blob.includes('paused')) return 'paused'
    return 'pre_draft'
  }

  function teamsFromDom(leagueId) {
    const teams = new Map()
    for (const a of document.querySelectorAll(`a[href*="/league/${leagueId}"], a[href*="leagueId=${leagueId}"]`)) {
      const href = a.getAttribute('href') || ''
      const teamId = href.match(/teamId=(\d+)/)?.[1] || href.match(/\/team(?:home)?\/(\d+)/)?.[1]
      if (!teamId) continue
      const name = (a.textContent || '').replace(/\s+/g, ' ').trim()
      if (name.length < 2 || name.length > 80) continue
      teams.set(teamId, { id: teamId, name })
    }
    return [...teams.values()]
  }

  function collectFromJson(root, leagueId, season) {
    if (!root || typeof root !== 'object') return null
    const seen = new Set()
    const stack = [root]
    let name
    const teams = new Map()
    while (stack.length) {
      const node = stack.pop()
      if (!node || typeof node !== 'object' || seen.has(node)) continue
      seen.add(node)
      if (typeof node.name === 'string' && (node.leagueId == leagueId || node.id == leagueId || node.leagueName)) {
        name = node.leagueName || node.name
      }
      const teamId = node.teamId ?? node.team_id
      if (teamId != null && (node.teamName || node.name)) {
        teams.set(String(teamId), { id: String(teamId), name: String(node.teamName || node.name) })
      }
      for (const value of Array.isArray(node) ? node : Object.values(node)) stack.push(value)
    }
    if (!name && !teams.size) return null
    return {
      name: name || `NFL.com ${leagueId}`,
      teamCount: teams.size,
      scoringType: 'unknown',
      draftType: 'snake',
      draftStatus: 'pre_draft',
      teams: [...teams.values()],
      picks: [],
      season,
    }
  }

  async function fetchLeagueJson(leagueId) {
    const urls = [
      `${location.origin}/league/${leagueId}?format=json`,
      `https://api.fantasy.nfl.com/v2/league/details?leagueId=${encodeURIComponent(leagueId)}&format=json`,
    ]
    for (const url of urls) {
      try {
        const response = await fetch(url, { credentials: 'include' })
        if (!response.ok) continue
        const data = await response.json()
        const mapped = collectFromJson(data, leagueId)
        if (mapped) return mapped
      } catch { /* try the next same-origin or host-permitted URL */ }
    }
    return null
  }

  function leagueFromPage(leagueId, season, teamId) {
    const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content') || document.title || ''
    const name = title.split('|')[0].split('-')[0].replace(/nfl fantasy/i, '').trim()
    const text = document.body?.innerText || ''
    const teams = teamsFromDom(leagueId)
    if (teamId) {
      const you = teams.find((team) => team.id === teamId)
      if (you) you.isYou = true
    }
    return {
      name: name || `NFL.com ${leagueId}`,
      teamCount: teams.length,
      scoringType: scoringFromText(text),
      draftType: /auction/i.test(text) ? 'auction' : 'snake',
      draftStatus: statusFromText(text),
      teams,
      picks: [],
    }
  }

  function post(payload) {
    window.postMessage({ source: PAGE_SOURCE, ...payload }, '*')
  }

  async function pull() {
    if (inFlight) return
    inFlight = true
    try {
      const { leagueId, season, teamId } = pageIds()
      const availableLeagues = leaguesFromDom()
      if (leagueId) {
        const fromApi = await fetchLeagueJson(leagueId)
        const fromPage = leagueFromPage(leagueId, season, teamId)
        const league = {
          ...fromPage,
          ...(fromApi || {}),
          name: fromApi?.name || fromPage.name,
          teams: (fromApi?.teams?.length ? fromApi.teams : fromPage.teams).map((team) => ({
            ...team,
            isYou: team.id === teamId || team.isYou,
          })),
          teamCount: (fromApi?.teams?.length || fromPage.teams.length),
          scoringType: fromPage.scoringType !== 'unknown' ? fromPage.scoringType : (fromApi?.scoringType ?? 'unknown'),
          draftStatus: fromPage.draftStatus,
        }
        const stamp = `${leagueId}:${league.name}:${league.teams.length}:${league.draftStatus}:${teamId || ''}`
        if (stamp === lastPosted) return
        lastPosted = stamp
        post({
          provider: 'nfl',
          leagueId,
          season,
          teamId,
          pageUrl: location.href,
          fetchedAt: Date.now(),
          league,
          availableLeagues,
        })
        return
      }
      const stamp = `list:${availableLeagues.map((item) => item.leagueId).join(',')}`
      if (stamp === lastPosted) return
      lastPosted = stamp
      post({
        provider: 'nfl',
        season,
        pageUrl: location.href,
        fetchedAt: Date.now(),
        availableLeagues,
        waiting: availableLeagues.length === 0,
        error: availableLeagues.length ? undefined : 'Open an NFL Fantasy league while logged in.',
      })
    } finally {
      inFlight = false
    }
  }

  void pull()
  window.setInterval(() => { void pull() }, 4000)
})()
