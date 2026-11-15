import { describe, expect, it } from 'vitest'
import { FEATURE_NAMES, noteFeatures } from './features'
import { noteChance, pickNotes } from './filter'

// Two candidates from a real recording (Chopin, Waltz Op. 69 No. 2), as noteFeatures described them.
const PLUCKED = [0.6626, 0.418, 72, 0.828, 0.7036, 0.827, 0.5, 4.4388, 5, 2.346, 4.4388, 5, -4.3507, -0.8286, 0.547, 0.7443, 0.4639, 3, 5, 1, 0, -0.036, -1, -1, -1, 0.2988, -1, 1, -0.828, 0.5, -0.052, 3, 0.864, 4.0721, -2.754, -0.7566, -2.4615, 1.1279]
const RINGING = [0.4731, 0.9172, 45, 0.587, 0.5378, 0.55, 0.461, 0.3878, 3.2384, 0.0418, 0.3878, 0.0314, -4.1369, 0, 0.0116, 0.4309, 0.4572, 0.9172, 4, 3, -3.3343, -0.359, -1, -1, -1, 0.7626, 0.5501, 0.3916, -0.587, 0.5, 0.2145, 2, 0.946, 3.7222, -2.0913, 1.1246, -3.486, 1.6134]

describe('note filter', () => {
  it('tells a plucked note from a string that is only ringing', () => {
    expect(PLUCKED).toHaveLength(FEATURE_NAMES.length)
    expect(noteChance(PLUCKED)).toBeGreaterThan(0.9)
    expect(noteChance(RINGING)).toBeLessThan(0.1)
  })

  it('describes every candidate and writes one pluck once', () => {
    const rate = 22050
    const mono = new Float32Array(rate * 2)
    const frames = Array.from({ length: 172 }, () => new Array(88).fill(0))
    const onsets = Array.from({ length: 172 }, () => new Array(88).fill(0))
    const cands = [
      { start: 0.5, duration: 0.3, pitch: 57, amplitude: 0.3, frame: 43 },
      { start: 0.56, duration: 0.3, pitch: 57, amplitude: 0.3, frame: 48 },
      { start: 1.0, duration: 0.3, pitch: 57, amplitude: 0.3, frame: 86 },
    ]
    const features = noteFeatures(cands, frames, onsets, mono, rate)
    expect(features).toHaveLength(3)
    for (const row of features) {
      expect(row).toHaveLength(FEATURE_NAMES.length)
      expect(row.every(Number.isFinite)).toBe(true)
    }
    const notes = pickNotes(cands, frames, onsets, mono, rate)
    expect(notes.length).toBeLessThanOrEqual(2)
    expect(notes.filter((n) => n.start < 0.9).length).toBeLessThanOrEqual(1)
  })
})
