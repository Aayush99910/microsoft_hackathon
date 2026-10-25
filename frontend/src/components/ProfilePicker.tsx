import type { Profile } from '../types'

export const MODES = [
  { id: 'casual', icon: '😎', label: 'Casual' },
  { id: 'analyst', icon: '📊', label: 'Analyst' },
  { id: 'tactics', icon: '📋', label: 'Tactics' },
  { id: 'kids', icon: '🧒', label: 'Kids' },
  { id: 'accessible', icon: '🔊', label: 'Accessible' },
]

export const LANGUAGES = [
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
  { id: 'hi', label: 'हिन्दी' },
  { id: 'ne', label: 'नेपाली' },
]

type Props = { profile: Profile; onChange: (profile: Profile) => void; compact?: boolean }

/** How the viewer wants the match told: a viewing mode and a language. */
export function ProfilePicker({ profile, onChange, compact }: Props) {
  return (
    <div className={`profile-picker ${compact ? 'compact' : ''}`}>
      <div className="chips" role="radiogroup" aria-label="Viewing mode">
        {MODES.map((m) => (
          <button
            key={m.id}
            role="radio"
            aria-checked={profile.mode === m.id}
            className={`chip-button ${profile.mode === m.id ? 'active' : ''}`}
            onClick={() => onChange({ ...profile, mode: m.id })}
          >
            <span aria-hidden>{m.icon}</span> {m.label}
          </button>
        ))}
      </div>
      <select
        className="language"
        aria-label="Language"
        value={profile.language}
        onChange={(e) => onChange({ ...profile, language: e.target.value })}
      >
        {LANGUAGES.map((l) => (
          <option key={l.id} value={l.id}>
            🌐 {l.label}
          </option>
        ))}
      </select>
    </div>
  )
}
