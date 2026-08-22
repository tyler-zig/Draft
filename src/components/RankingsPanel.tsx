import { useEffect, useState } from 'react'
import { sleeperProvider } from '../providers/sleeperProvider'
import { importPastedRankings, importRankingFile, importScrapedRankings } from '../rankings/importSet'
import { getScrapedRankings, subscribeScrapedRankings, type ScrapedRankings } from '../rankings/bridge'
import { loadRankSettings, saveRankSettings } from '../rankings/store'
import { ScraperPanel } from './ScraperPanel'
import type { RankSettings } from '../rankings/types'
import type { Player } from '../providers/types'

export function RankingsPanel({
  draftPlayers,
  onChange,
}: {
  draftPlayers: Player[]
  onChange: () => void
}) {
  const [settings, setSettings] = useState<RankSettings>(loadRankSettings)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [pasteLabel, setPasteLabel] = useState('CBS Sports PPR')
  const [scraped, setScraped] = useState<ScrapedRankings | null>(getScrapedRankings)
  const [dropActive, setDropActive] = useState(false)

  useEffect(() => subscribeScrapedRankings(() => setScraped(getScrapedRankings())), [])

  function updateSettings(next: RankSettings) {
    setSettings(next)
    saveRankSettings(next)
    onChange()
  }

  async function resolveDirectory() {
    if (draftPlayers.length >= 200 && draftPlayers.some((player) => player.sleeperId)) return draftPlayers
    return sleeperProvider.getPlayers()
  }

  async function enableImported(id: string) {
    if (!settings.enabledIds.includes(id)) {
      updateSettings({ ...settings, enabledIds: [...settings.enabledIds, id] })
    } else {
      onChange()
    }
  }

  async function onFile(file: File) {
    setError(null)
    setBusy(true)
    try {
      const set = await importRankingFile({ filename: file.name, text: await file.text(), directory: await resolveDirectory() })
      await enableImported(set.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  async function importPaste() {
    setError(null)
    setBusy(true)
    try {
      const set = await importPastedRankings({ text: pasteText, label: pasteLabel, directory: await resolveDirectory() })
      setPasteText('')
      setPasteOpen(false)
      await enableImported(set.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Paste import failed')
    } finally {
      setBusy(false)
    }
  }

  async function importScrape() {
    if (!scraped) return
    setError(null)
    setBusy(true)
    try {
      const set = await importScrapedRankings({ ...scraped, directory: await resolveDirectory() })
      updateSettings({ ...settings, enabledIds: settings.enabledIds.includes(set.id) ? settings.enabledIds : [...settings.enabledIds, set.id] })
      setScraped(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scraped rankings import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="cc-rk-library">
      <div
        className={`cc-rk-drop ${dropActive ? 'cc-rk-drop-on' : ''}`}
        onDragEnter={(event) => { event.preventDefault(); setDropActive(true) }}
        onDragOver={(event) => { event.preventDefault(); setDropActive(true) }}
        onDragLeave={() => setDropActive(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDropActive(false)
          const file = event.dataTransfer.files[0]
          if (file) void onFile(file)
        }}
      >
        <b>Drop CSV or JSON</b>
        Rank, player, position, team. No logins or paywalls are bypassed.
      </div>
      <div className="cc-rk-row-actions">
        <label className="cc-rk-primary">
          {busy ? 'Importing…' : 'Import file'}
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            hidden
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) void onFile(file)
            }}
          />
        </label>
        <button type="button" className="cc-rk-ghost" onClick={() => setPasteOpen((open) => !open)}>Paste table</button>
      </div>
      {pasteOpen ? (
        <div className="cc-rk-paste">
          <div className="cc-rk-paste-links">
            <input value={pasteLabel} onChange={(event) => setPasteLabel(event.target.value)} aria-label="Ranking source label" placeholder="Source and format, e.g. RotoWire PPR" />
            <a href="https://www.cbssports.com/fantasy/football/rankings/" target="_blank" rel="noreferrer">CBS rankings</a>
            <a href="https://www.rotowire.com/football/rankings.php" target="_blank" rel="noreferrer">RotoWire rankings</a>
          </div>
          <textarea value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={'Rank\tPlayer\tPos\tTeam\n1\tPlayer Name\tRB\tTEAM'} />
          <button type="button" className="cc-rk-primary" disabled={busy || !pasteText.trim()} onClick={() => void importPaste()}>{busy ? 'Importing…' : 'Add to recipe'}</button>
        </div>
      ) : null}
      {scraped ? (
        <div className="cc-rk-scraped">
          <span>Extension scraped {scraped.rows.length} rows: {scraped.label}</span>
          <a href={scraped.sourceUrl} target="_blank" rel="noreferrer">Source</a>
          <button type="button" className="cc-rk-primary" disabled={busy} onClick={() => void importScrape()}>Add scraped list</button>
        </div>
      ) : null}
      {error ? <p className="cc-expert-error">{error}</p> : null}
      <div className="cc-rk-collector">
        <ScraperPanel
          directory={draftPlayers}
          onChange={onChange}
        />
      </div>
    </section>
  )
}
