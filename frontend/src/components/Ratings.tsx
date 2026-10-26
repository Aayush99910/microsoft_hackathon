import { useState } from 'react'
import type { MatchInfo, Player, PlayerRating, Side, Stats } from '../types'

const GROUPS = [
  { label: 'Goalkeeper', positions: ['GK'] },
  { label: 'Defenders', positions: ['RB', 'RCB', 'LCB', 'LB'] },
  { label: 'Midfielders', positions: ['RCM', 'CM', 'LCM'] },
  { label: 'Forwards', positions: ['RW', 'ST', 'LW'] },
]

function band(rating: number): string {
  if (rating >= 8) return 'top'
  if (rating >= 7) return 'great'
  if (rating >= 6) return 'ok'
  return 'poor'
}

/** Small icons for what a player did: goals, assists, cards. */
function Marks({ r }: { r: PlayerRating }) {
  return (
    <span className="marks">
      {Array.from({ length: r.goals }, (_, i) => (
        <span key={`g${i}`} title="Goal">
          ⚽
        </span>
      ))}
      {r.assists > 0 && <span title="Assist">A{r.assists > 1 ? r.assists : ''}</span>}
      {r.yellow_cards > 0 && !r.red_cards && <i className="card-icon yellow" title="Yellow card" />}
      {r.red_cards > 0 && <i className="card-icon red" title="Red card" />}
    </span>
  )
}

function Badge({ rating }: { rating: number }) {
  return <span className={`rating ${band(rating)}`}>{rating.toFixed(1)}</span>
}

/** Live player ratings out of 10, like a match centre: pick a team, players by position. Plain rules, not AI. */
export function Ratings({ info, stats }: { info: MatchInfo; stats: Stats | null }) {
  const [side, setSide] = useState<Side>('home')
  if (!stats?.ratings?.length) return <p className="muted empty">Ratings appear once the match is under way.</p>

  const byId = new Map(stats.ratings.map((r) => [r.id, r]))
  const all = (['home', 'away'] as Side[]).flatMap((s) => info[s].players.map((p) => ({ p, s })))
  const best = all.reduce((a, b) => ((byId.get(b.p.id)?.rating ?? 0) > (byId.get(a.p.id)?.rating ?? 0) ? b : a))
  const team = info[side]

  const row = (p: Player) => {
    const r = byId.get(p.id)
    if (!r) return null
    return (
      <li key={p.id}>
        <span className="shirt-num">{p.number}</span>
        <span className="player-name">{p.name}</span>
        <Marks r={r} />
        <Badge rating={r.rating} />
      </li>
    )
  }

  return (
    <div className="ratings">
      <div className="ratings-teams" role="tablist">
        {(['home', 'away'] as Side[]).map((s) => (
          <button key={s} role="tab" aria-selected={side === s} onClick={() => setSide(s)}>
            <i style={{ background: info[s].color }} />
            {info[s].name}
          </button>
        ))}
      </div>

      {byId.get(best.p.id) && (
        <div className="potm">
          <div>
            <span className="label">Player of the match</span>
            <strong>{best.p.name}</strong>
            <span className="muted small">
              {info[best.s].short_name} · #{best.p.number} · {best.p.position}
            </span>
          </div>
          <Badge rating={byId.get(best.p.id)!.rating} />
        </div>
      )}

      {GROUPS.map((g) => (
        <section key={g.label} className="ratings-group">
          <h3>{g.label}</h3>
          <ol>
            {team.players
              .filter((p) => g.positions.includes(p.position))
              .sort((a, b) => g.positions.indexOf(a.position) - g.positions.indexOf(b.position))
              .map(row)}
          </ol>
        </section>
      ))}
      <p className="muted small ratings-note">Live, out of 10, from the match data. Everyone starts on 6.0.</p>
    </div>
  )
}
