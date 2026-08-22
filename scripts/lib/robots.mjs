/**
 * Minimal robots.txt reader: one fetch per origin, cached for the life of the
 * process, prefix matching, plus Crawl-delay.
 *
 * Deliberately small. None of the sources we collect from publish Allow rules
 * or wildcard paths, so there is no pattern engine here -- if a source starts
 * using them, this will under-match and needs revisiting.
 *
 * Every path this project collects is already permitted; the check is here so
 * an unattended scheduled run notices if that stops being true.
 */

const cache = new Map()

function parse(text) {
  const groups = []
  let current = null
  let lastWasAgent = false

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const index = line.indexOf(':')
    if (!line || index === -1) continue
    const key = line.slice(0, index).trim().toLowerCase()
    const value = line.slice(index + 1).trim()

    if (key === 'user-agent') {
      // Consecutive User-agent lines share one group of rules.
      if (!current || !lastWasAgent) {
        current = { agents: [], disallow: [], crawlDelay: null }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
      continue
    }

    lastWasAgent = false
    if (!current) continue
    // An empty Disallow means "nothing is disallowed", not a rule.
    if (key === 'disallow' && value) current.disallow.push(value)
    else if (key === 'crawl-delay') {
      const delay = Number(value)
      if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay
    }
  }
  return groups
}

/** Most specific matching agent wins; the `*` group is the fallback. */
function selectGroup(groups, userAgent) {
  const agent = userAgent.toLowerCase()
  let best = null
  let bestLength = -1
  let wildcard = null

  for (const group of groups) {
    for (const candidate of group.agents) {
      if (candidate === '*') wildcard ??= group
      else if (agent.includes(candidate) && candidate.length > bestLength) {
        best = group
        bestLength = candidate.length
      }
    }
  }
  return best ?? wildcard
}

async function load(origin, userAgent, fetchImpl) {
  const response = await fetchImpl(`${origin}/robots.txt`, {
    headers: { 'user-agent': userAgent, accept: 'text/plain' },
    signal: AbortSignal.timeout(15_000),
  })
  // 4xx means no usable robots file, which is not a denial. 5xx is a server
  // fault rather than a policy, so treat it the same but record the status.
  if (!response.ok) return { groups: [], missing: true, status: response.status }
  return { groups: parse(await response.text()), missing: false, status: response.status }
}

export async function getRobots(url, userAgent, fetchImpl = fetch) {
  const origin = new URL(url).origin
  if (!cache.has(origin)) {
    cache.set(origin, load(origin, userAgent, fetchImpl).catch((error) => ({
      groups: [],
      missing: true,
      status: null,
      error: error instanceof Error ? error.message : String(error),
    })))
  }
  const robots = await cache.get(origin)
  return { ...robots, group: selectGroup(robots.groups, userAgent) }
}

export function checkPath(group, pathname) {
  const hit = group?.disallow.find((path) => pathname.startsWith(path))
  return hit ? { allowed: false, reason: `Disallow: ${hit}` } : { allowed: true, reason: null }
}

export function crawlDelay(group) {
  return group?.crawlDelay ?? null
}

export function resetRobotsCache() {
  cache.clear()
}
