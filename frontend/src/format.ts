import type { MatchEvent } from './types'

/** Match clock as shown on TV: 12:34, or 45+1 in stoppage time. */
export function clock(t: number, period: number): string {
  const minute = Math.floor(t / 60)
  const limit = 45 * period
  const second = String(Math.floor(t % 60)).padStart(2, '0')
  return minute >= limit ? `${limit}+${minute - limit + 1}'` : `${String(minute).padStart(2, '0')}:${second}`
}

export function minuteLabel(t: number): string {
  return `${Math.floor(t / 60) + 1}'`
}

export const MOMENT_ICON: Record<string, string> = {
  goal: '⚽',
  milestone: '🏆',
  big_chance: '🎯',
  rocket: '⚡',
  card: '🟨',
  long_spell: '🔁',
  momentum_shift: '📈',
  pressing: '🔥',
  chaos: '🌀',
  half_time: '⏸️',
  full_time: '🏁',
}

export const MOMENT_LABEL: Record<string, string> = {
  goal: 'Goal',
  milestone: 'Milestone',
  big_chance: 'Big chance',
  rocket: 'Speed',
  card: 'Card',
  long_spell: 'Possession',
  momentum_shift: 'Momentum',
  pressing: 'Pressing',
  chaos: 'Chaos',
  half_time: 'Half-time',
  full_time: 'Full-time',
}

const ACTION: Record<string, string> = {
  pass: 'passes',
  carry: 'carries',
  dribble: 'dribbles',
  shot: 'shoots',
  goal: 'scores!',
  pressure: 'presses',
  tackle: 'tackles',
  possession_change: 'wins the ball',
  foul: 'fouls',
  card: 'is booked',
  period_start: 'Kick-off',
  period_end: 'Whistle',
}

export function describe(e: MatchEvent, names: Map<number, string>): string {
  const who = e.player_id ? names.get(e.player_id) ?? '' : ''
  return `${who} ${ACTION[e.type] ?? e.type}`.trim()
}
