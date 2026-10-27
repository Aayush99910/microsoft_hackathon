import { useState } from 'react'
import type { Profile, Team } from '../types'
import type { Fixture } from '../useMatchday'
import { type Detail, LANGUAGES, MODES } from './ProfilePicker'
import { SPEEDS, SettingsSheet } from './SettingsSheet'
import type { Theme } from './ThemeToggle'

type Props = {
  day: number
  fixtures: Fixture[] | null
  followed: number
  onFollow: (game: number) => void
  onDay: (day: number) => void
  speed: number
  profile: Profile
  sound: boolean
  onSound: (on: boolean) => void
  detail: Detail
  onDetail: (detail: Detail) => void
  theme: Theme
  onTheme: (theme: Theme) => void
  onSpeed: (speed: number) => void
  onProfile: (profile: Profile) => void
  onStart: () => void
}

/** Pre-match screen: the matchday's games (pick one to watch first), how it will be told, and start. */
export function Setup(props: Props) {
  const { day, fixtures, followed, onFollow, onDay, speed, profile, sound, detail, onStart } = props
  const [editing, setEditing] = useState(false)

  const mode = MODES.find((m) => m.id === profile.mode)

  const summary = [
    mode?.label,
    LANGUAGES.find((l) => l.id === profile.language)?.label,
    detail === 'brief' ? 'Brief' : 'Detailed',
    sound ? 'Sound on' : 'No sound',
    SPEEDS.find((s) => Number(s.id) === speed)?.label,
  ]

  return (
    <section className="setup md-setup">
      <div className="md-hero">
        <div>
          <span className="md-hero-kicker">{fixtures?.length ?? 7} games · one kick-off</span>
          <h2 className="md-hero-title">Matchday {day}</h2>
          <p className="md-hero-sub">Every game is generated from scratch. The one you watch is narrated live by AI agents; switch games any time.</p>
        </div>
        <div className="md-hero-actions">
          <button className="btn btn-primary" onClick={onStart} disabled={!fixtures}>
            Start matchday
          </button>
          <button className="link md-hero-new" onClick={() => onDay(day + 1 + Math.floor(Math.random() * 50))}>
            Shuffle fixtures
          </button>
        </div>
      </div>

      <div className="md-told">
        <span className="label">How it's told</span>
        <span className="md-told-chips">
          {summary.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </span>
        <button className="change-btn" onClick={() => setEditing(true)}>
          Change
        </button>
      </div>

      <div className="md-games-head">
        <span className="label">Pick a game to watch first</span>
      </div>
      <ul className="md-games" role="radiogroup" aria-label="Game to watch first">
        {(fixtures ?? Array.from({ length: 7 }, () => null)).map((f, i) =>
          f ? (
            <li key={f.game}>
              <button role="radio" aria-checked={followed === f.game} onClick={() => onFollow(f.game)}>
                <span className="md-game-top">
                  <span>{f.info.venue}</span>
                  <span className="md-game-pick">{followed === f.game ? 'Watching first' : 'Watch'}</span>
                </span>
                <Club team={f.info.home} />
                <Club team={f.info.away} />
              </button>
            </li>
          ) : (
            <li key={i} className="placeholder" />
          ),
        )}
      </ul>

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

function Club({ team }: { team: Team }) {
  return (
    <span className="md-game-club">
      <i style={{ background: team.color }} />
      <span className="md-game-name">{team.name}</span>
      <span className="md-game-formation">{team.formation}</span>
    </span>
  )
}
