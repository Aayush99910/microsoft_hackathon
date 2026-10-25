import { useEffect, useState } from 'react'
import { MomentFeed } from './components/MomentFeed'
import { Pitch } from './components/Pitch'
import { LanguagePicker, ModePicker } from './components/ProfilePicker'
import { Scoreboard } from './components/Scoreboard'
import { Setup } from './components/Setup'
import { StatsPanel } from './components/StatsPanel'
import type { Moment, Profile } from './types'
import { useMatchStream } from './useMatchStream'

const OVERLAY_SECONDS = 6 // how long a big-moment graphic stays on the pitch

function App() {
  const [seed, setSeed] = useState(7)
  const [speed, setSpeed] = useState(30)
  const [profile, setProfile] = useState<Profile>({ mode: 'casual', language: 'en' })
  const match = useMatchStream()
  const overlayMoment = useOverlay(match.moments)

  function changeProfile(next: Profile) {
    setProfile(next)
    match.changeProfile(next)
  }

  if (match.status === 'idle' || !match.info) {
    return (
      <main className="page">
        <Masthead />
        <Setup
          seed={seed}
          speed={speed}
          profile={profile}
          onSeed={setSeed}
          onSpeed={setSpeed}
          onProfile={setProfile}
          onKickOff={() => match.start(seed, speed, profile)}
        />
      </main>
    )
  }

  const { info } = match
  return (
    <main className="page">
      <Scoreboard info={info} stats={match.stats} last={match.events[0]} status={match.status} onExit={match.stop} />
      <div className="layout">
        <div className="col">
          <Pitch
            info={info}
            events={match.events}
            overlay={overlayMoment ? { moment: overlayMoment, line: match.lines[overlayMoment.id] } : null}
          />
          <StatsPanel info={info} stats={match.stats} />
        </div>
        <div className="col">
          <section className="panel">
            <div className="panel-head">
              <span className="label">Your commentary</span>
            </div>
            <div className="profile-body">
              <ModePicker profile={profile} onChange={changeProfile} />
              <LanguagePicker profile={profile} onChange={changeProfile} />
            </div>
            <p className="profile-note">Applies from the next key moment.</p>
          </section>
          <MomentFeed info={info} moments={match.moments} lines={match.lines} />
        </div>
      </div>
      {match.status === 'ended' && (
        <div className="end-actions">
          <button className="btn btn-primary" onClick={() => match.start(seed, speed, profile)}>
            Watch again
          </button>
          <button className="btn btn-line" onClick={match.stop}>
            New fixture
          </button>
        </div>
      )}
    </main>
  )
}

function Masthead() {
  return (
    <header className="masthead">
      <h1 className="wordmark">
        Match<span>/</span>Brain
      </h1>
      <span className="label">Live match intelligence</span>
    </header>
  )
}

/** The newest notable moment (importance 2+), shown for a few seconds. */
function useOverlay(moments: Moment[]): Moment | null {
  const [shown, setShown] = useState<Moment | null>(null)
  const newest = moments.find((m) => m.importance >= 2)

  useEffect(() => {
    if (!newest) return
    setShown(newest)
    const timer = setTimeout(() => setShown(null), OVERLAY_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [newest?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return shown
}

export default App
