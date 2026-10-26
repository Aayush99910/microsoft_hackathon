import { useEffect, useRef, useState } from 'react'

const MAX_QUEUE = 2 // stay close to live: drop older lines if speech falls behind

/** Reads commentary aloud, one line at a time, using the backend's Azure AI Speech endpoint. */
export function useSpeaker() {
  const [enabled, setEnabled] = useState(false)
  const [speaking, setSpeaking] = useState(false)
  const busy = useRef(false) // the up-to-date "speaking" flag (state lags behind within one render)
  const queue = useRef<{ text: string; language: string }[]>([])
  const audio = useRef<HTMLAudioElement | null>(null)

  useEffect(() => () => audio.current?.pause(), [])

  function playNext() {
    const next = queue.current.shift()
    if (!next) {
      busy.current = false
      setSpeaking(false)
      return
    }
    busy.current = true
    setSpeaking(true)
    const query = new URLSearchParams({ text: next.text, language: next.language })
    const player = new Audio(`/api/speech?${query}`)
    audio.current = player
    player.onended = playNext
    player.onerror = playNext // skip lines that fail rather than stopping
    player.play().catch(playNext)
  }

  function say(text: string, language: string, { interrupt = false } = {}) {
    if (!enabled || !text) return
    if (interrupt) {
      queue.current = []
      audio.current?.pause()
    }
    queue.current.push({ text, language })
    queue.current = queue.current.slice(-MAX_QUEUE)
    if (interrupt || !busy.current) playNext()
  }

  function toggle() {
    if (enabled) {
      queue.current = []
      audio.current?.pause()
      busy.current = false
      setSpeaking(false)
    }
    setEnabled(!enabled)
  }

  return { enabled, speaking, toggle, say }
}
