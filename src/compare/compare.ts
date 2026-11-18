import { type Score, beatTicks, measureStarts, notePitch, TICKS_PER_QUARTER } from '../model/score'
import type { OriginalScore } from './original'

/** A note of the arrangement, located in the score. */
export interface ScoreNote {
  /** Quarter notes from the start of measure 1. */
  start: number
  duration: number
  pitch: number
  measure: number
  voice: number
  beat: number
  string: number
}

export type Role = 'melody' | 'bass'

/** A melody or bass note of the original that the arrangement does not play. */
export interface MissingNote {
  role: Role
  /** Measure of the original (0-based). */
  originalMeasure: number
  /** Pitch to add, transposed into the arrangement's key and placed in the guitar's range. */
  pitch: number
  /** Where it belongs in the arrangement: measure, voice and beat to add it to. */
  measure: number
  voice: number
  beat: number
}

/** A note of the arrangement that nothing in the original supports at that moment. */
export interface StrayNote {
  pitch: number
  measure: number
  voice: number
  beat: number
  string: number
  /** Measure of the original at that moment (0-based). */
  originalMeasure: number
}

export interface Comparison {
  /** Semitones from the original up to the arrangement (−6..5). */
  transpose: number
  /** How many quarter notes of the original one quarter of the arrangement covers (½, 1 or 2). */
  ratio: number
  /** Original measures the arrangement covers, inclusive (0-based). */
  span: [number, number]
  melody: { total: number; found: number }
  bass: { total: number; found: number }
  missing: MissingNote[]
  stray: StrayNote[]
  /** Share of the arrangement's notes that the original supports; low means the two may not be the same music. */
  support: number
  /** The original has a single line (a melody or lead sheet), so only the melody is compared. */
  melodyOnly: boolean
  /** Passages of the original (measures, 0-based, inclusive) that the arrangement leaves out. */
  skipped: [number, number][]
  /** Measures of the arrangement (0-based) with something to look at. */
  flagged: number[]
  /** Stray notes as "measure:voice:beat:string", for colouring in the score. */
  strayKeys: string[]
}

const Q = TICKS_PER_QUARTER
/** Lowest and highest sounding pitch to suggest on a classical guitar (E2 to B5). */
const LOW = 40
const HIGH = 83

/** Every sounding note of the arrangement, ties merged into the note they continue. */
export function scoreNotes(score: Score): ScoreNote[] {
  const starts = measureStarts(score)
  const out: ScoreNote[] = []
  const open = new Map<string, ScoreNote>()
  score.measures.forEach((measure, m) => {
    measure.voices.forEach((voice, v) => {
      let tick = starts[m]
      voice.forEach((beat, b) => {
        const len = beatTicks(beat)
        for (const n of beat.notes) {
          const pitch = notePitch(score, n)
          const k = `${v}:${n.string}`
          const prev = open.get(k)
          if (n.tie && prev && prev.pitch === pitch) {
            prev.duration = (tick + len) / Q - prev.start
            continue
          }
          const note = { start: tick / Q, duration: len / Q, pitch, measure: m, voice: v, beat: b, string: n.string }
          out.push(note)
          open.set(k, note)
        }
        tick += len
      })
    })
  })
  return out.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
}

/** The notes that carry the top line (or the bottom line): each at least as high as anything sounding with it. */
function outline<N extends { start: number; duration: number; pitch: number }>(notes: N[], role: Role): N[] {
  const sign = role === 'melody' ? 1 : -1
  const out: N[] = []
  const byStart = new Map<number, N[]>()
  for (const n of notes) {
    const k = Math.round(n.start * 48)
    byStart.set(k, [...(byStart.get(k) ?? []), n])
  }
  for (const group of byStart.values()) {
    const top = group.reduce((a, b) => (sign * b.pitch > sign * a.pitch ? b : a))
    const t = top.start
    // Nothing still ringing from before may sit above it (below it, for the bass).
    const over = notes.some((o) => o.start < t - 1e-3 && o.start + o.duration > t + 1e-3 && sign * o.pitch > sign * top.pitch)
    if (over) continue
    out.push(top)
  }
  out.sort((a, b) => a.start - b.start)
  // A line that drops more than an octave below its neighbours is an inner part showing through a rest.
  return out.filter((n) => {
    const near = out.filter((o) => Math.abs(o.start - n.start) <= 1.5)
    const best = Math.max(...near.map((o) => sign * o.pitch))
    return best - sign * n.pitch <= 12
  })
}

/** Pitch-class profile of each frame: notes starting in it count fully, notes still ringing count a little. */
function frames(notes: { start: number; duration: number; pitch: number }[], step: number, shift = 0): Float64Array[] {
  const end = Math.max(0, ...notes.map((n) => n.start + Math.min(n.duration, 2)))
  const T = Math.max(1, Math.ceil(end / step) + 1)
  const F = Array.from({ length: T }, () => new Float64Array(12))
  for (const n of notes) {
    const pc = (((n.pitch + shift) % 12) + 12) % 12
    const a = Math.floor(n.start / step)
    F[a][pc] += 1
    const b = Math.min(T - 1, Math.floor((n.start + Math.min(n.duration, 2)) / step))
    for (let i = a + 1; i <= b; i++) F[i][pc] += 0.3
  }
  for (const f of F) {
    const norm = Math.hypot(...f)
    if (norm > 0) for (let i = 0; i < 12; i++) f[i] /= norm
  }
  return F
}

