import model from './digit-model.json'
import { type Glyph, normShape, staffMarks } from './glyphs'
import { findStaves, type Gray, type Staff } from './staff'

/** A fret number written on a string. */
export interface TabNote {
  /** 1 = high E … 6 = low E. */
  string: number
  fret: number
  /** Written <12>: a natural harmonic touched over this fret. */
  harmonic?: boolean
}

/** Natural harmonics: how far above the open string each touched fret sounds. */
const HARMONIC: Record<number, number> = { 12: 12, 7: 19, 19: 19, 5: 24, 24: 24, 4: 28, 9: 28, 16: 28, 3: 31 }

/** The pitch a tab note sounds, on a guitar tuned to `tuning` (strings 1..6). */
export function tabPitch(tuning: number[], n: TabNote): number {
  return tuning[n.string - 1] + (n.harmonic ? (HARMONIC[n.fret] ?? n.fret) : n.fret)
}

/** Notes written one above the other: played together. */
export interface TabChord {
  x: number
  notes: TabNote[]
}

/** A fret number read on a staff, and where. */
export interface PlacedNumber {
  x: number
  string: number
  fret: number
  harmonic?: boolean
}

/** What one tab staff on screen says. */
export interface StaffReading {
  /** Chords between barlines, left to right. */
  bars: TabChord[][]
  /** The numbers and barlines they were made from. */
  numbers: PlacedNumber[]
  barXs: number[]
  /** Marks that looked like digits but could not be read with confidence. */
  unsure: number
  /** Where the staff is on screen (its top line) and its line spacing. */
  y: number
  spacing: number
  /** A coarse picture of the staff, to tell whether two frames show the same line of tab. */
  look: Float32Array
}

const LOOK_W = 96
const LOOK_H = 12

/** The staff band shrunk to LOOK_W x LOOK_H cells of mean brightness. */
function lookOf(img: Gray, staff: Staff): Float32Array {
  const out = new Float32Array(LOOK_W * LOOK_H)
  const y0 = staff.lines[0] - staff.spacing * 0.8
  const y1 = staff.lines[5] + staff.spacing * 0.8
  for (let cy = 0; cy < LOOK_H; cy++) {
    for (let cx = 0; cx < LOOK_W; cx++) {
      const ya = Math.floor(y0 + ((y1 - y0) * cy) / LOOK_H)
      const yb = Math.floor(y0 + ((y1 - y0) * (cy + 1)) / LOOK_H)
      const xa = Math.floor(staff.x0 + ((staff.x1 - staff.x0) * cx) / LOOK_W)
      const xb = Math.floor(staff.x0 + ((staff.x1 - staff.x0) * (cx + 1)) / LOOK_W)
      let sum = 0
      let n = 0
      for (let y = Math.max(0, ya); y < Math.min(img.height, Math.max(yb, ya + 1)); y++) {
        for (let x = xa; x < Math.max(xb, xa + 1); x++) {
          sum += img.data[y * img.width + x]
          n++
        }
      }
      out[cy * LOOK_W + cx] = n ? sum / n : 0
    }
  }
  return out
}

/** The share of a staff's cells that differ between two frames (0..1), or 1 for staves in different places. */
export function lookChange(a: StaffReading, b: StaffReading): number {
  if (Math.abs(a.y - b.y) > a.spacing || Math.abs(a.spacing - b.spacing) > a.spacing * 0.1) return 1
  let changed = 0
  for (let i = 0; i < a.look.length; i++) if (Math.abs(a.look[i] - b.look[i]) > 30) changed++
  return changed / a.look.length
}

const PROTOS = model.protos.map((p) => normShape(p))
const LABELS = model.labels
/** A mark is read as the digit it resembles most, when the likeness is at least this. */
const MIN_LIKE = 0.6

/** The digit a mark shows, or null for a mark that is not a digit (or not clearly one); `bracket` for the < and > written round a harmonic. */
export function readDigit(g: Glyph): { digit: number | null; like: number; bracket?: '<' | '>' } {
  const v = normShape(g.shape)
  let best = -1
  let at = 0
  for (let i = 0; i < PROTOS.length; i++) {
    const p = PROTOS[i]
    let s = 0
    for (let k = 0; k < v.length; k++) s += p[k] * v[k]
    if (s > best) {
      best = s
      at = i
    }
  }
  const label = LABELS[at]
  if ((label === 'l' || label === 'r') && best >= MIN_LIKE) return { digit: null, like: best, bracket: label === 'l' ? '<' : '>' }
  return { digit: label === 'x' || best < MIN_LIKE ? null : Number(label), like: best }
}

