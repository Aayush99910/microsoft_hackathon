import type { Commentary, Moment, Profile } from './types'

/** Which mode and language a line was written for, e.g. "casual · fr" (as the server labels it). */
export function profileLabel(p: Profile): string {
  return `${p.mode} · ${p.language}`
}

export type Retold = { text: string; why: string | null; spoken: string; short: string; source: string; ms: number }

/**
 * Ask the Personalizer agent to re-tell one moment for a mode and language. Tries twice: when the
 * agent is slow the server hands back the original line, which must not pass as re-told.
 */
export async function retell(moment: Moment, line: Commentary, profile: Profile, homeTeam?: string): Promise<Retold> {
  const first = await retellOnce(moment, line, profile, homeTeam)
  if (first.source !== 'fallback') return first
  const second = await retellOnce(moment, line, profile, homeTeam)
  if (second.source !== 'fallback') return second
  throw new Error('personalizer did not answer')
}

async function retellOnce(moment: Moment, line: Commentary, profile: Profile, homeTeam?: string): Promise<Retold> {
  const response = await fetch('/api/personalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: line.base_text,
      why: line.base_why,
      spoken: line.base_spoken ?? line.base_text,
      short: line.base_short ?? line.base_text,
      facts: moment.facts,
      mode: profile.mode,
      language: profile.language,
      home_team: homeTeam, // the side the Home fan mode supports
    }),
  })
  if (!response.ok) throw new Error(`personalize failed: ${response.status}`)
  return response.json()
}
