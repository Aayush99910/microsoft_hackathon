import type { MatchInfo, Stats } from '../types'

type Row = { label: string; home: number; away: number; format?: (v: number) => string }

const pct = (v: number) => `${Math.round(v)}%`

/** Head-to-head stat bars plus a momentum meter for the last 5 minutes. */
export function StatsPanel({ info, stats }: { info: MatchInfo; stats: Stats | null }) {
  if (!stats) return <section className="card stats muted">Stats appear after kick-off…</section>
  const { home, away } = stats.teams
  const rows: Row[] = [
    { label: 'Possession', home: stats.possession_pct.home, away: stats.possession_pct.away, format: pct },
    { label: 'Shots', home: home.shots, away: away.shots },
    { label: 'On target', home: home.shots_on_target, away: away.shots_on_target },
    { label: 'Expected goals (xG)', home: home.xg, away: away.xg, format: (v) => v.toFixed(2) },
    { label: 'Pass accuracy', home: (home.pass_accuracy ?? 0) * 100, away: (away.pass_accuracy ?? 0) * 100, format: pct },
    { label: 'Tackles won', home: home.tackles_won, away: away.tackles_won },
    { label: 'Fouls', home: home.fouls, away: away.fouls },
  ]
  const momentum = stats.recent.momentum
  const leader = momentum > 0.15 ? info.home : momentum < -0.15 ? info.away : null

  return (
    <section className="card stats">
      <div className="momentum">
        <div className="momentum-head">
          <span>Momentum · last 5 min</span>
          <strong style={{ color: leader?.color }}>{leader ? `${leader.short_name} on top` : 'Even'}</strong>
        </div>
        <div className="momentum-bar">
          <div
            style={{
              left: momentum >= 0 ? '50%' : `${50 + momentum * 50}%`,
              width: `${Math.abs(momentum) * 50}%`,
              background: momentum >= 0 ? info.home.color : info.away.color,
            }}
          />
          <span className="mid" />
        </div>
      </div>

      {rows.map((r) => {
        const total = r.home + r.away || 1
        const show = r.format ?? String
        return (
          <div key={r.label} className="stat-row">
            <span className="value">{show(r.home)}</span>
            <div className="stat-center">
              <span className="stat-label">{r.label}</span>
              <div className="split">
                <div style={{ width: `${(100 * r.home) / total}%`, background: info.home.color }} />
                <div style={{ width: `${(100 * r.away) / total}%`, background: info.away.color }} />
              </div>
            </div>
            <span className="value">{show(r.away)}</span>
          </div>
        )
      })}
    </section>
  )
}
