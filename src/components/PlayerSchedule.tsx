import { isByeWeek, matchupTone, ordinal, type PlayerScheduleView } from '../intelligence/calculations/matchup'
import type { PlayoffWeeks } from '../providers/types'
import './player-schedule.css'

export function opponentLabel(week: PlayerScheduleView['weeks'][number]) {
  return isByeWeek(week) ? 'BYE' : `${week.home ? 'vs' : '@'} ${week.opponent}`
}

export function PlayerScheduleGrid({ schedule, playoffWeeks }: { schedule: PlayerScheduleView; playoffWeeks?: PlayoffWeeks | null }) {
  const nextWeek = schedule.weeks.find((week) => !week.completed)?.week
  const sos = schedule.strengthOfSchedule
  const inPlayoffs = (week: number) => Boolean(playoffWeeks && week >= playoffWeeks.start && week <= playoffWeeks.end)
  return (
    <div className="player-schedule">
      <ol className="player-schedule-grid" aria-label={`${schedule.season} ${schedule.team} schedule`}>
        {schedule.weeks.map((week) => {
          const tone = matchupTone(week.matchupRank)
          return (
            <li
              key={week.week}
              className={`player-schedule-week ${tone}${week.completed ? ' done' : ''}${week.week === nextWeek ? ' next' : ''}${isByeWeek(week) ? ' bye' : ''}${inPlayoffs(week.week) ? ' playoff' : ''}`}
            >
              <small>WK {week.week}</small>
              <span>{opponentLabel(week)}</span>
              <b className={tone}>{isByeWeek(week) ? 'BYE' : week.matchupRank == null ? '—' : ordinal(week.matchupRank)}</b>
            </li>
          )
        })}
      </ol>
      <p className="player-schedule-note">
        {sos?.remainingGames ? <>{schedule.season} remaining SOS <b className={matchupTone(sos.rank)}>{ordinal(sos.rank)} easiest</b> · {sos.remainingGames} games left</> : `${schedule.season} schedule`}
        {schedule.window.currentGames
          ? ` · ${schedule.window.currentSeason} blended with ${schedule.window.priorSeason}`
          : ` · ${schedule.window.priorSeason ?? schedule.window.currentSeason} FPA`}
        {playoffWeeks ? ` · Playoffs WK ${playoffWeeks.start}–${playoffWeeks.end}` : ''}
      </p>
      <div className="player-schedule-legend" aria-hidden="true">
        <span className="easy">Easy 1–8</span>
        <span className="neutral">Neutral 9–16</span>
        <span className="tough">Tough 17–24</span>
        <span className="hard">Hard 25–32</span>
        {playoffWeeks ? <span className="playoff">Playoffs</span> : null}
      </div>
    </div>
  )
}
