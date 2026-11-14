import { type Beat, type Dur, MAX_FRET, type Measure, type Note, type Score, STANDARD_TUNING } from '../model/score'
import { assignFingerboard, type GridNote, type GroupMark } from './fingering'
import { beatsToTime, type Timing, timeToBeats, timingTempo } from './tempo'
import type { NoteEvent } from './types'

export interface QuantizeOptions {
  timing: Timing
  timeSig: [number, number]
  /** Beats of the tracked pulse before the first full measure (pickup). */
  pickupBeats: number
  /** Split the bass onto its own stems-down voice. */
  twoVoices: boolean
  /** Smallest note value. */
  grid: 8 | 16
  key?: number
  title?: string
  composer?: string
  tuning?: number[]
}

export interface QuantizeResult {
  score: Score
  /** Beat times re-based so that index 0 is the start of measure 1. */
  timing: Timing
}

/** Sixteenths per tracked beat: a dotted quarter in compound time, else a quarter. */
/** Sixteenths in one beat of the tracked pulse: a dotted quarter in 6/8, an eighth in 3/8, otherwise a quarter. */
export function stepsPerBeat(timeSig: [number, number]): number {
  if (timeSig[1] !== 8) return 4
  return timeSig[0] % 3 === 0 && timeSig[0] > 3 ? 6 : 2
}

export function stepsPerMeasure(timeSig: [number, number]): number {
  return (timeSig[0] * 16) / timeSig[1]
}

// [length in sixteenths, note value, dots, the grid the value must start on]
const VALUES: Array<[number, Dur, number, number]> = [
  [16, 1, 0, 16], [12, 2, 1, 4], [8, 2, 0, 4], [6, 4, 1, 4], [4, 4, 0, 2], [3, 8, 1, 2], [2, 8, 0, 2], [1, 16, 0, 1],
]

/** Split a span inside one measure into legal note values (rests complete the beat first). */
function splitSpan(pos: number, len: number, rest: boolean, beat: number): Array<{ dur: Dur; dots: number; len: number }> {
  const out: Array<{ dur: Dur; dots: number; len: number }> = []
  while (len > 0) {
    let v: [number, Dur, number, number] | undefined
    if (rest) {
      const inBeat = pos % beat
      if (inBeat !== 0) {
        // Off the beat: the largest plain value that stays inside this beat.
        const room = Math.min(len, beat - inBeat)
        v = VALUES.find(([l, , dots]) => dots === 0 && l <= room && pos % l === 0)
      } else {
        v = VALUES.find(([l, , dots]) => l <= len && pos % l === 0 && (dots === 0 || (beat === 6 && l === 6)))
      }
    } else {
      v = VALUES.find(([l, , , align]) => l <= len && pos % align === 0)
    }
    v ??= VALUES[VALUES.length - 1]
    out.push({ dur: v[1], dots: v[2], len: v[0] })
    pos += v[0]
    len -= v[0]
  }
  return out
}

/** How strongly each beat of the pulse is marked by the bass: low, loud, long notes landing on it. */
function bassAccents(notes: NoteEvent[], timing: Timing): number[] {
  const accents = new Array<number>(timing.beatTimes.length + 2).fill(0)
  for (const n of notes) {
    const b = timeToBeats(timing, n.start)
    const nearest = Math.round(b)
    if (Math.abs(b - nearest) > 0.2 || nearest < 0 || nearest >= accents.length) continue
    accents[nearest] += n.amplitude * Math.max(0, (60 - n.pitch) / 20) * Math.min(1, n.duration)
  }
  return accents
}

/**
 * Guess the meter from how often the bass returns: every three beats means triple time, written
 * in 3/8 when the beat is quick and 3/4 otherwise. Anything else is written in 4/4.
 */
