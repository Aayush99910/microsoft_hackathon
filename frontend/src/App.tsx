import { useEffect, useRef, useState } from 'react'
import { Compare } from './components/Compare'
import { MomentFeed } from './components/MomentFeed'
import { Pitch } from './components/Pitch'
import { Lineups } from './components/Lineups'
import { SoundSwitch } from './components/Sound'
import { ThemeToggle, useTheme } from './components/ThemeToggle'
import { type Detail, DetailPicker, LANGUAGES, LanguagePicker, MODES, ModePicker } from './components/ProfilePicker'
import { Scoreboard } from './components/Scoreboard'
import { Setup } from './components/Setup'
import { StatsPanel } from './components/StatsPanel'
import type { Commentary, Moment, Profile } from './types'
import { minuteLabel } from './format'
import { profileLabel, retell } from './retell'
import { useMatchStream } from './useMatchStream'
import { useReplay } from './useReplay'
import { useCrowd } from './useCrowd'
import { type Intensity, useSpeaker } from './useSpeaker'

const OVERLAY_SECONDS = 6 // how long a big-moment graphic stays on the pitch
const TABS = [
  { id: 'moments', label: 'Moments' },
  { id: 'stats', label: 'Stats' },
  { id: 'lineups', label: 'Line-ups' },
] as const
type TabId = (typeof TABS)[number]['id']

const RETELL_RECENT = 5 // cards re-told straight away when the viewer switches mode or language
const SWITCH_MIN_MS = 2_000 // the switching bar shows at least this long, so the change is clearly visible
const SWITCH_MAX_MS = 6_000 // ...and at most this long, even if a re-tell is slow

