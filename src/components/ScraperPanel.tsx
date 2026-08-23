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
import { fetchLiveAdpSnapshot, type LiveAdpSnapshot } from '../rankings/liveAdp'
import { hostedCollectorSources, hostedFreshness, relativeAge } from '../rankings/hostedSources'
import { clearArtifactVersionCache } from '../supabase/artifacts'
import type { Player } from '../providers/types'
import { Select } from './Select'

const POLL_MS = 1000

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
  const [adp, setAdp] = useState<LiveAdpSnapshot | null>(null)
  const [selected, setSelected] = useState<SourceGroup[]>(['fantasypros', 'fantasypros-adp', 'rotowire', 'espn'])
  const [granularity, setGranularity] = useState<Granularity>('format')
  const [concurrency, setConcurrency] = useState(4)
  const [ignoreRobots, setIgnoreRobots] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)
  const wasRunning = useRef(false)

  const refreshSnapshots = useCallback(async () => {
    clearArtifactVersionCache()
    try {
      const [nextRankings, nextAdp] = await Promise.all([fetchCollectedSnapshot(), fetchLiveAdpSnapshot()])
      setSnapshot(nextRankings)
      setAdp(nextAdp)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }, [])

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
        if (first || (wasRunning.current && !next.running)) await refreshSnapshots()
        wasRunning.current = next.running
      } catch (caught) {
        if (cancelled) return
        if (caught instanceof NoCollectorError) {
          setAvailable(false)
          if (first) await refreshSnapshots()
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
  }, [status?.running, refreshSnapshots])

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
      if (!current) throw new Error('No hosted snapshot yet. Wait for the next Supabase Cron run.')
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
  const sources = hostedCollectorSources(snapshot, adp)
  const boardsAge = relativeAge(snapshot?.fetchedAt)
  const adpAge = relativeAge(adp?.fetchedAt)

  return (
    <section className="cc-rk-hosted">
      <header>
        <h3>Rankings collector</h3>
        <span>
          Boards {boardsAge}
          {snapshot ? ` · ${snapshot.stats.sets} boards` : ''}
          {' · '}Live ADP {adpAge}
          {adp?.sets?.length ? ` · ${adp.sets.length} boards` : ''}
        </span>
      </header>
      <p>
        Supabase Cron publishes these to the hosted app. Expert boards refresh about every 6 hours.
        Real-Time ADP is its own job every 15 minutes and does not wait on that snapshot.
      </p>

      <div className="cc-rk-hosted-sources">
        {sources.map((source) => (
          <div key={source.id} className={`cc-rk-hosted-source ${source.present ? '' : 'off'}`}>
            <div>
              <b>{source.label}</b>
              <small>{source.detail}</small>
            </div>
            <time>{relativeAge(source.fetchedAt)}</time>
            <i className={`cc-rk-dot ${hostedFreshness(source)}`} aria-hidden="true" />
          </div>
        ))}
      </div>

      <div className="cc-rk-hosted-actions">
        <label>
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
        <button
          type="button"
          className="cc-rk-primary"
          onClick={() => void install()}
          disabled={busy || running || !snapshot}
        >
          {busy ? 'Loading…' : 'Load into rankings'}
        </button>
      </div>

      {available === false ? (
        <p className="cc-rk-hosted-note">
          Local collect stays on the dev server. Production reads the hosted snapshots above.
        </p>
      ) : available ? (
        <details className="cc-rk-local">
          <summary>Collect locally</summary>
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

            <label className="flex items-center gap-1.5" title="Needed when partners.fantasypros.com blocks the Real-Time ADP API. Other sources are already allowed.">
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
        </details>
      ) : null}

      {notice ? <p className="cc-expert-notice">{notice}</p> : null}
      {error ? <p className="cc-expert-error">{error}</p> : null}
    </section>
  )
}
