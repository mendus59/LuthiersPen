/** Magnitude of one frequency in a Hann-windowed slice of audio (a single-bin Fourier transform). */
export function tone(mono: Float32Array, rate: number, start: number, length: number, freq: number): number {
  const a = Math.max(0, start)
  const b = Math.min(mono.length, start + length)
  if (b - a < length / 2) return 0
  const w = (2 * Math.PI * freq) / rate
  const cw = Math.cos(w)
  const sw = Math.sin(w)
  let c = 1
  let s = 0
  let re = 0
  let im = 0
  const hw = (2 * Math.PI) / length
  for (let i = a; i < b; i++) {
    const x = mono[i] * (0.5 - 0.5 * Math.cos(hw * (i - start)))
    re += x * c
    im += x * s
    const nc = c * cw - s * sw
    s = c * sw + s * cw
    c = nc
  }
  return Math.sqrt(re * re + im * im) / length
}

const SEMI = Math.pow(2, 1 / 12)

export interface NoteEvidence {
  /** Partials examined, and how many of them stand clear of their neighbouring semitones. */
  partials: number
  present: number
  /** Whether the lowest examined partial is present (rules out a note written an octave too low). */
  root: boolean
  /** Strength of the note's partials. */
  level: number
}

/**
 * Look in the recording for a note: at the moment the score says it starts, is there energy at
 * its partials that stands out from the semitones either side?
 */
export function noteEvidence(mono: Float32Array, rate: number, sec: number, pitch: number, cents = 0): NoteEvidence {
  const f0 = 440 * Math.pow(2, (pitch - 69 + cents / 100) / 12)
  const length = Math.round(rate * 0.24)
  const start = Math.round((sec - 0.03) * rate)
  let partials = 0
  let present = 0
  let root = false
  let level = 0
  for (let h = 1; h <= 8 && partials < 4; h++) {
    const f = f0 * h
    if (f < 200) continue
    if (f > rate * 0.45) break
    const on = tone(mono, rate, start, length, f)
    const lo = tone(mono, rate, start, length, f / SEMI)
    const hi = tone(mono, rate, start, length, f * SEMI)
    const clear = on > 1.6 * Math.max(lo, hi)
    if (clear) present++
    if (partials === 0) root = clear
    partials++
    level += on
  }
  return { partials, present, root, level: partials ? level / partials : 0 }
}
