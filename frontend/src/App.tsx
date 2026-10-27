import { useEffect, useRef, useState } from 'react'
import { Compare } from './components/Compare'
import { MomentFeed } from './components/MomentFeed'
import { Charts } from './components/Charts'
import { Lineups } from './components/Lineups'
import { Loading } from './components/Loading'
import { MatchdayBar } from './components/MatchdayBar'
import { SoundSwitch } from './components/Sound'
import { ThemeToggle, useTheme } from './components/ThemeToggle'
import { type Detail, DetailPicker, LANGUAGES, LanguagePicker, MODES, ModePicker } from './components/ProfilePicker'
import { Ratings } from './components/Ratings'
import { Scoreboard } from './components/Scoreboard'
import { SettingsSheet } from './components/SettingsSheet'
import { Setup } from './components/Setup'
import { StatsPanel } from './components/StatsPanel'
import type { Commentary, Moment, Profile } from './types'
import { profileLabel, retell } from './retell'
import { useMatchStream } from './useMatchStream'
import { type Fixture, useMatchday } from './useMatchday'
import { useCrowd } from './useCrowd'
import { type Intensity, useSpeaker } from './useSpeaker'

const TABS = [
  { id: 'moments', label: 'Moments' },
  { id: 'stats', label: 'Stats' },
  { id: 'ratings', label: 'Ratings' },
  { id: 'lineups', label: 'Teams' },
  { id: 'pitch', label: 'Pitch' },
] as const
type TabId = (typeof TABS)[number]['id']
const WIDE = '(min-width: 901px)' // side by side: key moments in their own column, the other tabs beside them

const RETELL_RECENT = 5 // cards re-told straight away when the viewer switches mode or language
const SWITCH_MIN_MS = 2_000 // the switching bar shows at least this long, so the change is clearly visible
const SWITCH_MAX_MS = 6_000 // ...and at most this long, even if a re-tell is slow

