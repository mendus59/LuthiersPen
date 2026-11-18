import { describe, expect, it } from 'vitest'
import { notePitch, voiceTicks, measureTicks } from '../model/score'
import { importScore } from './importScore'

const enc = (s: string) => new TextEncoder().encode(s)

const head = (part: string, attrs: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>Study in A minor</work-title></work>
  <identification><creator type="composer">F. Sor</creator></identification>
  <part-list><score-part id="P1"><part-name>${part}</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>${attrs}</attributes>
      <direction placement="above"><direction-type><words>Andante</words></direction-type><sound tempo="72"/></direction>`

const TAB_ATTRS = `<divisions>2</divisions><key><fifths>0</fifths><mode>minor</mode></key><time><beats>3</beats><beat-type>4</beat-type></time>
  <clef><sign>TAB</sign><line>5</line></clef>
  <staff-details><staff-lines>6</staff-lines>
    <staff-tuning line="1"><tuning-step>E</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
    <staff-tuning line="2"><tuning-step>A</tuning-step><tuning-octave>2</tuning-octave></staff-tuning>
    <staff-tuning line="3"><tuning-step>D</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
    <staff-tuning line="4"><tuning-step>G</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
    <staff-tuning line="5"><tuning-step>B</tuning-step><tuning-octave>3</tuning-octave></staff-tuning>
    <staff-tuning line="6"><tuning-step>E</tuning-step><tuning-octave>4</tuning-octave></staff-tuning>
  </staff-details>`

const tabNote = (step: string, octave: number, string: number, fret: number, opts: { chord?: boolean; voice?: number; type?: string; dur?: number; finger?: number; pluck?: string; tieStop?: boolean; tieStart?: boolean; alter?: number } = {}) =>
  `<note>${opts.chord ? '<chord/>' : ''}<pitch><step>${step}</step>${opts.alter ? `<alter>${opts.alter}</alter>` : ''}<octave>${octave}</octave></pitch>
    <duration>${opts.dur ?? 2}</duration>${opts.tieStop ? '<tie type="stop"/>' : ''}${opts.tieStart ? '<tie type="start"/>' : ''}<voice>${opts.voice ?? 1}</voice><type>${opts.type ?? 'quarter'}</type>
    <notations>${opts.tieStop ? '<tied type="stop"/>' : ''}${opts.tieStart ? '<tied type="start"/>' : ''}<technical><string>${string}</string><fret>${fret}</fret>${opts.finger !== undefined ? `<fingering>${opts.finger}</fingering>` : ''}${opts.pluck ? `<pluck>${opts.pluck}</pluck>` : ''}</technical></notations></note>`

/** Two bars of 3/4 tab: melody over a bass, with fingering and a tie into bar 2, then a repeat. */
const GUITAR_TAB = `${head('Guitar', TAB_ATTRS)}
      <barline location="left"><repeat direction="forward"/></barline>
      ${tabNote('E', 4, 1, 0, { pluck: 'a' })}
      ${tabNote('C', 4, 2, 1, { finger: 1, pluck: 'm' })}
      ${tabNote('B', 3, 2, 0, { tieStart: true })}
      <backup><duration>6</duration></backup>
      ${tabNote('A', 2, 5, 0, { voice: 2, type: 'half', dur: 6, pluck: 'p' }).replace('<type>half</type>', '<type>half</type><dot/>')}
    </measure>
    <measure number="2">
      ${tabNote('B', 3, 2, 0, { tieStop: true })}
      ${tabNote('G', 3, 3, 1, { alter: 1, finger: 1 })}
      ${tabNote('A', 3, 3, 2, { finger: 2 })}
      <backup><duration>6</duration></backup>
      ${tabNote('E', 2, 6, 0, { voice: 2, type: 'half', dur: 6 }).replace('<type>half</type>', '<type>half</type><dot/>')}
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
  </part>
</score-partwise>`

const pitchNote = (step: string, octave: number, dur: number, type: string, opts: { chord?: boolean; staff?: number; voice?: number } = {}) =>
  `<note>${opts.chord ? '<chord/>' : ''}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${dur}</duration><voice>${opts.voice ?? 1}</voice><type>${type}</type>${opts.staff ? `<staff>${opts.staff}</staff>` : ''}</note>`

/** A piano part in G major: a right-hand tune (partly too high for the guitar) over a left-hand bass. */
const PIANO = `${head('Piano', `<divisions>1</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><staves>2</staves><clef number="1"><sign>G</sign><line>2</line></clef><clef number="2"><sign>F</sign><line>4</line></clef>`)}
      ${pitchNote('G', 5, 1, 'quarter', { staff: 1 })}
      ${pitchNote('A', 5, 1, 'quarter', { staff: 1 })}
      ${pitchNote('B', 5, 1, 'quarter', { staff: 1 })}
      ${pitchNote('D', 6, 1, 'quarter', { staff: 1 })}
      <backup><duration>4</duration></backup>
      ${pitchNote('G', 2, 4, 'whole', { staff: 2, voice: 5 })}
      ${pitchNote('D', 3, 4, 'whole', { staff: 2, voice: 5, chord: true })}
    </measure>
  </part>
</score-partwise>`

describe('importScore', () => {
  it('keeps the strings, frets, fingering, key, time and tempo of a guitar tab part', () => {
    const { score, part } = importScore(enc(GUITAR_TAB), 'study.musicxml')
    expect(part.name).toBe('Guitar')
    expect(score.title).toBe('Study in A minor')
    expect(score.composer).toBe('F. Sor')
    expect(score.tempo).toBe(72)
    expect(score.timeSig).toEqual([3, 4])
    expect(score.key).toBe(0)
    expect(score.keyMinor).toBe(true)
    expect(score.tuning).toEqual([64, 59, 55, 50, 45, 40])
    // The repeat is written out: 2 bars played twice.
    expect(score.measures).toHaveLength(4)
    const [m1, m2] = score.measures
    expect(m1.voices).toHaveLength(2)
    expect(m1.voices[0].map((b) => b.notes[0])).toEqual([
      { string: 1, fret: 0, rh: 'a' },
      { string: 2, fret: 1, lh: 1, rh: 'm' },
      { string: 2, fret: 0 },
    ])
    expect(m1.voices[1]).toEqual([{ dur: 2, dots: 1, notes: [{ string: 5, fret: 0, rh: 'p' }] }])
    expect(m2.voices[0][0].notes[0]).toEqual({ string: 2, fret: 0, tie: true })
    expect(m2.voices[0][1].notes[0]).toMatchObject({ string: 3, fret: 1, lh: 1 })
    expect(notePitch(score, m2.voices[0][1].notes[0])).toBe(56) // G#3
    for (const [mi, ms] of score.measures.entries()) for (const v of ms.voices) expect(voiceTicks(v)).toBe(measureTicks(score, mi))
  })

  it('places a piano part on the fingerboard, bass in the second voice, octaves folded into range', () => {
    const { score, notes } = importScore(enc(PIANO), 'tune.xml')
    expect(score.key).toBe(1)
    expect(score.measures).toHaveLength(1)
    const [upper, bass] = score.measures[0].voices
    const pitches = upper.map((b) => b.notes.map((n) => notePitch(score, n)))
    // The right hand comes down an octave into the guitar's comfortable range; the low G2 and D3 fold back up.
    expect(pitches).toEqual([[67], [69], [71], [74]])
    expect(bass[0].notes.map((n) => notePitch(score, n)).sort()).toEqual([43, 50])
    // Fingering is added like a transcription's, since the file has none.
    expect(upper.some((b) => b.notes.some((n) => n.rh))).toBe(true)
    expect(notes.some((n) => /not a guitar part/.test(n))).toBe(true)
  })

  it('refuses a file that is not sheet music', () => {
    expect(() => importScore(enc('hello'), 'x.txt')).toThrow(/could not be read/)
  })
})
