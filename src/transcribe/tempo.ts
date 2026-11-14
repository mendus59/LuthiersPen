import type { NoteEvent } from './types'

/** The pulse of a recording: the time in seconds of every beat, starting at measure 1. */
export interface Timing {
  beatTimes: number[]
}

const RES = 0.01

function onsetEnvelope(notes: NoteEvent[]): Float32Array {
  const end = Math.max(...notes.map((n) => n.start)) + 2
  const env = new Float32Array(Math.ceil(end / RES) + 1)
  for (const n of notes) {
    const i = Math.round(n.start / RES)
    // Spread each onset a little so slightly uneven playing still lines up.
    for (let d = -4; d <= 4; d++) {
      const j = i + d
      if (j >= 0 && j < env.length) env[j] += n.amplitude * Math.exp(-(d * d) / 6)
    }
  }
  return env
}

/** Global tempo by scoring candidate tempos against the onset curve with a comb of sixteenths. */
function globalPeriod(env: Float32Array): number {
  let best = { score: -Infinity, period: 60 / 80 / RES }
  const weights = [1, 0.25, 0.5, 0.25]
  for (let bpm = 40; bpm <= 180; bpm += 0.5) {
    const period = 60 / bpm / RES
    const sub = period / 4
    let top = -Infinity
    for (let p = 0; p < Math.floor(period); p += 2) {
      let s = 0
      let count = 0
      for (let k = 0; ; k++) {
        const pos = Math.round(p + k * sub)
        if (pos >= env.length) break
        s += env[pos] * weights[k % 4]
        count++
      }
      s /= Math.sqrt(count)
      if (s > top) top = s
    }
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 90) / 0.9, 2))
    if (top * prior > best.score) best = { score: top * prior, period }
  }
  return best.period
}

/**
 * Follow the beat through the recording (dynamic programming, after Ellis 2007) so that
 * rubato and gradual tempo changes do not pull the notation off the grid.
 */
export function trackBeats(notes: NoteEvent[]): Timing {
  if (notes.length < 4) {
    const t0 = notes[0]?.start ?? 0
    return { beatTimes: [t0, t0 + 0.75] }
  }
  const env = onsetEnvelope(notes)
  const period = globalPeriod(env)
  const n = env.length
  let max = 0
  for (let i = 0; i < n; i++) max = Math.max(max, env[i])
  const tightness = 6
  const score = new Float32Array(n)
  const back = new Int32Array(n).fill(-1)
  const lo = Math.round(period / 2)
  const hi = Math.round(period * 2)
  for (let t = 0; t < n; t++) {
    let bestPrev = -1
    let bestVal = 0
    for (let d = lo; d <= hi && t - d >= 0; d++) {
      const pen = Math.log(d / period)
      const v = score[t - d] - tightness * pen * pen
      if (bestPrev < 0 || v > bestVal) {
        bestVal = v
        bestPrev = t - d
      }
    }
    const local = env[t] / (max || 1)
    if (bestPrev >= 0 && bestVal > 0) {
      score[t] = local + bestVal
      back[t] = bestPrev
    } else {
      score[t] = local
    }
  }
  // Start the backtrace from the best beat in the final stretch of the recording.
  const lastNote = Math.round(Math.max(...notes.map((x) => x.start)) / RES)
  let end = Math.min(n - 1, lastNote)
  let top = -Infinity
  for (let t = Math.max(0, lastNote - Math.round(period)); t <= Math.min(n - 1, lastNote + Math.round(period / 2)); t++) {
    if (score[t] > top) {
      top = score[t]
      end = t
    }
  }
  const beats: number[] = []
  for (let t = end; t >= 0; t = back[t]) {
    beats.push(t * RES)
    if (back[t] < 0) break
  }
  beats.reverse()
  if (beats.length < 2) beats.push(beats[0] + period * RES)
  // The two ends of the trace have no neighbour to anchor them: square them up with the beats inside.
  if (beats.length >= 5) {
    const n2 = beats.length
    const endGap = (beats[n2 - 2] - beats[n2 - 4]) / 2
    if (Math.abs(beats[n2 - 1] - beats[n2 - 2] - endGap) > endGap * 0.12) beats[n2 - 1] = beats[n2 - 2] + endGap
    const startGap = (beats[3] - beats[1]) / 2
    if (Math.abs(beats[1] - beats[0] - startGap) > startGap * 0.12) beats[0] = beats[1] - startGap
  }
  // Extend back to cover the first note.
  const first = Math.min(...notes.map((x) => x.start))
  const step = beats[1] - beats[0]
  while (beats[0] - step * 0.25 > first) beats.unshift(beats[0] - step)
  return { beatTimes: beats }
}

/** Median tempo of a timing, in beats per minute. */
export function timingTempo(t: Timing): number {
  const gaps: number[] = []
  for (let i = 1; i < t.beatTimes.length; i++) gaps.push(t.beatTimes[i] - t.beatTimes[i - 1])
  gaps.sort((a, b) => a - b)
  const med = gaps[Math.floor(gaps.length / 2)] || 0.75
  return Math.round(60 / med)
}

/** Recording time (s) → position in beats, extrapolating past either end. */
export function timeToBeats(t: Timing, sec: number): number {
  const b = t.beatTimes
  const n = b.length
  if (sec <= b[0]) return (sec - b[0]) / (b[1] - b[0])
  if (sec >= b[n - 1]) return n - 1 + (sec - b[n - 1]) / (b[n - 1] - b[n - 2])
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (b[mid] <= sec) lo = mid
    else hi = mid
  }
  return lo + (sec - b[lo]) / (b[hi] - b[lo])
}

/** Position in beats → recording time (s). */
export function beatsToTime(t: Timing, beats: number): number {
  const b = t.beatTimes
  const n = b.length
  if (beats <= 0) return b[0] + beats * (b[1] - b[0])
  if (beats >= n - 1) return b[n - 1] + (beats - (n - 1)) * (b[n - 1] - b[n - 2])
  const i = Math.floor(beats)
  return b[i] + (beats - i) * (b[i + 1] - b[i])
}

/** Halve (factor 0.5) or double (factor 2) the pulse when the tracker locked onto the wrong level. */
export function rescaleTiming(t: Timing, factor: 0.5 | 2): Timing {
  const b = t.beatTimes
  if (factor === 0.5) return { beatTimes: b.filter((_, i) => i % 2 === 0) }
  const out: number[] = []
  for (let i = 0; i < b.length - 1; i++) out.push(b[i], (b[i] + b[i + 1]) / 2)
  out.push(b[b.length - 1])
  return { beatTimes: out }
}
