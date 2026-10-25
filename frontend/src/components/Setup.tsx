import { useEffect, useState } from 'react'
import type { MatchInfo, Team } from '../types'

const SPEEDS = [
  { value: 10, label: 'Relaxed', hint: '≈ 9 min' },
  { value: 30, label: 'Normal', hint: '≈ 3 min' },
  { value: 120, label: 'Highlights', hint: '< 1 min' },
]

type Props = {
  seed: number
  speed: number
  onSeed: (seed: number) => void
  onSpeed: (speed: number) => void
  onKickOff: () => void
}

/** Pre-match card: the two teams, how fast to play, and the kick-off button. */
export function Setup({ seed, speed, onSeed, onSpeed, onKickOff }: Props) {
  const [info, setInfo] = useState<MatchInfo | null>(null)

  useEffect(() => {
    fetch(`/api/match/info?seed=${seed}`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [seed])

  return (
    <section className="setup">
      <p className="eyebrow">Synthetic match · AI match intelligence</p>
      <div className="fixture">
        {info ? <TeamCard team={info.home} /> : <div className="team-card placeholder" />}
        <span className="vs">vs</span>
        {info ? <TeamCard team={info.away} /> : <div className="team-card placeholder" />}
      </div>

      <div className="setup-row">
        <span className="setup-label">Match</span>
        <div className="match-picker">
          <span className="match-number">#{seed}</span>
          <button className="ghost" onClick={() => onSeed(Math.floor(Math.random() * 1000))}>
            🎲 Another match
          </button>
        </div>
      </div>

      <div className="setup-row">
        <span className="setup-label">Pace</span>
        <div className="segmented" role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s.value}
              role="radio"
              aria-checked={speed === s.value}
              className={speed === s.value ? 'active' : ''}
              onClick={() => onSpeed(s.value)}
            >
              {s.label}
              <small>{s.hint}</small>
            </button>
          ))}
        </div>
      </div>

      <button className="primary big" onClick={onKickOff} disabled={!info}>
        ▶ Kick off
      </button>
      <p className="muted small">
        Every match is generated from scratch. Same match number, same match.
      </p>
    </section>
  )
}

function TeamCard({ team }: { team: Team }) {
  const striker = team.players.find((p) => p.position === 'ST')
  return (
    <div className="team-card" style={{ borderColor: team.color }}>
      <span className="crest" style={{ background: team.color }}>
        {team.short_name}
      </span>
      <strong>{team.name}</strong>
      <span className="muted small">
        {team.formation} · #{striker?.number} {striker?.name}
      </span>
    </div>
  )
}
