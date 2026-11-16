import { type Score, beatTicks, measureStarts, notePitch, TICKS_PER_QUARTER } from '../model/score'
import { stepsPerBeat } from '../transcribe/quantize'
import { beatsToTime, type Timing } from '../transcribe/tempo'
import type { NoteEvent } from '../transcribe/types'
import { noteEvidence } from './evidence'

export interface MissingNote {
  measure: number
  pitch: number
}

export interface VerifyResult {
  /** 0..1 agreement for each measure (NaN for an empty measure with nothing heard). */
  measures: number[]
  overall: number
  /** Measures (0-based) whose agreement is low enough to deserve a look. */
  flagged: number[]
  /** Notes in the score that the recording does not support, as "measure:voice:beat:string". */
  doubts: string[]
  /** Notes heard in the recording that the score does not have. */
  missing: MissingNote[]
  notes: number
}

export const GOOD = 0.9
export const DOUBT = 0.8

/** When each note of the score sounds on playback, mapped onto the recording's own time. */
function scoreNotes(score: Score, timing: Timing) {
  const pulseTicks = (TICKS_PER_QUARTER / 4) * stepsPerBeat(score.timeSig)
  const barStarts = measureStarts(score)
  const out: Array<{ key: string; measure: number; pitch: number; sec: number }> = []
  score.measures.forEach((measure, m) => {
    measure.voices.forEach((voice, v) => {
      let tick = barStarts[m]
      voice.forEach((beat, b) => {
        const sec = beatsToTime(timing, tick / pulseTicks)
        for (const n of beat.notes) if (!n.tie) out.push({ key: `${m}:${v}:${b}:${n.string}`, measure: m, pitch: notePitch(score, n), sec })
        tick += beatTicks(beat)
      })
    })
  })
  return out
}

/**
 * Check the score against the original recording, note by note, exactly as playback will sound it.
 *
 * Every note is looked up in the recording at the moment the score plays it: its partials must
 * be there, standing clear of the semitones either side. Then the other direction: every note
 * heard in the recording must have a counterpart in the score. Timing follows the performance
 * beat by beat, so rubato does not count against the transcription.
 */
export function verify(score: Score, mono: Float32Array, rate: number, timing: Timing, heard: NoteEvent[]): VerifyResult {
  const notes = scoreNotes(score, timing)
  const count = score.measures.length
  const total = new Array<number>(count).fill(0)
  const good = new Array<number>(count).fill(0)
  const doubts: string[] = []
  for (const n of notes) {
    const e = noteEvidence(mono, rate, n.sec, n.pitch)
    total[n.measure]++
    if (e.root && e.present * 2 >= e.partials) good[n.measure]++
    else doubts.push(n.key)
  }

  // Heard but not written. One sixteenth at the local tempo is the matching window.
  const missing: MissingNote[] = []
  const tickStarts = measureStarts(score)
  const starts = score.measures.map((_, m) => beatsToTime(timing, tickStarts[m] / ((TICKS_PER_QUARTER / 4) * stepsPerBeat(score.timeSig))))
  const window = Math.max(0.08, ((60 / score.tempo) / 4) * 1.1)
  const low = score.tuning[score.tuning.length - 1]
  for (const h of heard) {
    let pitch = Math.round(h.pitch)
    while (pitch < low) pitch += 12
    if (notes.some((n) => n.pitch === pitch && Math.abs(n.sec - h.start) <= window)) continue
    // An overtone of something the score does have is not a missing note.
    if (notes.some((n) => [12, 19, 24, 28, 31].includes(pitch - n.pitch) && Math.abs(n.sec - h.start) <= window)) continue
    const e = noteEvidence(mono, rate, h.start, pitch)
    if (!(e.root && e.present * 2 >= e.partials)) continue
    let measure = 0
    while (measure + 1 < count && starts[measure + 1] <= h.start + 0.02) measure++
    if (h.start < starts[0] - window) continue
    missing.push({ measure, pitch })
    total[measure]++
  }

  const measures = total.map((t, i) => (t ? good[i] / t : NaN))
  const all = total.reduce((a, b) => a + b, 0)
  return {
    measures,
    overall: all ? good.reduce((a, b) => a + b, 0) / all : 0,
    flagged: measures.map((v, i) => (v < DOUBT ? i : -1)).filter((i) => i >= 0),
    doubts,
    missing,
    notes: notes.length,
  }
}
