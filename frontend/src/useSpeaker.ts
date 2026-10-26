import { useEffect, useRef, useState } from 'react'

export type Intensity = 'calm' | 'lively' | 'excited'
export type VoiceStatus = 'off' | 'idle' | 'speaking' | 'blocked'

type Clip = {
  text: string
  priority: number // higher = more important; low-priority clips are dropped first when speech falls behind
  queuedAt: number
  audio: Promise<string | null> // object URL of the MP3, fetched as soon as the line arrives
  onStart?: () => void // the clip starts playing (its card is shown at this instant)
  onSkip?: () => void // the clip will not be played (dropped, failed, too late, or sound switched off)
}

export type SayOptions = { priority?: number; interrupt?: boolean; onStart?: () => void; onSkip?: () => void }

const MAX_WAITING = 1 // at most one line waits; if another arrives, the less important is shown silently at once
const STALE_MS = 6_000 // a line still waiting this long is skipped, so the commentary stays live
const MUST_SAY = 3 // priority of goals and red cards: never skipped, and they cut in over smaller lines
const FETCH_TIMEOUT_MS = 15_000
const STALL_MARGIN_MS = 3_000 // a clip that has not ended this long after its length is skipped
const DEFAULT_CLIP_MS = 20_000 // watchdog before the clip's length is known
/** A 0.1 s silent WAV, played on the Kick off click so the browser allows audio for the rest of the match. */
function silentWav(): string {
  const samples = 800 // 0.1 s at 8 kHz, 8-bit mono
  const buffer = new ArrayBuffer(44 + samples)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => [...value].forEach((c, i) => view.setUint8(offset + i, c.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, 8000, true) // sample rate
  view.setUint32(28, 8000, true) // byte rate
  view.setUint16(32, 1, true) // block align
  view.setUint16(34, 8, true) // bits per sample
  text(36, 'data')
  view.setUint32(40, samples, true)
  new Uint8Array(buffer, 44).fill(128) // 128 = silence for 8-bit audio
  return URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
}

async function fetchClip(text: string, language: string, intensity: Intensity, mode: string): Promise<string | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const query = new URLSearchParams({ text, language, intensity, mode })
    const response = await fetch(`/api/speech?${query}`, { signal: controller.signal })
    if (!response.ok) return null
    return URL.createObjectURL(await response.blob())
  } catch {
    return null // network error or timeout: this line is skipped, the next one still plays
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reads commentary aloud with the backend's Azure AI Speech endpoint.
 *
 * Built so it cannot get stuck: clips are fetched ahead, one shared audio element plays them in
 * order, and a watchdog skips any clip that stalls. The Kick off click unlocks audio, so later
 * clips are allowed to play without further clicks.
 */
export function useSpeaker() {
  const [enabled, setEnabled] = useState(true)
  const [status, setStatus] = useState<VoiceStatus>('idle')
  const [nowSpeaking, setNowSpeaking] = useState<string | null>(null)
  const player = useRef<HTMLAudioElement | null>(null)
  const queue = useRef<Clip[]>([])
  const current = useRef<{ url: string; watchdog: number; priority: number } | null>(null)
  const busy = useRef(false)
  const on = useRef(true) // up-to-date "enabled" for async callbacks
  const generation = useRef(0) // bumped on interrupt/off, so a clip still downloading from before is dropped
  const prepared = useRef(new Map<string, Promise<string | null>>()) // clips fetched ahead, by language|mode|intensity|text
  const afterCurrent = useRef<(() => void)[]>([]) // skipped clips' cards, shown when the line playing now ends

  useEffect(() => () => player.current?.pause(), [])

  function audio(): HTMLAudioElement {
    if (!player.current) player.current = new Audio()
    return player.current
  }

  /** Call from a click (Kick off, Sound on): lets the browser play audio later without a click. */
  function unlock() {
    const el = audio()
    el.src = silentWav()
    el.play().then(() => setStatus((s) => (s === 'blocked' ? 'idle' : s))).catch(() => undefined)
  }

  /** A clip will not be played. Its card waits for the line being spoken to end, so it never runs ahead of the voice. */
  function skip(clip: Clip) {
    if (!clip.onSkip) return
    if (current.current) afterCurrent.current.push(clip.onSkip)
    else clip.onSkip()
  }

  function flushSkipped() {
    const waiting = afterCurrent.current
    afterCurrent.current = []
    waiting.forEach((f) => f())
  }

  function finish() {
    if (current.current) {
      clearTimeout(current.current.watchdog)
      URL.revokeObjectURL(current.current.url)
      current.current = null
    }
    busy.current = false
    setNowSpeaking(null)
    flushSkipped()
    pump()
  }

  async function pump() {
    if (busy.current || !on.current) return
    const clip = queue.current.shift()
    if (!clip) {
      setStatus('idle')
      return
    }
    busy.current = true
    const mine = generation.current
    const url = await clip.audio
    if (mine !== generation.current) {
      if (url) URL.revokeObjectURL(url) // interrupted while downloading: a newer pump owns playback now
      skip(clip)
      return
    }
    const stale = performance.now() - clip.queuedAt > STALE_MS && clip.priority < MUST_SAY
    if (!url || !on.current || stale) {
      busy.current = false
      if (url) URL.revokeObjectURL(url)
      skip(clip)
      return pump()
    }
    const el = audio()
    const watchdog = window.setTimeout(finish, DEFAULT_CLIP_MS)
    current.current = { url, watchdog, priority: clip.priority }
    el.onended = finish
    el.onerror = finish
    el.onloadedmetadata = () => {
      // Now that the length is known, give up only if it runs well past its end
      if (current.current?.url !== url || !Number.isFinite(el.duration)) return
      clearTimeout(current.current.watchdog)
      current.current.watchdog = window.setTimeout(finish, el.duration * 1000 + STALL_MARGIN_MS)
    }
    el.src = url
    setNowSpeaking(clip.text)
    setStatus('speaking')
    clip.onStart?.()
    el.play().catch((error: DOMException) => {
      if (error.name === 'NotAllowedError') setStatus('blocked') // browser wants a click first
      finish()
    })
  }

  /** Stop whatever is playing or downloading, without starting the next clip. */
  function stopCurrent() {
    generation.current++
    player.current?.pause()
    if (current.current) {
      clearTimeout(current.current.watchdog)
      URL.revokeObjectURL(current.current.url)
      current.current = null
    }
    busy.current = false
    setNowSpeaking(null)
    flushSkipped()
  }

  function dropQueue() {
    const dropped = queue.current
    queue.current = []
    dropped.forEach(skip)
  }

  /** Start fetching a clip before it is needed (commentary arrives a few seconds before its moment is shown). */
  function prepare(text: string, language: string, intensity: Intensity, mode: string) {
    if (!on.current || !text) return
    const key = `${language}|${mode}|${intensity}|${text}`
    if (!prepared.current.has(key)) prepared.current.set(key, fetchClip(text, language, intensity, mode))
  }

  /**
   * Queue a line. `onStart` fires when it actually starts playing (show its card then), `onSkip` if it
   * never will. `interrupt` (replays) stops the current clip and plays this one now.
   */
  function say(text: string, language: string, intensity: Intensity, mode: string, options: SayOptions = {}) {
    const { priority = 1, interrupt = false, onStart, onSkip } = options
    if (!on.current || !text) {
      onSkip?.()
      return
    }
    const key = `${language}|${mode}|${intensity}|${text}`
    const audio = prepared.current.get(key) ?? fetchClip(text, language, intensity, mode)
    prepared.current.delete(key) // each prepared clip is played once (its URL is released after)
    const clip: Clip = { text, priority, audio, queuedAt: performance.now(), onStart, onSkip }
    // A goal or red card cuts in over a smaller line that is still playing
    const cutIn = priority >= MUST_SAY && (current.current?.priority ?? MUST_SAY) < MUST_SAY
    if (interrupt || cutIn) {
      dropQueue()
      queue.current = [clip]
      stopCurrent()
    } else {
      queue.current.push(clip)
      while (queue.current.length > MAX_WAITING) {
        // drop the least important waiting clip (the oldest one if tied)
        const lowest = queue.current.reduce((low, c, i) => (c.priority < queue.current[low].priority ? i : low), 0)
        skip(queue.current.splice(lowest, 1)[0])
      }
    }
    pump()
  }

  /** Stop speaking now and drop what is waiting (switching mode or language); sound stays on for the next line. */
  function silence() {
    dropQueue()
    stopCurrent()
    if (on.current) setStatus('idle')
  }

  /** Sound on or off. Off drops everything waiting (their cards are shown straight away). */
  function setOn(next: boolean) {
    on.current = next
    setEnabled(next)
    if (next) {
      unlock()
      setStatus('idle')
    } else {
      dropQueue()
      stopCurrent()
      setStatus('off')
    }
  }

  return { enabled, status, nowSpeaking, setOn, unlock, prepare, say, silence }
}
