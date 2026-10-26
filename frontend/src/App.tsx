import { useEffect, useRef, useState } from 'react'
import { Compare } from './components/Compare'
import { MomentFeed } from './components/MomentFeed'
import { Pitch } from './components/Pitch'
import { LanguagePicker, ModePicker } from './components/ProfilePicker'
import { Scoreboard } from './components/Scoreboard'
import { Setup } from './components/Setup'
import { StatsPanel } from './components/StatsPanel'
import type { Commentary, Moment, Profile } from './types'
import { minuteLabel } from './format'
import { profileLabel, retell } from './retell'
import { useMatchStream } from './useMatchStream'
import { useReplay } from './useReplay'
import { useSpeaker } from './useSpeaker'

const OVERLAY_SECONDS = 6 // how long a big-moment graphic stays on the pitch
const RETELL_RECENT = 5 // cards re-told straight away when the viewer switches mode or language

function App() {
  const [seed, setSeed] = useState(7)
  const [speed, setSpeed] = useState(30)
  const [profile, setProfile] = useState<Profile>({ mode: 'casual', language: 'en' })
  const match = useMatchStream()
  const overlayMoment = useOverlay(match.moments)
  const { replay, play, stop: stopReplay } = useReplay()
  const speaker = useSpeaker()
  const [comparing, setComparing] = useState<Moment | null>(null)
  useSpeakNewLines(match.moments, match.lines, profile.language, speaker.say)

  function changeProfile(next: Profile) {
    setProfile(next)
    match.changeProfile(next) // new moments use it from now on
    // ...and the most recent cards are re-told straight away, so the switch is visible
    for (const m of match.moments.slice(0, RETELL_RECENT)) {
      const line = match.lines[m.id]
      if (!line) continue
      match.patchLine(m.id, { retelling: true })
      retell(m, line, next)
        .then((r) => match.patchLine(m.id, { text: r.text, why: r.why, profile: profileLabel(next), retelling: false }))
        .catch(() => match.patchLine(m.id, { retelling: false }))
    }
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
          {replay ? (
            <Pitch
              info={info}
              events={replay.events.slice(0, replay.step + 1).reverse()}
              trail={12}
              overlay={{ moment: replay.moment, line: match.lines[replay.moment.id] }}
              replay={{
                label: `Replay ${replay.step + 1}/${replay.events.length} · ${minuteLabel(replay.moment.t)}`,
                onExit: stopReplay,
              }}
            />
          ) : (
            <Pitch
              info={info}
              events={match.events}
              overlay={overlayMoment ? { moment: overlayMoment, line: match.lines[overlayMoment.id] } : null}
            />
          )}
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
              <button
                className={`voice-toggle ${speaker.enabled ? 'on' : ''}`}
                aria-pressed={speaker.enabled}
                onClick={speaker.toggle}
              >
                {speaker.enabled ? (speaker.speaking ? 'Voice · speaking' : 'Voice on') : 'Voice off'}
              </button>
            </div>
            <p className="profile-note">Switching re-tells the latest moments straight away. Use Compare on any moment to see all five.</p>
          </section>
          <MomentFeed
            info={info}
            moments={match.moments}
            lines={match.lines}
            onCompare={setComparing}
            onReplay={(m) => {
              play(m, match.eventsFor(m.evidence))
              speaker.say(match.lines[m.id]?.text ?? m.headline, profile.language, { interrupt: true })
              document.querySelector('.pitch-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }}
          />
        </div>
      </div>
      {comparing && match.lines[comparing.id] && (
        <Compare
          moment={comparing}
          line={match.lines[comparing.id]}
          language={profile.language}
          onClose={() => setComparing(null)}
        />
      )}
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

/** Speak each new commentary line once, as it arrives (only notable moments, to stay close to live). */
function useSpeakNewLines(
  moments: Moment[],
  lines: Record<number, Commentary>,
  language: string,
  say: (text: string, language: string) => void,
) {
  const spoken = useRef(new Set<number>())
  useEffect(() => {
    for (const m of [...moments].reverse()) {
      const line = lines[m.id]
      if (!line || spoken.current.has(m.id)) continue
      spoken.current.add(m.id)
      if (m.importance >= 2) say(line.text, language)
    }
  }, [moments, lines]) // eslint-disable-line react-hooks/exhaustive-deps
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
