/** A note detected in a recording. */
export interface NoteEvent {
  /** Start in seconds. */
  start: number
  /** Length in seconds. */
  duration: number
  /** MIDI pitch (sounding). */
  pitch: number
  /** 0..1 */
  amplitude: number
  /** Where it is played, when that is known (from tablature shown in a video): 1 = high E … 6 = low E. */
  string?: number
  fret?: number
}