function App() {
  const [seed, setSeed] = useState(7)
  const [speed, setSpeed] = useState(30)
  const [profile, setProfile] = useState<Profile>({ mode: 'casual', language: 'en' })
  const [detail, setDetail] = useState<Detail>('full')
  const { theme, toggle: toggleTheme } = useTheme()
  const brief = detail === 'brief'
  const match = useMatchStream()
  const overlayMoment = useOverlay(match.moments)
  const { replay, play, stop: stopReplay } = useReplay()
  const speaker = useSpeaker()
  const [comparing, setComparing] = useState<Moment | null>(null)
  const [switching, setSwitching] = useState<string | null>(null) // loading message while re-telling moments
  const switchToken = useRef<symbol | null>(null)
  const lastMomentAtSwitch = useRef(Number.MAX_SAFE_INTEGER) // no catch-up re-telling before the first switch
  const [tab, setTab] = useState<TabId>('moments')
  const [seenMoments, setSeenMoments] = useState(0) // moments already seen, for the badge on the Moments tab
  useEffect(() => {
    if (tab === 'moments') setSeenMoments(match.moments.length)
  }, [tab, match.moments.length])

  const crowd = useCrowd()
  const soundOn = speaker.enabled

  /** One switch for commentary voice and crowd. On: cards wait for their voice. Off: cards show at once. */
  function setSound(on: boolean) {
    speaker.setOn(on)
    crowd.setOn(on)
    match.setHolding(on)
  }

  // Commentary usually arrives a few seconds before its moment: start downloading its voice now
  const preparedLines = useRef(new Set<number>())
  useEffect(() => {
    if (Object.keys(match.lines).length === 0) preparedLines.current.clear() // new match: ids start again at 1
    if (!soundOn) return
    for (const line of Object.values(match.lines)) {
      if (preparedLines.current.has(line.moment_id)) continue
      preparedLines.current.add(line.moment_id)
      speaker.prepare(spokenText(line, brief), profile.language, intensityOf(line), profile.mode)
    }
  }, [match.lines]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sound on: once a waiting moment has its commentary, queue its voice. The card appears, and the crowd
  // reacts, at the instant the voice starts, so all three happen together.
  const voiced = useRef(new Set<number>())
  useEffect(() => {
    if (Object.keys(match.lines).length === 0) voiced.current.clear()
    for (const id of match.heldIds) {
      const line = match.lines[id]
      if (!line || voiced.current.has(id)) continue
      voiced.current.add(id)
      const showNow = () => {
        match.release(id)
        reactCrowd(crowd, line)
      }
      speaker.say(spokenText(line, brief), profile.language, intensityOf(line), profile.mode, {
        priority: line.importance,
        onStart: showNow,
        onSkip: () => match.release(id), // not spoken (too late or dropped): show the card anyway
      })
    }
  }, [match.heldIds, match.lines]) // eslint-disable-line react-hooks/exhaustive-deps

  // Commentary that was already being written when the viewer switched mode or language arrives in the
  // old style: re-tell it as it arrives, so everything after a switch matches the new choice
  const catchingUp = useRef(new Set<string>())
  useEffect(() => {
    if (Object.keys(match.lines).length === 0) catchingUp.current.clear()
    const wanted = profileLabel(profile)
    for (const line of Object.values(match.lines)) {
      const key = `${line.moment_id}|${wanted}`
      // only moments that arrived after the last switch (older ones beyond the latest few keep their text)
      if (line.moment_id <= lastMomentAtSwitch.current || line.profile === wanted || line.retelling) continue
      if (catchingUp.current.has(key)) continue
      const m = match.moments.find((x) => x.id === line.moment_id)
      if (!m) continue // not shown yet: it is re-told once it is
      catchingUp.current.add(key)
      retell(m, line, profile)
        .then((r) => match.patchLine(m.id, { text: r.text, why: r.why, spoken: r.spoken, short: r.short, profile: wanted }))
        .catch(() => undefined)
    }
  }, [match.lines, match.moments, profile]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => crowd.duck(speaker.status === 'speaking'), [speaker.status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (match.status === 'idle') crowd.stop()
    else if (match.status === 'live') crowd.resume()
  }, [match.status]) // eslint-disable-line react-hooks/exhaustive-deps

  function changeProfile(next: Profile) {
    setProfile(next)
    speaker.silence() // stop the current line at once; the next one comes in the new mode
    match.changeProfile(next) // new moments use it from now on
    // ...and the most recent cards are re-told straight away, so the switch is visible. A loading bar shows
    // for at least SWITCH_MIN_MS (and at most SWITCH_MAX_MS); whatever is being said keeps playing.
    const mode = MODES.find((m) => m.id === next.mode)?.label ?? next.mode
    const language = LANGUAGES.find((l) => l.id === next.language)?.label ?? next.language
    const token = Symbol()
    switchToken.current = token
    lastMomentAtSwitch.current = Math.max(0, ...match.moments.map((m) => m.id))
    setSwitching(`Switching to ${mode} · ${language}…`)
    const retold = match.moments.slice(0, RETELL_RECENT).flatMap((m) => {
      const line = match.lines[m.id]
      if (!line) return []
      match.patchLine(m.id, { retelling: true })
      return [
        retell(m, line, next)
          .then((r) =>
            match.patchLine(m.id, {
              text: r.text,
              why: r.why,
              spoken: r.spoken,
              short: r.short,
              profile: profileLabel(next),
              retelling: false,
            }),
          )
          .catch(() => match.patchLine(m.id, { retelling: false })),
      ]
    })
    const atLeast = new Promise((resolve) => setTimeout(resolve, SWITCH_MIN_MS))
    const atMost = new Promise((resolve) => setTimeout(resolve, SWITCH_MAX_MS))
    Promise.race([Promise.all([...retold, atLeast]), atMost]).then(() => {
      if (switchToken.current === token) setSwitching(null) // a newer switch keeps its own bar
    })
  }

  if (match.status === 'idle' || !match.info) {
    return (
      <main className="page">
        <Masthead theme={<ThemeToggle theme={theme} onToggle={toggleTheme} />} />
        <Setup
          seed={seed}
          speed={speed}
          profile={profile}
          onSeed={setSeed}
          onSpeed={setSpeed}
          onProfile={setProfile}
          sound={soundOn}
          onSound={setSound}
          detail={detail}
          onDetail={setDetail}
          onKickOff={() => {
            match.setHolding(soundOn)
            if (soundOn) {
              speaker.unlock() // the click lets the browser play commentary later without another click
              crowd.start()
            }
            match.start(seed, speed, profile)
          }}
        />
      </main>
    )
  }

  const { info } = match
  const unseen = match.moments.length - seenMoments
  return (
    <main className="page match">
      <Scoreboard info={info} stats={match.stats} last={match.events[0]} status={match.status} onExit={match.stop} />

      <div className="controls-bar">
        <span className="label">Commentary</span>
        <ModePicker profile={profile} onChange={changeProfile} />
        <LanguagePicker profile={profile} onChange={changeProfile} />
        <DetailPicker detail={detail} onChange={setDetail} />
        <span className="controls-gap" />
        <div className="controls-end">
          <SoundSwitch sound={soundOn} onSound={setSound} speaking={speaker.status === 'speaking'} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </div>

      <div className="layout">
        <div className="stage">
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
              waiting={match.events.length === 0 ? 'Getting the match ready…' : undefined}
              brief={brief}
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
        </div>

        <section className="side-panel">
          <div className="tab-bar" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                className={tab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'moments' && tab !== 'moments' && unseen > 0 && <span className="badge">{unseen}</span>}
              </button>
            ))}
          </div>
          <div className="tab-body" role="tabpanel">
            {tab === 'moments' && (
              <MomentFeed
                info={info}
                moments={match.moments}
                lines={match.lines}
                onCompare={setComparing}
                waiting={match.events.length === 0 ? 'Getting the match ready…' : 'Waiting for the first key moment…'}
                switching={switching}
                brief={brief}
                onReplay={(m) => {
                  play(m, match.eventsFor(m.evidence))
                  const line = match.lines[m.id]
                  speaker.say(line ? spokenText(line, brief) : m.headline, profile.language, intensityOf(m), profile.mode, {
                    priority: 9,
                    interrupt: true,
                  })
                }}
              />
            )}
            {tab === 'stats' && <StatsPanel info={info} stats={match.stats} />}
            {tab === 'lineups' && <Lineups info={info} />}
          </div>
        </section>
      </div>

      {comparing && match.lines[comparing.id] && (
        <Compare
          moment={comparing}
          line={match.lines[comparing.id]}
          language={profile.language}
          onClose={() => setComparing(null)}
        />
      )}
    </main>
  )
}

