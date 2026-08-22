import { useMemo, useState } from 'react'
import type { DraftSession, KeeperEntry, Player } from '../providers/types'
import type { EspnKeeperCandidate } from '../espn/mapEspn'
import { keeperRoom, removeKeeper, upsertKeeper, type KeeperConflict } from '../draft/keepers'
import { pickNumberFor } from '../draft/snake'
import { PlayerPhoto } from './PlayerPhoto'
import { Select } from './Select'

export function KeeperPanel({ session, players, keepers, manualKeepers, conflicts, candidates, providerLabel, syncing, costRoundPicks = true, onChange }: {
  session: DraftSession
  players: Player[]
  /** Manual plus synced, as the board sees them. */
  keepers: KeeperEntry[]
  /** The hand-entered subset -- the only entries this panel may edit. */
  manualKeepers: KeeperEntry[]
  conflicts: KeeperConflict[]
  candidates: EspnKeeperCandidate[]
  providerLabel: string
  syncing: boolean
  /** When false, keepers stay on the roster but do not consume a snake slot. */
  costRoundPicks?: boolean
  onChange: (next: KeeperEntry[]) => void
}) {
  const yourRoster = session.order.find((slot) => slot.isYou)?.rosterId
  const [teamId, setTeamId] = useState(yourRoster ?? session.order[0]?.rosterId ?? '')
  const [query, setQuery] = useState('')

  const byId = useMemo(() => new Map(players.map((player) => [player.id, player])), [players])
  const keptElsewhere = useMemo(
    () => new Set(keepers.filter((entry) => entry.rosterId !== teamId).map((entry) => entry.playerId)),
    [keepers, teamId],
  )
  const teamKeepers = useMemo(
    () => keepers.filter((entry) => entry.rosterId === teamId),
    [keepers, teamId],
  )
  const teamCandidates = useMemo(() => {
    const alreadyKept = new Set(keepers.map((entry) => entry.playerId))
    return candidates
      .filter((candidate) => candidate.rosterId === teamId && !alreadyKept.has(candidate.playerId))
      .sort((a, b) => (a.round ?? 99) - (b.round ?? 99))
  }, [candidates, keepers, teamId])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle.length < 2) return []
    const taken = new Set(keepers.map((entry) => entry.playerId))
    return players
      .filter((player) => !taken.has(player.id) && player.fullName.toLowerCase().includes(needle))
      .slice(0, 8)
  }, [keepers, players, query])

  const room = keeperRoom(keepers, teamId, session.keeperCount)
  const syncedCount = keepers.filter((entry) => entry.source !== 'manual').length
  const rounds = Array.from({ length: session.rounds }, (_, index) => index + 1)
  const teamSlot = session.order.find((slot) => slot.rosterId === teamId)?.slot ?? 1

  const isManual = (entry: KeeperEntry) => entry.source === 'manual'
  const add = (playerId: string, round: number | null) => {
    onChange(upsertKeeper(manualKeepers, { playerId, rosterId: teamId, round, source: 'manual' }))
    setQuery('')
  }
  const setRound = (entry: KeeperEntry, round: number | null) =>
    onChange(upsertKeeper(manualKeepers, { ...entry, round, source: 'manual' }))
  const drop = (playerId: string) => onChange(removeKeeper(manualKeepers, playerId))

  return <div className="cc-keepers">
    <p className="cc-modal-note">
      {costRoundPicks
        ? 'Keepers come off the board and take their team’s pick in the round they cost.'
        : 'Keepers come off the board and start on the roster, but they do not use a draft slot.'}
      {' '}Entries are saved to your account for this draft.
      {session.keeperCount ? ` ${providerLabel} allows ${session.keeperCount} per team.` : ''}
    </p>

    <div className="cc-keeper-sync">
      {syncing
        ? <span className="cc-readonly-chip">Checking {providerLabel}…</span>
        : syncedCount
          ? <span className="cc-readonly-chip cc-chip-on">{syncedCount} synced from {providerLabel}</span>
          : <span className="cc-readonly-chip">{providerLabel} has not published keepers yet — enter them by hand</span>}
    </div>

    {conflicts.length ? <div className="cc-keeper-conflicts">
      <b>{providerLabel} disagrees with {conflicts.length} of your entries</b>
      <ul>{conflicts.map((conflict) => {
        const player = byId.get(conflict.playerId)
        const syncedTeam = session.order.find((slot) => slot.rosterId === conflict.synced.rosterId)
        const manualTeam = session.order.find((slot) => slot.rosterId === conflict.manual.rosterId)
        return <li key={conflict.playerId}>
          {player?.fullName ?? conflict.playerId} — {conflict.reason === 'team'
            ? `you had ${manualTeam?.teamName ?? conflict.manual.rosterId}, ${providerLabel} says ${syncedTeam?.teamName ?? conflict.synced.rosterId}`
            : `you had round ${conflict.manual.round}, ${providerLabel} says round ${conflict.synced.round}`}. {providerLabel} wins.
        </li>
      })}</ul>
    </div> : null}

    <label className="cc-picker cc-keeper-team">
      <Select aria-label="Keeper team" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
        {session.order.map((slot) => <option key={slot.rosterId} value={slot.rosterId}>
          {slot.teamName || slot.displayName}{slot.isYou ? ' (you)' : ''}
        </option>)}
      </Select>
    </label>

    <div className="cc-keeper-list">
      {teamKeepers.length ? teamKeepers.map((entry) => {
        const player = byId.get(entry.playerId)
        const locked = !isManual(entry)
        return <div className="cc-keeper-row" key={entry.playerId}>
          {player ? <PlayerPhoto player={player} /> : <span className="cc-avatar cc-ghost">··</span>}
          <span className="cc-keeper-name">
            {player?.fullName ?? `Player ${entry.playerId}`}
            <small>{player ? `${player.position} · ${player.team ?? 'FA'}` : 'Not in the player list'}</small>
          </span>
          {costRoundPicks ? (
            <label className="cc-picker cc-keeper-round">
              <Select
                aria-label={`Keeper round for ${player?.fullName ?? entry.playerId}`}
                value={entry.round ?? ''}
                disabled={locked}
                onChange={(event) => setRound(entry, event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">Earliest open</option>
                {rounds.map((round) => <option key={round} value={round}>
                  Round {round} (pick {pickNumberFor(round, teamSlot, session.teams, session.type, session.pickOwners)})
                </option>)}
              </Select>
            </label>
          ) : (
            <span className="cc-readonly-chip">No pick cost</span>
          )}
          {locked
            ? <span className="cc-readonly-chip cc-chip-on">{entry.source === 'espn' ? 'ESPN' : 'Synced'}</span>
            : <button type="button" className="cc-remove" onClick={() => drop(entry.playerId)} aria-label={`Remove ${player?.fullName ?? entry.playerId}`}>×</button>}
        </div>
      }) : <div className="cc-empty-card">No keepers for this team.</div>}
    </div>

    {room != null ? <div className="cc-keeper-room">{room > 0 ? `${room} keeper${room === 1 ? '' : 's'} left for this team` : 'Keeper limit reached'}</div> : null}

    {teamCandidates.length ? <section className="cc-keeper-suggested">
      <div className="cc-eyebrow">Keepable on {providerLabel}</div>
      <div className="cc-keeper-chips">
        {teamCandidates.slice(0, 12).map((candidate) => {
          const player = byId.get(candidate.playerId)
          return <button type="button" key={candidate.playerId} onClick={() => add(candidate.playerId, candidate.round)}>
            {player?.fullName ?? `Player ${candidate.playerId}`}
            <small>{candidate.round ? `R${candidate.round}` : 'No cost'}</small>
          </button>
        })}
      </div>
    </section> : null}

    <section className="cc-keeper-add">
      <label className="cc-search">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Add a keeper by name…"
          aria-label="Search players to keep"
        />
      </label>
      {matches.length ? <div className="cc-keeper-matches">
        {matches.map((player) => <button type="button" key={player.id} onClick={() => add(player.id, null)}>
          <PlayerPhoto player={player} />
          <span>{player.fullName}<small>{player.position} · {player.team ?? 'FA'}</small></span>
        </button>)}
      </div> : query.trim().length >= 2 ? <div className="cc-empty-card">No available player matches “{query.trim()}”.</div> : null}
      {keptElsewhere.size ? <p className="cc-keeper-hint">Players already kept by another team are hidden.</p> : null}
    </section>
  </div>
}
