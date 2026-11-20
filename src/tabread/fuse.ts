import type { NoteEvent } from '../transcribe/types'
import { tabPitch, type TabNote } from './read'
import type { TabSheet } from './sheet'

/** Tunings a lesson may use; the one under which the tab agrees best with the sound is taken. */
export const TUNINGS: Array<{ name: string; strings: number[] }> = [
  { name: 'standard', strings: [64, 59, 55, 50, 45, 40] },
  { name: 'drop D', strings: [64, 59, 55, 50, 45, 38] },
  { name: 'double drop D', strings: [62, 59, 55, 50, 45, 38] },
  { name: 'DADGAD', strings: [62, 57, 55, 50, 45, 38] },
]

export interface Fusion {
  /** The notes to write: the tab's notes, timed by the recording, plus what the tab leaves out that was clearly played. */
  events: NoteEvent[]
  /** When each bar of the tab began, in the order the bars were played (repeats included). */
  downs: number[]
  tuning: number[]
  tuningName: string
  /** Share of the recording's clear notes that the tab accounts for. */
  agreement: number
  /** Tab chords matched to the recording. */
  matched: number
}

interface Chord {
  pitches: number[]
  notes: TabNote[]
  bar: number
  first: boolean
}

interface Group {
  t: number
  /** Candidate indices. */
  items: number[]
  /** The most likely candidate of each pitch. */
  best: Map<number, number>
}

/** Candidates below this chance are not worth lining up with the tab. */
const LISTEN = 0.1
/** Candidates starting this close together are one pluck. */
const TOGETHER = 0.05
/** A candidate at least this likely is a note the recording clearly has. */
const CLEAR = 0.35
/** Leaving out tab chords in a row, and starting again from another bar (a repeat), cost this. */
const SKIP = 1.2
const JUMP = 3
/** A note heard where the tab has none is still written when its chance is at least this. */
const EXTRA_IN_CHORD = 0.92
const EXTRA_BETWEEN = 0.6
/**
 * A tab note is written where the recording has at least this much sign of it. (Writing tab notes
 * the detector did not hear at all, or heard only a moment off, added more wrong notes than right.)
 */
const WEAK = 0.15
/** Below this agreement the tab is not of this recording (or not of this part of it). */
export const MIN_AGREEMENT = 0.5

function groupsOf(cands: NoteEvent[], chances: number[]): Group[] {
  const order = cands.map((_, i) => i).filter((i) => chances[i] >= LISTEN).sort((a, b) => cands[a].start - cands[b].start)
  const groups: Group[] = []
  for (const i of order) {
    let g = groups[groups.length - 1]
    if (!g || cands[i].start - g.t > TOGETHER) {
      g = { t: cands[i].start, items: [], best: new Map() }
      groups.push(g)
    }
    g.items.push(i)
    const p = Math.round(cands[i].pitch)
    const old = g.best.get(p)
    if (old === undefined || chances[i] > chances[old]) g.best.set(p, i)
  }
  return groups
}

function chordsOf(sheet: TabSheet, tuning: number[]): Chord[] {
  const out: Chord[] = []
  sheet.bars.forEach((bar, bi) =>
    bar.forEach((c, ci) => out.push({ pitches: c.notes.map((n) => tabPitch(tuning, n)), notes: c.notes, bar: bi, first: ci === 0 })),
  )
  return out
}

interface Path {
  score: number
  /** For each group, the chord it plays, or -1. */
  chordOf: Int32Array
  /** The group plays the rest of the chord the group before it began (an arpeggiated chord). */
  again: Uint8Array
}

/**
 * Line the recording up with the tab: each pluck (group of candidates starting together) either
 * plays the next chord of the tab, or one a little further on (the player left some out), or the
 * first chord of another bar (a repeat, or a jump), or none (a note the tab does not have). The
 * best path is found by dynamic programming; a chord scores by the tab notes the recording has,
 * less the tab notes it lacks and the clear notes it has that the tab does not.
 */
