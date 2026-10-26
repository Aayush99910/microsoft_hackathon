import { useEffect, useState } from 'react'
import type { MatchInfo, Profile, Team } from '../types'
import { type Detail, DetailCards, LanguagePicker, ModeCards, OptionCards } from './ProfilePicker'

const SPEEDS = [
  { id: '10', label: 'Relaxed', hint: 'Whole match in about 9 min' },
  { id: '30', label: 'Standard', hint: 'Whole match in about 3 min' },
  { id: '120', label: 'Highlights', hint: 'Under a minute' },
]

const SOUNDS = [
  { id: 'on', label: 'Sound', hint: 'Commentator voice and crowd' },
  { id: 'off', label: 'No sound', hint: 'Read the key moments only' },
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
            <span className="label">Commentary style</span>
            <p className="muted small">How the AI commentator tells the match</p>
          </div>
          <ModeCards profile={profile} onChange={onProfile} />
        </div>

        <div className="option">
          <div>
            <span className="label">Language</span>
          </div>
          <LanguagePicker profile={profile} onChange={onProfile} />
        </div>

        <div className="option">
          <div>
            <span className="label">Detail</span>
            <p className="muted small">How much to show for each key moment</p>
          </div>
          <DetailCards detail={detail} onChange={onDetail} />
        </div>

        <div className="option">
          <div>
            <span className="label">Sound</span>
            <p className="muted small">You can change it any time</p>
          </div>
          <OptionCards label="Sound" value={sound ? 'on' : 'off'} options={SOUNDS} onChange={(v) => onSound(v === 'on')} />
        </div>

        <div className="option">
          <div>
            <span className="label">Pace</span>
          </div>
          <OptionCards label="Playback speed" value={String(speed)} options={SPEEDS} onChange={(v) => onSpeed(Number(v))} />
        </div>
      </div>

      <div className="kickoff-bar">
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
