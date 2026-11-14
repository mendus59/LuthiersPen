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
}
