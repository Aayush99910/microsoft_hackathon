type Props = { sound: boolean; onSound: (on: boolean) => void; speaking?: boolean }

/** Sound or no sound, as a two-option switch in the same style as the other match options. */
export function SoundSwitch({ sound, onSound, speaking = false }: Props) {
  return (
    <div className="seg sound-switch" role="radiogroup" aria-label="Sound">
      <button role="radio" aria-checked={sound} onClick={() => onSound(true)}>
        Sound
        {sound && (
          <span className={`eq ${speaking ? 'live' : ''}`} aria-hidden>
            <i />
            <i />
            <i />
          </span>
        )}
      </button>
      <button role="radio" aria-checked={!sound} onClick={() => onSound(false)}>
        No sound
      </button>
    </div>
  )
}
