import type { Commentary, Moment, Profile } from './types'

const LANGUAGE_NAME: Record<string, string> = { en: 'English', es: 'Spanish', hi: 'Hindi', ne: 'Nepali' }

export function profileLabel(p: Profile): string {
  return `${p.mode} · ${LANGUAGE_NAME[p.language] ?? p.language}`
}

export type Retold = { text: string; why: string | null; source: string; ms: number }

/** Ask the Personalizer agent to re-tell one moment for a mode and language. */
export async function retell(moment: Moment, line: Commentary, profile: Profile): Promise<Retold> {
  const response = await fetch('/api/personalize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: line.base_text,
      why: line.base_why,
      facts: moment.facts,
      mode: profile.mode,
      language: profile.language,
    }),
  })
  if (!response.ok) throw new Error(`personalize failed: ${response.status}`)
  return response.json()
}
