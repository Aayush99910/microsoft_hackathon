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
  event: string | null
  team: Side | null
  player: string | null
  card: string | null
  ended: boolean
}

const FLASH_MS = 6_000

/** Every game of a matchday kicking off together: live scores and goal alerts (no agents, no cost). */
export function useMatchday() {
  const [games, setGames] = useState<Record<number, GameState>>({})
  const [flash, setFlash] = useState<Flash | null>(null)
  const source = useRef<EventSource | null>(null)
  const startedAt = useRef(0)
  const pace = useRef(1)
  const flashTimer = useRef(0)

  useEffect(() => () => source.current?.close(), [])

  function start(day: number, speed: number, fixtures: Fixture[]) {
    source.current?.close()
    setGames({})
    setFlash(null)
    startedAt.current = performance.now()
    pace.current = speed
    const es = new EventSource(`/api/matchday/stream?day=${day}&speed=${speed}`)
    source.current = es
    es.addEventListener('score', (msg) => {
      const s: ScoreMsg = JSON.parse((msg as MessageEvent).data)
      setGames((old) => ({
        ...old,
        [s.game]: {
          t: s.t,
          period: s.period,
          score: s.score,
          halfTime: s.event === 'period_end' ? s.period === 1 : s.event === 'period_start' ? false : !!old[s.game]?.halfTime,
          ended: s.ended,
        },
      }))
      const info = fixtures[s.game]?.info
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
    es.addEventListener('end', () => es.close())
    es.onerror = () => es.close()
  }

  function stop() {
    source.current?.close()
    source.current = null
    setGames({})
    setFlash(null)
  }

  /** How much of the matchday has been played, in match seconds: where to join another game. */
  function playedSeconds(): number {
    return ((performance.now() - startedAt.current) / 1000) * pace.current
  }

  return { games, flash, start, stop, playedSeconds }
}
