import { type Beat, type Measure, type Note, type Score, STANDARD_TUNING } from './score'

type Shape = { bass: [number, number]; treble: Array<[number, number, number]> }

// [string, fret, left-hand finger]
const AM: Shape = { bass: [5, 0], treble: [[3, 2, 3], [2, 1, 1], [1, 0, 0]] }
const DM: Shape = { bass: [4, 0], treble: [[3, 2, 2], [2, 3, 3], [1, 1, 1]] }
const E: Shape = { bass: [6, 0], treble: [[3, 1, 1], [2, 0, 0], [1, 0, 0]] }
const C: Shape = { bass: [5, 3], treble: [[3, 0, 0], [2, 1, 1], [1, 0, 0]] }
const G: Shape = { bass: [6, 3], treble: [[3, 0, 0], [2, 0, 0], [1, 3, 4]] }

/** A short original arpeggio study, so there is something to play with before transcribing. */
export function demoScore(): Score {
  const plan: Shape[][] = [[AM, AM], [DM, AM], [E, E], [AM, AM], [C, G], [DM, AM], [E, E]]
  const rh = ['i', 'm', 'a'] as const
  const fingered = new Set<Shape>()
  const measures: Measure[] = plan.map((shapes, mi) => {
    const upper: Beat[] = []
    const lower: Beat[] = []
    for (const shape of shapes) {
      const first = !fingered.has(shape)
      fingered.add(shape)
      for (let half = 0; half < 2; half++) {
        upper.push({ dur: 16, notes: [] })
        shape.treble.forEach(([string, fret, lh], k) => {
          const n: Note = { string, fret }
          if (first && half === 0 && lh) n.lh = lh
          if (mi === 0 && half === 0 && shape === shapes[0]) n.rh = rh[k]
          upper.push({ dur: 16, notes: [n] })
        })
        const bass: Note = { string: shape.bass[0], fret: shape.bass[1] }
        if (first && half === 0 && bass.fret) bass.lh = bass.fret === 3 ? 3 : 2
        if (mi === 0 && half === 0 && shape === shapes[0]) bass.rh = 'p'
        lower.push({ dur: 4, notes: [bass] })
      }
    }
    return { voices: [upper, lower] }
  })
  measures.push({
    voices: [
      [{ dur: 2, notes: [{ string: 3, fret: 2 }, { string: 2, fret: 1 }, { string: 1, fret: 0 }] }, { dur: 2, notes: [] }],
      [{ dur: 2, notes: [{ string: 5, fret: 0 }] }, { dur: 2, notes: [] }],
    ],
  })
  return { title: 'Arpeggio Study', subtitle: 'in A minor', composer: 'LuthiersPen demo', tempoText: 'Andante', tempo: 72, timeSig: [4, 4], key: 0, keyMinor: true, tuning: [...STANDARD_TUNING], measures }
}
