import { useEffect, useRef, useState } from 'react'
import type { Commentary, MatchEvent, MatchInfo, Moment, Profile, Stats } from './types'

export type Status = 'idle' | 'live' | 'half_time' | 'ended' | 'error'

const RECENT_EVENTS = 12
const HOLD_MAX_MS = 20_000 // safety net only: a moment is shown at the latest this long after it arrives
const RECONNECT_MS = 1_500 // a dropped connection (server restart, proxy time limit, phone signal) is reopened after this

const SILENT_MS = 40_000 // events arrive every few seconds: this long with nothing means the connection died quietly

type Game = { seed: number; speed: number; home?: string; away?: string; fromT: number; startedAt: number }

/** A moment from before the viewer joined: its headline stands in for commentary (and can be re-told). */
function headlineLine(m: Moment): Commentary {
  const h = m.headline
  return {
    moment_id: m.id, kind: m.kind, importance: m.importance, text: h, base_text: h, why: null, base_why: null,
    spoken: h, base_spoken: h, short: h, base_short: h, profile: 'casual · en', source: 'fallback', ms: 0, steps: [],
    catchup: true,
  }
}

/** Connects to the backend's live match stream and keeps the latest state. */
export function useMatchStream() {
  const [info, setInfo] = useState<MatchInfo | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [events, setEvents] = useState<MatchEvent[]>([]) // newest first
  const [moments, setMoments] = useState<Moment[]>([]) // newest first
  const [lines, setLines] = useState<Record<number, Commentary>>({})
  const [status, setStatus] = useState<Status>('idle')
  const [run, setRun] = useState(0) // bumped on every start: a new game, whose moment ids start at 1 again
  const source = useRef<EventSource | null>(null)
  const session = useRef('')
  const allEvents = useRef(new Map<number, MatchEvent>()) // every event so far, for replays
  // With sound on, moments wait here until their voice starts, so card, voice and crowd happen together.
  // With sound off they are shown as soon as they arrive.
  const held = useRef(new Map<number, { moment: Moment; timer: number }>())
  const ready = useRef(new Set<number>()) // released before the moment itself arrived
  const holding = useRef(true)
  const [heldIds, setHeldIds] = useState<number[]>([]) // moments waiting for their voice (oldest first)
  const game = useRef<Game | null>(null)
  const profileNow = useRef<Profile>({ mode: 'casual', language: 'en' })
  const retry = useRef(0)
  const shown = useRef(new Set<number>()) // ids of moments on screen (callbacks can't see the latest state)
  const lastHeard = useRef(0)

  // Some dropped connections never report an error (a proxy keeps the browser side open): rejoin if
  // the game has gone silent
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (source.current && performance.now() - lastHeard.current > SILENT_MS) connect(played(), true)
    }, 5_000)
    return () => clearInterval(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => source.current?.close(), [])

  /** Follow a game. `opts` picks the clubs and, on a matchday, how far in to join (seconds of play). */
  function start(seed: number, speed: number, profile: Profile, opts?: { home: string; away: string; fromT: number }) {
    setRun((r) => r + 1)
    setInfo(null)
    setStats(null)
    setEvents([])
    setMoments([])
    setLines({})
    setStatus('live')
    allEvents.current = new Map()
    held.current.forEach((h) => clearTimeout(h.timer))
    held.current = new Map()
    ready.current = new Set()
    shown.current = new Set()
    setHeldIds([])
    profileNow.current = profile
    game.current = { seed, speed, home: opts?.home, away: opts?.away, fromT: opts?.fromT ?? 0, startedAt: performance.now() }
    connect(game.current.fromT, false)
  }

  /** How far the game has got, in seconds of play. */
  function played(): number {
    const g = game.current
    return g ? g.fromT + ((performance.now() - g.startedAt) / 1000) * g.speed : 0
  }

  /**
   * Open the match stream `fromT` seconds of play in. `resume` = reconnecting after a dropped
   * connection: what is already on screen is kept and only what was missed is added.
   */
  function connect(fromT: number, resume: boolean) {
    const g = game.current
    if (!g) return
    source.current?.close()
    clearTimeout(retry.current)
    session.current = crypto.randomUUID().replaceAll('-', '')
    const profile = profileNow.current
    const query = new URLSearchParams({
      seed: String(g.seed),
      speed: String(g.speed),
      session: session.current,
      mode: profile.mode,
      language: profile.language,
      from_t: String(Math.round(Math.min(fromT, 7000))),
      ...(g.home && g.away && { home: g.home, away: g.away }),
    })
    const es = new EventSource(`/api/match/stream?${query}`)
    source.current = es
    lastHeard.current = performance.now()
    const on = <T,>(kind: string, handle: (data: T) => void) =>
      es.addEventListener(kind, (msg) => {
        lastHeard.current = performance.now()
        handle(JSON.parse((msg as MessageEvent).data))
      })

    on<MatchInfo>('info', (i) => !resume && setInfo(i))
    on<Stats>('stats', setStats)
    on<MatchEvent>('event', (e) => {
      if (allEvents.current.has(e.id)) return // already seen before a reconnect
      allEvents.current.set(e.id, e)
      setEvents((old) => [e, ...old].slice(0, RECENT_EVENTS))
      if (e.type === 'period_end' && e.period === 1) setStatus('half_time')
      if (e.type === 'period_start' && e.period === 2) setStatus('live')
    })
    // Joined (or rejoined) a game already under way: everything so far at once, without commentary
    on<{ events: MatchEvent[]; moments: Moment[]; stats: Stats }>('catchup', (d) => {
      d.events.forEach((e) => allEvents.current.set(e.id, e))
      setEvents([...allEvents.current.values()].slice(-RECENT_EVENTS).reverse())
      setStats(d.stats)
      // moment ids are the same on every run of a game, so a reconnect only adds the ones missed
      setMoments((old) => {
        const have = new Set(old.map((m) => m.id))
        const missed = d.moments.filter((m) => !have.has(m.id) && !held.current.has(m.id)).map((m) => ({ ...m, catchup: true }))
        missed.forEach((m) => shown.current.add(m.id))
        return [...old, ...missed].sort((a, b) => b.id - a.id)
      })
      setLines((old) => {
        const added = d.moments.filter((m) => !old[m.id]).map((m) => [m.id, headlineLine(m)] as const)
        return { ...old, ...Object.fromEntries(added) }
      })
      const all = [...allEvents.current.values()]
      const second = all.some((e) => e.type === 'period_start' && e.period === 2)
      if (all.some((e) => e.type === 'period_end' && e.period === 2)) setStatus('ended')
      else setStatus(!second && all.some((e) => e.type === 'period_end') ? 'half_time' : 'live')
    })
    on<Moment>('moment', (m) => {
      if (held.current.has(m.id) || shown.current.has(m.id)) return // already here before a reconnect
      if (!holding.current || ready.current.delete(m.id)) {
        show(m) // sound off (or already released): no waiting
        return
      }
      held.current.set(m.id, { moment: m, timer: window.setTimeout(() => release(m.id), HOLD_MAX_MS) })
      setHeldIds((ids) => [...ids, m.id])
    })
    on<Commentary>('commentary', (c) => setLines((old) => (old[c.moment_id] && !old[c.moment_id].catchup ? old : { ...old, [c.moment_id]: c })))
    on('end', () => {
      held.current.forEach((_, id) => release(id))
      es.close()
      source.current = null
      setStatus('ended')
    })
    es.onerror = () => {
      // Dropped mid-game: rejoin where the game has got to, keeping everything already on screen
      es.close()
      if (source.current !== es) return // stopped, or already replaced
      retry.current = window.setTimeout(() => {
        if (source.current === es) connect(played(), true)
      }, RECONNECT_MS)
    }
  }

  /** Change mode or language mid-match; the agents use it from the next key moment. */
  function changeProfile(profile: Profile) {
    profileNow.current = profile // a reconnect asks for it too
    if (!session.current || status === 'ended' || status === 'idle') return
    fetch(`/api/session/${session.current}/profile`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    }).catch(() => undefined)
  }

  /** Show a held moment now (its commentary and voice are ready). */
  function release(id: number) {
    const h = held.current.get(id)
    if (!h) {
      ready.current.add(id) // released before its moment arrived: show it as soon as it does
      return
    }
    clearTimeout(h.timer)
    held.current.delete(id)
    setHeldIds((ids) => ids.filter((x) => x !== id))
    show(h.moment)
  }

  function show(m: Moment) {
    shown.current.add(m.id)
    setMoments((old) => [m, ...old].sort((a, b) => b.id - a.id)) // newest first, even if shown out of order
  }

  /** Sound on: hold each moment until its voice starts. Sound off: show everything now. */
  function setHolding(hold: boolean) {
    holding.current = hold
    if (!hold) [...held.current.keys()].forEach(release)
  }

  /** The events a moment is based on, in match order (for replays). */
  function eventsFor(ids: number[]): MatchEvent[] {
    return ids.map((id) => allEvents.current.get(id)).filter((e): e is MatchEvent => !!e)
  }

  /** Every event so far, in match order (for the charts). */
  function history(): MatchEvent[] {
    return [...allEvents.current.values()]
  }

  /** Replace parts of a commentary line (used when re-telling it in another mode or language). */
  function patchLine(id: number, patch: Partial<Commentary>) {
    setLines((old) => (old[id] ? { ...old, [id]: { ...old[id], ...patch } } : old))
  }

  function stop() {
    source.current?.close()
    source.current = null
    clearTimeout(retry.current)
    game.current = null
    setStatus('idle')
  }

  return { info, stats, events, moments, lines, status, run, start, stop, changeProfile, eventsFor, history, patchLine, release, setHolding, heldIds }
}
