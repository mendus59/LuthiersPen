import { tone } from '../verify/evidence'
import type { NoteEvent } from './types'

/** A note the detector proposes, with the model frame it starts on. */
export interface Candidate extends NoteEvent {
  frame: number
}

export const FEATURE_NAMES = [
  'amp', 'dur', 'pitch', 'onsetPeak', 'onsetMean', 'framePeak', 'frameBefore',
  'rise1', 'rise2', 'rise3', 'riseMid', 'riseLong', 'level', 'levelRel',
  'gapPrev', 'sincePrev', 'ampPrev', 'gapNext',
  'together', 'ampRank', 'riseRel', 'onsetRel',
  'below12', 'below19', 'below24', 'above12', 'above19', 'ownPartials',
  'sameStronger', 'sameDist', 'onsetVsSame', 'sameCount', 'otherOnset', 'otherRise',
] as const

const FLOOR = 2e-5
const LOW = 21 // lowest pitch of the model's 88 bins

function partial(mono: Float32Array, rate: number, sec: number, seconds: number, freq: number): number {
  return tone(mono, rate, Math.round(sec * rate), Math.round(seconds * rate), freq)
}

/** After/before level of one partial around an onset. */
function rise(mono: Float32Array, rate: number, sec: number, freq: number, window: number): number {
  const before = partial(mono, rate, sec - window - 0.02, window, freq)
  let after = 0
  for (let k = 0; k <= 3; k++) after = Math.max(after, partial(mono, rate, sec + k * 0.02, window, freq))
  return (after + FLOOR) / (before + FLOOR)
}

const squash = (ratio: number) => Math.max(-3, Math.min(5, Math.log(ratio)))

/**
 * What is known about each candidate note: what the detector thought of it, how its partials
 * behave in the recording at its onset, and how it sits among the notes around it.
 */