function Masthead({ theme }: { theme: React.ReactNode }) {
  return (
    <header className="masthead">
      <h1 className="wordmark">
        Match<span>Brain</span>
      </h1>
      <div className="masthead-right">
        <span className="label">Live match intelligence</span>
        {theme}
      </div>
    </header>
  )
}

/** The crowd reacts to a key moment as its card appears: whistles, roars, oohs and groans. */
function reactCrowd(crowd: ReturnType<typeof useCrowd>, m: { kind: string; importance: number }) {
  switch (m.kind) {
    case 'kickoff':
      crowd.whistle([0.9])
      break
    case 'half_time':
      crowd.whistle([0.45, 0.9]) // two blasts
      break
    case 'full_time':
      crowd.whistle([0.4, 0.4, 1.2]) // three blasts
      break
    case 'goal':
      crowd.roar()
      break
    case 'big_chance':
    case 'rocket':
      crowd.ooh()
      break
    case 'card':
      crowd.groan()
      if (m.importance === 3) crowd.whistle([0.6]) // a red card
      break
  }
}

/** What the voice reads: the short line in Brief, otherwise the on-air version. */
function spokenText(line: Commentary, brief: boolean): string {
  return (brief ? line.short : line.spoken) ?? line.spoken ?? line.text
}

/** How excited the commentator sounds for each kind of moment (a card with importance 3 is a red). */
function intensityOf(m: { kind: string; importance: number }): Intensity {
  if (m.kind === 'goal' || m.kind === 'milestone' || (m.kind === 'card' && m.importance === 3)) return 'excited'
  if (m.kind === 'long_spell' || m.kind === 'chaos') return 'calm'
  return 'lively'
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