/** Read the fret numbers on one tab staff and group them into chords and bars. */
export function readStaff(img: Gray, staff: Staff): StaffReading {
  const sp = staff.spacing
  const { glyphs, bars } = staffMarks(img, staff)
  let unsure = 0
  const digits: Array<{ g: Glyph; d: number }> = []
  const brackets: Array<{ g: Glyph; side: '<' | '>' }> = []
  for (const g of glyphs) {
    const r = readDigit(g)
    if (r.bracket) {
      brackets.push({ g, side: r.bracket })
      continue
    }
    if (r.digit === null) {
      if (r.like >= 0.45 && r.like < MIN_LIKE) unsure++
      continue
    }
    digits.push({ g, d: r.digit })
  }
  // Numbers: a 1 or 2 just left of another digit on the same line makes 10-24.
  const numbers: PlacedNumber[] = []
  const bracketed = (line: number, x0: number, x1: number) =>
    brackets.some((b) => b.side === '<' && b.g.line === line && b.g.x1 <= x0 + 1 && x0 - b.g.x1 < sp * 0.5) &&
    brackets.some((b) => b.side === '>' && b.g.line === line && b.g.x0 >= x1 - 1 && b.g.x0 - x1 < sp * 0.5)
  for (let line = 0; line < 6; line++) {
    const row = digits.filter((x) => x.g.line === line).sort((a, b) => a.g.x0 - b.g.x0)
    for (let i = 0; i < row.length; i++) {
      const a = row[i]
      const b = row[i + 1]
      if (b && (a.d === 1 || a.d === 2) && b.g.x0 - a.g.x1 < sp * 0.4 && a.d * 10 + b.d <= 24) {
        numbers.push({ x: (a.g.x0 + b.g.x1) / 2, string: line + 1, fret: a.d * 10 + b.d, ...(bracketed(line, a.g.x0, b.g.x1) ? { harmonic: true } : {}) })
        i++
      } else {
        numbers.push({ x: a.g.cx, string: line + 1, fret: a.d, ...(bracketed(line, a.g.x0, a.g.x1) ? { harmonic: true } : {}) })
      }
    }
  }
  return { bars: layout(numbers, bars, sp), numbers, barXs: bars, unsure, y: staff.lines[0], spacing: sp, look: lookOf(img, staff) }
}

const noteOf = (n: PlacedNumber): TabNote => ({ string: n.string, fret: n.fret, ...(n.harmonic ? { harmonic: true } : {}) })

/** Group numbers into chords (one above the other) and the chords into bars. */
export function layout(list: PlacedNumber[], bars: number[], sp: number): TabChord[][] {
  const numbers = [...list].sort((a, b) => a.x - b.x)
  const chords: TabChord[] = []
  for (const n of numbers) {
    const last = chords[chords.length - 1]
    if (last && n.x - last.x < sp * 0.55 && !last.notes.some((o) => o.string === n.string)) {
      last.x = (last.x * last.notes.length + n.x) / (last.notes.length + 1)
      last.notes.push(noteOf(n))
    } else {
      chords.push({ x: n.x, notes: [noteOf(n)] })
    }
  }
  for (const c of chords) c.notes.sort((a, b) => a.string - b.string)
  // Bars: chords between barlines. A barline before the first chord opens the staff.
  const edges = bars.filter((b) => chords.length && b > chords[0].x - sp * 0.3 && b < chords[chords.length - 1].x + sp * 0.3)
  const out: TabChord[][] = [[]]
  let e = 0
  for (const c of chords) {
    while (e < edges.length && edges[e] < c.x) {
      if (out[out.length - 1].length) out.push([])
      e++
    }
    out[out.length - 1].push(c)
  }
  return out.filter((b) => b.length)
}

/** Every tab staff in a picture, top to bottom, read. */
export function readPicture(img: Gray): StaffReading[] {
  return findStaves(img).map((s) => readStaff(img, s)).filter((r) => r.bars.length)
}

/** A short text form of a reading ("0.2.-.-.-.- 3.-…|…"), to compare readings of two frames. */
export function readingKey(r: StaffReading): string {
  return r.bars.map((b) => b.map(chordKey).join(' ')).join('|')
}

export function chordKey(c: TabChord): string {
  return c.notes.map((n) => `${n.string}:${n.fret}${n.harmonic ? 'h' : ''}`).join(',')
}
