import { openedLabel, providerLabel } from '../leagues/labels'
import { savedLeagueKey, type SavedLeague } from '../leagues/savedLeagues'

/**
 * Leagues this account has opened before, so a returning drafter goes straight
 * back in instead of retyping a Sleeper username and re-picking a team.
 */
export function SavedLeaguesPanel({ leagues, selectedKey, onSelect }: {
  leagues: SavedLeague[]
  selectedKey: string | null
  onSelect: (league: SavedLeague) => void
}) {
  if (!leagues.length) return null

  return <section>
    <div className="lg-group"><h2>Your leagues</h2></div>
    <ul>
      {leagues.map((league) => {
        const key = savedLeagueKey(league)
        const ready = Boolean(league.draftId)
        return <li key={key}>
          <button
            type="button"
            className={`lg-row ${selectedKey === key ? 'on' : ''}`}
            aria-current={selectedKey === key ? 'true' : undefined}
            onClick={() => onSelect(league)}
          >
            <i className={`lg-dot ${ready ? 'ready' : ''}`} />
            <span>
              <b>{league.name}</b>
              <small>{providerLabel(league.provider)} · {league.teamName || 'Seat remembered'} · {openedLabel(league.lastOpenedAt)}</small>
            </span>
            <span className={`lg-status ${ready ? 'ready' : ''}`}>{ready ? 'Draft ready' : 'No draft yet'}</span>
          </button>
        </li>
      })}
    </ul>
  </section>
}
