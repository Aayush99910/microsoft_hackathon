import { useEffect, useRef, useState } from 'react'
import type { MatchInfo, Side } from './types'

export type Fixture = { game: number; seed: number; info: MatchInfo }
export type GameState = { t: number; period: number; score: Record<Side, number>; halfTime: boolean; ended: boolean }
export type Flash = { game: number; text: string; key: number }

type ScoreMsg = {
  game: number
  t: number
  period: number
  score: Record<Side, number>
  half_time: boolean
  event: string | null
  team: Side | null
  player: string | null
  card: string | null
  ended: boolean
}

const FLASH_MS = 6_000
const RECONNECT_MS = 1_500 // a dropped connection (server restart, proxy time limit, phone signal) is reopened after this
const SILENT_MS = 20_000 // scores arrive every few seconds: this long with nothing means the connection died quietly

/** Every game of a matchday kicking off together: live scores and goal alerts (no agents, no cost). */
export function useMatchday() {
  const [games, setGames] = useState<Record<number, GameState>>({})
  const [flash, setFlash] = useState<Flash | null>(null)
  const source = useRef<EventSource | null>(null)
  const startedAt = useRef(0)
  const pace = useRef(1)
  const flashTimer = useRef(0)
  const day = useRef(0)
  const fixtures = useRef<Fixture[]>([])
  const retry = useRef(0)
  const lastHeard = useRef(0)

  // Some dropped connections never report an error (a proxy keeps the browser side open): reconnect
  // if the scores have gone silent
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (source.current && performance.now() - lastHeard.current > SILENT_MS) connect(playedSeconds())
    }, 5_000)
    return () => clearInterval(timer)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => source.current?.close(), [])

  function start(matchday: number, speed: number, games: Fixture[]) {
    setGames({})
    setFlash(null)
    startedAt.current = performance.now()
    pace.current = speed
    day.current = matchday
    fixtures.current = games
    connect(0)
  }

  /** Open the scores stream `fromT` seconds of play in (0 = kick-off; more when reconnecting). */
  function connect(fromT: number) {
    source.current?.close()
    clearTimeout(retry.current)
    const es = new EventSource(`/api/matchday/stream?day=${day.current}&speed=${pace.current}&from_t=${Math.round(fromT)}`)
    source.current = es
    lastHeard.current = performance.now()
    es.addEventListener('score', (msg) => {
      lastHeard.current = performance.now()
      const s: ScoreMsg = JSON.parse((msg as MessageEvent).data)
      setGames((old) => ({
        ...old,
        [s.game]: { t: s.t, period: s.period, score: s.score, halfTime: s.half_time, ended: s.ended },
      }))
      const info = fixtures.current[s.game]?.info
      const alert =
        s.event === 'goal'
          ? `Goal · ${info.home.short_name} ${s.score.home}–${s.score.away} ${info.away.short_name}`
          : s.event === 'card' && s.card === 'red'
            ? `Red card · ${s.team ? info[s.team].short_name : ''}`
            : null
      if (info && alert) {
        setFlash({ game: s.game, text: s.player ? `${alert} · ${s.player}` : alert, key: performance.now() })
        clearTimeout(flashTimer.current)
        flashTimer.current = window.setTimeout(() => setFlash(null), FLASH_MS)
      }
    })
    es.addEventListener('end', () => {
      es.close()
      source.current = null
    })
    es.onerror = () => {
      // Dropped mid-matchday: pick up again where the matchday has got to
      es.close()
      if (source.current !== es) return // stopped, or already replaced
      retry.current = window.setTimeout(() => {
        if (source.current === es) connect(playedSeconds())
      }, RECONNECT_MS)
    }
  }

  function stop() {
    source.current?.close()
    source.current = null
    clearTimeout(retry.current)
    setGames({})
    setFlash(null)
  }

  /** How much of the matchday has been played, in match seconds: where to join another game. */
  function playedSeconds(): number {
    return ((performance.now() - startedAt.current) / 1000) * pace.current
  }

  return { games, flash, start, stop, playedSeconds }
}
