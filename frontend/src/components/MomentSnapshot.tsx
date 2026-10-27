import { useEffect, useState } from 'react'
import type { MatchEvent, MatchInfo, Moment, Side } from '../types'
import { PitchLines } from './Pitch'

type End = { end_x: number; end_y: number }

// Moments that are about a passage of play, so a picture of it helps
const PICTURED = new Set(['goal', 'big_chance', 'rocket', 'first_shot', 'card', 'long_spell', 'pressing'])
const STEP_MS = 550 // replay: time per pass, run or shot

/** Where the ball goes during an event (start and end), in SVG coordinates (y from the top). */
function ballPath(e: MatchEvent): [[number, number], [number, number]] {
  const d = (e.pass ?? e.carry ?? e.shot) as End | undefined
  const start: [number, number] = [e.x, 68 - e.y]
  return [start, d ? [d.end_x, 68 - d.end_y] : start]
}

/**
 * A still of the play behind a key moment, like a broadcast graphic: the passes and runs that
 * built it, the shot (or foul), and where it ended. Replay plays it back move by move.
 */
export function MomentSnapshot({ moment, info, events }: { moment: Moment; info: MatchInfo; events: MatchEvent[] }) {
  const [step, setStep] = useState<number | null>(null) // replaying: how many events are drawn so far
  const pictured = PICTURED.has(moment.kind) && events.length > 0
  const moves = events.filter((e) => e.type === 'pass' || e.type === 'carry' || e.type === 'shot')

  useEffect(() => {
    if (step === null) return
    if (step >= events.length) {
      const done = window.setTimeout(() => setStep(null), 1200) // hold the last frame, then the full picture
      return () => clearTimeout(done)
    }
    const next = window.setTimeout(() => setStep(step + 1), STEP_MS)
    return () => clearTimeout(next)
  }, [step, events.length])

  if (!pictured) return null
  const color = (side: Side | null) => (side ? info[side].color : '#fff')
  const shown = step === null ? events : events.slice(0, step)
  const last = events[events.length - 1]
  // the ball: at the end of the latest move drawn (during a replay), sliding there from where that move began
  const current = step === null ? null : shown.filter((e) => moves.includes(e)).at(-1)
  const ball = current ? ballPath(current)[1] : step !== null ? ballPath(events[0])[0] : null

  return (
    <div className="snapshot-wrap">
      <svg className="snapshot" viewBox="-3 -3 111 74" role="img" aria-label={`Picture of the play: ${moment.headline}`}>
        <defs>
          <marker id="snap-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto">
            <path d="M 0 0 L 10 5 L 0 10 z" fill="#fff" />
          </marker>
        </defs>
        <PitchLines />
        {shown.map((e) => {
          const y = 68 - e.y
          if (e.type === 'pass' || e.type === 'carry') {
            const d = (e.pass ?? e.carry) as End
            return (
              <line
                key={e.id}
                className={`snap-${e.type}`}
                x1={e.x}
                y1={y}
                x2={d.end_x}
                y2={68 - d.end_y}
                markerEnd={e.type === 'pass' ? 'url(#snap-arrow)' : undefined}
              />
            )
          }
          if (e.type === 'shot') {
            const s = e.shot as End & { outcome: string }
            return (
              <g key={e.id}>
                <line className="snap-shot" x1={e.x} y1={y} x2={s.end_x} y2={68 - s.end_y} />
                <circle cx={e.x} cy={y} r={1.6} fill={color(e.team)} stroke="#fff" strokeWidth={0.4} />
                {s.outcome === 'goal' && <circle className="snap-goal" cx={s.end_x} cy={68 - s.end_y} r={2.4} />}
              </g>
            )
          }
          if (e.type === 'pressure') return <circle key={e.id} cx={e.x} cy={y} r={1.1} fill={color(e.team)} opacity={0.85} />
          if (e.type === 'foul' || e.type === 'card') {
            return <rect key={e.id} x={e.x - 1.2} y={y - 1.7} width={2.4} height={3.4} rx={0.4} className="snap-card" />
          }
          return null
        })}
        {step === null && last.type !== 'shot' && last.type !== 'pressure' && (
          <circle cx={last.x} cy={68 - last.y} r={1.4} fill={color(last.team)} stroke="#fff" strokeWidth={0.4} />
        )}
        {ball && (
          <circle
            className="snap-ball"
            r={1.1}
            style={{ transform: `translate(${ball[0]}px, ${ball[1]}px)`, transitionDuration: `${STEP_MS}ms` }}
          />
        )}
      </svg>
      {moves.length > 1 && (
        <button className="snap-replay" onClick={() => setStep(step === null ? 0 : null)}>
          {step === null ? '▶ Replay' : 'Stop'}
        </button>
      )}
    </div>
  )
}
