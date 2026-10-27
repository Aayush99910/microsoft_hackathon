import type { MatchInfo, Team } from '../types'

const LINES = ['GK', 'DEF', 'MID', 'FWD']

/** Both starting elevens, goalkeeper to forwards. */
export function Lineups({ info }: { info: MatchInfo }) {
  return (
    <div className="lineups">
      <TeamList team={info.home} />
      <TeamList team={info.away} />
    </div>
  )
}

function TeamList({ team }: { team: Team }) {
  const players = [...team.players].sort((a, b) => LINES.indexOf(a.line) - LINES.indexOf(b.line))
  return (
    <section className="lineup" style={{ '--team': team.color } as React.CSSProperties}>
      <header className="lineup-head">
        <span className="lineup-name">{team.name}</span>
        <span className="label">{team.formation}</span>
      </header>
      <ol>
        {players.map((p) => (
          <li key={p.id}>
            <span className="shirt">{p.number}</span>
            <span className="player-name">{p.name}</span>
            <span className="label">{p.position}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
