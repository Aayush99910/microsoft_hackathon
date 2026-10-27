import { Component, type ReactNode, Suspense, lazy, useState } from 'react'
import type { MatchEvent, MatchInfo, Side } from '../types'
import { PitchLines } from './Pitch'

const Heatmap3D = lazy(() => import('./Heatmap3D')) // three.js is big: only load it when 3D is picked

type End = { end_x: number; end_y: number }
type Shot = End & { xg: number; outcome: string; blocker_id: number | null }
type Pass = End & { outcome: string }

const VIEWS = [
  { id: 'shots', label: 'Shots' },
  { id: 'heat', label: 'Heatmap' },
  { id: 'passes', label: 'Passes' },
] as const
type View = (typeof VIEWS)[number]['id']

// Events where a player is on the ball or making a play, for the heatmap
const TOUCHES = new Set(['pass', 'carry', 'shot', 'dribble', 'tackle', 'pressure'])
const CELL = 5 // heatmap square size in metres

const CHOICE_KEY = 'match-brain-heatmap'

function readChoice(): string | null {
  try {
    return localStorage.getItem(CHOICE_KEY)
  } catch {
    return null
  }
}

function saveChoice(choice: string) {
  try {
    localStorage.setItem(CHOICE_KEY, choice)
  } catch {
    // private mode: the choice just isn't remembered
  }
}

/** If the 3D view fails to load or draw, show the 2D one instead of breaking the page. */
class Fallback extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onError()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)

