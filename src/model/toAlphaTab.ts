import * as alphaTab from '@coderline/alphatab'
import { chordName } from './chords'
import { type Score, measureTicks, restsFor, voiceTicks } from './score'

const m = alphaTab.model

export interface RenderOptions {
  showLh: boolean
  showRh: boolean
  showStrings: boolean
  showTab: boolean
  showChords: boolean
  /** Notes to print in the warning colour, as "measure:voice:beat:string". */
  doubts?: Set<string>
}

const RH: Record<string, alphaTab.model.Fingers> = {
  p: m.Fingers.Thumb,
  i: m.Fingers.IndexFinger,
  m: m.Fingers.MiddleFinger,
  a: m.Fingers.AnnularFinger,
}
const LH = [m.Fingers.NoOrDead, m.Fingers.IndexFinger, m.Fingers.MiddleFinger, m.Fingers.AnnularFinger, m.Fingers.LittleFinger]

const DOUBT = alphaTab.model.Color.fromJson('#c2410c')

/** Build an alphaTab score (engraving + playback model) from a LuthiersPen score. */
export function toAlphaTab(score: Score, opts: RenderOptions, settings: alphaTab.Settings): alphaTab.model.Score {
  const at = new m.Score()
  at.title = score.title
  at.subTitle = score.subtitle ?? ''
  at.music = score.composer
  // Header like a printed edition: title and subtitle centred, the composer alone at the right.
  at.style = new m.ScoreStyle()
  at.style.headerAndFooter.set(m.ScoreSubElement.Music, new m.HeaderFooterStyle('%MUSIC%', true, alphaTab.platform.TextAlign.Right))
  at.style.headerAndFooter.set(m.ScoreSubElement.WordsAndMusic, new m.HeaderFooterStyle('', false))
  at.stylesheet.barNumberDisplay = m.BarNumberDisplay.FirstOfSystem

  const track = new m.Track()
  track.name = 'Guitar'
  track.shortName = ''
  track.ensureStaveCount(1)
  track.playbackInfo.program = 24 // nylon-string guitar
  track.playbackInfo.primaryChannel = 0
  track.playbackInfo.secondaryChannel = 1
  const staff = track.staves[0]
  // alphaTab lists strings from the highest to the lowest, like we do.
  staff.stringTuning = new m.Tuning('Guitar', [...score.tuning], false)
  staff.displayTranspositionPitch = -12
  staff.showTablature = opts.showTab
  staff.showStandardNotation = true
  at.addTrack(track)

  const strings = score.tuning.length
  const twoVoices = score.measures.some((x) => x.voices.length > 1)

  // Right-hand fingering the way an edition prints it: the whole figure at the start, then only
  // where a finger is not the one the string suggests (thumb on the bass, i-m-a on strings 3-2-1),
  // such as alternating fingers on one string.
  const usual = (string: number, bass: boolean) => (bass || string >= 4 ? 'p' : string === 3 ? 'i' : string === 2 ? 'm' : 'a')
  const rhShown = (mi: number, vi: number, string: number, rh: string) => mi === 0 || rh !== usual(string, vi === 1)
  // An open string is marked 0 when the same string was just stopped, so the release is not missed.
  const lastFret = new Map<number, number>()
  const openZero = new Set<string>()
  score.measures.forEach((measure, mi) =>
    measure.voices[0]?.forEach((b, bi) =>
      b.notes.forEach((n) => {
        if (n.fret === 0 && !n.tie && (lastFret.get(n.string) ?? 0) > 0) openZero.add(`${mi}:${bi}:${n.string}`)
        lastFret.set(n.string, n.fret)
      }),
    ),
  )

  score.measures.forEach((measure, mi) => {
    const mb = new m.MasterBar()
    const sig = measure.timeSig ?? score.timeSig
    mb.timeSignatureNumerator = sig[0]
    mb.timeSignatureDenominator = sig[1]
    const full = measureTicks(score, mi)
    if (mi === 0) {
      const tempo = m.Automation.buildTempoAutomation(false, 0, score.tempo, 2)
      if (score.tempoText) tempo.text = score.tempoText
      mb.tempoAutomations.push(tempo)
    }
    at.addMasterBar(mb)

    const bar = new m.Bar()
    bar.clef = m.Clef.G2
    bar.keySignature = score.key as alphaTab.model.KeySignature
    staff.addBar(bar)

    let chordId: string | null = null
    if (opts.showChords) {
      const name = chordName(score, measure)
      if (name) {
        chordId = `c:${name}`
        if (!staff.chords?.has(chordId)) {
          const chord = new m.Chord()
          chord.name = name
          chord.showDiagram = false
          chord.showFingering = false
          staff.addChord(chordId, chord)
        }
      }
    }
    const voiceCount = twoVoices ? 2 : 1
    for (let vi = 0; vi < voiceCount; vi++) {
      const voice = new m.Voice()
      bar.addVoice(voice)
      let beats = measure.voices[vi]
      if (!beats || beats.length === 0) beats = vi === 0 ? restsFor(full) : []
      // Pad a short upper voice so the bar always has its full length for playback.
      if (vi === 0 && voiceTicks(beats) < full - 1) beats = [...beats, ...restsFor(full - voiceTicks(beats))]

      if (beats.length === 0) {
        const empty = new m.Beat()
        empty.isEmpty = true
        voice.addBeat(empty)
      }
      beats.forEach((b, bi) => {
        const beat = new m.Beat()
        beat.duration = b.dur as unknown as alphaTab.model.Duration
        beat.dots = b.dots ?? 0
        if (b.tuplet) {
          beat.tupletNumerator = b.tuplet[0]
          beat.tupletDenominator = b.tuplet[1]
        }
        if (b.text) beat.text = b.text
        if (b.barre) {
          beat.barreFret = b.barre.fret
          beat.barreShape = b.barre.half ? m.BarreShape.Half : m.BarreShape.Full
        }
        if (twoVoices && b.notes.length > 0) {
          beat.preferredBeamDirection = vi === 0 ? alphaTab.rendering.BeamDirection.Up : alphaTab.rendering.BeamDirection.Down
        }
        if (chordId && vi === 0 && bi === 0) beat.chordId = chordId
        voice.addBeat(beat)
        for (const n of b.notes) {
          const note = new m.Note()
          note.fret = n.fret
          note.string = strings - n.string + 1
          if (n.tie) note.isTieDestination = true
          if (opts.showLh && n.lh) note.leftHandFinger = LH[n.lh] ?? m.Fingers.Unknown
          else if (opts.showLh && vi === 0 && openZero.has(`${mi}:${bi}:${n.string}`)) note.leftHandFinger = m.Fingers.NoOrDead
          if (opts.showRh && n.rh && rhShown(mi, vi, n.string, n.rh)) note.rightHandFinger = RH[n.rh]
          if (opts.showStrings && n.showString) note.showStringNumber = true
          if (opts.doubts?.has(`${mi}:${vi}:${bi}:${n.string}`)) {
            note.style = new m.NoteStyle()
            note.style.colors.set(m.NoteSubElement.StandardNotationNoteHead, DOUBT)
            note.style.colors.set(m.NoteSubElement.GuitarTabFretNumber, DOUBT)
          }
          beat.addNote(note)
        }
      })
    }
  })

  at.finish(settings)
  return at
}
