import { useEffect, useRef, useState } from 'react'
import type { Commentary, MatchEvent, MatchInfo, Moment, Profile, Stats } from './types'

export type Status = 'idle' | 'live' | 'half_time' | 'ended' | 'error'

const RECENT_EVENTS = 12
const HOLD_MAX_MS = 20_000 // safety net only: a moment is shown at the latest this long after it arrives

/** Connects to the backend's live match stream and keeps the latest state. */
export function useMatchStream() {
  const [info, setInfo] = useState<MatchInfo | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [events, setEvents] = useState<MatchEvent[]>([]) // newest first
  const [moments, setMoments] = useState<Moment[]>([]) // newest first
  const [lines, setLines] = useState<Record<number, Commentary>>({})
  const [status, setStatus] = useState<Status>('idle')
  const source = useRef<EventSource | null>(null)
  const session = useRef('')
  const allEvents = useRef(new Map<number, MatchEvent>()) // every event so far, for replays
  // With sound on, moments wait here until their voice starts, so card, voice and crowd happen together.
  // With sound off they are shown as soon as they arrive.
  const held = useRef(new Map<number, { moment: Moment; timer: number }>())
  const ready = useRef(new Set<number>()) // released before the moment itself arrived
  const holding = useRef(true)
  const [heldIds, setHeldIds] = useState<number[]>([]) // moments waiting for their voice (oldest first)

  useEffect(() => () => source.current?.close(), [])

  function start(seed: number, speed: number, profile: Profile) {
    source.current?.close()
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
    setHeldIds([])

    session.current = crypto.randomUUID().replaceAll('-', '')
    const query = new URLSearchParams({
      seed: String(seed),
      speed: String(speed),
      session: session.current,
      mode: profile.mode,
      language: profile.language,
    })
    const es = new EventSource(`/api/match/stream?${query}`)
    source.current = es
    const on = <T,>(kind: string, handle: (data: T) => void) =>
      es.addEventListener(kind, (msg) => handle(JSON.parse((msg as MessageEvent).data)))

    on<MatchInfo>('info', setInfo)
    on<Stats>('stats', setStats)
    on<MatchEvent>('event', (e) => {
      allEvents.current.set(e.id, e)
      setEvents((old) => [e, ...old].slice(0, RECENT_EVENTS))
      if (e.type === 'period_end' && e.period === 1) setStatus('half_time')
      if (e.type === 'period_start' && e.period === 2) setStatus('live')
    })
    on<Moment>('moment', (m) => {
      if (!holding.current || ready.current.delete(m.id)) {
        show(m) // sound off (or already released): no waiting
        return
      }
      held.current.set(m.id, { moment: m, timer: window.setTimeout(() => release(m.id), HOLD_MAX_MS) })
      setHeldIds((ids) => [...ids, m.id])
    })
    on<Commentary>('commentary', (c) => setLines((old) => ({ ...old, [c.moment_id]: c })))
    on('end', () => {
      held.current.forEach((_, id) => release(id))
      es.close()
      setStatus('ended')
    })
    es.onerror = () => {
      es.close()
      setStatus((s) => (s === 'ended' ? s : 'error'))
    }
  }

  /** Change mode or language mid-match; the agents use it from the next key moment. */
  function changeProfile(profile: Profile) {
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

  /** Replace parts of a commentary line (used when re-telling it in another mode or language). */
  function patchLine(id: number, patch: Partial<Commentary>) {
    setLines((old) => (old[id] ? { ...old, [id]: { ...old[id], ...patch } } : old))
  }

  function stop() {
    source.current?.close()
    setStatus('idle')
  }

  return { info, stats, events, moments, lines, status, start, stop, changeProfile, eventsFor, patchLine, release, setHolding, heldIds }
}
