import * as alphaTab from '@coderline/alphatab'
import { type Beat, type Dur, type Measure, type Note, type RhFinger, type Score, MAX_FRET, STANDARD_TUNING, restsFor, TICKS_PER_QUARTER, voiceTicks } from '../model/score'
import { type GridNote, assignFingerboard } from '../transcribe/fingering'

const m = alphaTab.model

export interface ImportResult {
  score: Score
  /** The part of the file that became the guitar part. */
  part: ImportPart
  /** Every part of the file that could be imported instead. */
  parts: ImportPart[]
  /** Things that could not be carried over, in plain words. */
  notes: string[]
}

const DURS: Dur[] = [1, 2, 4, 8, 16, 32]
const LH: Partial<Record<number, number>> = {
  [m.Fingers.NoOrDead]: 0,
  [m.Fingers.IndexFinger]: 1,
  [m.Fingers.MiddleFinger]: 2,
  [m.Fingers.AnnularFinger]: 3,
  [m.Fingers.LittleFinger]: 4,
}
const RH: Partial<Record<number, RhFinger>> = {
  [m.Fingers.Thumb]: 'p',
  [m.Fingers.IndexFinger]: 'i',
  [m.Fingers.MiddleFinger]: 'm',
  [m.Fingers.AnnularFinger]: 'a',
}

/** A note on its way into the LuthiersPen score: where it came from and where it will be played. */
interface Pending {
  src: alphaTab.model.Note
  note: Note
  pitch: number
  bass: boolean
  /** Start of its beat in ticks from the start of the piece (groups notes struck together). */
  at: number
  beat: Beat
}

/** A staff counts as guitar tablature when it carries a tuning of six (or seven) strings. */
const isGuitarStaff = (st: alphaTab.model.Staff) => !st.isPercussion && st.tuning.length >= 6 && st.tuning.length <= 7

const isGuitarTrack = (t: alphaTab.model.Track) =>
  t.staves.some(isGuitarStaff) || /guit|gtr|chitarra|gitarre|guitare/i.test(`${t.name} ${t.shortName}`) || (t.playbackInfo.program >= 24 && t.playbackInfo.program <= 31)

const noteCount = (t: alphaTab.model.Track) =>
  t.staves.reduce((s, st) => s + st.bars.reduce((b, bar) => b + bar.voices.reduce((v, voice) => v + voice.beats.reduce((n, beat) => n + beat.notes.length, 0), 0), 0), 0)

/** The parts of a file that can be imported, in file order. */
export interface ImportPart {
  index: number
  name: string
  guitar: boolean
}

function partsOf(score: alphaTab.model.Score): ImportPart[] {
  return score.tracks
    .map((t, index) => ({ t, index }))
    .filter(({ t }) => t.staves.some((s) => !s.isPercussion) && noteCount(t) > 0)
    .map(({ t, index }) => {
      const staves = t.staves.filter((s) => !s.isPercussion).length
      const name = (t.name.replace(/\u00a0/g, ' ').trim() || `Part ${index + 1}`) + (staves > 1 && !t.staves.some(isGuitarStaff) ? ' (all staves)' : '')
      return { index, name, guitar: isGuitarTrack(t) }
    })
}

/** A guitar part if there is one, otherwise the part with the most notes (the piano rather than the voice of a song). */
function defaultPart(score: alphaTab.model.Score, parts: ImportPart[]): ImportPart {
  return parts.find((p) => p.guitar) ?? parts.reduce((a, b) => (noteCount(score.tracks[b.index]) > noteCount(score.tracks[a.index]) ? b : a))
}

/** A legal LuthiersPen note value for an alphaTab one; very short values become 32nds. */
function toDur(d: alphaTab.model.Duration): { dur: Dur; lost: boolean } {
  const v = d as number
  if (DURS.includes(v as Dur)) return { dur: v as Dur, lost: false }
  return { dur: v < 1 ? 1 : 32, lost: true }
}

/** alphaTab keeps the non-breaking spaces of its text layout; a plain space is wanted for editing. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/\u00a0/g, ' ').trim()

/** A time signature that is exactly `ticks` long, for a pick-up or irregular bar. */
function sigFor(ticks: number, den: number): [number, number] {
  for (const d of [den, 4, 8, 16, 32]) {
    const unit = (TICKS_PER_QUARTER * 4) / d
    if (ticks % unit === 0 && ticks >= unit) return [ticks / unit, d]
  }
  return [Math.max(1, Math.round(ticks / 120)), 32]
}

