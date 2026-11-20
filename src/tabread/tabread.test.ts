import { describe, expect, it } from 'vitest'
import model from './digit-model.json'
import { fuseTab } from './fuse'
import { tabTiming } from './meter'
import { readPicture, tabPitch, type StaffReading, type TabChord } from './read'
import { joinSheet, type TabSheet } from './sheet'
import { findStaves, type Gray } from './staff'
import type { NoteEvent } from '../transcribe/types'

const W = 1280
const H = 220
const TOP = 60
const SP = 15

/** A digit's shape from the model (one drawn from a common font), as a 12 x 16 mask. */
function digitMask(d: number): number[] {
  const at = model.labels.indexOf(String(d), model.labels.length - 300)
  return model.protos[at]
}

/**
 * A picture of a tab staff: six grey lines, and dark fret numbers in a white gap of the line,
 * as lesson videos draw them, with barlines. `notes` are [x, string, fret].
 */
function tabPicture(notes: Array<[number, number, number]>, bars: number[], light = false): Gray {
  const ink = light ? 235 : 20
  const ground = light ? 15 : 250
  const line = light ? 150 : 120
  const data = new Uint8Array(W * H).fill(ground)
  for (let k = 0; k < 6; k++) {
    const y = TOP + k * SP
    for (let x = 60; x < 1220; x++) data[y * W + x] = line
  }
  for (const x of bars) for (let y = TOP; y <= TOP + 5 * SP; y++) data[y * W + x] = data[y * W + x + 1] = ink
  for (const [x0, string, fret] of notes) {
    const digits = String(fret).split('').map(Number)
    const cy = TOP + (string - 1) * SP
    const width = digits.length * 13
    // The gap in the line behind the number.
    for (let y = cy - 8; y <= cy + 8; y++) for (let x = x0 - 2; x < x0 + width + 2; x++) data[y * W + x] = ground
    digits.forEach((d, i) => {
      const m = digitMask(d)
      for (let r = 0; r < 16; r++) {
        for (let c = 0; c < 12; c++) {
          const v = m[r * 12 + c] / 99
          if (v > 0.4) data[(cy - 8 + r) * W + x0 + i * 13 + c] = ink
        }
      }
    })
  }
  return { width: W, height: H, data }
}

const PAGE: Array<[number, number, number]> = [
  [100, 6, 0], [100, 2, 1], [160, 3, 2], [220, 1, 0],
  [320, 5, 3], [380, 2, 12], [440, 4, 7],
  [560, 6, 3], [560, 1, 3], [620, 3, 5],
]

describe('reading tab from a video frame', () => {
  it('finds a six-line tab staff, dark on light and light on dark', () => {
    for (const light of [false, true]) {
      const st = findStaves(tabPicture(PAGE, [290, 530, 700], light))
      expect(st).toHaveLength(1)
      expect(st[0].lines[0]).toBeCloseTo(TOP, 0)
      expect(st[0].spacing).toBeCloseTo(SP, 0)
      expect(st[0].light).toBe(light)
    }
  })

  it('does not take a five-line music staff for tab', () => {
    const data = new Uint8Array(W * H).fill(250)
    for (let k = 0; k < 5; k++) for (let x = 60; x < 1220; x++) data[(TOP + k * SP) * W + x] = 40
    expect(findStaves({ width: W, height: H, data })).toHaveLength(0)
  })

  it('reads the fret numbers, two-digit frets included, as chords in bars', () => {
    const [r] = readPicture(tabPicture(PAGE, [290, 530, 700]))
    const text = r.bars.map((b) => b.map((c) => c.notes.map((n) => `${n.string}:${n.fret}`).join('+')).join(' '))
    expect(text).toEqual(['2:1+6:0 3:2 1:0', '5:3 2:12 4:7', '1:3+6:3 3:5'])
  })
})

/** A reading of one staff, for joining. */
function staffOf(bars: TabChord[][], look: number): StaffReading {
  const numbers = bars.flat().flatMap((c) => c.notes.map((n) => ({ x: c.x, string: n.string, fret: n.fret })))
  const barXs = bars.slice(1).map((b) => b[0].x - 10)
  return { bars, numbers, barXs, unsure: 0, y: 100, spacing: 15, look: new Float32Array(96 * 12).fill(look) }
}
const chord = (x: number, ...notes: Array<[number, number]>): TabChord => ({ x, notes: notes.map(([string, fret]) => ({ string, fret })) })

