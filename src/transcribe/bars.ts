import type { Timing } from './tempo'
import model from './downbeat-model.json'
import type { NoteEvent } from './types'

/** Notes that start this close together are one pluck of a chord or a strummed arpeggio. */
const TOGETHER = 0.035
const RES = 0.01
/** Cost of a bar much longer or shorter than the one before it. */
const RATIO = 4
/** Cost of a bar far from the expected length. */
const PRIOR = 1.5
/** Cost of losing the thread (a pause or a passage the template cannot follow) and starting again. */
const RESTART = 4
/** Move a beat onto a note played this close to it, as a share of the beat. */
const NUDGE = 0.12

export interface Meter {
  /** Beats in a bar. */
  beats: number
  /** Evenly spaced notes in one beat: 2 or 4 for a plain beat, 3 for a dotted or swung one. */
  split: number
}

interface Onset {
  t: number
  /** What is known about the onset as a downbeat (see DOWN_FEATURES). */
  f: number[]
  /** How strongly this onset marks a downbeat. */
  down: number
}

export const DOWN_FEATURES = [
  'bass', 'size', 'changeBeat', 'changeHalf', 'changeBar', 'lowestHalf', 'lowestBar', 'lowRel',
  'amp', 'long', 'gapBefore', 'topRel', 'newBass', 'one',
]

let downWeights: number[] = model.weights

/** Use other downbeat weights (for fitting them offline). */
export function setDownWeights(w: number[]) {
  downWeights = w
}

function chromaOf(notes: NoteEvent[], from: number, to: number): number[] {
  const c = new Array<number>(12).fill(0)
  for (const n of notes) {
    if (n.start >= to) break
    const a = Math.max(from, n.start)
    const b = Math.min(to, n.start + Math.max(n.duration, 0.1))
    if (b > a) c[((Math.round(n.pitch) % 12) + 12) % 12] += (b - a) * n.amplitude * (n.pitch < 55 ? 2 : 1)
  }
  return c
}

function change(notes: NoteEvent[], t: number, w: number): number {
  const x = chromaOf(notes, t - w, t - 0.02)
  const y = chromaOf(notes, t - 0.02, t + w)
  let dot = 0
  let nx = 0
  let ny = 0
  for (let i = 0; i < 12; i++) {
    dot += x[i] * y[i]
    nx += x[i] * x[i]
    ny += y[i] * y[i]
  }
  return nx > 0 && ny > 0 ? 1 - dot / Math.sqrt(nx * ny) : 0.5
}

/**
 * Group the notes into onsets and describe each one as a possible downbeat: how low, loud and long
 * its notes are, whether the harmony changes there, whether it is the lowest note around, and
 * whether the player paused before it. `period` is the expected bar length, `beats` its beats.
 */
