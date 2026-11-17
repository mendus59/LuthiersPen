// LuthiersPen's own score model. It is deliberately small and JSON-friendly so it can be
// saved to Firestore, edited, and converted to an alphaTab score for engraving and playback.

import { type Key, pcName, spell } from './keys'

export type Dur = 1 | 2 | 4 | 8 | 16 | 32
export type RhFinger = 'p' | 'i' | 'm' | 'a'

export interface Note {
  /** Guitar string, 1 = high E … 6 = low E. */
  string: number
  fret: number
  /** Left-hand finger 1-4 (0 = open). Only set where the fingering should be printed. */
  lh?: number
  rh?: RhFinger
  /** Tied to the note on the same string in the previous beat. */
  tie?: boolean
  /** Print the circled string number. */
  showString?: boolean
}

export interface Beat {
  dur: Dur
  dots?: number
  /** Tuplet as [notes, inTheTimeOf], e.g. [3, 2]. */
  tuplet?: [number, number]
  /** No notes = rest. */
  notes: Note[]
  barre?: { fret: number; half?: boolean }
  text?: string
}

export interface Measure {
  /** A time signature of its own, for a measure shorter or longer than the score's. */
  timeSig?: [number, number]
  /** voices[0] is the upper voice (stems up), voices[1] the bass voice (stems down). */
  voices: Beat[][]
}

export interface Score {
  title: string
  subtitle?: string
  composer: string
  /** Tempo word printed at the start, e.g. Allegro. */
  tempoText?: string
  tempo: number
  timeSig: [number, number]
  /** Key signature: number of sharps (positive) or flats (negative). */
  key: number
  /** The key is the minor one of its signature (A minor rather than C major). */
  keyMinor?: boolean
  /** Open-string MIDI pitches for strings 1..6. */
  tuning: number[]
  measures: Measure[]
}

/** Where a recording sits relative to the score, so the two can be played in sync and compared. */
export interface AudioSync {
  /** Seconds into the recording where measure 1 starts. */
  offset: number
  /** Tempo the recording was quantized at. */
  tempo: number
}

export const STANDARD_TUNING = [64, 59, 55, 50, 45, 40]
export const TICKS_PER_QUARTER = 960
export const MAX_FRET = 19

export function beatTicks(b: Pick<Beat, 'dur' | 'dots' | 'tuplet'>): number {
  let t = (TICKS_PER_QUARTER * 4) / b.dur
  if (b.dots === 1) t *= 1.5
  else if (b.dots === 2) t *= 1.75
  if (b.tuplet) t = (t * b.tuplet[1]) / b.tuplet[0]
  return t
}

/** Length of a measure: measure `mi` of the score, or a regular one when no measure is given. */
export function measureTicks(score: Pick<Score, 'timeSig'> & { measures?: Measure[] }, mi?: number): number {
  const sig = (mi !== undefined ? score.measures?.[mi]?.timeSig : undefined) ?? score.timeSig
  return (TICKS_PER_QUARTER * 4 * sig[0]) / sig[1]
}

/** Where each measure starts, in ticks from the start of measure 1, plus the end of the last. */
export function measureStarts(score: Score): number[] {
  const out = [0]
  score.measures.forEach((_, mi) => out.push(out[mi] + measureTicks(score, mi)))
  return out
}

export function voiceTicks(beats: Beat[]): number {
  return beats.reduce((s, b) => s + beatTicks(b), 0)
}

export function notePitch(score: Pick<Score, 'tuning'>, n: Pick<Note, 'string' | 'fret'>): number {
  return score.tuning[n.string - 1] + n.fret
}

/** The key a score is in. */
export function scoreKey(score: Pick<Score, 'key' | 'keyMinor'>): Key {
  return { sharps: score.key, minor: !!score.keyMinor }
}

/** Pitch name as written in a key, with its octave (C4 = middle C; B♯3 is written below C4). */
export function pitchName(midi: number, key: Key = { sharps: 0, minor: false }): string {
  const s = spell(((midi % 12) + 12) % 12, key)
  return `${pcName(midi, key)}${Math.floor((midi - s.offset) / 12) - 1}`
}

/** A rest filling a whole measure, split into legal note values. */
export function restsFor(ticks: number): Beat[] {
  const out: Beat[] = []
  const values: Array<[number, Dur, number]> = [
    [3840, 1, 0], [2880, 2, 1], [1920, 2, 0], [1440, 4, 1], [960, 4, 0],
    [720, 8, 1], [480, 8, 0], [360, 16, 1], [240, 16, 0], [120, 32, 0],
  ]
  let left = ticks
  while (left >= 120) {
    const v = values.find(([t]) => t <= left)!
    out.push({ dur: v[1], ...(v[2] ? { dots: v[2] } : {}), notes: [] })
    left -= v[0]
  }
  return out
}

export function emptyMeasure(score: Pick<Score, 'timeSig'>): Measure {
  return { voices: [restsFor(measureTicks(score))] }
}

export function newScore(title = 'Untitled', measures = 8): Score {
  const s: Score = {
    title,
    composer: '',
    tempo: 80,
    timeSig: [4, 4],
    key: 0,
    tuning: [...STANDARD_TUNING],
    measures: [],
  }
  for (let i = 0; i < measures; i++) s.measures.push(emptyMeasure(s))
  return s
}

export function cloneScore(s: Score): Score {
  return JSON.parse(JSON.stringify(s)) as Score
}

/** All places a pitch can be played, lowest fret first. */
export function positionsFor(tuning: number[], pitch: number): Array<{ string: number; fret: number }> {
  const out: Array<{ string: number; fret: number }> = []
  for (let s = 1; s <= tuning.length; s++) {
    const fret = pitch - tuning[s - 1]
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string: s, fret })
  }
  return out.sort((a, b) => a.fret - b.fret)
}

/** Start time in seconds of every measure, plus the end of the last one. */
export function measureSeconds(score: Score): number {
  return (measureTicks(score) / TICKS_PER_QUARTER) * (60 / score.tempo)
}