describe('joining the frames of a video into one tab', () => {
  it('takes each line once, in order, and reads a covered digit the way most frames do', () => {
    const lineA = [[chord(100, [1, 0]), chord(160, [2, 1])], [chord(300, [3, 2])]]
    const covered = [[chord(100, [1, 0]), chord(160, [2, 7])], [chord(300, [3, 2])]]
    const lineB = [[chord(100, [6, 3]), chord(160, [1, 5])]]
    const sheet = joinSheet([
      { t: 0, staves: [staffOf(lineA, 200)] },
      { t: 2, staves: [staffOf(covered, 200)] },
      { t: 4, staves: [staffOf(lineA, 200)] },
      { t: 6, staves: [staffOf(lineB, 50)] },
      { t: 8, staves: [staffOf(lineB, 50)] },
    ])
    expect(sheet.systems).toBe(2)
    expect(sheet.bars.map((b) => b.map((c) => c.notes.map((n) => `${n.string}:${n.fret}`).join('+')))).toEqual([['1:0', '2:1'], ['3:2'], ['6:3', '1:5']])
    expect(sheet.shown.map((s) => s.t)).toEqual([0, 6])
  })
})

/** A tab of `bars` bars of four chords, and a performance of it at `beat` seconds a chord. */
function piece(bars: number, tuning: number[], beat = 0.5) {
  const tab: TabChord[][] = []
  for (let b = 0; b < bars; b++) {
    tab.push([
      chord(0, [6, b % 2 ? 2 : 0], [3, 2]),
      chord(1, [2, 1 + (b % 3)]),
      chord(2, [1, 0]),
      chord(3, [2, 3]),
    ])
  }
  const cands: NoteEvent[] = []
  const chances: number[] = []
  let t = 1
  for (const bar of tab) {
    for (const c of bar) {
      for (const n of c.notes) {
        cands.push({ start: t + Math.random() * 0.01, duration: beat, pitch: tabPitch(tuning, n), amplitude: 0.5 })
        chances.push(0.9)
      }
      t += beat
    }
  }
  return { sheet: { bars: tab, systems: 1, shown: [{ t: 0, bar: 0 }] } as TabSheet, cands, chances }
}

describe('joining the tab with the sound', () => {
  it('writes the tab notes with their strings and frets at the times heard, and the bars as the tab has them', () => {
    const { sheet, cands, chances } = piece(8, [64, 59, 55, 50, 45, 38])
    // A faint tab note the filter alone would drop, and a wrong note heard only weakly.
    chances[1] = 0.25
    cands.push({ start: 3.0, duration: 0.3, pitch: 70, amplitude: 0.3 })
    chances.push(0.4)
    const f = fuseTab(cands, chances, sheet)!
    expect(f).not.toBeNull()
    expect(f.tuningName).toBe('drop D')
    expect(f.events.some((e) => e.pitch === 70)).toBe(false)
    expect(f.events.filter((e) => e.start < 1.1).map((e) => e.pitch).sort()).toEqual([38, 57])
    const low = f.events.find((e) => e.pitch === 38)!
    expect([low.string, low.fret]).toEqual([6, 0])
    expect(f.downs).toHaveLength(8)
    f.downs.forEach((d, k) => expect(d).toBeCloseTo(1 + k * 2, 1))
    const meter = tabTiming(f.downs, f.events, { beatTimes: Array.from({ length: 40 }, (_, k) => 1 + k * 0.5) }, [4, 4])!
    expect(meter.timeSig).toEqual([4, 4])
    expect(meter.fit.timing.beatTimes[4]).toBeCloseTo(f.downs[1], 1)
  })

  it('follows a repeat: the same bars played twice', () => {
    const { sheet, cands, chances } = piece(4, [64, 59, 55, 50, 45, 40])
    const again = cands.map((c) => ({ ...c, start: c.start + 8 }))
    const f = fuseTab([...cands, ...again], [...chances, ...chances], sheet)!
    expect(f.downs).toHaveLength(8)
  })

  it('gives up when the tab is of another piece', () => {
    const { sheet } = piece(4, [64, 59, 55, 50, 45, 40])
    const cands: NoteEvent[] = Array.from({ length: 40 }, (_, k) => ({ start: k * 0.3, duration: 0.3, pitch: 61 + (k % 5) * 2, amplitude: 0.5 }))
    expect(fuseTab(cands, cands.map(() => 0.9), sheet)).toBeNull()
  })
})
