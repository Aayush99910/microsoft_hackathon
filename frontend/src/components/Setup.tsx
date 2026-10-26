import { useEffect, useState } from 'react'
import type { MatchInfo, Profile, Team } from '../types'
import { type Detail, LANGUAGES, MODES } from './ProfilePicker'
import { SPEEDS, SettingsSheet } from './SettingsSheet'
import type { Theme } from './ThemeToggle'

type Props = {
  seed: number
  speed: number
  profile: Profile
  sound: boolean
  onSound: (on: boolean) => void
  detail: Detail
  onDetail: (detail: Detail) => void
  theme: Theme
  onTheme: (theme: Theme) => void
  onSeed: (seed: number) => void
  onSpeed: (speed: number) => void
  onProfile: (profile: Profile) => void
  onKickOff: () => void
}

/** Pre-match screen on one screen: the fixture, a summary of how it will be told, and kick-off. */
export function Setup(props: Props) {
  const { seed, speed, profile, sound, detail, onSeed, onKickOff } = props
  const [info, setInfo] = useState<MatchInfo | null>(null)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    fetch(`/api/match/info?seed=${seed}`)
      .then((r) => r.json())
      .then(setInfo)
      .catch(() => setInfo(null))
  }, [seed])

  const mode = MODES.find((m) => m.id === profile.mode)
  const choices = [
    { label: 'Style', value: mode?.label, hint: mode?.hint },
    { label: 'Language', value: LANGUAGES.find((l) => l.id === profile.language)?.label },
    { label: 'Detail', value: detail === 'brief' ? 'Brief' : 'Detailed' },
    { label: 'Sound', value: sound ? 'Voice and crowd' : 'No sound' },
    { label: 'Pace', value: SPEEDS.find((s) => Number(s.id) === speed)?.label },
  ]

  return (
    <section className="setup">
      <div className="fixture-card">
        <div className="fixture-top">
          <span className="label">Matchday · {info?.venue ?? '…'}</span>
          <button className="link" onClick={() => onSeed(Math.floor(Math.random() * 1000))}>
            New fixture
          </button>
        </div>
        <div className="fixture">
          {info ? <Club team={info.home} side="home" /> : <div className="club placeholder" />}
          <span className="vs">v</span>
          {info ? <Club team={info.away} side="away" /> : <div className="club placeholder" />}
        </div>
      </div>

      <div className="your-match">
        <div className="your-match-head">
          <span className="label">Your match</span>
          <button className="change-btn" onClick={() => setEditing(true)}>
            Change
          </button>
        </div>
        <dl>
          {choices.map((c) => (
            <div key={c.label}>
              <dt>{c.label}</dt>
              <dd>
                {c.value}
                {c.hint && <span className="muted"> · {c.hint}</span>}
              </dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="kickoff-bar">
        <p className="muted small">Every fixture is generated from scratch and narrated live by AI agents.</p>
        <button className="btn btn-primary" onClick={onKickOff} disabled={!info}>
          Kick off
        </button>
      </div>

      {editing && (
        <SettingsSheet
          profile={profile}
          onProfile={props.onProfile}
          detail={detail}
          onDetail={props.onDetail}
          sound={sound}
          onSound={props.onSound}
          theme={props.theme}
          onTheme={props.onTheme}
          speed={speed}
          onSpeed={props.onSpeed}
          onClose={() => setEditing(false)}
        />
      )}
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
