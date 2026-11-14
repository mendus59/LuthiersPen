import { describe, expect, it } from 'vitest'
import { measureTicks, notePitch, voiceTicks } from '../model/score'
import { guessKey, quantize } from './quantize'
import { timingTempo, trackBeats } from './tempo'
import type { NoteEvent } from './types'

/** An arpeggio study at a given tempo: bass on the beat, three treble sixteenths after it. */
function study(bpm: number, bars: number, drift = 0): NoteEvent[] {
  const out: NoteEvent[] = []
  let t = 0.4
  const chords = [[45, 60, 64, 69], [40, 59, 64, 68], [50, 62, 65, 69], [45, 60, 64, 72]]
  for (let bar = 0; bar < bars; bar++) {
    const c = chords[bar % chords.length]
    for (let beat = 0; beat < 4; beat++) {
      const sixteenth = 60 / (bpm * (1 + drift * Math.sin(bar / 3))) / 4
      out.push({ start: t, duration: sixteenth * 4, pitch: c[0], amplitude: 0.8 })
      for (let k = 1; k < 4; k++) out.push({ start: t + k * sixteenth, duration: sixteenth, pitch: c[k], amplitude: 0.5 })
      t += sixteenth * 4
    }
  }
  return out
}

describe('transcription pipeline', () => {
  it('finds the tempo', () => {
    const t = trackBeats(study(96, 8))
    expect(Math.abs(timingTempo(t) - 96)).toBeLessThanOrEqual(2)
  })

  it('follows a drifting tempo and keeps every note on its sixteenth', () => {
    const notes = study(84, 12, 0.06)
    const timing = trackBeats(notes)
    const { score } = quantize(notes, { timing, timeSig: [4, 4], pickupBeats: 0, twoVoices: true, grid: 16 })
    expect(score.measures.length).toBe(12)
    for (const m of score.measures) {
      for (const v of m.voices) expect(voiceTicks(v)).toBe(measureTicks(score))
      // bass: four quarters; treble: sixteenth rest + three sixteenths, four times
      expect(m.voices[1].filter((b) => b.notes.length).length).toBe(4)
      expect(m.voices[0].filter((b) => b.notes.length).length).toBe(12)
    }
  })

  it('keeps pitches and gives playable frets', () => {
    const notes = study(90, 4)
    const { score } = quantize(notes, { timing: trackBeats(notes), timeSig: [4, 4], pickupBeats: 0, twoVoices: false, grid: 16 })
    const pitches = new Set<number>()
    for (const m of score.measures)
      for (const b of m.voices[0]) {
        const frets = b.notes.filter((n) => n.fret > 0).map((n) => n.fret)
        if (frets.length) expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(4)
        expect(new Set(b.notes.map((n) => n.string)).size).toBe(b.notes.length)
        for (const n of b.notes) pitches.add(notePitch(score, n))
      }
    expect([...pitches].sort((a, b) => a - b)).toEqual([40, 45, 50, 59, 60, 62, 64, 65, 68, 69, 72])
  })

  it('guesses A minor / C major as no sharps', () => {
    expect(guessKey(study(90, 4))).toBe(0)
  })
})