export function guessMeter(notes: NoteEvent[], timing: Timing): [number, number] {
  const accents = bassAccents(notes, timing)
  const n = accents.length
  if (n < 16) return [4, 4]
  const mean = accents.reduce((a, b) => a + b, 0) / n
  const variance = accents.reduce((a, b) => a + (b - mean) * (b - mean), 0)
  if (variance === 0) return [4, 4]
  const repeat = (lag: number) => {
    let sum = 0
    for (let i = 0; i + lag < n; i++) sum += (accents[i] - mean) * (accents[i + lag] - mean)
    return sum / variance
  }
  const triple = repeat(3)
  if (triple < 0.1 || triple < Math.max(repeat(2), repeat(4)) + 0.05) return [4, 4]
  return timingTempo(timing) >= 110 ? [3, 8] : [3, 4]
}

const SLIP = 1.5

/**
 * Put the barlines where the bass says they are. Measures are a fixed number of beats long, but a
 * player who lingers or hurries can make the tracked pulse gain or lose a beat; rather than let
 * every later barline fall in the wrong place, allow a measure to be heard as one beat long or
 * short where the bass clearly asks for it, and stretch or squeeze the pulse there to fit.
 * Returns the corrected pulse and the number of pickup beats before the first downbeat.
 */
export function alignBars(notes: NoteEvent[], timing: Timing, beatsPerMeasure: number): { timing: Timing; pickup: number } {
  const L = beatsPerMeasure
  const accents = bassAccents(notes, timing).slice(0, timing.beatTimes.length)
  const n = accents.length
  const sorted = accents.filter((a) => a > 0).sort((a, b) => a - b)
  const scale = sorted.length ? sorted[Math.floor(sorted.length * 0.75)] : 1
  if (L < 2 || n < 2 * L) return { timing, pickup: 0 }
  const best = new Array<number>(n).fill(-Infinity)
  const from = new Array<number>(n).fill(-1)
  for (let i = 0; i < n; i++) {
    const own = Math.min(2, accents[i] / scale)
    if (i < L) best[i] = own - (i === 0 ? 0 : 0.2)
    for (const len of [L, L - 1, L + 1]) {
      const j = i - len
      if (j < 0 || best[j] === -Infinity) continue
      const v = best[j] + own - (len === L ? 0 : SLIP)
      if (v > best[i]) {
        best[i] = v
        from[i] = j
      }
    }
  }
  let end = n - 1
  for (let i = n - 1; i >= Math.max(0, n - L); i--) if (best[i] > best[end]) end = i
  const downbeats: number[] = []
  for (let i = end; i >= 0; i = from[i]) downbeats.push(i)
  downbeats.reverse()
  const b = timing.beatTimes
  const beats: number[] = b.slice(0, downbeats[0])
  for (let k = 0; k < downbeats.length; k++) {
    const start = downbeats[k]
    const stop = k + 1 < downbeats.length ? downbeats[k + 1] : -1
    if (stop < 0) {
      beats.push(...b.slice(start))
    } else if (stop - start === L) {
      beats.push(...b.slice(start, stop))
    } else {
      // An irregular measure: spread the regular number of beats evenly over its time.
      for (let q = 0; q < L; q++) beats.push(b[start] + ((b[stop] - b[start]) * q) / L)
    }
  }
  return { timing: { beatTimes: beats }, pickup: downbeats[0] }
}

