(() => {
  const PAGE_SOURCE = 'draft-assistant-yahoo-page'
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
    const path = location.pathname.match(/\/f1\/(\d+)/i)
    const key = location.pathname.match(/(\d{3,})\.l\.(\d+)/)
    const leagueId = path?.[1] || key?.[2] || url.searchParams.get('lid') || url.searchParams.get('leagueId')
    const teamId = location.pathname.match(/\/f1\/\d+\/(\d+)/)?.[1] || url.searchParams.get('teamId')
    return { leagueId, season: url.searchParams.get('season') || DEFAULT_SEASON, teamId }
  }

  function leaguesFromDom() {
    const found = []
    for (const a of document.querySelectorAll('a[href*="/f1/"]')) {
      try {
        const href = new URL(a.getAttribute('href') || '', location.origin)
        const leagueId = href.pathname.match(/\/f1\/(\d+)/)?.[1]
        if (!leagueId) continue
        const name = (a.textContent || '').replace(/\s+/g, ' ').trim()
        found.push({ leagueId, name: name.length > 1 && name.length < 80 ? name : undefined, season: DEFAULT_SEASON })
      } catch { /* ignore */ }
    }
    return uniqueLeagues(found)
  }

  function scoringFromText(text) {
    const blob = text.toLowerCase()
    if (blob.includes('half ppr') || blob.includes('half-ppr') || blob.includes('0.5 ppr')) return 'half_ppr'
    if (/\bppr\b/.test(blob) && !blob.includes('non-ppr')) return 'ppr'
    if (blob.includes('standard') || blob.includes('non-ppr')) return 'std'
    return 'unknown'
  }

  function statusFromText(text) {
    const blob = text.toLowerCase()
    if (blob.includes('live draft') || blob.includes('on the clock') || blob.includes('draft in progress')) return 'drafting'
    if (blob.includes('draft results') || blob.includes('draft complete')) return 'complete'
    if (blob.includes('paused')) return 'paused'
    return 'pre_draft'
  }

  function teamsFromDom(leagueId) {
    const teams = new Map()
    const re = new RegExp(`/f1/${leagueId}/(\\d+)`)
    for (const a of document.querySelectorAll('a[href*="/f1/"]')) {
      const href = a.getAttribute('href') || ''
      const match = href.match(re)
      if (!match || match[1] === leagueId) continue
      const name = (a.textContent || '').replace(/\s+/g, ' ').trim()
      if (name.length < 2 || name.length > 80) continue
      teams.set(match[1], { id: match[1], name })
    }
    return [...teams.values()]
  }

  function leagueFromPage(leagueId, season, teamId) {
    const title = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
      || document.title
      || ''
    const name = title.split('|')[0].split('-')[0].replace(/yahoo fantasy football/i, '').trim()
    const text = document.body?.innerText || ''
    const teams = teamsFromDom(leagueId)
    if (teamId) {
      const you = teams.find((team) => team.id === teamId)
      if (you) you.isYou = true
    }
    return {
      name: name || `Yahoo ${leagueId}`,
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

  function pull() {
    if (inFlight) return
    inFlight = true
    try {
      const { leagueId, season, teamId } = pageIds()
      const availableLeagues = leaguesFromDom()
      if (leagueId) {
        const league = leagueFromPage(leagueId, season, teamId)
        const stamp = `${leagueId}:${league.name}:${league.teams.length}:${league.draftStatus}:${teamId || ''}`
        if (stamp === lastPosted) return
        lastPosted = stamp
        post({
          provider: 'yahoo',
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
        provider: 'yahoo',
        season,
        pageUrl: location.href,
        fetchedAt: Date.now(),
        availableLeagues,
        waiting: availableLeagues.length === 0,
        error: availableLeagues.length ? undefined : 'Open a Yahoo Fantasy league while logged in.',
      })
    } finally {
      inFlight = false
    }
  }

  pull()
  window.setInterval(pull, 4000)
})()
