import { describe, expect, it } from 'vitest'
import { repeatFeatures, withRepeats } from './repeats'

describe('repeat check', () => {
  // A twelve-note phrase played three times, 3 s apart; one note of the last time came out weak.
  const phrase = [64, 63, 64, 63, 64, 59, 62, 60, 57, 45, 52, 57]
  const start: number[] = []
  const pitch: number[] = []
  const chance: number[] = []
  for (let r = 0; r < 3; r++) {
    phrase.forEach((p, i) => {
      start.push(1 + r * 3 + i * 0.2)
      pitch.push(p)
      chance.push(r === 2 && i === 6 ? 0.3 : 0.95)
    })
  }
  // A stray candidate that never comes back.
  start.push(7.9)
  pitch.push(70)
  chance.push(0.3)

  it('finds the repeats and what they say', () => {
    const rep = repeatFeatures(start, pitch, chance)
    expect(rep).toHaveLength(start.length)
    expect(rep[30][2]).toBeGreaterThanOrEqual(1)
    expect(rep[30][0]).toBeGreaterThan(0.9)
    expect(rep[36][0]).toBeLessThan(0.1)
  })

  it('trusts a weak note its repeats agree with more than a stray one', () => {
    const after = withRepeats(chance, repeatFeatures(start, pitch, chance))
    expect(after[30]).toBeGreaterThan(after[36])
    expect(after[30]).toBeGreaterThan(0.35)
  })
})