export function downbeatOnsets(notes: NoteEvent[], period: number, beats: number): Onset[] {
  const sorted = [...notes].sort((a, b) => a.start - b.start)
  const groups: NoteEvent[][] = []
  for (const n of sorted) {
    const g = groups[groups.length - 1]
    if (g && n.start - g[0].start <= TOGETHER) g.push(n)
    else groups.push([n])
  }
  const beat = period / beats
  const basses = groups.map((g) => {
    let bass = 0
    for (const n of g) bass = Math.max(bass, n.amplitude * Math.max(0, (60 - n.pitch) / 20) * Math.min(1, n.duration))
    return bass
  })
  const pos = basses.filter((b) => b > 0).sort((a, b) => a - b)
  const scale = pos.length ? pos[Math.floor(pos.length * 0.75)] : 1
  const lowOf = (g: NoteEvent[]) => Math.min(...g.map((n) => n.pitch))
  const topOf = (g: NoteEvent[]) => Math.max(...g.map((n) => n.pitch))
  const lowestWithin = (k: number, w: number) => {
    const low = lowOf(groups[k])
    for (let i = k - 1; i >= 0 && groups[k][0].start - groups[i][0].start <= w; i--) if (lowOf(groups[i]) < low) return 0
    for (let i = k + 1; i < groups.length && groups[i][0].start - groups[k][0].start <= w; i++) if (lowOf(groups[i]) < low) return 0
    return 1
  }
  const localMean = (k: number, of: (g: NoteEvent[]) => number) => {
    let s = 0
    let c = 0
    for (let i = k - 1; i >= 0 && groups[k][0].start - groups[i][0].start <= period; i--) {
      s += of(groups[i])
      c++
    }
    for (let i = k + 1; i < groups.length && groups[i][0].start - groups[k][0].start <= period; i++) {
      s += of(groups[i])
      c++
    }
    return c ? s / c : of(groups[k])
  }
  let lastBass = -1
  return groups.map((g, k) => {
    const t = g[0].start
    const low = lowOf(g)
    const newBass = low < 55 ? (lastBass < 0 || (low - lastBass) % 12 !== 0 ? 1 : 0) : 0
    if (low < 55) lastBass = low
    const f = [
      Math.min(2, basses[k] / scale),
      Math.min(4, g.length) / 4,
      change(sorted, t, beat),
      change(sorted, t, period / 2),
      change(sorted, t, period),
      lowestWithin(k, period / 2) * (low < 55 ? 1 : 0),
      lowestWithin(k, period) * (low < 55 ? 1 : 0),
      Math.max(-1, Math.min(1, (localMean(k, lowOf) - low) / 12)),
      Math.min(1.5, g.reduce((s, n) => s + n.amplitude, 0)),
      Math.min(2, Math.max(...g.map((n) => n.duration)) / beat),
      Math.min(2, k > 0 ? (t - groups[k - 1][0].start) / beat : 1),
      Math.max(-1, Math.min(1, (topOf(g) - localMean(k, topOf)) / 12)),
      newBass,
      1,
    ]
    return { t, f, down: 0 }
  })
}

function envelope(notes: NoteEvent[]): Float32Array {
  const end = Math.max(...notes.map((n) => n.start)) + 4
  const env = new Float32Array(Math.ceil(end / RES) + 1)
  for (const n of notes) {
    const i = Math.round(n.start / RES)
    for (let d = -3; d <= 3; d++) {
      const j = i + d
      if (j >= 0 && j < env.length) env[j] += n.amplitude * Math.exp(-(d * d) / 4)
    }
  }
  const s = Array.from(env).filter((v) => v > 0).sort((a, b) => a - b)
  const top = s.length ? s[Math.floor(s.length * 0.9)] : 1
  for (let i = 0; i < env.length; i++) env[i] = Math.min(1.5, env[i] / top)
  return env
}

/** Cost of a bar of another length than the meter's (a 2/4 bar inside 4/4). */
const ODD = 3

/** Bar lengths, in beats, that may stand in for the meter's own now and then. */
export function oddBars(beats: number): number[] {
  if (beats === 4) return [2, 3]
  if (beats === 3) return [2]
  return []
}

/**
 * Find the downbeats of a performance with a bar-sized template instead of beat by beat: each bar
 * is scored by the bass and chords on its downbeat and by how well the other notes fall on an
 * even grid of beats inside it. Bars may stretch and shrink from one to the next (rubato), so the
 * pulse is followed bar by bar rather than held to one tempo, and a bar may now and then be a few
 * beats short (a 2/4 bar inside 4/4).
 * `period` is the expected length of a bar in seconds. Returns the downbeats and the number of
 * beats in each bar between them.
 */