/**
 * Align the arrangement (every frame) to a stretch of the original (free start and end), allowing
 * for rubato. Returns the original frame matched to each arrangement frame and the mean cost.
 */
function align(A: Float64Array[], B: Float64Array[]): { map: number[]; cost: number } {
  const n = A.length
  const m = B.length
  const cost = (i: number, j: number) => {
    let s = 0
    const a = A[i]
    const b = B[j]
    let ea = 0
    let eb = 0
    for (let k = 0; k < 12; k++) {
      s += a[k] * b[k]
      ea += a[k]
      eb += b[k]
    }
    if (ea === 0 && eb === 0) return 0.2
    if (ea === 0 || eb === 0) return 0.6
    return 1 - s
  }
  const SKEW = 0.15
  const D = new Float64Array(n * m)
  const L = new Uint32Array(n * m)
  const P = new Uint8Array(n * m)
  for (let j = 0; j < m; j++) {
    D[j] = cost(0, j)
    L[j] = 1
  }
  for (let i = 1; i < n; i++) {
    const row = i * m
    for (let j = 0; j < m; j++) {
      const c = cost(i, j)
      let best = D[row - m + j] + c + SKEW // arrangement moves on, original holds
      let len = L[row - m + j] + 1
      let p = 1
      if (j > 0) {
        const diag = D[row - m + j - 1] + c
        if (diag < best) {
          best = diag
          len = L[row - m + j - 1] + 1
          p = 0
        }
        const left = D[row + j - 1] + c + SKEW // original moves on, arrangement holds
        if (left < best) {
          best = left
          len = L[row + j - 1] + 1
          p = 2
        }
      }
      D[row + j] = best
      L[row + j] = len
      P[row + j] = p
    }
  }
  let j = 0
  for (let x = 1; x < m; x++) if (D[(n - 1) * m + x] / L[(n - 1) * m + x] < D[(n - 1) * m + j] / L[(n - 1) * m + j]) j = x
  const total = D[(n - 1) * m + j] / L[(n - 1) * m + j]
  const map: number[][] = Array.from({ length: n }, () => [])
  let i = n - 1
  while (i >= 0) {
    map[i].push(j)
    const p = P[i * m + j]
    if (i === 0) break
    if (p === 0) {
      i--
      j--
    } else if (p === 1) i--
    else j--
  }
  return { map: map.map((js) => js.reduce((a, b) => a + b, 0) / js.length), cost: total }
}

/** Piecewise-linear lookup in a monotone table of [x, y] pairs. */
function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0] + (x - xs[0])
  const last = xs.length - 1
  if (x >= xs[last]) return ys[last] + (x - xs[last])
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (xs[mid] <= x) lo = mid
    else hi = mid
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1)
  return ys[lo] + f * (ys[hi] - ys[lo])
}

const pcOf = (p: number) => ((p % 12) + 12) % 12

