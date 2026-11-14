import { describe, expect, it } from 'vitest'
import { FEATURE_NAMES, noteFeatures } from './features'
import { noteChance, pickNotes } from './filter'

// Two candidates from a real recording (Chopin, Waltz Op. 69 No. 2), as noteFeatures described them.
const PLUCKED = [0.7124, 0.6385, 52, 0.857, 0.7406, 0.828, 0.674, 1.1789, 0.6962, -0.6258, 0.6962, 1.0034, -4.2214, 0, 0, 0.1277, 0.6577, 0.6385, 3, 0, -0.1134, 0, -1, -1, -1, 0.3536, -1, 1, -0.424, 0.1277, 0.3155, 14, 0.672, 0.8096]
const RINGING = [0.4262, 0.6153, 45, 0.577, 0.4848, 0.644, 0.53, 0.2343, -0.1827, 0.5894, 0.2343, -0.0581, -4.5037, -0.5668, 0, 0.2902, 0.5235, 1.0913, 5, 3, -3.6857, -0.368, -1, -1, -1, 0.5414, 0.4462, 1, -0.577, 0.5, 0.079, 12, 0.945, 3.92]

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
