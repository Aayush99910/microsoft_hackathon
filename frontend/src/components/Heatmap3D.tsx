import { Line, OrbitControls } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { memo, useEffect, useMemo, useRef, useState } from 'react'
import { BoxGeometry } from 'three'
import type { MatchEvent } from '../types'

type V3 = [number, number, number]

const TOUCHES = new Set(['pass', 'carry', 'shot', 'dribble', 'tackle', 'pressure'])
const CELL = 5

/** Match coordinates (metres, x along, y across) to the 3D scene: centre spot at the origin, y up. */
const at = (x: number, y: number, h = 0): V3 => [x - 52.5, h, 34 - y]

function circle(cx: number, cy: number, r: number, from = 0, to = Math.PI * 2): V3[] {
  return Array.from({ length: 33 }, (_, i) => {
    const a = from + ((to - from) * i) / 32
    return at(cx + r * Math.cos(a), cy + r * Math.sin(a), 0.03)
  })
}

const rect = (x: number, y: number, w: number, h: number): V3[] =>
  [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
    [x, y],
  ].map(([a, b]) => at(a, b, 0.03))

// The pitch never changes: drawn once, not again on every match event
const Ground = memo(function Ground() {
  const lines: V3[][] = [
    rect(0, 0, 105, 68),
    [at(52.5, 0, 0.03), at(52.5, 68, 0.03)],
    circle(52.5, 34, 9.15),
    rect(0, 13.84, 16.5, 40.32),
    rect(88.5, 13.84, 16.5, 40.32),
    rect(0, 24.84, 5.5, 18.32),
    rect(99.5, 24.84, 5.5, 18.32),
    circle(11, 34, 9.15, -0.93, 0.93),
    circle(94, 34, 9.15, Math.PI - 0.93, Math.PI + 0.93),
  ]
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[115, 78]} />
        <meshStandardMaterial color="#1d6644" />
      </mesh>
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[i * 10.5 + 5.25 - 52.5, 0, 0]}>
          <planeGeometry args={[10.5, 68]} />
          <meshStandardMaterial color={i % 2 ? '#24774d' : '#1f6d46'} />
        </mesh>
      ))}
      {lines.map((points, i) => (
        <Line key={i} points={points} color="white" lineWidth={1.5} transparent opacity={0.75} />
      ))}
      <Goal x={0} />
      <Goal x={105} />
    </group>
  )
})

function Goal({ x }: { x: number }) {
  const back = x === 0 ? -2 : 2
  const frame: V3[] = [at(x, 30.34), at(x, 30.34, 2.44), at(x, 37.66, 2.44), at(x, 37.66)]
  const net: V3[] = [at(x, 30.34, 2.44), at(x + back, 30.34, 0), at(x + back, 37.66, 0), at(x, 37.66, 2.44)]
  return (
    <>
      <Line points={frame} color="white" lineWidth={3} />
      <Line points={net} color="white" lineWidth={1} transparent opacity={0.4} />
    </>
  )
}

const REFRESH_MS = 3_000 // the towers re-measure every few seconds, not on every event (light on phones)

/** Touches per 5 m square, re-measured every few seconds. */
function useCounts(events: MatchEvent[]): Map<string, number> {
  const latest = useRef(events)
  latest.current = events
  const [counts, setCounts] = useState(() => countTouches(events))
  useEffect(() => {
    const timer = window.setInterval(() => setCounts(countTouches(latest.current)), REFRESH_MS)
    return () => clearInterval(timer)
  }, [])
  useEffect(() => setCounts(countTouches(latest.current)), [events.length === 0]) // eslint-disable-line react-hooks/exhaustive-deps
  return counts
}

function countTouches(events: MatchEvent[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const e of events) {
    if (!TOUCHES.has(e.type)) continue
    const key = `${Math.min(20, Math.floor(e.x / CELL))},${Math.min(13, Math.floor(e.y / CELL))}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function Heat({ events }: { events: MatchEvent[] }) {
  const counts = useCounts(events)
  const box = useMemo(() => new BoxGeometry(1, 1, 1), []) // one shared box, stretched per square
  useEffect(() => () => box.dispose(), [box])
  const max = Math.max(1, ...counts.values())
  return (
    <>
      {[...counts].map(([key, n]) => {
        const [cx, cy] = key.split(',').map(Number)
        const v = n / max
        if (v < 0.12) return null // a stray touch or two: leave the grass showing
        const h = 0.3 + v * 14
        return (
          <mesh
            key={key}
            geometry={box}
            position={at(cx * CELL + CELL / 2, cy * CELL + CELL / 2, h / 2)}
            scale={[CELL * 0.86, h, CELL * 0.86]}
          >
            <meshLambertMaterial color={`hsl(${60 - v * 60}, 100%, 50%)`} transparent opacity={0.55 + v * 0.4} />
          </mesh>
        )
      })}
    </>
  )
}

/**
 * The heatmap in 3D: towers over the pitch, turning slowly. Drag sideways to turn it yourself. It never
 * zooms or captures vertical swipes, so scrolling the page over it still works (on phones too).
 * `onFail` is called if the device drops the 3D context, so the page can fall back to 2D.
 */
export default function Heatmap3D({ events, onFail }: { events: MatchEvent[]; onFail: () => void }) {
  return (
    <div className="pitch-3d">
      <Canvas
        camera={{ position: [0, 58, 72], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, powerPreference: 'low-power' }}
        onCreated={({ gl }) =>
          gl.domElement.addEventListener('webglcontextlost', (e) => {
            e.preventDefault()
            onFail()
          })
        }
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[30, 60, 40]} intensity={1.2} />
        <Ground />
        <Heat events={events} />
        <OrbitControls
          target={[0, 0, 0]}
          enablePan={false}
          enableZoom={false}
          minPolarAngle={0.9}
          maxPolarAngle={0.9}
          autoRotate
          autoRotateSpeed={0.6}
        />
      </Canvas>
    </div>
  )
}
