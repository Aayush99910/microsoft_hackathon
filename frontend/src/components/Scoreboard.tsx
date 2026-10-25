import { clock } from '../format'
import type { MatchEvent, MatchInfo, Stats } from '../types'
import type { Status } from '../useMatchStream'

const STATUS_LABEL: Record<Status, string> = {
  idle: '',
  live: 'Live',
  half_time: 'HT',
  ended: 'FT',
  error: 'Lost feed',
}

type Props = { info: MatchInfo; stats: Stats | null; last: MatchEvent | undefined; status: Status; onExit: () => void }

/** TV-style score bug: team colour blocks, score, clock and status, with match progress underneath. */
export function Scoreboard({ info, stats, last, status, onExit }: Props) {
  const progress = last ? Math.min(1, (last.period === 1 ? Math.min(last.t, 2700) : last.t) / 5400) : 0
  const style = { '--home': info.home.color, '--away': info.away.color } as React.CSSProperties
  return (
    <>
      <header className="scorebar" style={style}>
        <button className="back" onClick={onExit} aria-label="Back to match setup">
          ←
        </button>
        <div className="score-line">
          <span className="score-team home">
            <span className="full">{info.home.name}</span>
            <span className="short">{info.home.short_name}</span>
          </span>
          <span className="score-figure" aria-label={`Score ${stats?.score.home ?? 0} to ${stats?.score.away ?? 0}`}>
            {stats?.score.home ?? 0}
            <span className="sep" />
            {stats?.score.away ?? 0}
          </span>
          <span className="score-team away">
            <span className="full">{info.away.name}</span>
            <span className="short">{info.away.short_name}</span>
          </span>
        </div>
        <div className="score-clock">
          <span className={`status ${status}`}>{STATUS_LABEL[status]}</span>
          <span className="num">{last ? clock(last.t, last.period) : '00:00'}</span>
        </div>
      </header>
      <div className="timeline" aria-hidden>
        <div style={{ width: `${progress * 100}%` }} />
      </div>
    </>
  )
}