/**
 * Read a MusicXML (.musicxml, .xml, .mxl) or Guitar Pro file and turn it into a LuthiersPen score
 * that can be edited and saved like a transcription. A guitar part keeps its strings, frets,
 * fingerings and barres; any other part is placed on the fingerboard the way a transcription is.
 * Repeats are written out, because the score model plays straight through.
 */
export function importScore(bytes: Uint8Array, fileName = '', partIndex?: number): ImportResult {
  const settings = new alphaTab.Settings()
  let at: alphaTab.model.Score
  try {
    at = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
  } catch {
    throw new Error('That file could not be read as sheet music. Use MusicXML (.musicxml, .xml or .mxl) or Guitar Pro.')
  }
  const parts = partsOf(at)
  if (parts.length === 0) throw new Error('That file has no notes to import.')
  const part = parts.find((p) => p.index === partIndex) ?? defaultPart(at, parts)
  const track = at.tracks[part.index]
  const { guitar } = part
  const staves = track.staves.filter((s) => !s.isPercussion)
  const tabStaff = staves.find(isGuitarStaff)
  // alphaTab lists strings from the lowest; LuthiersPen from the highest (string 1 = high E).
  const tuning = tabStaff ? [...tabStaff.tuning].sort((a, b) => b - a) : [...STANDARD_TUNING]
  const strings = tuning.length
  const usedStaves = tabStaff ? [tabStaff] : staves
  const warnings: string[] = []

  // Play order with repeats and endings written out, as the playback hears it.
  const gen = new alphaTab.midi.MidiFileGenerator(at, settings, new alphaTab.midi.AlphaSynthMidiFileHandler(new alphaTab.midi.MidiFile()))
  gen.generate()
  const order = gen.tickLookup.masterBars.map((p) => p.masterBar)
  if (order.length === 0) throw new Error('That file has no measures to import.')
  if (order.length > at.masterBars.length) warnings.push('Repeats are written out, so the piece plays straight through.')

  const first = at.masterBars[0]
  const firstBar = usedStaves[0].bars[0]
  const timeSig: [number, number] = [first.timeSignatureNumerator, first.timeSignatureDenominator]
  const key = (firstBar?.keySignature ?? first.keySignature) as number
  const keyMinor = (firstBar?.keySignatureType ?? first.keySignatureType) === m.KeySignatureType.Minor
  if (at.masterBars.some((mb, i) => (usedStaves[0].bars[i]?.keySignature ?? mb.keySignature) !== key)) {
    warnings.push('The key changes during the piece; LuthiersPen keeps the opening key signature.')
  }

  const pianoFingers = guitar && track.playbackInfo.program < 8
  const capo = tabStaff?.capo ?? 0
  if (capo > 0) warnings.push(`The capo at fret ${capo} is not kept: frets are as written, so playback sounds ${capo} semitone${capo === 1 ? '' : 's'} lower.`)
  const measures: Measure[] = []
  const pending: Pending[] = []
  let lostDur = false
  let extraVoices = 0
  let grace = 0
  let fromTab = 0
  let hasFingering = false
  let pieceTicks = 0

  for (const mb of order) {
    const full = mb.calculateDuration()
    const sig: [number, number] = [mb.timeSignatureNumerator, mb.timeSignatureDenominator]
    const regular = (TICKS_PER_QUARTER * 4 * sig[0]) / sig[1]
    let own: [number, number] | undefined = sig[0] !== timeSig[0] || sig[1] !== timeSig[1] ? sig : undefined
    if (full !== regular && full > 0) own = sigFor(full, sig[1])

    // The upper voice first, then the bass. On one staff that is its first two voices; across
    // staves (a piano part) the top staff's first voice and the bottom staff's. Other voices join
    // beats struck at the same time.
    const perStaff = usedStaves.map((st) => (st.bars[mb.index]?.voices ?? []).filter((v) => !v.isEmpty && v.beats.some((b) => !b.isEmpty)))
    let sources = perStaff.flat()
    if (perStaff.length > 1) {
      const top = perStaff[0][0]
      const bottom = perStaff.slice(1).reverse().find((vs) => vs.length > 0)?.[0]
      const lead = [top, bottom].filter((v): v is alphaTab.model.Voice => !!v)
      sources = [...lead, ...sources.filter((v) => !lead.includes(v))]
      // With an empty top staff the bottom staff's voice is the only one, so it is the upper voice.
    }
    const voices: Beat[][] = []
    // Starts of the kept voices' beats, so a third voice can join a beat struck at the same time.
    const starts: Array<Map<number, Beat>> = []
    sources.forEach((v, vi) => {
      const keep = vi < 2
      const out: Beat[] = []
      const byStart = new Map<number, Beat>()
      for (const b of v.beats) {
        if (b.isEmpty) continue
        if (b.graceType !== m.GraceType.None) {
          grace += b.notes.length
          continue
        }
        let target: Beat
        if (keep) {
          const d = toDur(b.duration)
          lostDur ||= d.lost
          target = { dur: d.dur, notes: [] }
          if (b.dots > 0) target.dots = Math.min(2, b.dots)
          if (b.hasTuplet && b.tupletNumerator > 0 && b.tupletDenominator > 0) target.tuplet = [b.tupletNumerator, b.tupletDenominator]
          if (b.barreFret > 0 && b.barreShape !== m.BarreShape.None) target.barre = { fret: b.barreFret, half: b.barreShape === m.BarreShape.Half }
          if (plain(b.text) && plain(b.text) !== plain(at.tempoLabel)) target.text = plain(b.text)
          out.push(target)
          byStart.set(b.playbackStart, target)
        } else {
          const joined = starts.map((s) => s.get(b.playbackStart)).find((x) => x)
          if (!joined) {
            extraVoices += b.notes.length
            continue
          }
          target = joined
        }
        for (const n of b.notes) {
          if (n.isDead) continue
          const pitch = n.realValue
          const note: Note = { string: 0, fret: 0 }
          if (tabStaff && n.isStringed && n.string >= 1 && n.string <= strings) {
            note.string = strings - n.string + 1
            note.fret = n.fret
            fromTab++
          }
          // A part without a guitar program reads MusicXML fingering 1-5 as piano fingers (1 = thumb).
          const lh = pianoFingers ? (n.leftHandFinger >= 0 && n.leftHandFinger <= 3 ? n.leftHandFinger + 1 : undefined) : LH[n.leftHandFinger]
          if (lh !== undefined) {
            if (lh > 0) note.lh = lh
            hasFingering = true
          }
          const rh = RH[n.rightHandFinger]
          if (rh) {
            note.rh = rh
            hasFingering = true
          }
          if (n.showStringNumber && n.string > 0) note.showString = true
          if (n.isTieDestination) note.tie = true
          target.notes.push(note)
          pending.push({ src: n, note, pitch, bass: false, at: pieceTicks + b.playbackStart, beat: target })
        }
      }
      if (keep) {
        // A voice of rests only: a whole-bar rest (which alphaTab writes as a whole note) or nothing.
        if (out.every((b) => b.notes.length === 0)) out.splice(0, out.length, ...(voices.length === 0 ? restsFor(full > 0 ? full : regular) : []))
        voices.push(out)
        starts.push(byStart)
      }
    })
    if (voices.length === 0) voices.push(restsFor(full > 0 ? full : regular))
    measures.push({ ...(own ? { timeSig: own } : {}), voices })
    pieceTicks += full > 0 ? full : regular
  }
  // The bass is whatever ended up in the second voice.
  const bassNotes = new Set<Note>()
  for (const ms of measures) for (const b of ms.voices[1] ?? []) for (const n of b.notes) bassNotes.add(n)
  for (const p of pending) p.bass = bassNotes.has(p.note)

  placeOnFingerboard(pending, tuning, !hasFingering && fromTab === 0)

  // Drop notes the fingerboard could not take, and empty second voices.
  for (const ms of measures) {
    for (const v of ms.voices) for (const b of v) b.notes = b.notes.filter((n) => n.string > 0)
    if (ms.voices.length > 1 && ms.voices[1].every((b) => b.notes.length === 0)) ms.voices.length = 1
    // A voice longer than its measure would play into the next one: trim from the end.
    const full = ((TICKS_PER_QUARTER * 4 * (ms.timeSig ?? timeSig)[0]) / (ms.timeSig ?? timeSig)[1])
    for (const v of ms.voices) while (v.length > 1 && voiceTicks(v) > full + 1) v.pop()
  }
  const dropped = pending.filter((p) => p.note.string === 0).length
  if (dropped) warnings.push(`${dropped} note${dropped === 1 ? '' : 's'} could not be played on the guitar together with the others and were left out.`)
  if (grace) warnings.push(`${grace} grace note${grace === 1 ? ' was' : 's were'} left out.`)
  if (extraVoices) warnings.push(`${extraVoices} note${extraVoices === 1 ? '' : 's'} in a third voice were left out.`)
  if (lostDur) warnings.push('Notes shorter than a 32nd were written as 32nds.')
  if (!guitar) warnings.push('This is not a guitar part, so LuthiersPen chose strings, frets and fingerings for it; notes outside the guitar’s range moved by an octave.')

  const base = fileName.replace(/\.[^.]+$/, '')
  const score: Score = {
    title: plain(at.title) || base || 'Imported score',
    composer: plain(at.artist || at.music || at.words),
    tempo: Math.max(20, Math.min(240, Math.round(at.tempo || 80))),
    timeSig,
    key: Math.max(-7, Math.min(7, key)),
    tuning,
    measures,
  }
  if (plain(at.subTitle)) score.subtitle = plain(at.subTitle)
  if (plain(at.tempoLabel)) score.tempoText = plain(at.tempoLabel)
  if (keyMinor) score.keyMinor = true
  return { score, part, parts, notes: warnings }
}