function align(groups: Group[], chances: number[], chords: Chord[]): Path {
  const G = groups.length
  const J = chords.length
  const NEG = -1e9
  const match = (g: Group, j: number, again: boolean): number => {
    const c = chords[j]
    let s = 0
    let hit = 0
    for (const p of c.pitches) {
      const i = g.best.get(p)
      if (i !== undefined) {
        s += 0.5 + chances[i]
        hit++
      } else if (!again) s -= 0.4
    }
    if (!hit) return NEG
    for (const [p, i] of g.best) if (chances[i] >= CLEAR && !c.pitches.includes(p)) s -= 0.6 * chances[i]
    return again ? s - 0.3 : s
  }
  const idle = (g: Group): number => {
    let s = 0.02
    for (const i of g.best.values()) if (chances[i] >= CLEAR) s += 0.5 * chances[i]
    return s
  }
  const starts = chords.map((c) => c.first)
  let f = new Float64Array(J).fill(NEG)
  let pre = 0
  // How each (group, chord) state was reached: the chord before, or -1 from the start, -2 for a group left out.
  const from = new Int32Array(G * J).fill(-3)
  for (let g = 0; g < G; g++) {
    const grp = groups[g]
    const cost = idle(grp)
    let top = NEG
    let topAt = -1
    for (let j = 0; j < J; j++) if (f[j] > top) {
      top = f[j]
      topAt = j
    }
    const nf = new Float64Array(J).fill(NEG)
    for (let j = 0; j < J; j++) {
      // Left out: the last chord stays j.
      let best = f[j] - cost
      let src = -2
      const m = match(grp, j, false)
      if (m > NEG / 2) {
        for (let k = 1; k <= 3; k++) {
          if (j - k < 0) break
          const v = f[j - k] - SKIP * (k - 1) + m
          if (v > best) {
            best = v
            src = j - k
          }
        }
        if (starts[j]) {
          if (topAt >= 0 && top - JUMP + m > best) {
            best = top - JUMP + m
            src = topAt
          }
          const v = pre - (j === 0 ? 0 : JUMP / 2) + m
          if (v > best) {
            best = v
            src = -1
          }
        }
      }
      // The same chord, its notes spread over two plucks (an arpeggiated chord).
      const again = match(grp, j, true)
      if (again > NEG / 2 && f[j] + again > best) {
        best = f[j] + again
        src = J + j
      }
      nf[j] = best
      from[g * J + j] = src
    }
    pre -= cost
    f = nf
  }
  let end = -1
  let score = pre
  for (let j = 0; j < J; j++) if (f[j] > score) {
    score = f[j]
    end = j
  }
  const chordOf = new Int32Array(G).fill(-1)
  const again = new Uint8Array(G)
  let j = end
  for (let g = G - 1; g >= 0 && j >= 0; g--) {
    const src = from[g * J + j]
    if (src === -2) continue
    chordOf[g] = j
    if (src >= J) {
      again[g] = 1
      continue
    }
    j = src
  }
  return { score, chordOf, again }
}

/**
 * Join what a video's tab says with what its sound says. The tab is right about which notes
 * there are and where they are played; the recording is right about when, and about what the
 * player did differently. Each tab chord the player is heard playing is written with the tab's
 * notes, strings and frets, at the time it was heard, down to notes heard only faintly;
 * a note the tab does not have is kept only when it was heard clearly; the bars of the tab give
 * the barlines. Returns null when the tab does not fit the recording.
 */
