import { MOMENT_LABEL, describe, minuteLabel } from '../format'
import type { Commentary, MatchEvent, MatchInfo, Moment } from '../types'

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
 * passes and runs, and a TV lower-third graphic for big moments.
 */
export function Pitch({ info, events, overlay }: Props) {
  const names = new Map([...info.home.players, ...info.away.players].map((p) => [p.id, p.name]))
  const trail = events.filter((e) => ON_BALL.has(e.type)).slice(0, TRAIL).reverse()
  const latest = events.find((e) => e.player_id) ?? events[0]
  const [ballX, ballY] = trail.length ? endOf(trail[trail.length - 1]) : [52.5, 34]
  const color = (e: MatchEvent) => (e.team === 'away' ? info.away.color : info.home.color)
  const overlayTeam = overlay?.moment.team ? info[overlay.moment.team] : null

  return (
    <div className="pitch-wrap">
      <svg className="pitch" viewBox="-3 -3 111 74" role="img" aria-label="Live pitch view">
        {/* y is flipped so that y=0 (bottom touchline) is at the bottom of the screen */}
        <g transform="translate(0 68) scale(1 -1)">
          <PitchLines />
          {trail.map((e, i) => {
            const [ex, ey] = endOf(e)
            const failed = e.type === 'pass' && (e.pass as { outcome: string }).outcome !== 'complete'
            return (
              <g key={e.id} opacity={0.2 + (0.8 * (i + 1)) / trail.length}>
                <line
                  x1={e.x}
                  y1={e.y}
                  x2={ex}
                  y2={ey}
                  stroke={e.type === 'shot' ? '#ffffff' : color(e)}
                  strokeWidth={e.type === 'shot' ? 0.6 : 0.4}
                  strokeDasharray={e.type === 'carry' ? '0.7 0.7' : failed ? '1.6 0.9' : undefined}
                  strokeLinecap="round"
                />
                <circle cx={e.x} cy={e.y} r={1.15} fill={color(e)} stroke="#fff" strokeWidth={0.3} />
              </g>
            )
          })}
          <circle className="ball" cx={ballX} cy={ballY} r={0.85} fill="#fff" />
        </g>
      </svg>

      {latest && (
        <div className="now-playing">
          <span className="bar" style={{ background: latest.team ? color(latest) : 'var(--muted)' }} />
          {describe(latest, names)}
        </div>
      )}

      {overlay && (
        <div key={overlay.moment.id} className={`lower-third ${overlay.moment.kind}`}>
          <span className="tag" style={{ background: overlayTeam?.color ?? 'var(--panel-2)' }}>
            {overlayTeam?.short_name ?? minuteLabel(overlay.moment.t)}
          </span>
          <div className="body">
            <div className="kicker">
              {MOMENT_LABEL[overlay.moment.kind] ?? overlay.moment.kind} · {minuteLabel(overlay.moment.t)}
            </div>
            <div className="line">{overlay.line?.text ?? overlay.moment.headline}</div>
          </div>
        </div>
      )}
    </div>
  )
}

function PitchLines() {
  const stroke = { stroke: 'rgba(255,255,255,0.55)', strokeWidth: 0.25, fill: 'none' }
  return (
    <g>
      <rect x={-3} y={-3} width={111} height={74} fill="#22432f" />
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} x={i * 10.5} y={0} width={10.5} height={68} fill={i % 2 ? '#244731' : '#22432f'} />
      ))}
      <rect x={0} y={0} width={105} height={68} {...stroke} />
      <line x1={52.5} y1={0} x2={52.5} y2={68} {...stroke} />
      <circle cx={52.5} cy={34} r={9.15} {...stroke} />
      <circle cx={52.5} cy={34} r={0.35} fill="rgba(255,255,255,0.55)" />
      <rect x={0} y={13.84} width={16.5} height={40.32} {...stroke} />
      <rect x={88.5} y={13.84} width={16.5} height={40.32} {...stroke} />
      <rect x={0} y={24.84} width={5.5} height={18.32} {...stroke} />
      <rect x={99.5} y={24.84} width={5.5} height={18.32} {...stroke} />
      <path d="M 16.5 26.7 A 9.15 9.15 0 0 1 16.5 41.3" {...stroke} />
      <path d="M 88.5 26.7 A 9.15 9.15 0 0 0 88.5 41.3" {...stroke} />
      <rect x={-1.6} y={30.34} width={1.6} height={7.32} {...stroke} />
      <rect x={105} y={30.34} width={1.6} height={7.32} {...stroke} />
    </g>
  )
}