/** Turn detected notes into an engraved score: quantize, split voices, finger, and bar. */
export function quantize(events: NoteEvent[], opts: QuantizeOptions): QuantizeResult {
  const tuning = opts.tuning ?? STANDARD_TUNING
  const spb = stepsPerBeat(opts.timeSig)
  const spm = stepsPerMeasure(opts.timeSig)
  const beatsPerMeasure = spm / spb
  const unit = opts.grid === 8 ? 2 : 1
  // Measure 1 starts at this (possibly negative) beat of the tracked pulse.
  const origin = opts.pickupBeats > 0 ? opts.pickupBeats - beatsPerMeasure : 0
  const low = tuning[tuning.length - 1]
  const high = tuning[0] + MAX_FRET

  // 1. Onto the grid.
  const seen = new Map<string, GridNote>()
  for (const e of events) {
    let pitch = Math.round(e.pitch)
    while (pitch < low) pitch += 12
    while (pitch > high) pitch -= 12
    const startPos = (timeToBeats(opts.timing, e.start) - origin) * spb
    const endPos = (timeToBeats(opts.timing, e.start + e.duration) - origin) * spb
    const step = Math.round(startPos / unit) * unit
    if (step < 0) continue
    let end = Math.max(step + unit, Math.round(endPos / unit) * unit)
    // A tie of one grid unit over the barline is rounding noise, not music.
    const over = end % spm
    if (over > 0 && over <= unit && end - over > step) end -= over
    const key = `${step}:${pitch}`
    const old = seen.get(key)
    if (old) {
      old.end = Math.max(old.end, end)
      old.amplitude = Math.max(old.amplitude, e.amplitude)
    } else {
      seen.set(key, { step, end, pitch, amplitude: e.amplitude, bass: false, string: 0, fret: 0 })
    }
  }
  let grid = [...seen.values()].sort((a, b) => a.step - b.step || a.pitch - b.pitch)

  // 2. Voices: low notes, and the bottom of a chord, go to the thumb's voice.
  if (opts.twoVoices) {
    const byStep = new Map<number, GridNote[]>()
    for (const n of grid) byStep.set(n.step, [...(byStep.get(n.step) ?? []), n])
    const bassTop = tuning[tuning.length - 3] + 2 // E on the fourth string
    for (const group of byStep.values()) {
      for (const n of group) if (n.pitch <= bassTop) n.bass = true
      const lowest = group[0]
      if (group.length > 1 && !lowest.bass && lowest.pitch <= bassTop + 3) lowest.bass = true
    }
  }

  // 3. Strings, frets, fingerings.
  const placed = assignFingerboard(grid, tuning)
  grid = placed.notes
  const marks = new Map<number, GroupMark>(placed.marks.map((x) => [x.step, x]))

  // 4. Measures and beats.
  const last = grid.reduce((mx, n) => Math.max(mx, n.end), 0)
  const measureCount = Math.max(1, Math.ceil(last / spm))
  const measures: Measure[] = Array.from({ length: measureCount }, () => ({ voices: opts.twoVoices ? [[], []] : [[]] }))
  const usedMarks = new Set<number>()

  const buildVoice = (voiceNotes: GridNote[], vi: number) => {
    const chords = new Map<number, GridNote[]>()
    for (const n of voiceNotes) chords.set(n.step, [...(chords.get(n.step) ?? []), n])
    const steps = [...chords.keys()].sort((a, b) => a - b)
    let cursor = 0
    const emit = (from: number, to: number, chord: GridNote[] | null) => {
      let pos = from
      let first = true
      while (pos < to) {
        const mi = Math.floor(pos / spm)
        const inBar = pos - mi * spm
        const len = Math.min(to - pos, spm - inBar)
        for (const piece of splitSpan(inBar, len, chord === null, spb)) {
          const beat: Beat = { dur: piece.dur, notes: [] }
          if (piece.dots) beat.dots = piece.dots
          if (chord) {
            beat.notes = chord.map((n) => {
              const note: Note = { string: n.string, fret: n.fret }
              if (first) {
                if (n.lh) note.lh = n.lh
                if (n.rh) note.rh = n.rh
                if (n.showString) note.showString = true
              } else {
                note.tie = true
              }
              return note
            })
            if (first) {
              const mark = marks.get(chord[0].step)
              if (mark && !usedMarks.has(mark.step)) {
                usedMarks.add(mark.step)
                if (mark.barre) beat.barre = mark.barre
                if (mark.text) beat.text = mark.text
              }
            }
          }
          measures[mi].voices[vi].push(beat)
          first = false
        }
        pos += len
      }
    }
    steps.forEach((step, i) => {
      if (step < cursor) return // swallowed by a longer note
      const chord = chords.get(step)!
      const next = i + 1 < steps.length ? steps[i + 1] : Infinity
      const sustain = Math.max(...chord.map((n) => n.end)) - step
      const gap = next - step
      // Plucked notes are written as one plain value where possible; a tie is only worth its
      // ink when the note really is held for (nearly) the whole gap.
      const plain = splitSpan(step % spm, Math.min(gap === Infinity ? sustain : gap, spm - (step % spm)), false, spb)[0].len
      let len = gap === Infinity ? sustain : sustain >= gap * 0.85 ? gap : sustain >= plain * 0.6 ? Math.max(plain, Math.min(sustain, gap)) : sustain
      if (len > plain && len < gap) len = plain
      len = Math.max(unit, Math.min(len, Math.max(spm, sustain)))
      if (gap !== Infinity) len = Math.min(len, gap)
      if (step > cursor) emit(cursor, step, null)
      emit(step, step + len, chord)
      cursor = step + len
    })
    // Complete the last measure this voice touches.
    const endOfBar = Math.ceil(cursor / spm) * spm
    if (cursor < endOfBar) emit(cursor, endOfBar, null)
  }

  if (opts.twoVoices) {
    buildVoice(grid.filter((n) => !n.bass), 0)
    buildVoice(grid.filter((n) => n.bass), 1)
  } else {
    buildVoice(grid, 0)
  }

  // Carry a barre across the beats between two chords that share it (up to a measure apart),
  // so it prints as one bracket instead of a mark per chord.
  for (let vi = 0; vi < (opts.twoVoices ? 2 : 1); vi++) {
    const flat = measures.flatMap((x) => x.voices[vi])
    let lastIndex = -1
    flat.forEach((beat, i) => {
      if (!beat.barre) return
      const prev = lastIndex >= 0 ? flat[lastIndex] : null
      if (prev?.barre && prev.barre.fret === beat.barre.fret && i - lastIndex <= 16) {
        if (prev.barre.half !== beat.barre.half) beat.barre = { ...prev.barre }
        for (let k = lastIndex + 1; k < i; k++) flat[k].barre = { ...prev.barre }
      }
      lastIndex = i
    })
  }

  // A final measure holding nothing but the tail of a tied note is the last chord ringing out.
  while (measures.length > 1 && measures[measures.length - 1].voices.every((v) => v.every((b) => b.notes.every((n) => n.tie)))) measures.pop()

  // Beat times re-based to measure 1, long enough to cover the whole score.
  const totalBeats = measures.length * beatsPerMeasure
  const beatTimes: number[] = []
  for (let i = 0; i <= totalBeats; i++) beatTimes.push(beatsToTime(opts.timing, origin + i))

  const tempo = Math.round((timingTempo(opts.timing) * spb) / 4)
  const score: Score = {
    title: opts.title ?? 'Transcription',
    composer: opts.composer ?? '',
    tempo,
    timeSig: opts.timeSig,
    key: opts.key ?? 0,
    tuning: [...tuning],
    measures,
  }
  return { score, timing: { beatTimes } }
}

