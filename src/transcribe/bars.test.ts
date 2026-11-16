import { describe, expect, it } from 'vitest'
import { fitBars, trackBars } from './bars'
import { hearSwing, quantize } from './quantize'
import { trackBeats } from './tempo'
import type { NoteEvent } from './types'
import { measureTicks, voiceTicks } from '../model/score'

const CHORDS = [
  [45, 57, 60, 64],
  [40, 56, 59, 64],
  [50, 57, 62, 65],
  [43, 55, 59, 62],
]

/**
 * A waltz-like study: a new bass and chord on each downbeat, the chord's upper notes on the other
 * beats, played with a tempo that swells and relaxes from bar to bar.
 */
function study(bars: number, beats: number, rubato: number, pickup = 0): { notes: NoteEvent[]; downs: number[] } {
  const notes: NoteEvent[] = []
  const downs: number[] = []
  let t = 0.5
  const beat0 = 0.6
  for (let k = 0; k < pickup; k++) {
    notes.push({ start: t, duration: beat0, pitch: 64, amplitude: 0.5 })
    t += beat0
  }
  for (let bar = 0; bar < bars; bar++) {
    const c = CHORDS[bar % CHORDS.length]
    const beat = beat0 * (1 + rubato * Math.sin(bar / 2))
    downs.push(t)
    notes.push({ start: t, duration: beat * beats, pitch: c[0], amplitude: 0.9 })
    for (let q = 0; q < beats; q++) {
      for (const p of q === 0 ? c.slice(1) : c.slice(2)) notes.push({ start: t + q * beat, duration: beat, pitch: p, amplitude: 0.5 })
      notes.push({ start: t + (q + 0.5) * beat, duration: beat / 2, pitch: c[1], amplitude: 0.4 })
    }
    t += beat * beats
  }
  return { notes, downs }
}

describe('bar tracking', () => {
  it('follows the downbeats of a performance with rubato', () => {
    const { notes, downs } = study(24, 3, 0.15)
    const found = trackBars(notes, 1.8, { beats: 3, split: 2 }).downs
    const hits = downs.filter((d) => found.some((f) => Math.abs(f - d) < 0.03)).length
    expect(hits / downs.length).toBeGreaterThanOrEqual(0.95)
    expect(found.length).toBeLessThanOrEqual(downs.length + 1)
  })

  it('keeps every bass note at the start of its measure, after a pickup', () => {
    const { notes } = study(16, 3, 0.1, 1)
    const heard = trackBeats(notes)
    const fit = fitBars(notes, heard, [3, 4])
    expect(fit.pickup).toBe(1)
    const { score } = quantize(notes, { timing: fit.timing, timeSig: [3, 4], pickupBeats: fit.pickup, twoVoices: true, grid: 16 })
    expect(score.measures.length).toBe(17)
    for (const m of score.measures.slice(1)) expect(m.voices[1][0].notes.length).toBe(1)
  })
})

describe('bars of another length', () => {
  it('writes a two-beat bar inside 4/4 as a 2/4 measure', () => {
    const notes: NoteEvent[] = []
    const lengths = [4, 4, 4, 4, 4, 2, 4, 4, 4, 4, 4, 2, 4, 4, 4, 4]
    const beat = 0.6
    let t = 0.5
    lengths.forEach((len, bar) => {
      const c = CHORDS[bar % CHORDS.length]
      notes.push({ start: t, duration: beat * len, pitch: c[0], amplitude: 0.9 })
      for (let q = 0; q < len; q++) {
        for (const p of q === 0 ? c.slice(1) : c.slice(2)) notes.push({ start: t + q * beat, duration: beat, pitch: p, amplitude: 0.45 })
        notes.push({ start: t + (q + 0.5) * beat, duration: beat / 2, pitch: c[1], amplitude: 0.35 })
      }
      t += beat * len
    })
    const fit = fitBars(notes, trackBeats(notes), [4, 4])
    // The last measure, after the final downbeat, is a regular one and not listed.
    expect(fit.barBeats).toEqual(lengths.slice(0, -1))
    const { score } = quantize(notes, { timing: fit.timing, timeSig: [4, 4], pickupBeats: fit.pickup, twoVoices: true, grid: 16, barBeats: fit.barBeats })
    expect(score.measures.map((m) => m.timeSig?.join('/') ?? '4/4')).toEqual(lengths.map((l) => (l === 2 ? '2/4' : '4/4')))
    for (const [mi, m] of score.measures.entries()) for (const v of m.voices) expect(voiceTicks(v)).toBe(measureTicks(score, mi))
  })
})

describe('swing', () => {
  it('hears swung eighths and writes them straight', () => {
    const notes: NoteEvent[] = []
    const beatTimes: number[] = []
    for (let k = 0; k < 32; k++) {
      const t = 1 + k * 0.5
      beatTimes.push(t)
      notes.push({ start: t, duration: 0.33, pitch: 64, amplitude: 0.6 })
      notes.push({ start: t + 0.5 * (2 / 3), duration: 0.17, pitch: 67, amplitude: 0.5 })
    }
    const timing = { beatTimes }
    expect(hearSwing(notes, timing)).toBe(true)
    const { score } = quantize(notes, { timing, timeSig: [4, 4], pickupBeats: 0, twoVoices: false, grid: 16, swing: true })
    expect(score.tempoText).toBe('Swing')
    // Eight straight eighths in every measure.
    for (const m of score.measures) expect(m.voices[0].map((b) => b.dur)).toEqual([8, 8, 8, 8, 8, 8, 8, 8])
    const straight = notes.map((n, i) => (i % 2 ? { ...n, start: n.start - 0.5 / 6 } : n))
    expect(hearSwing(straight, timing)).toBe(false)
  })
})
