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
  // Thresholds tuned for plucked nylon strings: a clear attack, then a quick decay.
  const raw = outputToNotesPoly(frames, onsets, 0.6, 0.3, 5, true, 1400, 70, true)
  const timed = noteFramesToTime(addPitchBendsToNoteEvents(contours, raw))
  return timed
    .map((n) => ({ start: n.startTimeSeconds, duration: n.durationSeconds, pitch: n.pitchMidi, amplitude: n.amplitude }))
    .sort((a, b) => a.start - b.start)
}
