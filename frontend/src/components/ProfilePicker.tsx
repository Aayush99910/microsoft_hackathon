import type { Profile } from '../types'

export const MODES = [
  { id: 'casual', label: 'Casual', hint: 'The story of the game, no jargon' },
  { id: 'analyst', label: 'Analyst', hint: 'Stats first: xG, shots, possession' },
  { id: 'tactics', label: 'Tactics', hint: 'Shape, pressing and space, like a coach' },
  { id: 'kids', label: 'Kids', hint: 'Simple words, lots of fun' },
  { id: 'homer', label: 'Home fan', hint: 'One-eyed, all in for the home side' },
  { id: 'accessible', label: 'Described', hint: 'For blind and low-vision fans: who, where, what' },
]

export const LANGUAGES = [
  { id: 'en', label: 'English', english: 'English' },
  { id: 'es', label: 'Español', english: 'Spanish' },
  { id: 'fr', label: 'Français', english: 'French' },
  { id: 'de', label: 'Deutsch', english: 'German' },
  { id: 'pt', label: 'Português', english: 'Portuguese' },
  { id: 'it', label: 'Italiano', english: 'Italian' },
  { id: 'nl', label: 'Nederlands', english: 'Dutch' },
  { id: 'ar', label: 'العربية', english: 'Arabic' },
  { id: 'zh', label: '中文', english: 'Chinese' },
  { id: 'ja', label: '日本語', english: 'Japanese' },
  { id: 'ko', label: '한국어', english: 'Korean' },
  { id: 'ru', label: 'Русский', english: 'Russian' },
  { id: 'tr', label: 'Türkçe', english: 'Turkish' },
  { id: 'pl', label: 'Polski', english: 'Polish' },
  { id: 'uk', label: 'Українська', english: 'Ukrainian' },
  { id: 'id', label: 'Bahasa Indonesia', english: 'Indonesian' },
  { id: 'ms', label: 'Bahasa Melayu', english: 'Malay' },
  { id: 'vi', label: 'Tiếng Việt', english: 'Vietnamese' },
  { id: 'th', label: 'ไทย', english: 'Thai' },
  { id: 'hi', label: 'हिन्दी', english: 'Hindi' },
  { id: 'bn', label: 'বাংলা', english: 'Bengali' },
  { id: 'ur', label: 'اردو', english: 'Urdu' },
  { id: 'ta', label: 'தமிழ்', english: 'Tamil' },
  { id: 'te', label: 'తెలుగు', english: 'Telugu' },
  { id: 'mr', label: 'मराठी', english: 'Marathi' },
  { id: 'ne', label: 'नेपाली', english: 'Nepali' },
  { id: 'sw', label: 'Kiswahili', english: 'Swahili' },
  { id: 'fa', label: 'فارسی', english: 'Persian' },
  { id: 'el', label: 'Ελληνικά', english: 'Greek' },
  { id: 'sv', label: 'Svenska', english: 'Swedish' },
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
          {l.label === l.english ? l.label : `${l.label} · ${l.english}`}
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

/** Choice cards: each option says what you get, so nothing needs explaining (setup page, phone settings). */
export function OptionCards<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { id: T; label: string; hint: string }[]
  onChange: (value: T) => void
}) {
  return (
    <div className="option-cards" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} role="radio" aria-checked={value === o.id} onClick={() => onChange(o.id)}>
          <strong>{o.label}</strong>
          <span>{o.hint}</span>
        </button>
      ))}
    </div>
  )
}

export function ModeCards({ profile, onChange }: Props) {
  return (
    <OptionCards
      label="Commentary style"
      value={profile.mode}
      options={MODES}
      onChange={(mode) => onChange({ ...profile, mode })}
    />
  )
}

const DETAILS: { id: Detail; label: string; hint: string }[] = [
  { id: 'brief', label: 'Brief', hint: 'One short line per moment' },
  { id: 'full', label: 'Detailed', hint: 'Full commentary and why it matters' },
]

export function DetailCards({ detail, onChange }: { detail: Detail; onChange: (detail: Detail) => void }) {
  return <OptionCards label="Commentary detail" value={detail} options={DETAILS} onChange={onChange} />
}
