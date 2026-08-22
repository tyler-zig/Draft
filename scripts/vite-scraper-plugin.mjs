/**
 * Dev-server control plane for the rankings collector.
 *
 * The collector is a Node script: the browser cannot run it, and could not
 * fetch those origins directly anyway (no CORS headers on any of them). So the
 * UI drives it through the dev server, which is the same arrangement the
 * Sleeper proxy in vite.config.ts already uses.
 *
 * This exists only under `vite dev` and `vite preview`. A static production
 * build has no server attached and therefore no scrape endpoint -- the UI
 * detects that and says so rather than offering a button that cannot work.
 */

import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const MAX_LOG_LINES = 400

/**
 * Only these may be passed through to the CLI. Anything arriving from the page
 * is validated against this rather than forwarded, so the endpoint cannot be
 * talked into running an arbitrary command line.
 */
const GROUPS = new Set(['rotowire', 'fantasypros', 'fantasypros-adp', 'espn'])
const MAX_CONCURRENCY = 8

const state = {
  running: false,
  /** 'collecting' | 'publishing' | null -- so the UI can name the slow half. */
  phase: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  args: null,
  log: [],
  result: null,
  error: null,
  published: null,
}

function push(line) {
  for (const part of String(line).split(/\r?\n/)) {
    if (!part.trim()) continue
    state.log.push({ at: Date.now(), text: part })
  }
  if (state.log.length > MAX_LOG_LINES) {
    state.log.splice(0, state.log.length - MAX_LOG_LINES)
  }
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      // Nothing legitimate here is large; refuse to buffer more than a token.
      if (size > 16_384) reject(new Error('request body too large'))
      else chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolveBody({})
      try {
        resolveBody(JSON.parse(raw))
      } catch {
        reject(new Error('request body was not valid JSON'))
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.statusCode = status
  res.setHeader('content-type', 'application/json')
  res.setHeader('cache-control', 'no-store')
  res.end(body)
}

/** Builds an argv from validated fields only -- never from raw request text. */
function buildArgs(body) {
  const args = ['--quiet']

  if (Array.isArray(body.only) && body.only.length > 0) {
    const groups = body.only.filter((group) => GROUPS.has(group))
    if (groups.length === 0) throw new Error('no recognised source groups selected')
    // Selecting everything is the same as passing no filter, and avoids
    // --only's habit of overwriting latest.json with a partial run.
    if (groups.length < GROUPS.size) args.push(`--only=${groups.join(',')}`)
  }

  const concurrency = Number(body.concurrency)
  if (Number.isFinite(concurrency)) {
    args.push(`--concurrency=${Math.min(MAX_CONCURRENCY, Math.max(1, Math.trunc(concurrency)))}`)
  }

  if (body.ignoreRobots === true) args.push('--ignore-robots')
  return args
}

function finish(code) {
  state.running = false
  state.phase = null
  state.finishedAt = Date.now()
  state.exitCode = code
}

/**
 * Pushes the freshly collected files to Supabase.
 *
 * Part of the same run, not a separate command anyone has to remember: the app
 * reads rankings from Supabase and only falls back to public/, so a collection
 * that stops at the filesystem is invisible to it. Reporting the run as
 * finished at that point was the bug -- the numbers on screen were the last
 * upload's, with nothing saying so.
 *
 * `--if-configured` keeps a checkout with no credentials working: it collects,
 * skips the push, and says so.
 */
function publish(root) {
  state.phase = 'publishing'
  push('> node scripts/upload-supabase-artifacts.mjs --if-configured')
  const script = resolve(root, 'scripts/upload-supabase-artifacts.mjs')
  const child = spawn(process.execPath, [script, '--if-configured'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  child.stdout.on('data', (chunk) => push(chunk.toString()))
  child.stderr.on('data', (chunk) => push(chunk.toString()))

  child.on('error', (error) => {
    state.error ??= `publish failed to start: ${error.message}`
    push(`publish failed to start: ${error.message}`)
    state.published = false
    finish(1)
  })

  child.on('close', (code) => {
    state.published = code === 0
    // A collection the app cannot see is not a success, so this surfaces as
    // the run's error rather than a line buried in the log.
    if (code !== 0) state.error ??= `publish exited with code ${code}`
    finish(code)
  })
}

function start(root, body) {
  const args = buildArgs(body)
  const script = resolve(root, 'scripts/scrape-rankings.mjs')

  Object.assign(state, {
    running: true,
    phase: 'collecting',
    startedAt: Date.now(),
    finishedAt: null,
    exitCode: null,
    args,
    log: [],
    result: null,
    error: null,
    published: null,
  })
  push(`> node scripts/scrape-rankings.mjs ${args.join(' ')}`)

  // Argument array, no shell: nothing here is interpreted by a command line.
  const child = spawn(process.execPath, [script, ...args], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => push(chunk.toString()))

  child.on('error', (error) => {
    state.error = error.message
    push(`failed to start: ${error.message}`)
    finish(1)
  })

  child.on('close', (code) => {
    try {
      state.result = JSON.parse(stdout)
      const { sets, rows, players } = state.result
      push(`collected: ${sets} sets, ${rows} rows, ${players} players`)
    } catch {
      if (code === 0) state.error ??= 'collector produced no summary'
      push(stdout.trim() || `exited with code ${code}`)
    }
    if (code !== 0) {
      state.error ??= `collector exited with code ${code}`
      return finish(code)
    }
    // Nothing to publish if the collection failed; otherwise always publish,
    // because the app reads what was published, not what is on disk.
    publish(root)
  })
}

function middleware(root) {
  return async (req, res, next) => {
    const url = (req.url ?? '').split('?')[0]
    if (!url.startsWith('/api/scrape')) return next()

    try {
      if (url === '/api/scrape/status' && req.method === 'GET') {
        return send(res, 200, state)
      }
      if (url === '/api/scrape/run' && req.method === 'POST') {
        if (state.running) return send(res, 409, { error: 'a collection is already running' })
        start(root, await readBody(req))
        return send(res, 202, state)
      }
      return send(res, 404, { error: 'unknown scrape endpoint' })
    } catch (error) {
      return send(res, 400, { error: error instanceof Error ? error.message : String(error) })
    }
  }
}

export function scraperPlugin() {
  return {
    name: 'draft-assistant-scraper',
    apply: () => true,
    configureServer(server) {
      server.middlewares.use(middleware(server.config.root))
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware(server.config.root))
    },
  }
}
