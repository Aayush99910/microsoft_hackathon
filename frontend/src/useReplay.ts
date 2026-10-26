import { useEffect, useState } from 'react'
import type { MatchEvent, Moment } from './types'

const STEP_MS = 750 // time between replayed events
const HOLD_MS = 3500 // how long the finished replay stays on screen

export type Replay = { moment: Moment; events: MatchEvent[]; step: number }

/** Steps through the events behind a key moment, one at a time, then returns to live. */
export function useReplay() {
  const [replay, setReplay] = useState<Replay | null>(null)

  useEffect(() => {
    if (!replay) return
    const finished = replay.step >= replay.events.length - 1
    const timer = setTimeout(
      () => setReplay(finished ? null : { ...replay, step: replay.step + 1 }),
      finished ? HOLD_MS : STEP_MS,
    )
    return () => clearTimeout(timer)
  }, [replay])

  function play(moment: Moment, events: MatchEvent[]) {
    if (events.length) setReplay({ moment, events, step: 0 })
  }

  return { replay, play, stop: () => setReplay(null) }
}
