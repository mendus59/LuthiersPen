import { describe, expect, it } from 'vitest'
import { ALL_KEYS, type Key, keyFromHistogram, keyName, keyTonic, parseKey, keyValue, pcName } from './keys'
import { pitchName } from './score'

const k = (sharps: number, minor = false): Key => ({ sharps, minor })
const names = (key: Key) => Array.from({ length: 12 }, (_, pc) => pcName(pc, key)).join(' ')

describe('keys', () => {
  it('names every key by its tonic', () => {
    expect(keyName(k(0))).toBe('C major')
    expect(keyName(k(0, true))).toBe('A minor')
    expect(keyName(k(2))).toBe('D major')
    expect(keyName(k(2, true))).toBe('B minor')
    expect(keyName(k(-1, true))).toBe('D minor')
    expect(keyName(k(-3, true))).toBe('C minor')
    expect(keyName(k(6))).toBe('F♯ major')
    expect(keyName(k(-6, true))).toBe('E♭ minor')
    expect(keyName(k(7))).toBe('C♯ major')
    expect(keyName(k(-7))).toBe('C♭ major')
    expect(new Set(ALL_KEYS.map(keyName)).size).toBe(30)
    for (const key of ALL_KEYS) expect(parseKey(keyValue(key))).toEqual(key)
  })

  it('spells the scale from the signature and the notes outside it as an edition does', () => {
    expect(names(k(0))).toBe('C D♭ D E♭ E F F♯ G G♯ A B♭ B')
    // A minor: raised 7th and 6th (G♯, F♯), the major third of A (C♯), the Neapolitan B♭, D♯ leading to E.
    expect(names(k(0, true))).toBe('C C♯ D D♯ E F F♯ G G♯ A B♭ B')
    // D minor: C♯ is the leading tone, not D♭.
    expect(pcName(1, k(-1, true))).toBe('C♯')
    // G minor and C minor: F♯ and B natural.
    expect(pcName(6, k(-2, true))).toBe('F♯')
    expect(pcName(11, k(-3, true))).toBe('B')
    // E major: C natural rather than B♯, A♯ as the raised fourth, D and G naturals as the lowered seventh and third.
    expect(names(k(4))).toBe('C C♯ D D♯ E F F♯ G G♯ A A♯ B')
    // F♯ major writes E♯, and G♯ minor writes F𝄪 as its leading tone.
    expect(pcName(5, k(6))).toBe('E♯')
    expect(pcName(7, k(5, true))).toBe('F𝄪')
    // F major: B♭ in the scale, B natural as the raised fourth.
    expect(pcName(10, k(-1))).toBe('B♭')
    expect(pcName(11, k(-1))).toBe('B')
  })

  it('numbers octaves from the written letter', () => {
    expect(pitchName(60)).toBe('C4')
    expect(pitchName(76, k(1))).toBe('E5')
    // C in C♯ major is B♯, written in the octave below.
    expect(pitchName(60, k(7))).toBe('B♯3')
  })

  it('finds major and minor keys from a pitch-class histogram', () => {
    const scale = (tonic: number, steps: number[], weights: number[]) => {
      const h = new Array<number>(12).fill(0)
      steps.forEach((s, i) => (h[(tonic + s) % 12] += weights[i]))
      return h
    }
    const major = [0, 2, 4, 5, 7, 9, 11]
    const harmonicMinor = [0, 2, 3, 5, 7, 8, 11]
    // Tonic triad notes weigh most, as in real music.
    const w = [5, 2, 4, 2, 4, 2, 1.5]
    for (let t = 0; t < 12; t++) {
      expect(keyTonic(keyFromHistogram(scale(t, major, w)))).toBe(t)
      const mk = keyFromHistogram(scale(t, harmonicMinor, w))
      expect(mk.minor).toBe(true)
      expect(keyTonic(mk)).toBe(t)
    }
    expect(keyFromHistogram(scale(2, major, w))).toEqual(k(2))
    expect(keyFromHistogram(scale(11, harmonicMinor, w))).toEqual(k(2, true))
  })
})
