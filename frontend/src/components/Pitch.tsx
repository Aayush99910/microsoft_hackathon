import type { Commentary, MatchEvent, MatchInfo, Moment } from '../types'
import { MOMENT_ICON, describe } from '../format'

type End = { end_x: number; end_y: number }

const TRAIL = 6 // on-ball events drawn behind the ball
const ON_BALL = new Set(['pass', 'carry', 'shot'])

function endOf(e: MatchEvent): [number, number] {
  const details = (e.pass ?? e.carry ?? e.shot) as End | undefined
  return details ? [details.end_x, details.end_y] : [e.x, e.y]
}

type Props = {
  info: MatchInfo
  events: MatchEvent[] // newest first
  overlay: { moment: Moment; line?: Commentary } | null
}

/**
 * Top-down pitch (105 x 68 m, home attacks left to right): the ball, the last few
 * passes and runs, and a pop-up overlay for big moments.
 */
export function Pitch({ info, events, overlay }: Props) {
  const names = new Map([...info.home.players, ...info.away.players].map((p) => [p.id, p.name]))
  const trail = events.filter((e) => ON_BALL.has(e.type)).slice(0, TRAIL).reverse()
  const latest = events.find((e) => e.player_id) ?? events[0]
  const [ballX, ballY] = trail.length ? endOf(trail[trail.length - 1]) : [52.5, 34]
  const color = (e: MatchEvent) => (e.team === 'away' ? info.away.color : info.home.color)

  return (
    <div className="pitch-wrap">
      <svg className="pitch" viewBox="-2 -2 109 72" role="img" aria-label="Live pitch view">
        {/* y is flipped so that y=0 (bottom touchline) is at the bottom of the screen */}
        <g transform="translate(0 68) scale(1 -1)">
          <PitchLines />
          {trail.map((e, i) => {
            const [ex, ey] = endOf(e)
            const failed = e.type === 'pass' && (e.pass as { outcome: string }).outcome !== 'complete'
            return (
              <g key={e.id} opacity={0.25 + (0.75 * (i + 1)) / trail.length}>
                <line
                  x1={e.x}
                  y1={e.y}
                  x2={ex}
                  y2={ey}
                  stroke={e.type === 'shot' ? '#ffd166' : color(e)}
                  strokeWidth={e.type === 'shot' ? 0.7 : 0.45}
                  strokeDasharray={e.type === 'carry' ? '0.8 0.8' : failed ? '2 1' : undefined}
                />
                <circle cx={e.x} cy={e.y} r={1.1} fill={color(e)} stroke="#0b1a12" strokeWidth={0.25} />
              </g>
            )
          })}
          <circle className="ball" cx={ballX} cy={ballY} r={0.9} fill="#fff" stroke="#0b1a12" strokeWidth={0.25} />
        </g>
      </svg>

      {latest && (
        <div className="pitch-caption">
          <span className="dot" style={{ background: latest.team ? color(latest) : '#8fa89a' }} />
          {describe(latest, names)}
        </div>
      )}

      {overlay && (
        <div key={overlay.moment.id} className={`overlay importance-${overlay.moment.importance}`}>
          <span className="overlay-icon">{MOMENT_ICON[overlay.moment.kind] ?? '•'}</span>
          <span>{overlay.line?.text ?? overlay.moment.headline}</span>
        </div>
      )}
    </div>
  )
}

function PitchLines() {
  const stroke = { stroke: 'rgba(255,255,255,0.35)', strokeWidth: 0.3, fill: 'none' }
  return (
    <g>
      <rect x={0} y={0} width={105} height={68} fill="#1d5c3a" />
      {[0, 1, 2, 3, 4, 5, 6].map((i) => (
        <rect key={i} x={i * 15} y={0} width={7.5} height={68} fill="#1f6340" />
      ))}
      <rect x={0} y={0} width={105} height={68} {...stroke} />
      <line x1={52.5} y1={0} x2={52.5} y2={68} {...stroke} />
      <circle cx={52.5} cy={34} r={9.15} {...stroke} />
      <rect x={0} y={13.84} width={16.5} height={40.32} {...stroke} />
      <rect x={88.5} y={13.84} width={16.5} height={40.32} {...stroke} />
      <rect x={0} y={24.84} width={5.5} height={18.32} {...stroke} />
      <rect x={99.5} y={24.84} width={5.5} height={18.32} {...stroke} />
      <rect x={-1.5} y={30.34} width={1.5} height={7.32} {...stroke} />
      <rect x={105} y={30.34} width={1.5} height={7.32} {...stroke} />
    </g>
  )
}
