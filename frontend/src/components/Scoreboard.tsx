import { clock } from '../format'
import type { MatchEvent, MatchInfo, Stats } from '../types'
import type { Status } from '../useMatchStream'

const STATUS_LABEL: Record<Status, string> = {
  idle: '',
  live: 'LIVE',
  half_time: 'HALF-TIME',
  ended: 'FULL-TIME',
  error: 'DISCONNECTED',
}

type Props = { info: MatchInfo; stats: Stats | null; last: MatchEvent | undefined; status: Status; onExit: () => void }

/** Broadcast-style score bar with clock, status and match progress. */
export function Scoreboard({ info, stats, last, status, onExit }: Props) {
  const progress = last ? Math.min(1, (last.period === 1 ? Math.min(last.t, 2700) : last.t) / 5400) : 0
  return (
    <header className="scoreboard">
      <button className="ghost back" onClick={onExit} aria-label="Back to match setup">
        ←
      </button>
      <div className="score-main">
        <span className="side home">
          <span className="crest" style={{ background: info.home.color }}>{info.home.short_name}</span>
          <span className="team-name">{info.home.name}</span>
        </span>
        <span className="score">
          {stats?.score.home ?? 0}
          <span className="dash">–</span>
          {stats?.score.away ?? 0}
        </span>
        <span className="side away">
          <span className="team-name">{info.away.name}</span>
          <span className="crest" style={{ background: info.away.color }}>{info.away.short_name}</span>
        </span>
      </div>
      <div className="score-meta">
        <span className="clock">{last ? clock(last.t, last.period) : '00:00'}</span>
        <span className={`status ${status}`}>{STATUS_LABEL[status]}</span>
      </div>
      <div className="progress" aria-hidden>
        <div style={{ width: `${progress * 100}%` }} />
      </div>
    </header>
  )
}