export function noteFeatures(cands: Candidate[], frames: number[][], onsets: number[][], mono: Float32Array, rate: number): number[][] {
  const order = cands.map((_, i) => i).sort((a, b) => cands[a].start - cands[b].start)
  const own = cands.map((c) => {
    const f0 = 440 * Math.pow(2, (c.pitch - 69) / 12)
    const bin = c.pitch - LOW
    let onsetPeak = 0
    let onsetMean = 0
    let count = 0
    for (let f = Math.max(0, c.frame - 2); f <= Math.min(onsets.length - 1, c.frame + 2); f++) {
      onsetPeak = Math.max(onsetPeak, onsets[f][bin])
      onsetMean += onsets[f][bin]
      count++
    }
    let framePeak = 0
    for (let f = c.frame; f <= Math.min(frames.length - 1, c.frame + 6); f++) framePeak = Math.max(framePeak, frames[f][bin])
    let frameBefore = 0
    for (let f = Math.max(0, c.frame - 6); f < Math.max(0, c.frame - 1); f++) frameBefore = Math.max(frameBefore, frames[f][bin])
    const rises = [1, 2, 3].map((h) => squash(rise(mono, rate, c.start, f0 * h, 0.06)))
    const riseLong = squash(rise(mono, rate, c.start, f0, 0.12))
    let level = 0
    for (let h = 1; h <= 3; h++) level += partial(mono, rate, c.start, 0.1, f0 * h)
    return { onsetPeak, onsetMean: onsetMean / Math.max(1, count), framePeak, frameBefore, rises, riseMid: [...rises].sort((a, b) => a - b)[1], riseLong, level: Math.log(level / 3 + FLOOR) }
  })
  const out: number[][] = new Array(cands.length)
  const lastOfPitch = new Map<number, number>()
  const prevOf = new Array<number>(cands.length).fill(-1)
  for (const i of order) {
    prevOf[i] = lastOfPitch.get(cands[i].pitch) ?? -1
    lastOfPitch.set(cands[i].pitch, i)
  }
  const nextOf = new Array<number>(cands.length).fill(-1)
  for (let i = 0; i < cands.length; i++) if (prevOf[i] >= 0) nextOf[prevOf[i]] = i
  const byPitch = new Map<number, number[]>()
  for (const i of order) {
    const list = byPitch.get(cands[i].pitch)
    if (list) list.push(i)
    else byPitch.set(cands[i].pitch, [i])
  }
  let lo = 0
  for (let k = 0; k < order.length; k++) {
    const i = order[k]
    const c = cands[i]
    const o = own[i]
    while (cands[order[lo]].start < c.start - 0.06) lo++
    const group: number[] = []
    for (let q = lo; q < order.length && cands[order[q]].start <= c.start + 0.06; q++) group.push(order[q])
    const maxRise = Math.max(...group.map((j) => own[j].riseMid))
    const maxOnset = Math.max(...group.map((j) => own[j].onsetPeak))
    const maxLevel = Math.max(...group.map((j) => own[j].level))
    const related = (interval: number) => {
      const j = group.find((x) => cands[x].pitch - c.pitch === interval)
      return j === undefined ? -1 : cands[j].amplitude
    }
    const p = prevOf[i]
    const nx = nextOf[i]
    // If a note an octave or twelfth above starts with this one: how strong are this note's own partials?
    let ownPart = 1
    for (const [interval, divisor] of [[12, 2], [19, 3], [24, 4]] as const) {
      if (!group.some((x) => cands[x].pitch - c.pitch === interval)) continue
      const f0 = 440 * Math.pow(2, (c.pitch - 69) / 12)
      let mine = 0
      let mineCount = 0
      let shared = 0
      let sharedCount = 0
      for (let h = 1; h <= 12; h++) {
        if (h % divisor === 0) {
          if (sharedCount < 3) {
            shared += partial(mono, rate, c.start, 0.2, f0 * h)
            sharedCount++
          }
        } else if (mineCount < 3) {
          mine += partial(mono, rate, c.start, 0.2, f0 * h)
          mineCount++
        }
      }
      ownPart = Math.min(ownPart, shared > 0 ? Math.min(1, mine / mineCount / (shared / sharedCount)) : 1)
    }
    // The same pitch proposed again close by (one pluck heard twice) and over the last few seconds.
    let sameStronger = 0
    let sameDist = 0.5
    const sameOnsets: number[] = []
    for (const j of byPitch.get(c.pitch)!) {
      if (j === i) continue
      const apart = Math.abs(cands[j].start - c.start)
      if (apart <= 0.2) {
        sameStronger = Math.max(sameStronger, own[j].onsetPeak)
        sameDist = Math.min(sameDist, apart)
      }
      if (apart <= 2.5) sameOnsets.push(own[j].onsetPeak)
    }
    sameOnsets.sort((a, b) => a - b)
    const typical = sameOnsets.length ? (sameOnsets[(sameOnsets.length - 1) >> 1] + sameOnsets[sameOnsets.length >> 1]) / 2 : o.onsetPeak
    let otherOnset = 0
    let otherRise = -3
    for (const j of group) {
      if (cands[j].pitch === c.pitch || Math.abs(cands[j].start - c.start) > 0.05) continue
      otherOnset = Math.max(otherOnset, own[j].onsetPeak)
      otherRise = Math.max(otherRise, own[j].riseMid)
    }
    out[i] = [
      c.amplitude, Math.min(2, c.duration), c.pitch, o.onsetPeak, o.onsetMean, o.framePeak, o.frameBefore,
      o.rises[0], o.rises[1], o.rises[2], o.riseMid, o.riseLong, o.level, o.level - maxLevel,
      p < 0 ? 3 : Math.max(-1, Math.min(3, c.start - (cands[p].start + cands[p].duration))),
      p < 0 ? 3 : Math.min(3, c.start - cands[p].start),
      p < 0 ? 0 : cands[p].amplitude,
      nx < 0 ? 3 : Math.min(3, cands[nx].start - c.start),
      group.length, group.filter((j) => cands[j].amplitude > c.amplitude).length, o.riseMid - maxRise, o.onsetPeak - maxOnset,
      related(-12), related(-19), related(-24), related(12), related(19), ownPart,
      sameStronger - o.onsetPeak, sameDist, o.onsetPeak - typical, sameOnsets.length, otherOnset, otherRise,
    ]
  }
  return out
}
