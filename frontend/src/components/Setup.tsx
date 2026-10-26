import { useEffect, useState } from 'react'
import type { MatchInfo, Profile, Team } from '../types'
import { type Detail, DetailPicker, LanguagePicker, MODES, ModePicker } from './ProfilePicker'
import { SoundSwitch } from './Sound'

const SPEEDS = [
  { value: 10, label: 'Relaxed', hint: '≈ 9 min' },
  { value: 30, label: 'Standard', hint: '≈ 3 min' },
  { value: 120, label: 'Highlights', hint: 'under 1 min' },
]

type Props = {
  seed: number
  speed: number
  profile: Profile
  sound: boolean
  onSound: (on: boolean) => void
  detail: Detail
  onDetail: (detail: Detail) => void
  onSeed: (seed: number) => void
  onSpeed: (speed: number) => void
  onProfile: (profile: Profile) => void
  onKickOff: () => void
}

/** Pre-match screen: the fixture, how to tell the story, how fast to play, and kick-off. */
export function Setup({
  seed,
  speed,
  profile,
  sound,
  onSound,
  detail,
  onDetail,
  onSeed,
  onSpeed,
  onProfile,
  onKickOff,
}: Props) {
  const [info, setInfo] = useState<MatchInfo | null>(null)

  useEffect(() => {
    fetch(`/api/match/info?seed=${seed}`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [seed])

  const mode = MODES.find((m) => m.id === profile.mode)

  return (
    <section className="setup">
      <span className="label">Matchday · {info?.venue ?? '…'}</span>
      <div className="fixture">
        {info ? <Club team={info.home} side="home" /> : <div className="club placeholder" />}
        <span className="vs">V</span>
        {info ? <Club team={info.away} side="away" /> : <div className="club placeholder" />}
      </div>

      <div className="options">
        <div className="option">
          <div>
            <span className="label">Fixture</span>
          </div>
          <div className="match-row">
            <span className="match-no num">No. {seed}</span>
            <button className="link" onClick={() => onSeed(Math.floor(Math.random() * 1000))}>
              Generate another
            </button>
          </div>
        </div>

        <div className="option">
          <div>
            <span className="label">Commentary</span>
            <p className="muted small">{mode?.hint}</p>
          </div>
          <div className="match-row" style={{ flexWrap: 'wrap', gap: 10 }}>
            <ModePicker profile={profile} onChange={onProfile} />
            <LanguagePicker profile={profile} onChange={onProfile} />
          </div>
        </div>

        <div className="option">
          <div>
            <span className="label">Detail</span>
            <p className="muted small">{detail === 'brief' ? 'One short line per moment' : 'Full commentary with why it matters'}</p>
          </div>
          <DetailPicker detail={detail} onChange={onDetail} />
        </div>

        <div className="option">
          <div>
            <span className="label">Sound</span>
            <p className="muted small">Commentator voice and crowd. Change it any time.</p>
          </div>
          <SoundSwitch sound={sound} onSound={onSound} />
        </div>

        <div className="option">
          <div>
            <span className="label">Pace</span>
          </div>
          <div className="seg" role="radiogroup" aria-label="Playback speed">
            {SPEEDS.map((s) => (
              <button key={s.value} role="radio" aria-checked={speed === s.value} onClick={() => onSpeed(s.value)}>
                {s.label}
                <small>{s.hint}</small>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="kickoff">
        <p className="muted small" style={{ margin: 0, maxWidth: 380 }}>
          Every fixture is generated from scratch and narrated live by AI agents. Same number, same match.
        </p>
        <button className="btn btn-primary" onClick={onKickOff} disabled={!info}>
          Kick off
        </button>
      </div>
    </section>
  )
}

function Club({ team, side }: { team: Team; side: 'home' | 'away' }) {
  const striker = team.players.find((p) => p.position === 'ST')
  return (
    <div className={`club ${side}`} style={{ '--team': team.color } as React.CSSProperties}>
      <span className="label">{side === 'home' ? 'Home' : 'Away'}</span>
      <div className="club-name">{team.name}</div>
      <span className="muted small">
        {team.formation} · {striker?.number} {striker?.name}
      </span>
    </div>
  )
}
