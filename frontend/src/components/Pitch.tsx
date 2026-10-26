import type { MatchEvent, MatchInfo } from '../types'

type End = { end_x: number; end_y: number }

const ON_BALL = new Set(['pass', 'carry', 'shot'])

// Same 4-3-3 shape the simulator uses, in each team's own attacking frame (attacking toward x = 105)
const FORMATION_433: Record<string, [number, number]> = {
  GK: [5, 34],
  RB: [30, 8],
  RCB: [22, 24],
  LCB: [22, 44],
  LB: [30, 60],
  RCM: [45, 22],
  CM: [40, 34],
  LCM: [45, 46],
  RW: [72, 10],
  ST: [78, 34],
  LW: [72, 58],
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function endOf(e: MatchEvent): [number, number] {
  const details = (e.pass ?? e.carry ?? e.shot) as End | undefined
  return details ? [details.end_x, details.end_y] : [e.x, e.y]
}

/**
 * Where each player stands: the team shape slides up and down with the ball and the team in
 * possession pushes a little higher (as in the simulator).
 */
function playerSpots(info: MatchInfo, ballX: number, inPossession: 'home' | 'away') {
  return (['home', 'away'] as const).flatMap((side) => {
    const ownBallX = side === 'home' ? ballX : 105 - ballX
    const shift = (ownBallX - 52.5) * 0.5
    const push = side === inPossession ? 6 : 0
    return info[side].players.map((p) => {
      const [fx, fy] = FORMATION_433[p.position] ?? [52.5, 34]
      const x = p.position === 'GK' ? fx + Math.max(0, shift) * 0.2 : clamp(fx + shift + push, 3, 102)
      // the away team attacks the other way
      const [px, py] = side === 'home' ? [x, fy] : [105 - x, 68 - fy]
      return { id: p.id, number: p.number, side, x: px, y: py }
    })
  })
}

/** Top-down live pitch (105 x 68 m, home attacks left to right): all 22 players and the ball. */
export function Pitch({ info, events }: { info: MatchInfo; events: MatchEvent[] /* newest first */ }) {
  const last = events.find((e) => ON_BALL.has(e.type))
  const [ballX, ballY] = last ? endOf(last) : [52.5, 34]
  const inPossession = (events.find((e) => e.team)?.team ?? 'home') as 'home' | 'away'
  const players = playerSpots(info, ballX, inPossession)

  return (
    <div className="pitch-wrap">
      <svg className="pitch" viewBox="-3 -3 111 74" role="img" aria-label="Live pitch view">
        <PitchLines />
        {/* y is measured from the top here, so y=0 (bottom touchline in match data) is drawn at the bottom */}
        {players.map((p) => {
          const active = p.id === last?.player_id
          const [x, y] = active ? [ballX, ballY] : [p.x, p.y]
          return (
            <g key={p.id} className="player" style={{ transform: `translate(${x}px, ${68 - y}px)` }}>
              <circle r={active ? 1.9 : 1.55} fill={info[p.side].color} className={active ? 'on-ball' : undefined} />
              <text className="shirt-no" dy="0.55">
                {p.number}
              </text>
            </g>
          )
        })}
        <circle className="ball" cx={ballX} cy={68 - ballY} r={0.8} fill="#fff" />
      </svg>
      <div className="pitch-legend">
        <span>
          <i style={{ background: info.home.color }} /> {info.home.short_name} → attacking right
        </span>
        <span>
          <i style={{ background: info.away.color }} /> {info.away.short_name}
        </span>
      </div>
    </div>
  )
}

function PitchLines() {
  // Colours come from the theme (light / dark) in index.css
  return (
    <g>
      <rect className="pitch-grass" x={-3} y={-3} width={111} height={74} />
      {Array.from({ length: 10 }, (_, i) => (
        <rect key={i} className={i % 2 ? 'pitch-stripe' : 'pitch-grass'} x={i * 10.5} y={0} width={10.5} height={68} />
      ))}
      <g className="pitch-markings">
        <rect x={0} y={0} width={105} height={68} />
        <line x1={52.5} y1={0} x2={52.5} y2={68} />
        <circle cx={52.5} cy={34} r={9.15} />
        <rect x={0} y={13.84} width={16.5} height={40.32} />
        <rect x={88.5} y={13.84} width={16.5} height={40.32} />
        <rect x={0} y={24.84} width={5.5} height={18.32} />
        <rect x={99.5} y={24.84} width={5.5} height={18.32} />
        <path d="M 16.5 26.7 A 9.15 9.15 0 0 1 16.5 41.3" />
        <path d="M 88.5 26.7 A 9.15 9.15 0 0 0 88.5 41.3" />
        <rect x={-1.6} y={30.34} width={1.6} height={7.32} />
        <rect x={105} y={30.34} width={1.6} height={7.32} />
      </g>
      <circle className="pitch-spot" cx={52.5} cy={34} r={0.35} />
    </g>
  )
}
