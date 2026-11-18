import * as alphaTab from '@coderline/alphatab'

/** One note of the original score, in the order it is played (repeats written out). */
export interface OriginalNote {
  /** Start in quarter notes from the beginning of the performance. */
  start: number
  /** Length in quarter notes. */
  duration: number
  /** Sounding MIDI pitch. */
  pitch: number
  /** Measure of the original score (0-based), as printed. */
  measure: number
}

export interface OriginalScore {
  title: string
  composer: string
  notes: OriginalNote[]
  /** Measures as printed. */
  measures: number
  /** Key signature of the first measure: sharps (positive) or flats (negative). */
  key: number
}

const QUARTER = 960

/**
 * Read an original score (MusicXML, compressed .mxl, Guitar Pro or Capella) and list every note in
 * playing order, with repeats and endings written out, across all instruments and staves.
 */
export function readOriginal(bytes: Uint8Array): OriginalScore {
  const settings = new alphaTab.Settings()
  let score: alphaTab.model.Score
  try {
    score = alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
  } catch {
    throw new Error('That file could not be read as sheet music. Use MusicXML (.musicxml, .xml or .mxl) or Guitar Pro.')
  }
  const handler = new alphaTab.midi.AlphaSynthMidiFileHandler(new alphaTab.midi.MidiFile())
  const gen = new alphaTab.midi.MidiFileGenerator(score, settings, handler)
  gen.generate()
  const notes: OriginalNote[] = []
  for (const played of gen.tickLookup.masterBars) {
    const bi = played.masterBar.index
    for (const track of score.tracks) {
      if (track.playbackInfo.isMute) continue
      for (const staff of track.staves) {
        if (staff.isPercussion) continue
        const bar = staff.bars[bi]
        if (!bar) continue
        for (const voice of bar.voices) {
          for (const beat of voice.beats) {
            if (beat.graceType !== alphaTab.model.GraceType.None) continue
            for (const n of beat.notes) {
              if (n.isTieDestination || n.isDead) continue
              // A tied note sounds until the end of its last tied partner.
              let end = beat.playbackStart + beat.playbackDuration
              let tie: alphaTab.model.Note | null = n
              let barOffset = 0
              while (tie?.tieDestination) {
                const d: alphaTab.model.Note = tie.tieDestination
                if (d.beat.voice.bar.index !== tie.beat.voice.bar.index) barOffset += tie.beat.voice.bar.masterBar.calculateDuration()
                end = barOffset + d.beat.playbackStart + d.beat.playbackDuration
                tie = d
              }
              notes.push({
                start: (played.start + beat.playbackStart) / QUARTER,
                duration: Math.max(1, end - beat.playbackStart) / QUARTER,
                pitch: n.realValue,
                measure: bi,
              })
            }
          }
        }
      }
    }
  }
  notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch)
  return {
    title: score.title,
    composer: score.artist || score.music || score.words || '',
    notes,
    measures: score.masterBars.length,
    key: score.masterBars[0]?.keySignature ?? 0,
  }
}