/** The Pitch tab: shot map, heatmap (2D or 3D) and pass map, all drawn from the match events. */
export function Charts({ info, history }: { info: MatchInfo; history: MatchEvent[] }) {
  const [view, setView] = useState<View>('shots')
  const [threeD, setThreeDState] = useState(() => readChoice() === '3d')
  const [no3D, setNo3D] = useState(false) // the device could not draw 3D: stay on 2D
  const setThreeD = (on: boolean) => {
    setThreeDState(on)
    saveChoice(on ? '3d' : '2d')
  }
  const [side, setSide] = useState<Side>('home')
  const [playerId, setPlayerId] = useState<number | null>(null) // null = whole team

  const pickSide = (s: Side) => {
    setSide(s)
    setPlayerId(null)
  }
  const mine = history.filter((e) => e.team === side && (playerId === null || e.player_id === playerId))

  return (
    <div className="charts">
      <div className="seg chart-views" role="radiogroup" aria-label="Pitch view">
        {VIEWS.map((v) => (
          <button key={v.id} role="radio" aria-checked={view === v.id} onClick={() => setView(v.id)}>
            {v.label}
          </button>
        ))}
      </div>

      {(view === 'heat' || view === 'passes') && (
        <div className="chart-filters">
          <div className="ratings-teams" role="tablist">
            {(['home', 'away'] as Side[]).map((s) => (
              <button key={s} role="tab" aria-selected={side === s} onClick={() => pickSide(s)}>
                <i style={{ background: info[s].color }} />
                {info[s].short_name}
              </button>
            ))}
          </div>
          <select
            aria-label="Player"
            value={playerId ?? ''}
            onChange={(e) => setPlayerId(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">Whole team</option>
            {info[side].players.map((p) => (
              <option key={p.id} value={p.id}>
                {p.number} · {p.name} ({p.position})
              </option>
            ))}
          </select>
        </div>
      )}

      {view === 'shots' && <ShotMap info={info} history={history} />}
      {view === 'heat' && (
        <>
          <div className="seg heat-mode" role="radiogroup" aria-label="Heatmap style">
            {(['2D', '3D'] as const).map((m) => (
              <button key={m} role="radio" aria-checked={threeD === (m === '3D')} onClick={() => setThreeD(m === '3D')}>
                {m}
              </button>
            ))}
          </div>
          {no3D && <p className="muted small chart-note">3D isn't available on this device, so here it is in 2D.</p>}
          {threeD && !no3D ? (
            <Fallback onError={() => setNo3D(true)}>
              <Suspense fallback={<div className="pitch-3d loading muted small">Loading 3D…</div>}>
                <Heatmap3D events={mine} onFail={() => setNo3D(true)} />
                <p className="muted small chart-note">
                  Drag sideways to turn it. Taller, redder towers = more time on the ball there.
                </p>
              </Suspense>
            </Fallback>
          ) : (
            <Heatmap events={mine} side={side} />
          )}
        </>
      )}
      {view === 'passes' && <PassMap events={mine} />}
    </div>
  )
}

/** Both teams' shots: bigger circle = better chance (xG), filled = goal. */
function ShotMap({ info, history }: { info: MatchInfo; history: MatchEvent[] }) {
  const shots = history.filter((e) => e.type === 'shot' && e.team)
  const names = new Map([...info.home.players, ...info.away.players].map((p) => [p.id, p.name]))
  const summary = (s: Side) => {
    const own = shots.filter((e) => e.team === s).map((e) => e.shot as Shot)
    return {
      shots: own.length,
      onTarget: own.filter((x) => x.outcome === 'goal' || x.outcome === 'saved').length,
      goals: own.filter((x) => x.outcome === 'goal').length,
      xg: own.reduce((a, x) => a + x.xg, 0),
    }
  }
  // Saves made by each keeper: the other team's shots that ended "saved"
  const saves = (s: Side) => shots.filter((e) => e.team !== s && (e.shot as Shot).outcome === 'saved').length
  const keeper = (s: Side) => info[s].players.find((p) => p.position === 'GK')

  return (
    <>
      <ChartPitch>
        {shots.map((e) => {
          const s = e.shot as Shot
          const color = info[e.team as Side].color
          const goal = s.outcome === 'goal'
          return (
            <g key={e.id}>
              {goal && <line className="shot-path" x1={e.x} y1={68 - e.y} x2={s.end_x} y2={68 - s.end_y} />}
              <circle cx={e.x} cy={68 - e.y} r={0.9 + s.xg * 5} className={`shot-dot ${s.outcome}`} fill={color}>
                <title>
                  {names.get(e.player_id ?? -1)}: {s.outcome.replace('_', ' ')}, xG {s.xg.toFixed(2)}
                </title>
              </circle>
            </g>
          )
        })}
      </ChartPitch>
      <table className="chart-table">
        <thead>
          <tr>
            <th />
            <th>Shots</th>
            <th>On target</th>
            <th>Goals</th>
            <th>xG</th>
            <th>Saves</th>
          </tr>
        </thead>
        <tbody>
          {(['home', 'away'] as Side[]).map((s) => {
            const t = summary(s)
            return (
              <tr key={s}>
                <th>
                  <i style={{ background: info[s].color }} /> {info[s].short_name}
                </th>
                <td>{t.shots}</td>
                <td>{t.onTarget}</td>
                <td>{t.goals}</td>
                <td>{t.xg.toFixed(2)}</td>
                <td title={keeper(s)?.name}>{saves(s)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="muted small chart-note">
        {info.home.short_name} shoot right, {info.away.short_name} left. Bigger circle = better chance (xG). Bold ring =
        goal, faded = missed or blocked. Saves are by each team's keeper.
      </p>
    </>
  )
}

/** Where a team or player has been on the ball, in 5 m squares, blurred into a heatmap. */
function Heatmap({ events, side }: { events: MatchEvent[]; side: Side }) {
  const counts = new Map<string, number>()
  for (const e of events) {
    if (!TOUCHES.has(e.type)) continue
    const key = `${Math.min(20, Math.floor(e.x / CELL))},${Math.min(13, Math.floor(e.y / CELL))}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const max = Math.max(1, ...counts.values())
  const total = [...counts.values()].reduce((a, b) => a + b, 0)

  return (
    <>
      <ChartPitch defs={<HeatBlur />}>
        <g filter="url(#heat-blur)">
          {[...counts].map(([key, n]) => {
            const [cx, cy] = key.split(',').map(Number)
            const v = n / max
            if (v < 0.12) return null // a stray touch or two: leave the grass showing
            return (
              <rect
                key={key}
                x={cx * CELL}
                y={68 - (cy + 1) * CELL}
                width={CELL}
                height={CELL}
                fill={`hsl(${60 - v * 60} 100% ${50 - v * 5}%)`}
                opacity={0.45 + v * 0.55}
              />
            )
          })}
        </g>
      </ChartPitch>
      <p className="muted small chart-note">
        {total ? `${total} actions on the ball` : 'No actions yet'} · attacking {side === 'home' ? 'right' : 'left'} ·
        red = most active
      </p>
    </>
  )
}

function HeatBlur() {
  return (
    <filter id="heat-blur" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="2.6" />
    </filter>
  )
}

/** Every pass by a team or player: green arrows reached a teammate, red ones did not. */
function PassMap({ events }: { events: MatchEvent[] }) {
  const passes = events.filter((e) => e.type === 'pass')
  const done = passes.filter((e) => (e.pass as Pass).outcome === 'complete').length
  const shown = passes.slice(-120) // a whole team's match is too many arrows to read

  return (
    <>
      <ChartPitch defs={<Arrows />}>
        {shown.map((e) => {
          const p = e.pass as Pass
          const ok = p.outcome === 'complete'
          return (
            <line
              key={e.id}
              className={`pass-line ${ok ? 'ok' : 'lost'}`}
              x1={e.x}
              y1={68 - e.y}
              x2={p.end_x}
              y2={68 - p.end_y}
              markerEnd={`url(#arrow-${ok ? 'ok' : 'lost'})`}
            />
          )
        })}
      </ChartPitch>
      <p className="muted small chart-note">
        {passes.length
          ? `${done} of ${passes.length} passes completed (${pct(done, passes.length)}%)${
              passes.length > shown.length ? ` · showing the last ${shown.length}` : ''
            }`
          : 'No passes yet'}{' '}
        · <span className="pass-key ok">complete</span> <span className="pass-key lost">lost</span>
      </p>
    </>
  )
}

function Arrows() {
  return (
    <>
      {['ok', 'lost'].map((k) => (
        <marker
          key={k}
          id={`arrow-${k}`}
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="4"
          markerHeight="4"
          orient="auto"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" className={`pass-head ${k}`} />
        </marker>
      ))}
    </>
  )
}

function ChartPitch({ children, defs }: { children: React.ReactNode; defs?: React.ReactNode }) {
  return (
    <div className="pitch-wrap">
      <svg className="pitch" viewBox="-3 -3 111 74" role="img">
        {defs && <defs>{defs}</defs>}
        <PitchLines />
        {children}
      </svg>
    </div>
  )
}
