import { beatsFromBars } from '../transcribe/bars'
import type { Timing } from '../transcribe/tempo'
import type { NoteEvent } from '../transcribe/types'

/** Meters a bar of the tab can be, by the beats of the heard pulse it lasts. */
const METERS: Array<{ pulses: number; timeSig: [number, number]; beats: number }> = [
  { pulses: 2, timeSig: [2, 4], beats: 2 },
  { pulses: 3, timeSig: [3, 4], beats: 3 },
  { pulses: 4, timeSig: [4, 4], beats: 4 },
  // A slow piece whose pulse was heard at the eighths.
  { pulses: 6, timeSig: [3, 4], beats: 3 },
  { pulses: 8, timeSig: [4, 4], beats: 4 },
]

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.floor(s.length / 2)]
}

/**
 * Barlines from a video's tab: the bars start where the tab's bars were heard to start (see
 * fuseTab), and the meter is the number of heard beats a bar lasts. A bar much shorter or longer
 * than the rest (a 2/4 bar inside 4/4) keeps its own length. With `fixed`, the bars are given
 * the meter `heardSig` (chosen by the user) instead. Returns null with too few bars.
 */
export function tabTiming(
  downs: number[],
  notes: NoteEvent[],
  heard: Timing,
  heardSig: [number, number],
  fixed = false,
): { fit: { timing: Timing; pickup: number; barBeats: number[] }; timeSig: [number, number] } | null {
  if (downs.length < 3 || heard.beatTimes.length < 2) return null
  const lengths = downs.slice(1).map((t, k) => t - downs[k])
  const bar = median(lengths)
  const beat = median(heard.beatTimes.slice(1).map((t, k) => t - heard.beatTimes[k]))
  const ratio = bar / beat
  // The meter heard by ear wins when it fits the tab's bars as well as another.
  let pick = METERS[0]
  let err = Infinity
  const compound = heardSig[1] === 8 && heardSig[0] % 3 === 0 && heardSig[0] > 3
  if (fixed) pick = { pulses: 0, timeSig: heardSig, beats: compound ? heardSig[0] / 3 : heardSig[0] }
  else for (const m of METERS) {
    const e = Math.abs(Math.log(ratio / m.pulses)) - (m.timeSig.join() === heardSig.join() ? 0.06 : 0)
    if (e < err) {
      err = e
      pick = m
    }
  }
  const sizes = lengths.map((len) => {
    const r = len / bar
    if (r > 0.7 && r < 1.35) return pick.beats
    return Math.max(1, Math.min(pick.beats * 2, Math.round(r * pick.beats)))
  })
  return { fit: beatsFromBars(downs, pick.beats, notes, sizes), timeSig: pick.timeSig }
}