/** Guess the key signature (sharps/flats) from pitch-class weights (Krumhansl profiles). */
export function guessKey(events: NoteEvent[]): number {
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
  const minor = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
  const hist = new Array<number>(12).fill(0)
  for (const e of events) hist[((Math.round(e.pitch) % 12) + 12) % 12] += Math.min(e.duration, 0.4) * e.amplitude
  const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length
  const hm = mean(hist)
  const corr = (profile: number[], tonic: number) => {
    const pm = mean(profile)
    let num = 0
    let dp = 0
    let dh = 0
    for (let i = 0; i < 12; i++) {
      const h = hist[(i + tonic) % 12] - hm
      const q = profile[i] - pm
      num += h * q
      dp += q * q
      dh += h * h
    }
    return num / (Math.sqrt(dp * dh) || 1)
  }
  let best = { v: -Infinity, sharps: 0 }
  // Number of sharps for each major tonic pitch class.
  const sharpsOfMajor = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]
  for (let t = 0; t < 12; t++) {
    const mj = corr(major, t)
    if (mj > best.v) best = { v: mj, sharps: sharpsOfMajor[t] }
    const mn = corr(minor, t)
    if (mn > best.v) best = { v: mn, sharps: sharpsOfMajor[(t + 3) % 12] }
  }
  return best.sharps
}
