import type { DraftPick, DraftSession, DraftSlot, Player } from '../providers/types'
import { ownerSlotForPick, picksUntilSlot } from '../draft/snake'
import { PositionBadge } from './PositionBadge'
import { Pill } from './ui'

function scoringLabel(session: DraftSession) {
  if (session.scoringType === 'ppr') return 'PPR'
  if (session.scoringType === 'half_ppr') return 'Half PPR'
  if (session.scoringType === 'std') return 'Standard'
  return 'Scoring n/a'
}

function LastPickBits({
  session,
  picks,
  players,
  invert,
}: {
  session: DraftSession
  picks: DraftPick[]
  players: Player[]
  invert: boolean
}) {
  const last = picks[picks.length - 1]
  const muted = invert ? 'text-bg/70' : 'text-muted'
  if (!last) {
    return <span className={`text-sm ${muted}`}>Waiting for the first pick</span>
  }
  const player =
    players.find((p) => p.id === last.playerId) ??
    (last.meta
      ? {
          fullName: `${last.meta.firstName} ${last.meta.lastName}`.trim(),
          position: last.meta.position,
        }
      : null)
  const team = session.order.find((s) => s.slot === last.draftSlot)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm">
      <span className={`text-[11px] font-semibold uppercase tracking-wide ${muted}`}>
        Last
      </span>
      <span className={`font-mono text-xs tabular-nums ${muted}`}>
        #{last.pickNo}
      </span>
      {player ? <PositionBadge position={player.position} /> : null}
      <span className="truncate font-medium">
        {player?.fullName || last.playerId}
      </span>
      <span className={`truncate ${muted}`}>
        to {team?.displayName ?? `Slot ${last.draftSlot}`}
      </span>
    </div>
  )
}

export function OnTheClock({
  session,
  picks,
  players,
}: {
  session: DraftSession
  picks: DraftPick[]
  players: Player[]
}) {
  const picksMade = picks.length
  const total = session.teams * session.rounds
  const currentPickNo = Math.min(picksMade + 1, total)
  const done = picksMade >= total || session.status === 'complete'
  const loc = ownerSlotForPick(currentPickNo, session.teams, session.type, session.pickOwners)
  const onClock: DraftSlot | undefined = session.order.find(
    (s) => s.slot === loc.slot,
  )
  const until =
    session.yourSlot == null
      ? null
      : picksUntilSlot(
          currentPickNo,
          session.yourSlot,
          session.teams,
          session.rounds,
          session.type,
          undefined,
          session.pickOwners,
        )
  const youAreOnClock = !done && until === 0

  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5 ${
        youAreOnClock
          ? 'border-accent/30 bg-accent text-bg'
          : 'border-line bg-panel'
      }`}
    >
      <div className="flex items-center gap-2">
        {youAreOnClock ? (
          <span className="pulse-dot h-2 w-2 rounded-full bg-bg" />
        ) : null}
        <div
          className={`text-sm font-semibold ${
            done ? 'text-muted' : youAreOnClock ? '' : 'text-warn'
          }`}
        >
          {done
            ? 'Draft complete'
            : youAreOnClock
              ? "You're on the clock"
              : `On the clock: ${onClock?.displayName ?? `Slot ${loc.slot}`}`}
        </div>
      </div>

      <div
        className={`font-mono text-xs tabular-nums ${
          youAreOnClock ? 'text-bg/75' : 'text-muted'
        }`}
      >
        Pick {Math.min(currentPickNo, total)} · Round {loc.round}
      </div>

      {!done && until != null && until > 0 ? (
        <div className="text-sm font-medium">
          You pick in {until} {until === 1 ? 'pick' : 'picks'}
        </div>
      ) : null}

      <div className="min-w-0 flex-1">
        <LastPickBits
          session={session}
          picks={picks}
          players={players}
          invert={youAreOnClock}
        />
      </div>

      <div className="ml-auto flex flex-wrap items-center gap-1.5">
        {youAreOnClock ? (
          <>
            <span className="rounded-md border border-bg/25 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              {session.teams} tm
            </span>
            <span className="rounded-md border border-bg/25 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              {session.rounds} rd
            </span>
            <span className="rounded-md border border-bg/25 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              {session.type}
            </span>
            <span className="rounded-md border border-bg/25 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
              {scoringLabel(session)}
            </span>
          </>
        ) : (
          <>
            <Pill>
              {session.teams} teams
            </Pill>
            <Pill>{session.rounds} rounds</Pill>
            <Pill>{session.type}</Pill>
            <Pill>{scoringLabel(session)}</Pill>
          </>
        )}
      </div>
    </div>
  )
}
