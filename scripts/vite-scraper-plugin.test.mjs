import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { scraperPlugin } from './vite-scraper-plugin.mjs'

/**
 * A throwaway project root with stub scripts standing in for the collector and
 * the uploader, so the chaining can be driven without touching the network.
 */
function projectRoot({ collectorExit = 0, publishExit = 0 }) {
  const root = mkdtempSync(join(tmpdir(), 'scraper-plugin-'))
  mkdirSync(join(root, 'scripts'))
  writeFileSync(
    join(root, 'scripts/scrape-rankings.mjs'),
    `process.stdout.write(JSON.stringify({ sets: 2, rows: 10, players: 8 }));\nprocess.exit(${collectorExit});\n`,
  )
  writeFileSync(
    join(root, 'scripts/upload-supabase-artifacts.mjs'),
    `console.log('Uploaded 9 artifacts.');\nprocess.exit(${publishExit});\n`,
  )
  return root
}

function middlewareFor(root) {
  let handler
  scraperPlugin().configureServer({
    config: { root },
    middlewares: { use: (fn) => { handler = fn } },
  })
  return handler
}

function call(handler, { url, method, body }) {
  const req = new EventEmitter()
  req.url = url
  req.method = method
  const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v }, end(payload) { this.body = payload } }
  const done = new Promise((resolve) => {
    const finish = res.end.bind(res)
    res.end = (payload) => { finish(payload); resolve(JSON.parse(payload)) }
  })
  handler(req, res, () => {})
  if (method === 'POST') {
    req.emit('data', Buffer.from(JSON.stringify(body ?? {})))
    req.emit('end')
  }
  return done
}

async function runToCompletion(root) {
  const handler = middlewareFor(root)
  await call(handler, { url: '/api/scrape/run', method: 'POST', body: { only: ['fantasypros'] } })
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await call(handler, { url: '/api/scrape/status', method: 'GET' })
    if (!status.running) return status
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error('run never finished')
}

describe('collect and publish are one run', () => {
  it('publishes the collected files without a second command', async () => {
    const root = projectRoot({})
    try {
      const status = await runToCompletion(root)
      expect(status.result).toMatchObject({ sets: 2, rows: 10, players: 8 })
      expect(status.published).toBe(true)
      expect(status.error).toBeNull()
      expect(status.phase).toBeNull()
      const log = status.log.map((line) => line.text).join('\n')
      expect(log).toContain('upload-supabase-artifacts.mjs --if-configured')
      expect(log).toContain('Uploaded 9 artifacts.')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('reports a failed publish as the run failing', async () => {
    // A collection the app cannot read is not a success, however well it
    // scraped -- that silence is what left the board on stale numbers.
    const root = projectRoot({ publishExit: 1 })
    try {
      const status = await runToCompletion(root)
      expect(status.published).toBe(false)
      expect(status.error).toMatch(/publish exited with code 1/)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('does not publish when the collection failed', async () => {
    const root = projectRoot({ collectorExit: 2 })
    try {
      const status = await runToCompletion(root)
      expect(status.published).toBeNull()
      expect(status.error).toMatch(/collector exited with code 2/)
      expect(status.log.map((line) => line.text).join('\n')).not.toContain('Uploaded')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
