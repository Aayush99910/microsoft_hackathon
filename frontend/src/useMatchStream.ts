import { useEffect, useRef, useState } from 'react'
import type { Commentary, MatchEvent, MatchInfo, Moment, Stats } from './types'

export type Status = 'idle' | 'live' | 'half_time' | 'ended' | 'error'

const RECENT_EVENTS = 12

/** Connects to the backend's live match stream and keeps the latest state. */
export function useMatchStream() {
  const [info, setInfo] = useState<MatchInfo | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [events, setEvents] = useState<MatchEvent[]>([]) // newest first
  const [moments, setMoments] = useState<Moment[]>([]) // newest first
  const [lines, setLines] = useState<Record<number, Commentary>>({})
  const [status, setStatus] = useState<Status>('idle')
  const source = useRef<EventSource | null>(null)

  useEffect(() => () => source.current?.close(), [])

  function start(seed: number, speed: number) {
    source.current?.close()
    setInfo(null)
    setStats(null)
    setEvents([])
    setMoments([])
    setLines({})
    setStatus('live')

    const es = new EventSource(`/api/match/stream?seed=${seed}&speed=${speed}`)
    source.current = es
    const on = <T,>(kind: string, handle: (data: T) => void) =>
      es.addEventListener(kind, (msg) => handle(JSON.parse((msg as MessageEvent).data)))

    on<MatchInfo>('info', setInfo)
    on<Stats>('stats', setStats)
    on<MatchEvent>('event', (e) => {
      setEvents((old) => [e, ...old].slice(0, RECENT_EVENTS))
      if (e.type === 'period_end' && e.period === 1) setStatus('half_time')
      if (e.type === 'period_start' && e.period === 2) setStatus('live')
    })
    on<Moment>('moment', (m) => setMoments((old) => [m, ...old]))
    on<Commentary>('commentary', (c) => setLines((old) => ({ ...old, [c.moment_id]: c })))
    on('end', () => {
      es.close()
      setStatus('ended')
    })
    es.onerror = () => {
      es.close()
      setStatus((s) => (s === 'ended' ? s : 'error'))
    }
  }

  function stop() {
    source.current?.close()
    setStatus('idle')
  }

  return { info, stats, events, moments, lines, status, start, stop }
}
