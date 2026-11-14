import { MODEL_RATE } from './audio'
import { pickNotes } from './filter'
import type { NoteEvent } from './types'

/**
 * Detect the notes in a mono 22.05 kHz recording with Spotify's Basic Pitch model,
 * running entirely in the browser (TensorFlow.js). Nothing is uploaded.
 */
export async function detectNotes(mono: Float32Array, onProgress: (fraction: number) => void): Promise<NoteEvent[]> {
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
  // Ask for more candidates than the detector is sure of; pickNotes decides which were played.
  const raw = outputToNotesPoly(frames, onsets, 0.4, 0.3, 5, true, 1400, 70, true)
  const timed = noteFramesToTime(addPitchBendsToNoteEvents(contours, raw))
  const cands = timed.map((n, i) => ({ start: n.startTimeSeconds, duration: n.durationSeconds, pitch: n.pitchMidi, amplitude: n.amplitude, frame: raw[i].startFrame }))
  return pickNotes(cands, frames, onsets, mono, MODEL_RATE)
}