/**
 * Give every note without a tab position a string and fret. Notes outside the guitar's range move
 * by whole octaves (the whole part first, if it sits an octave off, then single notes).
 * When the file carries no fingering at all, add the fingerings and marks a transcription gets.
 */
function placeOnFingerboard(pending: Pending[], tuning: number[], addFingering: boolean) {
  const lo = Math.min(...tuning)
  const hi = Math.max(...tuning) + MAX_FRET
  const free = pending.filter((p) => p.note.string === 0)
  if (free.length === 0) return
  // Shift the whole part by the octave that puts most of it where the guitar plays comfortably (up to
  // the 12th fret of the top string). Piano and voice parts usually come down an octave.
  const comfortable = Math.max(...tuning) + 12
  let best = 0
  let bestIn = -1
  for (const k of [0, -12, 12, -24, 24]) {
    const inside = free.filter((p) => p.pitch + k >= lo && p.pitch + k <= comfortable).length
    if (inside > bestIn) {
      best = k
      bestIn = inside
    }
  }
  const grid: GridNote[] = []
  const owner = new Map<GridNote, Pending>()
  for (const p of free) {
    let pitch = p.pitch + best
    while (pitch < lo) pitch += 12
    while (pitch > hi) pitch -= 12
    const g: GridNote = { step: p.at, end: p.at + 1, pitch, amplitude: p.bass ? 1 : 0.9, bass: p.bass, string: 0, fret: 0 }
    grid.push(g)
    owner.set(g, p)
  }
  // Two notes of one beat on the same pitch (unison in two voices) need only one string.
  const seen = new Set<string>()
  const unique = grid.filter((g) => {
    const k = `${g.step}:${g.pitch}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  // Tab notes already struck at the same time keep their strings: assign the rest around them.
  const taken = new Map<number, Set<number>>()
  for (const p of pending) if (p.note.string > 0) (taken.get(p.at) ?? taken.set(p.at, new Set()).get(p.at)!).add(p.note.string)

  const { notes, marks } = assignFingerboard(unique, tuning)
  const placed = new Map<string, GridNote>()
  for (const g of notes) placed.set(`${g.step}:${g.pitch}`, g)
  for (const g of grid) {
    const p = owner.get(g)!
    const at = placed.get(`${g.step}:${g.pitch}`)
    if (!at || taken.get(p.at)?.has(at.string)) continue
    p.note.string = at.string
    p.note.fret = at.fret
    if (addFingering) {
      if (at.lh && !p.note.tie) p.note.lh = at.lh
      if (at.rh) p.note.rh = at.rh
      if (at.showString && !p.note.tie) p.note.showString = true
    }
  }
  // A tied note stays on the string of the note it continues.
  const last = new Map<alphaTab.model.Note, Note>()
  for (const p of pending) {
    const origin = p.src.tieOrigin
    const from = origin ? last.get(origin) : undefined
    if (p.note.tie && from && from.string > 0) {
      p.note.string = from.string
      p.note.fret = from.fret
    }
    last.set(p.src, p.note)
  }
  if (addFingering && marks.length) {
    // Barre and position marks belong to the first beat struck at their time.
    const beatAt = new Map<number, Beat>()
    for (const p of pending) if (!beatAt.has(p.at)) beatAt.set(p.at, p.beat)
    for (const mk of marks) {
      const b = beatAt.get(mk.step)
      if (!b) continue
      if (mk.barre && !b.barre) b.barre = mk.barre
      if (mk.text && !b.text) b.text = mk.text
    }
  }
}
