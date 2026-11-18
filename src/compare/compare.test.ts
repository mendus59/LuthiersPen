import { describe, expect, it } from 'vitest'
import { type Beat, type Score, newScore, positionsFor } from '../model/score'
import { compareWithOriginal, scoreNotes } from './compare'
import { readOriginal, type OriginalNote, type OriginalScore } from './original'

// A tune of 16 bars in 4/4: a melody in quarters over a bass note per bar.
const TUNE = [72, 74, 76, 77, 79, 77, 76, 74, 72, 76, 79, 84, 83, 79, 77, 74]
const BASS = [48, 53, 55, 48]

function original(): OriginalScore {
  const notes: OriginalNote[] = []
  for (let bar = 0; bar < 16; bar++) {
    for (let q = 0; q < 4; q++) notes.push({ start: bar * 4 + q, duration: 1, pitch: TUNE[(bar * 4 + q) % TUNE.length], measure: bar })
    notes.push({ start: bar * 4, duration: 4, pitch: BASS[bar % 4], measure: bar })
  }
  return { title: 'Tune', composer: '', notes, measures: 16, key: 0 }
}

const at = (pitch: number) => {
  const p = positionsFor([64, 59, 55, 50, 45, 40], pitch)[0]
  return { string: p.string, fret: p.fret }
}

/** The tune arranged for guitar, `shift` semitones away and an octave down, with changes. */
function arrangement(shift: number, change: (bar: number, q: number, pitch: number) => number | null): Score {
  const s = newScore('Arrangement', 16)
  s.measures = []
  for (let bar = 0; bar < 16; bar++) {
    const top: Beat[] = []
    for (let q = 0; q < 4; q++) {
      const p = change(bar, q, TUNE[(bar * 4 + q) % TUNE.length] + shift - 12)
      top.push({ dur: 4, notes: p === null ? [] : [at(p)] })
    }
    const bass: Beat[] = [{ dur: 1, notes: [at(BASS[bar % 4] + shift)] }]
    s.measures.push({ voices: [top, bass] })
  }
  return s
}

describe('compareWithOriginal', () => {
  it('finds the key and passes a faithful arrangement', () => {
    const c = compareWithOriginal(arrangement(-3, (_b, _q, p) => p), original())!
    expect(c.transpose).toBe(-3)
    expect(c.ratio).toBe(1)
    expect(c.melody.found).toBe(c.melody.total)
    expect(c.stray).toEqual([])
  })

  it('lists a missing melody note and a note the original does not have', () => {
    const c = compareWithOriginal(
      arrangement(2, (bar, q, p) => (bar === 5 && q === 2 ? null : bar === 9 && q === 1 ? p + 1 : p)),
      original(),
    )!
    expect(c.transpose).toBe(2)
    const melody = c.missing.filter((m) => m.role === 'melody')
    expect(melody.some((m) => m.measure === 5 && m.beat === 2 && m.pitch % 12 === (TUNE[22 % 16] + 2) % 12)).toBe(true)
    expect(c.stray.some((s) => s.measure === 9 && s.beat === 1)).toBe(true)
    expect(c.flagged).toEqual(expect.arrayContaining([5, 9]))
  })
})

describe('scoreNotes', () => {
  it('merges tied notes', () => {
    const s = newScore('Ties', 1)
    s.measures = [{ voices: [[{ dur: 2, notes: [at(64)] }, { dur: 2, notes: [{ ...at(64), tie: true }] }]] }]
    const n = scoreNotes(s)
    expect(n).toHaveLength(1)
    expect(n[0].duration).toBe(4)
  })
})

describe('readOriginal', () => {
  it('reads MusicXML and writes out repeats', () => {
    const note = (step: string) => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>4</duration><type>whole</type></note>`
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1"><work><work-title>Little</work-title></work><part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
<part id="P1">
<measure number="1"><attributes><divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
<barline location="left"><repeat direction="forward"/></barline>${note('G')}</measure>
<measure number="2">${note('A')}<barline location="right"><repeat direction="backward"/></barline></measure>
<measure number="3">${note('B')}</measure>
</part></score-partwise>`
    const o = readOriginal(new TextEncoder().encode(xml))
    expect(o.title).toBe('Little')
    expect(o.key).toBe(1)
    expect(o.notes.map((n) => n.pitch)).toEqual([67, 69, 67, 69, 71])
    expect(o.notes.map((n) => n.measure)).toEqual([0, 1, 0, 1, 2])
    expect(o.notes[4].start).toBe(16)
  })

  it('explains a file that is not sheet music', () => {
    expect(() => readOriginal(new TextEncoder().encode('not music'))).toThrow(/MusicXML/)
  })
})