export function fuseTab(cands: NoteEvent[], chances: number[], sheet: TabSheet): Fusion | null {
  if (!sheet.bars.length || !cands.length) return null
  const groups = groupsOf(cands, chances)
  if (!groups.length) return null
  let pick: { tuning: (typeof TUNINGS)[number]; chords: Chord[]; path: Path } | null = null
  for (const tuning of TUNINGS) {
    const chords = chordsOf(sheet, tuning.strings)
    const path = align(groups, chances, chords)
    if (!pick || path.score > pick.path.score) pick = { tuning, chords, path }
  }
  const { chords, path } = pick!
  // How much of what was clearly heard the tab explains.
  let clear = 0
  let explained = 0
  groups.forEach((g, gi) => {
    const j = path.chordOf[gi]
    for (const [p, i] of g.best) {
      if (chances[i] < CLEAR) continue
      clear++
      if (j >= 0 && chords[j].pitches.includes(p)) explained++
    }
  })
  const agreement = clear ? explained / clear : 0
  if (agreement < MIN_AGREEMENT) return null

  const chosen = new Float64Array(cands.length)
  const place = new Map<number, TabNote>()
  groups.forEach((g, gi) => {
    const j = path.chordOf[gi]
    if (j < 0) {
      for (const i of g.items) if (chances[i] >= EXTRA_BETWEEN) chosen[i] = chances[i]
      return
    }
    const c = chords[j]
    const wanted = new Set(c.pitches)
    c.pitches.forEach((p, k) => {
      const i = g.best.get(p)
      if (i === undefined || chances[i] < WEAK) return
      chosen[i] = 1
      place.set(i, c.notes[k])
    })
    for (const i of g.items) if (!wanted.has(Math.round(cands[i].pitch)) && chances[i] >= EXTRA_IN_CHORD) chosen[i] = chances[i]
  })
  const all: NoteEvent[] = []
  const allChance: number[] = []
  cands.forEach((c, i) => {
    const n: NoteEvent = { start: c.start, duration: c.duration, pitch: c.pitch, amplitude: c.amplitude }
    const at = place.get(i)
    if (at && !at.harmonic) {
      n.string = at.string
      n.fret = at.fret
    }
    all.push(n)
    allChance.push(chosen[i])
  })
  const kept = keepChosen(all, allChance)

  // Bars in the order played: a new one starts where the path moves into another bar, or back
  // into the same one. Its downbeat is the time of its first chord, or worked out from its
  // neighbours when that chord was not heard.
  const occ: Array<{ bar: number; t: number | null }> = []
  let lastChord = -1
  groups.forEach((g, gi) => {
    const j = path.chordOf[gi]
    if (j < 0 || j === lastChord) return
    const bar = chords[j].bar
    const prev = lastChord >= 0 ? chords[lastChord].bar : -1
    if (bar !== prev || j < lastChord) {
      // A bar or two passed over (not heard) are counted too, so the barlines stay in step; a longer
      // leap is a jump to another part of the tab.
      if (prev >= 0 && bar > prev + 1 && bar <= prev + 3 && j > lastChord) for (let b = prev + 1; b < bar; b++) occ.push({ bar: b, t: null })
      occ.push({ bar, t: chords[j].first ? g.t : null })
    }
    lastChord = j
  })
  const downs = fillTimes(occ.map((o) => o.t))
  return { events: kept, downs, tuning: [...pick!.tuning.strings], tuningName: pick!.tuning.name, agreement, matched: new Set(path.chordOf).size - 1 }
}

/** The chosen notes, with one pluck reported twice merged and a ringing note left to ring. */
function keepChosen(cands: NoteEvent[], chances: number[]): NoteEvent[] {
  const order = cands.map((_, i) => i).sort((a, b) => cands[a].start - cands[b].start)
  const last = new Map<number, NoteEvent>()
  const kept: NoteEvent[] = []
  for (const i of order) {
    const c = cands[i]
    const p = Math.round(c.pitch)
    const before = last.get(p)
    if (!chances[i]) {
      if (before && c.start - (before.start + before.duration) < 0.12) before.duration = Math.max(before.duration, c.start + c.duration - before.start)
      continue
    }
    if (before && c.start - before.start <= 0.1) {
      before.duration = Math.max(before.start + before.duration, c.start + c.duration) - before.start
      if (c.string && !before.string) {
        before.string = c.string
        before.fret = c.fret
      }
      continue
    }
    const n = { ...c, pitch: p }
    kept.push(n)
    last.set(p, n)
  }
  return kept
}

/** Fill unknown times by straight lines between the known ones (and beyond them at the nearest pace). */
function fillTimes(ts: Array<number | null>): number[] {
  const known = ts.map((t, i) => [i, t] as const).filter(([, t]) => t !== null) as Array<readonly [number, number]>
  if (!known.length) return []
  const out: number[] = []
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i]
    if (t !== null) {
      out.push(t)
      continue
    }
    let k = known.findIndex(([q]) => q > i)
    if (k <= 0) k = k === 0 ? 1 : known.length - 1
    if (known.length < 2) {
      out.push(known[0][1])
      continue
    }
    const [i0, t0] = known[k - 1]
    const [i1, t1] = known[k]
    out.push(t0 + ((t1 - t0) * (i - i0)) / (i1 - i0))
  }
  // Keep them in order: a guess must not land before the bar it follows.
  for (let i = 1; i < out.length; i++) if (out[i] <= out[i - 1]) out[i] = out[i - 1] + 0.05
  return out
}