export function trackBars(notes: NoteEvent[], period: number, meter: Meter, odd: number[] = []): { downs: number[]; beats: number[]; score: number } {
  const L = meter.beats
  const on = downbeatOnsets(notes, period, L)
  for (const o of on) o.down = o.f.reduce((s, x, i) => s + x * downWeights[i], 0)
  const env = envelope(notes)
  const n = on.length
  if (n < 4) return { downs: on.map((o) => o.t), beats: on.slice(1).map(() => L), score: -Infinity }
  const sizes = [L, ...odd.filter((b) => b !== L && b >= 1)]
  const V = sizes.length
  const near = (t: number, tol: number) => {
    const a = Math.max(0, Math.round((t - tol) / RES))
    const b = Math.min(env.length - 1, Math.round((t + tol) / RES))
    let m = 0
    for (let i = a; i <= b; i++) if (env[i] > m) m = env[i]
    return m
  }
  const fit = (a: number, b: number, beats: number) => {
    const N = beats * meter.split
    const span = b - a
    const tol = Math.min(0.04, (span / N) * 0.25)
    let s = 0
    let w = 0
    for (let q = 1; q < N; q++) {
      const weight = q % meter.split === 0 ? 1 : 0.5
      s += weight * near(a + (span * q) / N, tol)
      w += weight
    }
    return w ? s / w : 0
  }
  const beat = period / L
  const lo = beat * Math.min(...sizes) * 0.6
  const hi = period * 1.6
  // State (i, j, v): a bar of sizes[v] beats from onset j to onset i, keyed j * V + v in maps per i.
  const prevs: number[][] = []
  for (let i = 0; i < n; i++) {
    const list: number[] = []
    for (let j = i - 1; j >= 0 && on[i].t - on[j].t <= hi; j--) if (on[i].t - on[j].t >= lo) list.push(j)
    prevs.push(list)
  }
  const score: Map<number, number>[] = Array.from({ length: n }, () => new Map())
  // Back links: [key] continues from that bar ending at j; [-1, i2, key2] restarts after the bar
  // (i2, key2) that ended at or before j (a pause or a bar the template cannot follow); [] is the
  // first bar.
  const back: Map<number, number[]>[] = Array.from({ length: n }, () => new Map())
  // Best bar ending at or before each onset, for restarts.
  const bestUpTo: Array<{ v: number; i: number; key: number }> = []
  const first = on[0].t
  for (let i = 0; i < n; i++) {
    for (const j of prevs[i]) {
      const d = on[i].t - on[j].t
      for (let v = 0; v < V; v++) {
        const size = sizes[v]
        const expected = beat * size
        if (d < expected * 0.6 || d > expected * 1.6) continue
        const own = on[j].down + fit(on[j].t, on[i].t, size) - PRIOR * Math.log(d / expected) ** 2 - (v === 0 ? 0 : ODD)
        let best = on[j].t - first <= period * 1.2 ? own : -Infinity
        let link: number[] = []
        for (const [key, val0] of score[j]) {
          const k = Math.floor(key / V)
          const r = Math.log(d / size / ((on[j].t - on[k].t) / sizes[key % V]))
          const val = val0 + own - RATIO * r * r
          if (val > best) {
            best = val
            link = [key]
          }
        }
        const prior = j > 0 ? bestUpTo[j] : undefined
        if (prior && prior.i >= 0 && prior.v + own - RESTART > best) {
          best = prior.v + own - RESTART
          link = [-1, prior.i, prior.key]
        }
        if (best > -Infinity) {
          score[i].set(j * V + v, best)
          back[i].set(j * V + v, link)
        }
      }
    }
    const here = { v: -Infinity, i: -1, key: -1 }
    for (const [key, v] of score[i]) if (v > here.v) Object.assign(here, { v, i, key })
    const before = i > 0 ? bestUpTo[i - 1] : undefined
    bestUpTo.push(before && before.v > here.v ? before : here)
  }
  // End on the bar whose closing downbeat is near the end and scores best (the closing downbeat
  // itself earns its own bass bonus).
  const lastT = on[n - 1].t
  let bi = -1
  let bkey = -1
  let top = -Infinity
  for (let i = 0; i < n; i++) {
    for (const [key, v] of score[i]) {
      const val = v + on[i].down - (lastT - on[i].t > period * 1.2 ? RESTART : 0)
      if (val > top) {
        top = val
        bi = i
        bkey = key
      }
    }
  }
  if (bi < 0) return { downs: [], beats: [], score: -Infinity }
  const downs: number[] = [on[bi].t]
  const beats: number[] = []
  let i = bi
  let key = bkey
  for (;;) {
    const j = Math.floor(key / V)
    downs.push(on[j].t)
    beats.push(sizes[key % V])
    const link = back[i].get(key) ?? []
    if (link.length === 0) break
    if (link[0] === -1) {
      if (link[1] !== j) {
        downs.push(on[link[1]].t)
        beats.push(L)
      }
      i = link[1]
      key = link[2]
    } else {
      i = j
      key = link[0]
    }
  }
  return { downs: downs.reverse(), beats: beats.reverse(), score: top }
}