/** Compare an arrangement with the original it is based on. */
export function compareWithOriginal(score: Score, original: OriginalScore): Comparison | null {
  const all = scoreNotes(score)
  const orig = original.notes
  if (all.length < 4 || orig.length < 4) return null
  // A single-line original (a melody or lead sheet) is compared with the arrangement's top line only.
  const together = orig.filter((n, i) => orig.some((o, j) => j !== i && o.start < n.start + n.duration - 1e-3 && o.start + o.duration > n.start + 1e-3)).length
  const melodyOnly = together < 0.1 * orig.length
  const arr = melodyOnly ? outline(all, 'melody') : all

  // 1. Find the key and the note values the arrangement uses relative to the original, on a coarse grid.
  const COARSE = 0.5
  let best = { cost: Infinity, shift: 0, ratio: 1 }
  for (const ratio of [1, 0.5, 2]) {
    const A = frames(arr.map((n) => ({ ...n, start: n.start * ratio, duration: n.duration * ratio })), COARSE)
    for (let shift = -6; shift < 6; shift++) {
      const B = frames(orig, COARSE, shift)
      const { cost } = align(A, B)
      // Prefer the plain reading when two are about as good.
      const bias = (ratio === 1 ? 0 : 0.01) + (shift === 0 ? 0 : 0.005)
      if (cost + bias < best.cost) best = { cost: cost + bias, shift, ratio }
    }
  }
  const { shift, ratio } = best

  // 2. Align again on a fine grid and build the time map both ways.
  const STEP = 0.25
  const A = frames(arr.map((n) => ({ ...n, start: n.start * ratio, duration: n.duration * ratio })), STEP)
  const B = frames(orig, STEP, shift)
  const { map } = align(A, B)
  const xs: number[] = []
  const ys: number[] = []
  map.forEach((j, i) => {
    const x = (i * STEP) / ratio
    const y = j * STEP
    if (xs.length && y < ys[ys.length - 1]) return
    if (xs.length && x === xs[xs.length - 1]) return
    xs.push(x)
    ys.push(y)
  })
  const toOrig = (t: number) => interp(xs, ys, t)
  const toArr = (u: number) => interp(ys, xs, u)
  const uFrom = toOrig(0)
  const uTo = toOrig(arr[arr.length - 1].start + arr[arr.length - 1].duration)
  const inSpan = orig.filter((n) => n.start >= uFrom - 0.25 && n.start <= uTo)
  const measureAt = (u: number) => {
    let mm = inSpan[0]?.measure ?? 0
    for (const n of orig) {
      if (n.start > u + 1e-3) break
      mm = n.measure
    }
    return mm
  }

  // The beat of the arrangement nearest a moment, in a voice.
  const starts = measureStarts(score)
  const beatAt = (t: number, voice: number) => {
    const tick = t * Q
    let m = 0
    while (m + 1 < score.measures.length && starts[m + 1] <= tick + 1) m++
    const v = Math.min(voice, score.measures[m].voices.length - 1)
    let at = starts[m]
    let bestB = 0
    let bestD = Infinity
    score.measures[m].voices[v].forEach((beat, b) => {
      const d = Math.abs(at - tick)
      if (d < bestD) {
        bestD = d
        bestB = b
      }
      at += beatTicks(beat)
    })
    return { measure: m, voice: v, beat: bestB }
  }

  // Stretches where the original runs on while the arrangement stands still are passages it leaves out.
  const skipped: [number, number][] = []
  const skippedAt = new Set<number>()
  {
    const ms = [...new Set(inSpan.map((n) => n.measure))]
    const firstOf = new Map<number, number>()
    for (const n of inSpan) if (!firstOf.has(n.measure)) firstOf.set(n.measure, n.start)
    let run: number[] = []
    const flush = () => {
      if (run.length >= 2) {
        skipped.push([run[0], run[run.length - 1]])
        for (const m of run) skippedAt.add(m)
      }
      run = []
    }
    ms.forEach((m, i) => {
      const next = ms[i + 1]
      const a = firstOf.get(m)!
      const b = next !== undefined ? firstOf.get(next)! : uTo
      const len = b - a
      const covered = toArr(b) - toArr(a)
      if (len > 0.5 && covered * ratio < 0.25 * len) run.push(m)
      else flush()
    })
    flush()
  }

  // 3. Are the original's melody and bass notes in the arrangement?
  const TOL = 0.5 / ratio
  const missing: MissingNote[] = []
  const tally = { melody: { total: 0, found: 0 }, bass: { total: 0, found: 0 } }
  for (const role of melodyOnly ? (['melody'] as const) : (['melody', 'bass'] as const)) {
    for (const n of outline(inSpan, role)) {
      if (skippedAt.has(n.measure)) continue
      const t = toArr(n.start)
      const pc = pcOf(n.pitch + shift)
      tally[role].total++
      const hit = arr.some(
        (a) => pcOf(a.pitch) === pc && ((Math.abs(a.start - t) <= TOL) || (a.start < t && a.start + a.duration > t + TOL / 2)),
      )
      if (hit) {
        tally[role].found++
        continue
      }
      // Suggest it in the octave nearest the arrangement's own line there.
      const around = arr.filter((a) => Math.abs(a.start - t) <= 2 / ratio)
      const ref = around.length
        ? role === 'melody'
          ? Math.max(...around.map((a) => a.pitch))
          : Math.min(...around.map((a) => a.pitch))
        : n.pitch + shift
      let p = n.pitch + shift
      while (p - ref > 6) p -= 12
      while (ref - p > 6) p += 12
      while (p < LOW) p += 12
      while (p > HIGH) p -= 12
      const at = beatAt(t, role === 'melody' ? 0 : 1)
      missing.push({ role, originalMeasure: n.measure, pitch: p, ...at })
    }
  }

  // 4. Does the original support each note of the arrangement?
  const stray: StrayNote[] = []
  let supported = 0
  const W = 1
  for (const a of melodyOnly ? [] : arr) {
    const u = toOrig(a.start)
    const pc = pcOf(a.pitch)
    const near = inSpan.some((o) => pcOf(o.pitch + shift) === pc && o.start <= u + W && o.start + o.duration >= u - W)
    if (near) {
      supported++
      continue
    }
    stray.push({ pitch: a.pitch, measure: a.measure, voice: a.voice, beat: a.beat, string: a.string, originalMeasure: measureAt(u) })
  }

  const flagged = [...new Set([...missing.filter((x) => x.role === 'melody').map((x) => x.measure), ...stray.map((x) => x.measure)])].sort((a, b) => a - b)
  return {
    transpose: shift,
    ratio,
    span: [measureAt(uFrom), measureAt(uTo)],
    melody: tally.melody,
    bass: tally.bass,
    missing,
    stray,
    support: melodyOnly ? tally.melody.found / Math.max(1, tally.melody.total) : supported / arr.length,
    melodyOnly,
    skipped,
    flagged,
    strayKeys: stray.map((s) => `${s.measure}:${s.voice}:${s.beat}:${s.string}`),
  }
}
