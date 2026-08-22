import { useCallback, useEffect, useRef, useState } from 'react'
import {
  NoCollectorError,
  SOURCE_GROUPS,
  getScrapeStatus,
  startScrape,
  type ScrapeStatus,
  type SourceGroup,
} from '../rankings/scraperApi'
import {
  fetchCollectedSnapshot,
  installCollectedSets,
  type CollectedSnapshot,
  type Granularity,
} from '../rankings/collected'
import type { Player } from '../providers/types'
import { Select } from './Select'

const POLL_MS = 1000

function ago(timestamp: number): string {
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function ScraperPanel({
  directory,
  onChange,
}: {
  directory: Player[]
  onChange: () => void | Promise<void>
}) {
  const [status, setStatus] = useState<ScrapeStatus | null>(null)
  const [available, setAvailable] = useState<boolean | null>(null)
  const [snapshot, setSnapshot] = useState<CollectedSnapshot | null>(null)
  const [selected, setSelected] = useState<SourceGroup[]>(['fantasypros', 'rotowire', 'espn'])
  const [granularity, setGranularity] = useState<Granularity>('format')
  const [concurrency, setConcurrency] = useState(4)
  const [ignoreRobots, setIgnoreRobots] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  const wasRunning = useRef(false)

  const refreshSnapshot = useCallback(async () => {
    try {
      setSnapshot(await fetchCollectedSnapshot())
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

  // Polls the collector and reloads the snapshot whenever a run finishes.
  // Fast while a run is in flight, slow otherwise so a collection started from
  // a terminal still shows up here.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    let first = true

    async function tick() {
      try {
        const next = await getScrapeStatus(controller.signal)
        if (cancelled) return
        setAvailable(true)
        setStatus(next)
        if (first || (wasRunning.current && !next.running)) await refreshSnapshot()
        wasRunning.current = next.running
      } catch (caught) {
        if (cancelled) return
        if (caught instanceof NoCollectorError) {
          setAvailable(false)
          // No collector here, but a snapshot committed to disk may still exist.
          if (first) await refreshSnapshot()
        }
      } finally {
        first = false
      }
    }

    void tick()
    const timer = setInterval(tick, status?.running ? POLL_MS : POLL_MS * 8)
    return () => {
      cancelled = true
      controller.abort()
      clearInterval(timer)
    }
  }, [status?.running, refreshSnapshot])

  useEffect(() => {
    const node = logRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [status?.log.length])

  function toggleSource(id: SourceGroup) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  async function run() {
    setError(null)
    setNotice(null)
    try {
      setStatus(await startScrape({ only: selected, concurrency, ignoreRobots }))
      wasRunning.current = true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function install() {
    setError(null)
    setNotice(null)
    setBusy(true)
    try {
      const current = snapshot ?? (await fetchCollectedSnapshot())
      if (!current) throw new Error('No snapshot on disk yet. Run a collection first.')
      const sets = await installCollectedSets(current, directory, granularity)
      setNotice(`Loaded ${sets.length} ranking ${sets.length === 1 ? 'set' : 'sets'}. Enable them in the recipe.`)
      await onChange()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  const running = status?.running ?? false
  const result = status?.result

  return (
    <section className="rounded border border-line bg-panel-2 p-3 text-sm">
      <header className="mb-2 flex items-center gap-2">
        <h3 className="font-semibold">Rankings collector</h3>
        {snapshot ? (
          <span className="text-xs text-muted">
            snapshot {ago(snapshot.fetchedAt)} · {snapshot.stats.sets} boards ·{' '}
            {snapshot.stats.players} players
          </span>
        ) : (
          <span className="text-xs text-muted">no snapshot yet</span>
        )}
      </header>

      {available === false ? (
        <p className="rounded bg-panel px-3 py-2 text-xs text-muted">
          The collector runs on the dev server and is not attached to this build. Run{' '}
          <code className="text-accent">npm run dev</code>, or collect from a terminal with{' '}
          <code className="text-accent">npm run scrape:rankings</code>.
        </p>
      ) : (
        <>
          <div className="mb-2 flex flex-wrap gap-3">
            {SOURCE_GROUPS.map((source) => (
              <label key={source.id} className="flex items-start gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={selected.includes(source.id)}
                  disabled={running}
                  onChange={() => toggleSource(source.id)}
                />
                <span>
                  <span className="font-medium">{source.label}</span>
                  <span className="block text-muted">{source.detail}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-1.5">
              Requests per host
              <input
                type="number"
                min={1}
                max={8}
                value={concurrency}
                disabled={running}
                onChange={(event) => setConcurrency(Number(event.target.value))}
                className="w-14 rounded border border-line bg-panel px-1.5 py-0.5 tabular-nums"
              />
            </label>

            <label className="flex items-center gap-1.5">
              Load as
              <Select
                value={granularity}
                onChange={(event) => setGranularity(event.target.value as Granularity)}
                className="rounded border border-line bg-panel px-1.5 py-0.5"
              >
                <option value="format">One set per scoring format</option>
                <option value="board">One set per board (~74)</option>
              </Select>
            </label>

            <label className="flex items-center gap-1.5" title="Needed for FantasyPros Real-Time ADP, whose data lives under a /json/ path their robots.txt disallows. For every other source it only drops the crawl-delay and the check that would notice a source's terms changing.">
              <input
                type="checkbox"
                checked={ignoreRobots}
                disabled={running}
                onChange={(event) => setIgnoreRobots(event.target.checked)}
              />
              <span className="text-muted">Ignore robots.txt</span>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void run()}
              disabled={running || selected.length === 0}
              className="rounded bg-accent px-3 py-1 text-xs font-semibold text-bg disabled:opacity-60"
            >
              {running ? (status?.phase === 'publishing' ? 'Publishing…' : 'Collecting…') : 'Collect now'}
            </button>
            <button
              type="button"
              onClick={() => void install()}
              disabled={busy || running || !snapshot}
              className="rounded border border-line px-3 py-1 text-xs font-semibold disabled:opacity-60"
            >
              Load into rankings
            </button>
            {result && !running ? (
              <span className="text-xs text-muted">
                {result.sets} sets · {result.rows} rows · {result.players} players ·{' '}
                {result.espnIdsAttached} IDs matched
                {status?.published === false ? ' · not published' : status?.published ? ' · published' : ' · local only'}
              </span>
            ) : null}
          </div>

          {status && status.log.length > 0 ? (
            <pre
              ref={logRef}
              className="mt-2 max-h-32 overflow-auto rounded bg-panel px-2 py-1.5 text-[11px] leading-relaxed text-muted"
            >
              {status.log.map((line) => line.text).join('\n')}
            </pre>
          ) : null}

          {status?.error && !running ? (
            <p className="mt-2 text-xs text-danger">{status.error}</p>
          ) : null}

          {result && result.failures.length > 0 ? (
            <ul className="mt-2 space-y-0.5 text-xs text-warn">
              {result.failures.slice(0, 5).map((failure) => (
                <li key={failure.source}>
                  {failure.source}: {failure.error}
                </li>
              ))}
              {result.failures.length > 5 ? (
                <li>…and {result.failures.length - 5} more</li>
              ) : null}
            </ul>
          ) : null}
        </>
      )}

      {notice ? <p className="mt-2 text-xs text-accent">{notice}</p> : null}
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </section>
  )
}
