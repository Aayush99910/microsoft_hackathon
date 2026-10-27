import { useEffect, useRef } from 'react'
import { clockMinute } from '../format'
import type { Side, Stats } from '../types'
import type { Fixture, Flash, GameState } from '../useMatchday'

type Props = {
  fixtures: Fixture[]
  games: Record<number, GameState>
  followed: number
  followedStats: Stats | null // the game being watched uses its own, commentary-synced score
  flash: Flash | null
  onFollow: (game: number) => void
}

/** All of the matchday's games side by side, like a scores ticker: tap one to watch it. */
export function MatchdayBar({ fixtures, games, followed, followedStats, flash, onFollow }: Props) {
  const bar = useRef<HTMLElement>(null)
  useEffect(() => {
    // keep the game being watched in view on narrow screens
    bar.current?.querySelector('.md-chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [followed])
  return (
    <>
      <nav className="md-bar" aria-label="Matchday games" ref={bar}>
        {fixtures.map((f) => {
          const g = games[f.game]
          const on = f.game === followed
          const score: Record<Side, number> = (on && followedStats?.score) || g?.score || { home: 0, away: 0 }
          const status = !g ? '0\'' : g.ended ? 'FT' : g.halfTime ? 'HT' : clockMinute(g.t, g.period)
          return (
            <button
              key={`${f.game}-${flash?.game === f.game ? flash.key : ''}`}
              className={`md-chip${on ? ' on' : ''}${flash?.game === f.game ? ' flash' : ''}`}
              aria-pressed={on}
              onClick={() => onFollow(f.game)}
            >
              <span className="md-row">
                <i style={{ background: f.info.home.color }} />
                <span>{f.info.home.short_name}</span>
                <b>{score.home}</b>
              </span>
              <span className="md-row">
                <i style={{ background: f.info.away.color }} />
                <span>{f.info.away.short_name}</span>
                <b>{score.away}</b>
              </span>
              <span className="md-status">{on ? 'Watching' : status}</span>
            </button>
          )
        })}
      </nav>
      {flash && flash.game !== followed && (
        <button key={flash.key} className="md-toast" onClick={() => onFollow(flash.game)}>
          <span>{flash.text}</span>
          <span className="md-toast-go">Watch</span>
        </button>
      )}
    </>
  )
}
