import { useEffect, useRef, useState } from 'react'

/**
 * Stadium atmosphere, synthesized live with the Web Audio API (no recordings, so no licensing):
 * a constant crowd murmur, a roar for goals, an "ooh" that falls into a groan for near misses,
 * and the referee's whistle. The murmur dips while the commentator speaks, as on TV.
 */
export function useCrowd() {
  const [enabled, setEnabled] = useState(true)
  const ctx = useRef<AudioContext | null>(null)
  const master = useRef<GainNode | null>(null) // overall crowd volume (on/off)
  const bed = useRef<GainNode | null>(null) // the murmur, ducked under the commentary
  const noise = useRef<AudioBuffer | null>(null)
  const on = useRef(true)

  useEffect(() => () => void ctx.current?.close(), [])

  /** Must run inside a click (Kick off / Crowd on): browsers only start audio after a user gesture. */
  function start() {
    if (ctx.current) {
      void ctx.current.resume()
      return
    }
    const ac = new AudioContext()
    ctx.current = ac
    noise.current = pinkNoise(ac, 4)

    const out = ac.createGain()
    out.gain.value = on.current ? 0.55 : 0
    out.connect(ac.destination)
    master.current = out

    const level = ac.createGain()
    level.gain.value = 1
    level.connect(out)
    bed.current = level

    // Two layers of filtered noise make a crowd murmur; a slow wobble keeps it alive
    for (const [freq, q, volume, wobbleHz] of [
      [450, 0.6, 0.11, 0.07],
      [1400, 1.2, 0.035, 0.13],
    ]) {
      const src = loop(ac)
      const filter = ac.createBiquadFilter()
      filter.type = 'bandpass'
      filter.frequency.value = freq
      filter.Q.value = q
      const gain = ac.createGain()
      gain.gain.value = volume
      const wobble = ac.createOscillator()
      const depth = ac.createGain()
      wobble.frequency.value = wobbleHz
      depth.gain.value = volume * 0.35
      wobble.connect(depth).connect(gain.gain)
      src.connect(filter).connect(gain).connect(level)
      src.start()
      wobble.start()
    }
  }

  function loop(ac: AudioContext): AudioBufferSourceNode {
    const src = ac.createBufferSource()
    src.buffer = noise.current
    src.loop = true
    src.loopStart = Math.random() // different layers start at different points
    return src
  }

  /** A burst of crowd noise: `peak` volume, filter sweeping `from`→`to` Hz over `rise` s, fading over `fall` s. */
  function swell(peak: number, from: number, to: number, rise: number, hold: number, fall: number, endFreq = to) {
    const ac = ctx.current
    if (!ac || !master.current || !on.current) return
    const t = ac.currentTime
    const src = loop(ac)
    const filter = ac.createBiquadFilter()
    filter.type = 'bandpass'
    filter.Q.value = 0.7
    filter.frequency.setValueAtTime(from, t)
    filter.frequency.linearRampToValueAtTime(to, t + rise)
    filter.frequency.linearRampToValueAtTime(endFreq, t + rise + hold + fall)
    const gain = ac.createGain()
    gain.gain.setValueAtTime(0.0001, t)
    gain.gain.exponentialRampToValueAtTime(peak, t + rise)
    gain.gain.setValueAtTime(peak, t + rise + hold)
    gain.gain.exponentialRampToValueAtTime(0.0001, t + rise + hold + fall)
    src.connect(filter).connect(gain).connect(master.current)
    src.start(t)
    src.stop(t + rise + hold + fall + 0.1)
  }

  const roar = () => swell(0.9, 500, 1100, 0.35, 2.2, 3.5, 700) // goal
  const ooh = () => swell(0.45, 350, 850, 0.6, 0.3, 1.6, 300) // rises, then falls into a groan
  const groan = () => swell(0.3, 380, 380, 0.25, 0.2, 1.4, 220) // booking, foul on a break

  /** Referee's whistle: one blast per entry, length in seconds. */
  function whistle(blasts: number[]) {
    const ac = ctx.current
    if (!ac || !master.current || !on.current) return
    let t = ac.currentTime + 0.05
    for (const length of blasts) {
      const tone = ac.createOscillator()
      tone.type = 'triangle'
      tone.frequency.value = 2950
      const trill = ac.createOscillator() // the pea rattling inside the whistle
      const trillDepth = ac.createGain()
      trill.frequency.value = 38
      trillDepth.gain.value = 140
      trill.connect(trillDepth).connect(tone.frequency)
      const gain = ac.createGain()
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.12, t + 0.03)
      gain.gain.setValueAtTime(0.12, t + length - 0.05)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + length)
      tone.connect(gain).connect(master.current)
      tone.start(t)
      trill.start(t)
      tone.stop(t + length + 0.05)
      trill.stop(t + length + 0.05)
      t += length + 0.18
    }
  }

  /** Lower the murmur while the commentator talks. */
  function duck(speaking: boolean) {
    const ac = ctx.current
    if (!ac || !bed.current) return
    bed.current.gain.setTargetAtTime(speaking ? 0.35 : 1, ac.currentTime, 0.25)
  }

  /** Crowd on or off (part of the single Sound switch). Turning it on must happen in a click. */
  function setOn(next: boolean) {
    on.current = next
    setEnabled(next)
    if (next) start()
    const ac = ctx.current
    if (ac && master.current) master.current.gain.setTargetAtTime(next ? 0.55 : 0, ac.currentTime, 0.2)
  }

  function stop() {
    const ac = ctx.current
    if (ac && master.current) master.current.gain.setTargetAtTime(0, ac.currentTime, 0.3)
  }

  function resume() {
    const ac = ctx.current
    if (ac && master.current && on.current) master.current.gain.setTargetAtTime(0.55, ac.currentTime, 0.3)
  }

  return { enabled, setOn, start, stop, resume, roar, ooh, groan, whistle, duck }
}

/** Pink noise (more natural than white for crowds), Paul Kellet's filter. */
function pinkNoise(ac: AudioContext, seconds: number): AudioBuffer {
  const buffer = ac.createBuffer(1, ac.sampleRate * seconds, ac.sampleRate)
  const data = buffer.getChannelData(0)
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0
  for (let i = 0; i < data.length; i++) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
    b6 = white * 0.115926
  }
  return buffer
}
