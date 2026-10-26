import type { Profile } from '../types'

export const MODES = [
  { id: 'casual', label: 'Casual', hint: 'The story, no jargon' },
  { id: 'analyst', label: 'Analyst', hint: 'Numbers first' },
  { id: 'tactics', label: 'Tactics', hint: 'Shape, space, pressing' },
  { id: 'kids', label: 'Kids', hint: 'Simple and fun' },
  { id: 'accessible', label: 'Described', hint: 'For blind and low-vision fans: who, where, what' },
]

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'ne', label: 'नेपाली' },
]

type Props = { profile: Profile; onChange: (profile: Profile) => void }

/** How the viewer wants the match told: a viewing mode and a language. */
export function ModePicker({ profile, onChange }: Props) {
  return (
    <div className="seg" role="radiogroup" aria-label="Viewing mode">
      {MODES.map((m) => (
        <button
          key={m.id}
          role="radio"
          aria-checked={profile.mode === m.id}
          title={m.hint}
          onClick={() => onChange({ ...profile, mode: m.id })}
        >
          {m.label}
        </button>
      ))}
    </div>
  )
}

export function LanguagePicker({ profile, onChange }: Props) {
  return (
    <select
      className="select"
      aria-label="Commentary language"
      value={profile.language}
      onChange={(e) => onChange({ ...profile, language: e.target.value })}
    >
      {LANGUAGES.map((l) => (
        <option key={l.id} value={l.id}>
          {l.label}
        </option>
      ))}
    </select>
  )
}

export type Detail = 'brief' | 'full'

/** How much commentary to show: one short line per moment, or the full line with "why it matters". */
export function DetailPicker({ detail, onChange }: { detail: Detail; onChange: (detail: Detail) => void }) {
  return (
    <div className="seg" role="radiogroup" aria-label="Commentary detail">
      <button role="radio" aria-checked={detail === 'brief'} onClick={() => onChange('brief')}>
        Brief
      </button>
      <button role="radio" aria-checked={detail === 'full'} onClick={() => onChange('full')}>
        Detailed
      </button>
    </div>
  )
}
