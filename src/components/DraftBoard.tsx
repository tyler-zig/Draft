import { useMemo } from 'react'
import type { DraftPick, DraftSession, Player } from '../providers/types'
import { pickNumberFor } from '../draft/snake'
import { TeamLogo } from './TeamLogo'

export function DraftBoard({
  session,
  picks,
  players,
  currentPickNo,
  onSelect,
}: {
  session: DraftSession
  picks: DraftPick[]
  players: Player[]
  currentPickNo: number
  onSelect?: (playerId: string) => void
}) {
  const byKey = useMemo(() => {
    const map = new Map<string, DraftPick>()
    for (const pick of picks) {
      if (pick.pickNo < 1) continue
      map.set(`${pick.round}-${pick.draftSlot}`, pick)
    }
    return map
  }, [picks])
  const playerById = useMemo(() => new Map(players.map((player) => [player.id, player])), [players])
  const rounds = useMemo(() => Array.from({ length: session.rounds }, (_, index) => index + 1), [session.rounds])
  const total = session.teams * session.rounds
  const shownPick = Math.min(currentPickNo, total)

  return (
    <div className="cc-full-board">
      <div className="cc-full-board-legend">
        <span>Round {Math.ceil(shownPick / session.teams)} · Pick {shownPick}</span>
        <span className="cc-full-board-swatch cc-you">On the clock</span>
        <span className="cc-full-board-swatch cc-yours">Your team</span>
        <span className="cc-full-board-swatch cc-keeper-pick">Keeper</span>
      </div>
      <div
        className="cc-full-board-grid"
        style={{
          gridTemplateColumns: `24px repeat(${session.teams}, minmax(0, 1fr))`,
          gridTemplateRows: `auto repeat(${session.rounds}, minmax(0, 1fr))`,
        }}
      >
        <div className="cc-full-board-corner">Rd</div>
        {session.order.map((slot) => {
          const name = slot.teamName || slot.displayName
          return (
            <div key={slot.slot} className={`cc-full-board-team ${slot.isYou ? 'cc-yours' : ''}`} title={name}>
              <TeamLogo className="cc-team-logo-round" src={slot.avatar} label={name} />
              <b>{name}</b>
              {slot.isYou ? <small>You</small> : null}
            </div>
          )
        })}
        {rounds.map((round) => (
          <RoundRow
            key={round}
            round={round}
            session={session}
            picks={picks}
            byKey={byKey}
            playerById={playerById}
            currentPickNo={currentPickNo}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  )
}

function RoundRow({
  round,
  session,
  picks,
  byKey,
  playerById,
  currentPickNo,
  onSelect,
}: {
  round: number
  session: DraftSession
  picks: DraftPick[]
  byKey: Map<string, DraftPick>
  playerById: Map<string, Player>
  currentPickNo: number
  onSelect?: (playerId: string) => void
}) {
  return (
    <>
      <div className="cc-full-board-round">{round}</div>
      {session.order.map((slot) => {
        const pickNo = pickNumberFor(round, slot.slot, session.teams, session.type, session.pickOwners)
        const pick = byKey.get(`${round}-${slot.slot}`) ?? picks.find((entry) => entry.pickNo === pickNo)
        const player = pick ? playerById.get(pick.playerId) : undefined
        const first = player?.firstName ?? pick?.meta?.firstName ?? ''
        const last = player?.lastName ?? pick?.meta?.lastName ?? ''
        const name = player?.lastName || player?.fullName || `${first} ${last}`.trim()
        const position = player?.position ?? pick?.meta?.position ?? ''
        const team = player?.team ?? pick?.meta?.team ?? ''
        const isCurrent = !pick && pickNo === currentPickNo
        const posClass = position ? `cc-${position.toLowerCase().replace('/', '')}` : ''
        const playerId = player?.id ?? pick?.playerId
        const canOpen = Boolean(playerId && onSelect)
        const className = `cc-full-board-cell ${pick ? `cc-filled ${posClass}` : ''} ${isCurrent ? 'cc-you' : ''} ${slot.isYou ? 'cc-yours' : ''} ${pick?.isKeeper ? 'cc-keeper-pick' : ''} ${!pick && !isCurrent ? 'cc-future' : ''}`
        const title = pick ? `${name} · ${[position, team].filter(Boolean).join(' ')}`.trim() : undefined
        const body = (
          <>
            <span className="cc-no">
              {pickNo}
              {pick?.isKeeper ? <i className="cc-keeper-tag">K</i> : null}
            </span>
            {pick ? (
              <>
                <b>{name || 'Pick'}</b>
                <small>{[position, team].filter(Boolean).join(' · ') || '—'}</small>
              </>
            ) : isCurrent ? (
              <b>{slot.isYou ? 'Your pick' : 'On the clock'}</b>
            ) : null}
          </>
        )
        return canOpen && playerId ? (
          <button
            key={`${round}-${slot.slot}`}
            type="button"
            className={className}
            title={title}
            aria-label={`Open ${name || 'player'}`}
            onClick={() => onSelect?.(playerId)}
          >
            {body}
          </button>
        ) : (
          <div key={`${round}-${slot.slot}`} className={className} title={title}>
            {body}
          </div>
        )
      })}
    </>
  )
}