/**
 * Beat times from downbeats: each bar's beats are spread evenly inside it, then each beat is
 * nudged onto a note played right at it, so a beat that is lingered on or hurried stays in place.
 * Bars are added before the first and after the last downbeat to cover every note.
 * `beats` is the meter's beats in a bar, `sizes` the beats of each tracked bar where it differs.
 */
export function beatsFromBars(downs: number[], beats: number, notes: NoteEvent[], sizes: number[] = []): { timing: Timing; pickup: number; barBeats: number[] } {
  const starts = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b)
  const out: number[] = []
  for (let k = 0; k + 1 < downs.length; k++) {
    const a = downs[k]
    const span = downs[k + 1] - a
    const count = sizes[k] ?? beats
    for (let q = 0; q < count; q++) {
      let t = a + (span * q) / count
      if (q > 0) {
        const tol = (span / count) * NUDGE
        let best = Infinity
        for (const s of starts) if (Math.abs(s - t) < Math.abs(best - t)) best = s
        if (Math.abs(best - t) <= tol) t = best
      }
      out.push(t)
    }
  }
  const lastBar = downs.length >= 2 ? downs[downs.length - 1] - downs[downs.length - 2] : 2
  const beat = lastBar / (sizes[downs.length - 2] ?? beats)
  out.push(downs[downs.length - 1])
  const lastNote = starts[starts.length - 1] ?? 0
  while (out[out.length - 1] < lastNote + beat) out.push(out[out.length - 1] + beat)
  const firstBeat = (out[1] ?? out[0] + 1) - out[0]
  let pickup = 0
  const firstNote = starts[0] ?? out[0]
  while (out[0] - firstBeat * 0.25 > firstNote) {
    out.unshift(out[0] - firstBeat)
    pickup++
  }
  const barBeats = [...new Array<number>(Math.ceil(pickup / beats)).fill(beats), ...downs.slice(1).map((_, k) => sizes[k] ?? beats)]
  return { timing: { beatTimes: out }, pickup, barBeats }
}

/**
 * Place the barlines of a performance: follow its bars with trackBars, at the length the tracked
 * pulse and the meter suggest, and spread each bar's beats inside it. Returns the pulse to
 * quantize with, the number of pickup beats before the first downbeat, and the beats in each
 * measure from measure 1 (a few may be shorter than the meter's).
 */
export function fitBars(notes: NoteEvent[], heard: Timing, timeSig: [number, number]): { timing: Timing; pickup: number; barBeats?: number[] } {
  const compound = timeSig[1] === 8 && timeSig[0] % 3 === 0 && timeSig[0] > 3
  const beats = compound ? timeSig[0] / 3 : timeSig[0]
  const b = heard.beatTimes
  if (notes.length < 8 || b.length < 2) return { timing: heard, pickup: 0 }
  const period = beats * medianGap(b)
  const { downs, beats: sizes } = trackBars(notes, period, { beats, split: compound ? 3 : 2 }, oddBars(beats))
  if (downs.length < 2) return { timing: heard, pickup: 0 }
  return beatsFromBars(downs, beats, notes, sizes)
}

function medianGap(times: number[]): number {
  const gaps = times.slice(1).map((t, i) => t - times[i]).sort((x, y) => x - y)
  return gaps[Math.floor(gaps.length / 2)]
}
