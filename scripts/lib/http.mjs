/**
 * Fetch with timeouts, bounded retries and per-host pacing.
 *
 * The pacing is not only courtesy: an unattended six-hourly job that trips a
 * rate limiter loses the whole run, so a queue that keeps us under the limit
 * collects more data than firing everything at once.
 */

import { getRobots, checkPath, crawlDelay } from './robots.mjs'

export const USER_AGENT =
  'DraftAssistantRankingsCollector/2.0 (+https://example.invalid/contact)'

const RETRY_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

const DEFAULT_CONCURRENCY = 4

const hosts = new Map()

function hostState(origin) {
  let state = hosts.get(origin)
  if (!state) {
    state = { queue: [], active: 0, minDelayMs: 0, concurrency: DEFAULT_CONCURRENCY }
    hosts.set(origin, state)
  }
  return state
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A declared Crawl-delay is a statement about request *spacing*, which only
 * means anything if requests are serialised -- so adopting one also drops this
 * host to a single in-flight request.
 */
export function setHostDelay(origin, ms) {
  const state = hostState(origin)
  state.minDelayMs = Math.max(state.minDelayMs, ms)
  if (state.minDelayMs > 0) state.concurrency = 1
}

export function setHostConcurrency(origin, limit) {
  const state = hostState(origin)
  if (state.minDelayMs === 0) state.concurrency = Math.max(1, limit)
}

function pump(state) {
  while (state.active < state.concurrency && state.queue.length > 0) {
    const job = state.queue.shift()
    state.active += 1
    job.task().then(job.resolve, job.reject).finally(async () => {
      // Spacing is measured between the end of one request and the start of
      // the next, which is the conservative reading of Crawl-delay.
      if (state.minDelayMs > 0) await sleep(state.minDelayMs)
      state.active -= 1
      pump(state)
    })
  }
}

/**
 * Bounded per-origin queue. Different hosts run fully in parallel; within a
 * host we stay under the limit so a scheduled run does not trip a rate limiter
 * and lose everything.
 */
function schedule(origin, task) {
  const state = hostState(origin)
  return new Promise((resolve, reject) => {
    state.queue.push({ task, resolve, reject })
    pump(state)
  })
}

function retryAfterMs(response) {
  const header = response.headers.get('retry-after')
  if (!header) return null
  const seconds = Number(header)
  if (Number.isFinite(seconds)) return seconds * 1000
  const date = Date.parse(header)
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null
}

export async function fetchText(url, options = {}) {
  const {
    attempts = 3,
    timeoutMs = 20_000,
    accept = 'text/html,application/xhtml+xml',
    headers = {},
    onRetry,
  } = options

  const origin = new URL(url).origin
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await schedule(origin, () =>
        fetch(url, {
          headers: { 'user-agent': USER_AGENT, accept, ...headers },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        }),
      )

      if (response.ok) return { text: await response.text(), response }

      if (!RETRY_STATUS.has(response.status) || attempt === attempts) {
        throw new Error(`HTTP ${response.status}`)
      }
      // Honour Retry-After when the server sends one; otherwise back off.
      const wait = retryAfterMs(response) ?? 500 * 2 ** (attempt - 1)
      onRetry?.({ url, attempt, status: response.status, waitMs: wait })
      await sleep(wait)
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === attempts) break
      const wait = 500 * 2 ** (attempt - 1)
      onRetry?.({ url, attempt, status: null, waitMs: wait, error: lastError.message })
      await sleep(wait)
    }
  }
  throw lastError ?? new Error('request failed')
}

export async function fetchJson(url, options = {}) {
  const { text } = await fetchText(url, { accept: 'application/json', ...options })
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('response was not valid JSON')
  }
}

/**
 * FantasyPros puts `published` before the player array. Read just enough to
 * compare that stamp, then cancel when it has not moved so we do not pull the
 * rest of a 250KB board we already have.
 */
export async function fetchJsonUnlessPublished(url, previousPublished, options = {}) {
  if (!previousPublished) return { unchanged: false, data: await fetchJson(url, options) }

  const {
    attempts = 3,
    timeoutMs = 20_000,
    headers = {},
    onRetry,
    readPublished,
  } = options
  if (typeof readPublished !== 'function') throw new Error('readPublished is required')

  const origin = new URL(url).origin
  let lastError = null

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await schedule(origin, () =>
        fetch(url, {
          headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...headers },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        }),
      )
      if (response.ok) return readPublishedDecision(response, previousPublished, readPublished)
      if (!RETRY_STATUS.has(response.status) || attempt === attempts) {
        throw new Error(`HTTP ${response.status}`)
      }
      const wait = retryAfterMs(response) ?? 500 * 2 ** (attempt - 1)
      onRetry?.({ url, attempt, status: response.status, waitMs: wait })
      await sleep(wait)
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      if (attempt === attempts) break
      const wait = 500 * 2 ** (attempt - 1)
      onRetry?.({ url, attempt, status: null, waitMs: wait, error: lastError.message })
      await sleep(wait)
    }
  }
  throw lastError ?? new Error('request failed')
}

async function readPublishedDecision(response, previousPublished, readPublished) {
  const result = await readBodyUntilPublished(response, previousPublished, readPublished)
  if (result.unchanged) return result
  try {
    return { unchanged: false, data: JSON.parse(result.text) }
  } catch {
    throw new Error('response was not valid JSON')
  }
}

async function readBodyUntilPublished(response, previousPublished, readPublished) {
  if (!response.body) {
    const text = await response.text()
    const published = readPublished(text)
    if (published && published === previousPublished) return { unchanged: true, published }
    return { unchanged: false, text }
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
      if (published === previousPublished) {
        await reader.cancel()
        return { unchanged: true, published }
      }
    }
    text += decoder.decode()
    return { unchanged: false, text }
  } catch (error) {
    await reader.cancel().catch(() => {})
    throw error
  }
}

/**
 * Resolves robots policy for an origin once and applies its Crawl-delay to
 * this host's queue. Returns whether `url` may be collected.
 */
export async function guard(url, { ignoreRobots = false } = {}) {
  if (ignoreRobots) return { allowed: true, reason: 'robots check disabled', delay: null }
  const robots = await getRobots(url, USER_AGENT)
  const delay = crawlDelay(robots.group)
  if (delay) setHostDelay(new URL(url).origin, delay * 1000)
  const verdict = checkPath(robots.group, new URL(url).pathname)
  return { ...verdict, delay, robotsMissing: robots.missing }
}
