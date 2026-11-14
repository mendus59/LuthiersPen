import { tone } from '../verify/evidence'
import type { NoteEvent } from './types'

const SEMI = Math.pow(2, 1 / 12)
const RETRIGGER_GAP = 0.12
const MIN_AMPLITUDE = 0.45
const MIN_RISE = 1.2
const RISE_WINDOW = 0.06
const FLOOR = 2e-5
const UNDERTONE = 0.3
const OVERTONE = 0.6

const DIVISOR: Record<number, number> = { 12: 2, 19: 3, 24: 4, 28: 5, 31: 6 }

/**
 * For a low note reported together with a higher one that could be its overtone: how strong are
 * the low note's own partials (those the higher note does not share) next to the shared ones?
 * Near zero means the low note is not really there.
 */
function ownPartials(mono: Float32Array, rate: number, sec: number, low: number, divisor: number): number {
  const f0 = 440 * Math.pow(2, (low - 69) / 12)
  const length = Math.round(rate * 0.2)
  const start = Math.round(sec * rate)
  let own = 0
  let ownCount = 0
  let shared = 0
  let sharedCount = 0
  for (let h = 1; h <= 12; h++) {
    if (h % divisor === 0) {
      if (sharedCount < 3) {
        shared += tone(mono, rate, start, length, f0 * h)
        sharedCount++
      }
    } else if (ownCount < 3) {
      own += tone(mono, rate, start, length, f0 * h)
      ownCount++
    }
  }
  return shared > 0 ? own / ownCount / (shared / sharedCount) : 1
}

/**
 * How much a note's partials grow at its onset: their level just after it over their level just
 * before, taking the middle one of the first three partials. A pluck (or a slur) makes them jump;
 * a string that is merely still ringing while another is plucked stays near 1.
 */
function pluckRise(mono: Float32Array, rate: number, sec: number, pitch: number): number {
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12)
  const length = Math.round(rate * RISE_WINDOW)
  const rises: number[] = []
  for (let h = 1; h <= 3; h++) {
    const before = tone(mono, rate, Math.round((sec - 0.08) * rate), length, f0 * h)
    let after = 0
    for (let k = 0; k <= 3; k++) after = Math.max(after, tone(mono, rate, Math.round((sec + k * 0.02) * rate), length, f0 * h))
    rises.push((after + FLOOR) / (before + FLOOR))
  }
  return rises.sort((x, y) => x - y)[1]
}

/**
 * Remove the detector's habitual mistakes on plucked strings, by going back to the recording:
 * a string that is still ringing reported as plucked again whenever another note starts,
 * overtones (and undertones) reported as separate notes, and notes with no energy behind them.
 */
export function cleanEvents(events: NoteEvent[], mono: Float32Array, rate: number): NoteEvent[] {
  const sorted = [...events].sort((a, b) => a.start - b.start)

  // 1. A note has to begin: its partials must grow at its onset. If they do not, the string was
  //    already ringing when another note was plucked, so let the earlier note ring on instead.
  const plucked: NoteEvent[] = []
  for (const e of sorted) {
    if (e.amplitude >= MIN_AMPLITUDE && pluckRise(mono, rate, e.start, e.pitch) >= MIN_RISE) {
      plucked.push({ ...e })
      continue
    }
    const ringing = plucked.findLast((o) => o.pitch === e.pitch)
    if (ringing && e.start - (ringing.start + ringing.duration) < RETRIGGER_GAP) ringing.duration = e.start + e.duration - ringing.start
  }

  // 2. Notes a harmonic interval apart that start together: one of them may be an illusion.
  const dropped = new Set<NoteEvent>()
  for (const lo of plucked) {
    for (const hi of plucked) {
      const divisor = DIVISOR[hi.pitch - lo.pitch]
      if (!divisor || Math.abs(hi.start - lo.start) > 0.06 || dropped.has(lo) || dropped.has(hi)) continue
      const own = ownPartials(mono, rate, Math.min(lo.start, hi.start), lo.pitch, divisor)
      if (own < UNDERTONE) {
        dropped.add(lo)
      } else if (hi.amplitude < lo.amplitude * OVERTONE) {
        dropped.add(hi)
      }
    }
  }

  // 3. Whatever is left must actually be in the recording: its partials have to stand clear of their neighbours.
  return plucked.filter((e) => {
    if (dropped.has(e)) return false
    const f0 = 440 * Math.pow(2, (e.pitch - 69) / 12)
    const length = Math.round(rate * 0.2)
    const start = Math.round((e.start - 0.02) * rate)
    let clear = 0
    let n = 0
    for (let h = 1; h <= 8 && n < 3; h++) {
      const f = f0 * h
      if (f < 200) continue
      const on = tone(mono, rate, start, length, f)
      if (on > 1.4 * Math.max(tone(mono, rate, start, length, f / SEMI), tone(mono, rate, start, length, f * SEMI))) clear++
      n++
    }
    return clear >= 1
  })
}
