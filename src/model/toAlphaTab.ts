import * as alphaTab from '@coderline/alphatab'
import { type Score, measureTicks, restsFor, voiceTicks } from './score'

const m = alphaTab.model

export interface RenderOptions {
  showLh: boolean
  showRh: boolean
  showStrings: boolean
  showTab: boolean
  /** Notes to print in the warning colour, as "measure:voice:beat:string". */
  doubts?: Set<string>
}

const RH: Record<string, alphaTab.model.Fingers> = {
  p: m.Fingers.Thumb,
  i: m.Fingers.IndexFinger,
  m: m.Fingers.MiddleFinger,
  a: m.Fingers.AnnularFinger,
}
const LH = [m.Fingers.Unknown, m.Fingers.IndexFinger, m.Fingers.MiddleFinger, m.Fingers.AnnularFinger, m.Fingers.LittleFinger]

const DOUBT = alphaTab.model.Color.fromJson('#c2410c')

/** Build an alphaTab score (engraving + playback model) from a LuthiersPen score. */
export function toAlphaTab(score: Score, opts: RenderOptions, settings: alphaTab.Settings): alphaTab.model.Score {
  const at = new m.Score()
  at.title = score.title
  at.music = score.composer

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
  const full = measureTicks(score)

  score.measures.forEach((measure, mi) => {
    const mb = new m.MasterBar()
    mb.timeSignatureNumerator = score.timeSig[0]
    mb.timeSignatureDenominator = score.timeSig[1]
    if (mi === 0) mb.tempoAutomations.push(m.Automation.buildTempoAutomation(false, 0, score.tempo, 2))
    at.addMasterBar(mb)

    const bar = new m.Bar()
    bar.clef = m.Clef.G2
    bar.keySignature = score.key as alphaTab.model.KeySignature
    staff.addBar(bar)

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
        voice.addBeat(beat)
        for (const n of b.notes) {
          const note = new m.Note()
          note.fret = n.fret
          note.string = strings - n.string + 1
          if (n.tie) note.isTieDestination = true
          if (opts.showLh && n.lh) note.leftHandFinger = LH[n.lh] ?? m.Fingers.Unknown
          if (opts.showRh && n.rh) note.rightHandFinger = RH[n.rh]
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
