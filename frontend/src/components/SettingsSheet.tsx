import { useEffect } from 'react'
import type { Profile } from '../types'
import { type Detail, DetailCards, LanguagePicker, ModeCards } from './ProfilePicker'
import { SoundSwitch } from './Sound'
import { type Theme, ThemePicker } from './ThemeToggle'

type Props = {
  profile: Profile
  onProfile: (profile: Profile) => void
  detail: Detail
  onDetail: (detail: Detail) => void
  sound: boolean
  onSound: (on: boolean) => void
  speaking: boolean
  theme: Theme
  onTheme: (theme: Theme) => void
  onClose: () => void
}

/** Phone match settings: a panel that slides up from the bottom, every option labelled. */
export function SettingsSheet({ profile, onProfile, detail, onDetail, sound, onSound, speaking, theme, onTheme, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Changing mode or language starts the re-telling, so the sheet closes to show it
  const changeProfile = (next: Profile) => {
    onProfile(next)
    onClose()
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Match settings" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <strong>Settings</strong>
          <button className="link" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="sheet-row">
          <span className="label">Commentary style</span>
          <ModeCards profile={profile} onChange={changeProfile} />
        </div>
        <div className="sheet-row">
          <span className="label">Language</span>
          <LanguagePicker profile={profile} onChange={changeProfile} />
        </div>
        <div className="sheet-row">
          <span className="label">Detail</span>
          <DetailCards detail={detail} onChange={onDetail} />
        </div>
        <div className="sheet-row">
          <span className="label">Sound</span>
          <SoundSwitch sound={sound} onSound={onSound} speaking={speaking} />
        </div>
        <div className="sheet-row">
          <span className="label">Theme</span>
          <ThemePicker theme={theme} onChange={onTheme} />
        </div>
      </div>
    </div>
  )
}
