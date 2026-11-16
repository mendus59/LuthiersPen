import {
  type Beat, type Dur, MAX_FRET, type Note, type RhFinger, type Score,
  cloneScore, emptyMeasure, measureTicks, notePitch, positionsFor, restsFor, voiceTicks,
} from './score'

/** What is selected in the editor: a beat, and optionally one note in it (by string). */
export interface Selection {
  m: number
  v: number
  b: number
  string?: number
}

export interface Edit {
  score: Score
  sel: Selection
}

const voiceOf = (s: Score, sel: Selection): Beat[] => s.measures[sel.m]?.voices[sel.v] ?? []
const beatOf = (s: Score, sel: Selection): Beat | undefined => voiceOf(s, sel)[sel.b]
const noteOf = (s: Score, sel: Selection): Note | undefined => beatOf(s, sel)?.notes.find((n) => n.string === sel.string)

/** Apply a change to a copy of the score. Returns null when the selection points at nothing. */
function change(score: Score, sel: Selection, fn: (s: Score, beat: Beat, note: Note | undefined) => Selection | void): Edit | null {
  const s = cloneScore(score)
  const beat = beatOf(s, sel)
  if (!beat) return null
  const next = fn(s, beat, noteOf(s, sel))
  return { score: s, sel: next ?? sel }
}

export function setDuration(score: Score, sel: Selection, dur: Dur): Edit | null {
  return change(score, sel, (_s, beat) => {
    beat.dur = dur
    delete beat.dots
  })
}

export function toggleDot(score: Score, sel: Selection): Edit | null {
  return change(score, sel, (_s, beat) => {
    if (beat.dots) delete beat.dots
    else beat.dots = 1
  })
}

export function toggleTriplet(score: Score, sel: Selection): Edit | null {
  return change(score, sel, (_s, beat) => {
    if (beat.tuplet) delete beat.tuplet
    else beat.tuplet = [3, 2]
  })
}

/** Add a note of the given sounding pitch to the selected beat, on the most comfortable free string. */
export function addPitch(score: Score, sel: Selection, pitch: number): Edit | null {
  return change(score, sel, (s, beat) => {
    const used = new Set(beat.notes.map((n) => n.string))
    const fretted = beat.notes.filter((n) => n.fret > 0).map((n) => n.fret)
    const near = fretted.length ? Math.min(...fretted) : 0
    const options = positionsFor(s.tuning, pitch).filter((p) => !used.has(p.string))
    if (options.length === 0) return
    options.sort((a, b) => Math.abs(a.fret - near) - Math.abs(b.fret - near) || a.fret - b.fret)
    const place = near ? options[0] : positionsFor(s.tuning, pitch).filter((p) => !used.has(p.string))[0]
    beat.notes.push({ string: place.string, fret: place.fret })
    beat.notes.sort((a, b) => b.string - a.string)
    return { ...sel, string: place.string }
  })
}

/** Set the fret on a string of the selected beat (tab-style entry). */
export function setFret(score: Score, sel: Selection, string: number, fret: number): Edit | null {
  if (fret < 0 || fret > MAX_FRET) return null
  return change(score, sel, (_s, beat) => {
    const existing = beat.notes.find((n) => n.string === string)
    if (existing) existing.fret = fret
    else beat.notes.push({ string, fret })
    beat.notes.sort((a, b) => b.string - a.string)
    return { ...sel, string }
  })
}

export function removeNote(score: Score, sel: Selection): Edit | null {
  return change(score, sel, (_s, beat) => {
    if (sel.string) beat.notes = beat.notes.filter((n) => n.string !== sel.string)
    else beat.notes = []
    return { m: sel.m, v: sel.v, b: sel.b, string: beat.notes[0]?.string }
  })
}

/** Move the selected note (or every note of the beat) by semitones. */
export function transpose(score: Score, sel: Selection, semitones: number): Edit | null {
  return change(score, sel, (s, beat, note) => {
    const targets = note ? [note] : beat.notes
    let selected = sel.string
    for (const n of targets) {
      const pitch = notePitch(s, n) + semitones
      const fret = n.fret + semitones
      if (fret >= 0 && fret <= MAX_FRET) {
        n.fret = fret
      } else {
        const used = new Set(beat.notes.filter((x) => x !== n).map((x) => x.string))
        const place = positionsFor(s.tuning, pitch).find((p) => !used.has(p.string))
        if (!place) continue
        if (selected === n.string) selected = place.string
        n.string = place.string
        n.fret = place.fret
      }
      delete n.lh
    }
    beat.notes.sort((a, b) => b.string - a.string)
    return { ...sel, string: selected }
  })
}

/** Play the same pitch on a neighbouring string (dir +1 = towards the bass strings). */
export function moveString(score: Score, sel: Selection, dir: 1 | -1): Edit | null {
  return change(score, sel, (s, beat, note) => {
    if (!note) return
    const target = note.string + dir
    if (target < 1 || target > s.tuning.length || beat.notes.some((n) => n.string === target)) return
    const fret = notePitch(s, note) - s.tuning[target - 1]
    if (fret < 0 || fret > MAX_FRET) return
    note.string = target
    note.fret = fret
    delete note.lh
    beat.notes.sort((a, b) => b.string - a.string)
    return { ...sel, string: target }
  })
}

export function setLh(score: Score, sel: Selection, finger: number): Edit | null {
  return change(score, sel, (_s, _b, note) => {
    if (!note) return
    if (note.lh === finger || finger === 0) delete note.lh
    else note.lh = finger
  })
}

