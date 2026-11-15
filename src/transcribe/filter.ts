import model from './note-model.json'
import { FEATURE_NAMES, noteFeatures, type Candidate } from './features'
import type { NoteEvent } from './types'

/** A candidate is written down when the model gives it at least this chance of being a played note. */
const KEEP = 0.3
/** One pluck is sometimes proposed twice, a moment apart. */
const SAME_PLUCK = 0.1
/** A rejected candidate this soon after a kept note of its pitch is that note still ringing. */
const RING_ON = 0.12

interface Tree {
  /** Feature tested at each node. */
  f: number[]
  /** Go left when the feature is at most this. */
  t: number[]
  l: number[]
  r: number[]
  /** What a leaf adds to the score. */
  v: number[]
}

const TREES = model.trees as Tree[]
if (model.features.join() !== FEATURE_NAMES.join()) throw new Error('note-model.json was trained on different features')

/**
 * The chance that a candidate is a note the guitarist played, from what is known about it
 * (see noteFeatures). The model is three hundred small decision trees, fitted on recordings
 * whose tablature is known.
 */
export function noteChance(features: number[]): number {
  let score = model.base
  for (const tree of TREES) {
    let node = 0
    while (tree.l[node] >= 0) node = features[tree.f[node]] <= tree.t[node] ? tree.l[node] : tree.r[node]
    score += tree.v[node]
  }
  return 1 / (1 + Math.exp(-score))
}

/**
 * Choose the played notes among the detector's candidates. The detector is asked for more
 * candidates than it is sure of, so that soft and re-plucked notes are not lost; this decides
 * which of them are real, drops one pluck reported twice, and lets a ringing string ring on.
 */
export function pickNotes(cands: Candidate[], frames: number[][], onsets: number[][], mono: Float32Array, rate: number): NoteEvent[] {
  const features = noteFeatures(cands, frames, onsets, mono, rate)
  const order = cands.map((_, i) => i).sort((a, b) => cands[a].start - cands[b].start)
  const last = new Map<number, { note: NoteEvent; chance: number }>()
  const kept: { note: NoteEvent; chance: number }[] = []
  for (const i of order) {
    const c = cands[i]
    const chance = noteChance(features[i])
    const before = last.get(c.pitch)
    if (chance < KEEP) {
      if (before && c.start - (before.note.start + before.note.duration) < RING_ON) {
        before.note.duration = Math.max(before.note.duration, c.start + c.duration - before.note.start)
      }
      continue
    }
    if (before && c.start - before.note.start <= SAME_PLUCK) {
      const end = Math.max(before.note.start + before.note.duration, c.start + c.duration)
      if (chance > before.chance) {
        before.note.start = c.start
        before.note.amplitude = c.amplitude
        before.chance = chance
      }
      before.note.duration = end - before.note.start
      continue
    }
    const entry = { note: { start: c.start, duration: c.duration, pitch: c.pitch, amplitude: c.amplitude }, chance }
    kept.push(entry)
    last.set(c.pitch, entry)
  }
  return kept.map((k) => k.note).sort((a, b) => a.start - b.start)
}
