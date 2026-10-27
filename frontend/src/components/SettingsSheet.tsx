import { useEffect, useState } from 'react'
import type { Profile } from '../types'
import { type Detail, DetailCards, LanguagePicker, ModeCards, OptionCards } from './ProfilePicker'
import { type Theme, ThemePicker } from './ThemeToggle'

export const SPEEDS = [
  { id: '1', label: 'Real time', hint: '90 minutes, like the real thing' },
  { id: '5', label: 'Relaxed', hint: 'Whole match in about 18 min' },
  { id: '20', label: 'Quick', hint: 'Whole match in about 5 min' },
]

export const SOUNDS = [
  { id: 'on', label: 'Sound', hint: 'Commentator voice and crowd' },
  { id: 'off', label: 'No sound', hint: 'Read the key moments only' },
]

type Props = {
  profile: Profile
  onProfile: (profile: Profile) => void
  detail: Detail
  onDetail: (detail: Detail) => void
  sound: boolean
  onSound: (on: boolean) => void
  theme: Theme
  onTheme: (theme: Theme) => void
  speed?: number // before kick-off only: how fast to play the match
  onSpeed?: (speed: number) => void
  onClose: () => void
}

/**
 * Phone match settings: a panel that slides up from the bottom. Choices are a draft until Save,
 * so a change of mode and language together is re-told once.
 */
export function SettingsSheet(props: Props) {
  const { profile, onProfile, detail, onDetail, sound, onSound, theme, onTheme, speed, onSpeed, onClose } = props
  const [draftProfile, setDraftProfile] = useState(profile)
  const [draftDetail, setDraftDetail] = useState(detail)
  const [draftSound, setDraftSound] = useState(sound)
  const [draftTheme, setDraftTheme] = useState(theme)
  const [draftSpeed, setDraftSpeed] = useState(speed)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const profileChanged = draftProfile.mode !== profile.mode || draftProfile.language !== profile.language
  const changed =
    profileChanged || draftDetail !== detail || draftSound !== sound || draftTheme !== theme || draftSpeed !== speed

  function save() {
    if (draftTheme !== theme) onTheme(draftTheme)
    if (draftDetail !== detail) onDetail(draftDetail)
    if (draftSound !== sound) onSound(draftSound)
    if (draftSpeed !== undefined && draftSpeed !== speed) onSpeed?.(draftSpeed)
    if (profileChanged) onProfile(draftProfile)
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Match settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <strong>Settings</strong>
          <button className="link" onClick={onClose}>
            Cancel
          </button>
        </div>

        <div className="sheet-row">
          <span className="label">Commentary style</span>
          <ModeCards profile={draftProfile} onChange={setDraftProfile} />
        </div>
        <div className="sheet-row">
          <span className="label">Language</span>
          <LanguagePicker profile={draftProfile} onChange={setDraftProfile} />
        </div>
        <div className="sheet-row">
          <span className="label">Detail</span>
          <DetailCards detail={draftDetail} onChange={setDraftDetail} />
        </div>
        <div className="sheet-row">
          <span className="label">Sound</span>
          <OptionCards label="Sound" value={draftSound ? 'on' : 'off'} options={SOUNDS} onChange={(v) => setDraftSound(v === 'on')} />
        </div>
        {draftSpeed !== undefined && (
          <div className="sheet-row">
            <span className="label">Pace</span>
            <OptionCards
              label="Playback speed"
              value={String(draftSpeed)}
              options={SPEEDS}
              onChange={(v) => setDraftSpeed(Number(v))}
            />
          </div>
        )}
        <div className="sheet-row">
          <span className="label">Theme</span>
          <ThemePicker theme={draftTheme} onChange={setDraftTheme} />
        </div>

        <div className="sheet-actions">
          <button className="btn btn-primary" onClick={save} disabled={!changed}>
            {changed ? 'Save changes' : 'No changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