export function setRh(score: Score, sel: Selection, finger: RhFinger): Edit | null {
  return change(score, sel, (_s, _b, note) => {
    if (!note) return
    if (note.rh === finger) delete note.rh
    else note.rh = finger
  })
}

export function toggleStringNumber(score: Score, sel: Selection): Edit | null {
  return change(score, sel, (_s, _b, note) => {
    if (!note) return
    if (note.showString) delete note.showString
    else note.showString = true
  })
}

export function toggleTie(score: Score, sel: Selection): Edit | null {
  return change(score, sel, (_s, beat, note) => {
    for (const n of note ? [note] : beat.notes) {
      if (n.tie) delete n.tie
      else n.tie = true
    }
  })
}

export function setBarre(score: Score, sel: Selection, fret: number, half: boolean): Edit | null {
  return change(score, sel, (_s, beat) => {
    if (fret <= 0) delete beat.barre
    else beat.barre = half ? { fret, half } : { fret }
  })
}

export function setText(score: Score, sel: Selection, text: string): Edit | null {
  return change(score, sel, (_s, beat) => {
    if (text) beat.text = text
    else delete beat.text
  })
}

export function insertBeat(score: Score, sel: Selection): Edit | null {
  const s = cloneScore(score)
  const voice = voiceOf(s, sel)
  const cur = voice[sel.b]
  if (!s.measures[sel.m]) return null
  const beat: Beat = { dur: cur?.dur ?? 4, notes: [] }
  voice.splice(sel.b + 1, 0, beat)
  return { score: s, sel: { m: sel.m, v: sel.v, b: Math.min(sel.b + 1, voice.length - 1) } }
}

export function deleteBeat(score: Score, sel: Selection): Edit | null {
  const s = cloneScore(score)
  const voice = voiceOf(s, sel)
  if (voice.length <= 1) return null
  voice.splice(sel.b, 1)
  return { score: s, sel: { m: sel.m, v: sel.v, b: Math.min(sel.b, voice.length - 1) } }
}

export function addMeasure(score: Score, after: number): Edit {
  const s = cloneScore(score)
  const m = emptyMeasure(s)
  if (s.measures.some((x) => x.voices.length > 1)) m.voices.push(restsFor(measureTicks(s)))
  s.measures.splice(after + 1, 0, m)
  return { score: s, sel: { m: after + 1, v: 0, b: 0 } }
}

export function deleteMeasure(score: Score, index: number): Edit | null {
  if (score.measures.length <= 1) return null
  const s = cloneScore(score)
  s.measures.splice(index, 1)
  return { score: s, sel: { m: Math.min(index, s.measures.length - 1), v: 0, b: 0 } }
}

/**
 * Give one measure its own time signature (a 2/4 bar inside 4/4), or the score's again when it is
 * the same; its voices are fitted to the new length.
 */
export function setMeasureTimeSig(score: Score, index: number, sig: [number, number]): Edit | null {
  if (!score.measures[index]) return null
  const s = cloneScore(score)
  const m = s.measures[index]
  if (sig[0] === s.timeSig[0] && sig[1] === s.timeSig[1]) delete m.timeSig
  else m.timeSig = sig
  m.voices.forEach((_, v) => {
    const fitted = fitMeasure(s, { m: index, v, b: 0 })
    if (fitted) s.measures[index] = fitted.score.measures[index]
  })
  return { score: s, sel: { m: index, v: 0, b: 0 } }
}

/** Make sure every measure has a bass voice, so notes can be written stems-down. */
export function ensureSecondVoice(score: Score): Score {
  const s = cloneScore(score)
  s.measures.forEach((m, mi) => {
    if (m.voices.length < 2 || m.voices[1].length === 0) m.voices[1] = restsFor(measureTicks(s, mi))
  })
  return s
}

/** Fill the rest of a voice with rests, or trim trailing rests, so it matches the time signature. */
export function fitMeasure(score: Score, sel: Selection): Edit | null {
  const s = cloneScore(score)
  const voice = voiceOf(s, sel)
  if (!s.measures[sel.m]) return null
  const full = measureTicks(s, sel.m)
  while (voice.length > 1 && voiceTicks(voice) > full && voice[voice.length - 1].notes.length === 0) voice.pop()
  const have = voiceTicks(voice)
  if (have < full) voice.push(...restsFor(full - have))
  return { score: s, sel: { ...sel, b: Math.min(sel.b, voice.length - 1) } }
}

/** How a voice compares with the time signature: 0 = exact, negative = short, positive = too long (in ticks). */
export function measureBalance(score: Score, sel: Selection): number {
  return voiceTicks(voiceOf(score, sel)) - measureTicks(score, sel.m)
}

export function selectedBeat(score: Score, sel: Selection | null): Beat | undefined {
  return sel ? beatOf(score, sel) : undefined
}

export function selectedNote(score: Score, sel: Selection | null): Note | undefined {
  return sel ? noteOf(score, sel) : undefined
}

/** Step the selection to the next/previous beat, crossing barlines. */
export function stepSelection(score: Score, sel: Selection, dir: 1 | -1): Selection {
  let { m, b } = sel
  const v = sel.v
  b += dir
  if (b < 0) {
    if (m === 0) return sel
    m--
    b = Math.max(0, (score.measures[m].voices[v]?.length ?? 1) - 1)
  } else if (b >= (score.measures[m].voices[v]?.length ?? 0)) {
    if (m >= score.measures.length - 1) return sel
    m++
    b = 0
  }
  return { m, v: score.measures[m].voices[v] ? v : 0, b, string: score.measures[m].voices[v]?.[b]?.notes[0]?.string }
}
