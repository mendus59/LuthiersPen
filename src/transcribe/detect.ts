import { MODEL_RATE } from './audio'
import type { Candidate } from './features'
import { judgeCandidates, keepLikely } from './filter'
import type { NoteEvent } from './types'

/**
 * Detect the notes in a mono 22.05 kHz recording with Spotify's Basic Pitch model,
 * running entirely in the browser (TensorFlow.js). Nothing is uploaded.
 */
export async function detectNotes(mono: Float32Array, onProgress: (fraction: number) => void): Promise<NoteEvent[]> {
  const { cands, chances } = await detectCandidates(mono, onProgress)
  return keepLikely(cands, chances)
}

/**
 * Every note the detector proposes, with the chance that each was really played (see
 * judgeCandidates), before the likely ones are kept.
 */
export async function detectCandidates(mono: Float32Array, onProgress: (fraction: number) => void): Promise<{ cands: Candidate[]; chances: number[] }> {
  const { BasicPitch, addPitchBendsToNoteEvents, noteFramesToTime, outputToNotesPoly } = await import('@spotify/basic-pitch')
  const model = new BasicPitch(`${import.meta.env.BASE_URL}basic-pitch/model.json`)
  const frames: number[][] = []
  const onsets: number[][] = []
  const contours: number[][] = []
  await model.evaluateModel(
    mono,
    (f, o, c) => {
      frames.push(...f)
      onsets.push(...o)
      contours.push(...c)
    },
    onProgress,
  )
  // Ask for more candidates than the detector is sure of; the note filter decides which were played.
  const raw = outputToNotesPoly(frames, onsets, 0.4, 0.3, 5, true, 1400, 70, true)
  const timed = noteFramesToTime(addPitchBendsToNoteEvents(contours, raw))
  const cands = timed.map((n, i) => ({ start: n.startTimeSeconds, duration: n.durationSeconds, pitch: n.pitchMidi, amplitude: n.amplitude, frame: raw[i].startFrame }))
  return { cands, chances: judgeCandidates(cands, frames, onsets, mono, MODEL_RATE) }
}
