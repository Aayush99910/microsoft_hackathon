import { useEffect, useState } from 'react'
import { MomentFeed } from './components/MomentFeed'
import { Pitch } from './components/Pitch'
import { Scoreboard } from './components/Scoreboard'
import { Setup } from './components/Setup'
import { StatsPanel } from './components/StatsPanel'
import type { Moment } from './types'
import { useMatchStream } from './useMatchStream'

const OVERLAY_SECONDS = 6 // how long a big-moment overlay stays on the pitch

function App() {
  const [seed, setSeed] = useState(7)
  const [speed, setSpeed] = useState(30)
  const match = useMatchStream()
  const overlayMoment = useOverlay(match.moments)

  if (match.status === 'idle' || !match.info) {
    return (
      <main className="page">
        <h1 className="brand">⚽ Match Brain</h1>
        <Setup seed={seed} speed={speed} onSeed={setSeed} onSpeed={setSpeed} onKickOff={() => match.start(seed, speed)} />
      </main>
    )
  }

  const { info } = match
  return (
    <main className="page live">
      <Scoreboard info={info} stats={match.stats} last={match.events[0]} status={match.status} onExit={match.stop} />
      <div className="layout">
        <div className="main-col">
          <Pitch
            info={info}
            events={match.events}
            overlay={overlayMoment ? { moment: overlayMoment, line: match.lines[overlayMoment.id] } : null}
          />
          <StatsPanel info={info} stats={match.stats} />
        </div>
        <MomentFeed info={info} moments={match.moments} lines={match.lines} />
      </div>
      {match.status === 'ended' && (
        <div className="end-actions">
          <button className="primary" onClick={() => match.start(seed, speed)}>↻ Watch again</button>
          <button className="ghost" onClick={match.stop}>New match</button>
        </div>
      )}
    </main>
  )
}

/** The newest notable moment (importance 2+), shown for a few seconds. */
function useOverlay(moments: Moment[]): Moment | null {
  const [shown, setShown] = useState<Moment | null>(null)
  const newest = moments.find((m) => m.importance >= 2)

  useEffect(() => {
    if (!newest) return
    setShown(newest)
    const timer = setTimeout(() => setShown(null), OVERLAY_SECONDS * 1000)
    return () => clearTimeout(timer)
  }, [newest?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return shown
}

export default App