function App() {
  const [day, setDay] = useState(1)
  const [fixtures, setFixtures] = useState<Fixture[] | null>(null)
  const [followed, setFollowed] = useState(0) // which game of the matchday is being watched
  const [speed, setSpeed] = useState(5)
  const [profile, setProfile] = useState<Profile>({ mode: 'casual', language: 'en' })
  const [detail, setDetail] = useState<Detail>('full')
  const { theme, setTheme, toggle: toggleTheme } = useTheme()
  const brief = detail === 'brief'
  const match = useMatchStream()
  const matchday = useMatchday()
  useEffect(() => {
    setFixtures(null)
    fetch(`/api/matchday?day=${day}`)
      .then((r) => r.json())
      .then((d) => setFixtures(d.fixtures))
      .catch(() => setFixtures(null))
  }, [day])
  const speaker = useSpeaker()
  const [comparing, setComparing] = useState<Moment | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [switching, setSwitching] = useState<string | null>(null) // loading message while re-telling moments
  const switchToken = useRef<symbol | null>(null)
  // Lines after this moment that are not in the viewer's mode and language get re-told (from the start of a
  // game too: a line whose translation failed arrives in English and is re-told)
  const lastMomentAtSwitch = useRef(0)
  const [tab, setTab] = useState<TabId>('moments')
  const wide = useMediaQuery(WIDE)
  const sideTabs = wide ? TABS.filter((t) => t.id !== 'moments') : TABS
  const shownTab: TabId = wide && tab === 'moments' ? 'stats' : tab
  const [seenMoments, setSeenMoments] = useState(0) // moments already seen, for the badge on the Moments tab
  useEffect(() => {
    if (tab === 'moments' || wide) setSeenMoments(match.moments.length)
  }, [tab, wide, match.moments.length])

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
    if (!soundOn) return
    for (const line of Object.values(match.lines)) {
      if (line.catchup || !inLanguage(line, profile) || preparedLines.current.has(line.moment_id)) continue
      preparedLines.current.add(line.moment_id)
      speaker.prepare(spokenText(line, brief), profile.language, intensityOf(line), profile.mode)
    }
  }, [match.lines]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sound on: once a waiting moment has its commentary, queue its voice. The card appears, and the crowd
  // reacts, at the instant the voice starts, so all three happen together.
  const voiced = useRef(new Set<number>())
  useEffect(() => {
    for (const id of match.heldIds) {
      const line = match.lines[id]
      // A line not yet in the viewer's language (written before a switch, or its translation failed) waits for
      // its re-told version: the voice never reads English in a Hindi voice. If that never comes, the card is
      // shown silently after the hold limit.
      if (!line || voiced.current.has(id) || !inLanguage(line, profile)) continue
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
    const wanted = profileLabel(profile)
    const lines = Object.values(match.lines)
    const recentCatchup = new Set(lines.filter((l) => l.catchup).map((l) => l.moment_id).sort((a, b) => b - a).slice(0, RETELL_RECENT))
    for (const line of lines) {
      const key = `${line.moment_id}|${wanted}`
      // only moments that arrived after the last switch, and the latest few from before the viewer joined
      // (older ones keep their text)
      const due = line.catchup ? recentCatchup.has(line.moment_id) : line.moment_id > lastMomentAtSwitch.current
      if (!due || line.profile === wanted || line.retelling) continue
      if (catchingUp.current.has(key)) continue
      const m = match.moments.find((x) => x.id === line.moment_id)
      if (!m) continue // not shown yet: it is re-told once it is
      catchingUp.current.add(key)
      retell(m, line, profile, match.info?.home.name)
        .then((r) => match.patchLine(m.id, { text: r.text, why: r.why, spoken: r.spoken, short: r.short, profile: wanted }))
        .catch(() => catchingUp.current.delete(key)) // try again on the next update
    }
  }, [match.lines, match.moments, profile]) // eslint-disable-line react-hooks/exhaustive-deps

  // A new game (or the same one restarted): its moment ids start at 1 again, so forget the last game's
  // (otherwise its moments 1, 2, 3... look already spoken and stay silent)
  useEffect(() => {
    preparedLines.current.clear()
    voiced.current.clear()
    catchingUp.current.clear()
    lastMomentAtSwitch.current = 0
  }, [match.run])

  useEffect(() => crowd.duck(speaker.status === 'speaking'), [speaker.status]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (match.status === 'idle') crowd.stop()
    else if (match.status === 'live') crowd.resume()
    else if (match.status === 'ended') {
      const quiet = window.setTimeout(crowd.stop, 8_000) // after the final whistle and the full-time recap starts
      return () => clearTimeout(quiet)
    }
  }, [match.status]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Watch one of the matchday's games, joining it at the minute the matchday has reached. */
  function follow(game: number, fromT: number) {
    const f = fixtures?.[game]
    if (!f) return
    setFollowed(game)
    speaker.silence()
    match.start(f.seed, speed, profile, { home: f.info.home.key, away: f.info.away.key, fromT: Math.min(fromT, 6000) })
    if (fromT > 0 && soundOn) introduce(f)
  }

  /** Joining a game already under way: the commentator says where we are, so there is no dead air. */
  async function introduce(f: Fixture) {
    const g = matchday.games[f.game]
    const score = g?.score ?? { home: 0, away: 0 }
    const minute = g ? Math.floor(g.t / 60) : 0
    let language = 'en' // the template is English until it is translated
    let text = `Over to ${f.info.venue}: ${f.info.home.name} ${score.home}, ${f.info.away.name} ${score.away}, ${
      g?.halfTime ? 'at half-time' : `${minute} minutes played`
    }.`
    if (profile.language !== 'en' || profile.mode !== 'casual') {
      try {
        const r = await fetch('/api/personalize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text,
            mode: profile.mode,
            language: profile.language,
            facts: {},
            home_team: f.info.home.name,
            spoken_max_words: 14,
          }),
        }).then((res) => res.json())
        if (r.source === 'agent') {
          text = r.spoken || r.text
          language = profile.language
        }
      } catch {
        // say it in English rather than not at all
      }
    }
    speaker.say(text, language, 'lively', profile.mode, { priority: 2 })
  }

  function startMatchday() {
    if (!fixtures) return
    match.setHolding(soundOn)
    if (soundOn) {
      speaker.unlock() // the click lets the browser play commentary later without another click
      crowd.start()
    }
    matchday.start(day, speed, fixtures)
    follow(followed, 0)
  }

  function leave() {
    match.stop()
    matchday.stop()
  }

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
      catchingUp.current.add(`${m.id}|${profileLabel(next)}`) // being re-told here: not again below
      match.patchLine(m.id, { retelling: true })
      return [
        retell(m, line, next, match.info?.home.name)
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
          .catch(() => {
            catchingUp.current.delete(`${m.id}|${profileLabel(next)}`) // let the catch-up try it again
            match.patchLine(m.id, { retelling: false })
          }),
      ]
    })
    const atLeast = new Promise((resolve) => setTimeout(resolve, SWITCH_MIN_MS))
    const atMost = new Promise((resolve) => setTimeout(resolve, SWITCH_MAX_MS))
    Promise.race([Promise.all([...retold, atLeast]), atMost]).then(() => {
      if (switchToken.current === token) setSwitching(null) // a newer switch keeps its own bar
    })
  }

  const bar = fixtures && (
    <MatchdayBar
      fixtures={fixtures}
      games={matchday.games}
      followed={followed}
      followedStats={match.info ? match.stats : null}
      flash={matchday.flash}
      onFollow={(game) => game !== followed && follow(game, matchday.playedSeconds())}
    />
  )

  if (match.status === 'idle') {
    return (
      <main className="page">
        <Masthead theme={<ThemeToggle theme={theme} onToggle={toggleTheme} />} />
        <Setup
          day={day}
          onDay={(d) => {
            setDay(d)
            setFollowed(0)
          }}
          fixtures={fixtures}
          followed={followed}
          onFollow={setFollowed}
          speed={speed}
          profile={profile}
          onSpeed={setSpeed}
          onProfile={setProfile}
          sound={soundOn}
          onSound={setSound}
          detail={detail}
          onDetail={setDetail}
          theme={theme}
          onTheme={setTheme}
          onStart={startMatchday}
        />
      </main>
    )
  }

  const { info } = match
  if (!info) {
    // joining another game: keep the scores bar while it loads
    return (
      <main className="page match">
        {bar}
        <Loading text="Joining the game…" className="feed-loading" spinner />
      </main>
    )
  }
  const unseen = match.moments.length - seenMoments
  const feed = (
    <MomentFeed
      info={info}
      moments={match.moments}
      lines={match.lines}
      onCompare={setComparing}
      waiting={match.events.length === 0 ? 'Getting the match ready…' : 'Waiting for the first key moment…'}
      switching={switching}
      brief={brief}
      eventsFor={match.eventsFor}
    />
  )
  return (
    <main className="page match">
      {bar}
      <Scoreboard info={info} stats={match.stats} last={match.events[0]} status={match.status} onExit={leave} onSettings={() => setSettingsOpen(true)} />
      <button className="settings-strip" onClick={() => setSettingsOpen(true)}>
        <span>
          {MODES.find((m) => m.id === profile.mode)?.label} · {LANGUAGES.find((l) => l.id === profile.language)?.label} ·{' '}
          {brief ? 'Brief' : 'Detailed'} · {soundOn ? 'Sound on' : 'No sound'}
        </span>
        <span className="change">Change</span>
      </button>

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

      {match.status === 'ended' && (
        <div className="end-actions">
          <button className="btn btn-primary" onClick={startMatchday}>
            Replay matchday
          </button>
          <button className="btn btn-line" onClick={leave}>
            New matchday
          </button>
        </div>
      )}

      <div className="layout">
        {wide && (
          <section className="side-panel moments-panel">
            <h2 className="panel-title">Key moments</h2>
            <div className="tab-body">{feed}</div>
          </section>
        )}

        <section className="side-panel">
          <div className="tab-bar" role="tablist">
            {sideTabs.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={shownTab === t.id}
                className={shownTab === t.id ? 'active' : ''}
                onClick={() => setTab(t.id)}
              >
                {t.label}
                {t.id === 'moments' && shownTab !== 'moments' && unseen > 0 && <span className="badge">{unseen}</span>}
              </button>
            ))}
          </div>
          <div className="tab-body" role="tabpanel">
            {shownTab === 'moments' && feed}
            {shownTab === 'stats' && <StatsPanel info={info} stats={match.stats} />}
            {shownTab === 'ratings' && <Ratings info={info} stats={match.stats} />}
            {shownTab === 'lineups' && <Lineups info={info} />}
            {shownTab === 'pitch' && <Charts info={info} history={match.history()} />}
          </div>
        </section>
      </div>

      {settingsOpen && (
        <SettingsSheet
          profile={profile}
          onProfile={changeProfile}
          detail={detail}
          onDetail={setDetail}
          sound={soundOn}
          onSound={setSound}
          theme={theme}
          onTheme={setTheme}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {soundOn && speaker.status === 'blocked' && (
        // the browser refused to play audio without a tap (Safari, iPhone): one tap brings the voice back
        <button className="md-toast sound-blocked" onClick={speaker.unlock}>
          <span>Commentary is muted by the browser</span>
          <span className="md-toast-go">Tap to hear it</span>
        </button>
      )}

      {comparing && match.lines[comparing.id] && (
        <Compare
          moment={comparing}
          line={match.lines[comparing.id]}
          language={profile.language}
          homeTeam={info.home.name}
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

/** Whether a commentary line is written in the viewer's language (its label is "mode · language"). */
function inLanguage(line: Commentary, profile: Profile): boolean {
  return line.profile.split(' · ')[1] === profile.language
}

/** What the voice reads: the short line in Brief, otherwise the on-air version. */
function spokenText(line: Commentary, brief: boolean): string {
  return (brief ? line.short : line.spoken) ?? line.spoken ?? line.text
}

/** How excited the commentator sounds for each kind of moment (a card with importance 3 is a red). */
function intensityOf(m: { kind: string; importance: number }): Intensity {
  if (m.kind === 'goal' || m.kind === 'milestone' || (m.kind === 'card' && m.importance === 3)) return 'excited'
  if (m.kind === 'long_spell' || m.kind === 'chaos' || m.kind === 'opening' || m.kind === 'update') return 'calm'
  return 'lively'
}

/** Whether a CSS media query matches, kept up to date as the window is resized. */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const list = window.matchMedia(query)
    const onChange = () => setMatches(list.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])
  return matches
}

export default App
