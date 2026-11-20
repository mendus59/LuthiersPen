import type { Gray, Staff } from './staff'

/** A mark drawn on a tab staff: a fret number's digit, or something else to look at. */
export interface Glyph {
  x0: number
  x1: number
  y0: number
  y1: number
  cx: number
  cy: number
  /** The line it sits on, 0 = string 1. */
  line: number
  /** Its shape, scaled to GLYPH_H rows and centred in GLYPH_W columns, 0..1. */
  shape: Float32Array
}

export const GLYPH_W = 12
export const GLYPH_H = 16

/** What a staff holds once its lines are lifted off: the marks on it and its barlines. */
export interface StaffMarks {
  glyphs: Glyph[]
  /** x of each barline. */
  bars: number[]
}

/**
 * Lift the marks off a tab staff: separate ink from the ground, wipe the six lines where nothing
 * else is drawn across them, and collect the connected marks that sit on a line and are the
 * size of a digit, along with the barlines.
 */
export function staffMarks(img: Gray, staff: Staff): StaffMarks {
  const { width: w, data } = img
  const sp = staff.spacing
  const y0 = Math.max(0, Math.floor(staff.lines[0] - sp * 0.9))
  const y1 = Math.min(img.height - 1, Math.ceil(staff.lines[5] + sp * 0.9))
  const x0 = Math.max(0, Math.floor(staff.x0 - sp))
  const x1 = Math.min(w - 1, Math.ceil(staff.x1 + sp))
  const bw = x1 - x0 + 1
  const bh = y1 - y0 + 1
  // Ink: how far each pixel is from the ground, in the direction the marks are drawn.
  const vals: number[] = []
  for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 3) vals.push(data[y * w + x])
  vals.sort((a, b) => a - b)
  const ground = vals[Math.floor(vals.length / 2)]
  const ink = new Uint8Array(bw * bh)
  const inks: number[] = []
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const v = data[(y + y0) * w + x + x0]
      const c = Math.max(0, staff.light ? v - ground : ground - v)
      ink[y * bw + x] = c
      if (c > 40) inks.push(c)
    }
  }
  inks.sort((a, b) => a - b)
  const full = inks.length ? inks[Math.floor(inks.length * 0.9)] : 255
  const cut = Math.max(35, full * 0.45)
  const on = new Uint8Array(bw * bh)
  for (let i = 0; i < on.length; i++) on[i] = ink[i] >= cut ? 1 : 0
  // Wipe the lines: a pixel of a line stays only where a mark runs across the line there.
  const reach = Math.max(1, Math.round(sp * 0.08))
  const inkAt = (y: number, x: number) => {
    if (y < 0 || y >= bh) return false
    for (let dx = -1; dx <= 1; dx++) if (x + dx >= 0 && x + dx < bw && on[y * bw + x + dx]) return true
    return false
  }
  const longRun = Math.round(sp * 1.2)
  for (const ly of staff.lines) {
    const c = Math.round(ly) - y0
    const wipe: number[] = []
    for (let y = c - reach; y <= c + reach; y++) {
      if (y < 0 || y >= bh) continue
      // Only long horizontal runs are line: a digit drawn in a gap of the line keeps its strokes.
      let x = 0
      while (x < bw) {
        if (!on[y * bw + x]) {
          x++
          continue
        }
        let e = x
        while (e < bw && on[y * bw + e]) e++
        if (e - x >= longRun) for (let k = x; k < e; k++) if (!(inkAt(c - reach - 1, k) && inkAt(c + reach + 1, k))) wipe.push(y * bw + k)
        x = e
      }
    }
    for (const i of wipe) on[i] = 0
  }
  // Barlines: columns inked from the first line to the last.
  const top = Math.round(staff.lines[0]) - y0
  const bot = Math.round(staff.lines[5]) - y0
  const bars: number[] = []
  let run: number[] = []
  const flushBar = () => {
    if (run.length && run.length <= Math.max(4, sp * 0.4)) bars.push(x0 + run.reduce((a, b) => a + b, 0) / run.length)
    run = []
  }
  for (let x = 0; x < bw; x++) {
    let n = 0
    for (let y = top + 1; y < bot; y++) if (ink[y * bw + x] >= Math.min(cut, full * 0.35)) n++
    if (n >= (bot - top - 1) * 0.93) run.push(x)
    else flushBar()
  }
  flushBar()

  // Connected marks (8-neighbours).
  const label = new Int32Array(bw * bh).fill(-1)
  type Raw = { pix: number[]; x0: number; x1: number; y0: number; y1: number }
  const raws: Raw[] = []
  const stack: number[] = []
  for (let start = 0; start < on.length; start++) {
    if (!on[start] || label[start] >= 0) continue
    stack.length = 0
    stack.push(start)
    label[start] = start
    const r: Raw = { pix: [], x0: bw, x1: 0, y0: bh, y1: 0 }
    while (stack.length) {
      const p = stack.pop()!
      r.pix.push(p)
      const px = p % bw
      const py = (p - px) / bw
      if (px < r.x0) r.x0 = px
      if (px > r.x1) r.x1 = px
      if (py < r.y0) r.y0 = py
      if (py > r.y1) r.y1 = py
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy
        if (ny < 0 || ny >= bh) continue
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx
          if (nx < 0 || nx >= bw) continue
          const q = ny * bw + nx
          if (on[q] && label[q] < 0) {
            label[q] = start
            stack.push(q)
          }
        }
      }
    }
    if (r.y1 - r.y0 + 1 <= sp * 1.15) raws.push(r)
  }
  // A digit a line ran through can come apart where the line was wiped: join pieces one above
  // the other that share most of their columns and nearly touch.
  raws.sort((p, q) => p.x0 - q.x0)
  for (let i = 0; i < raws.length; i++) {
    const p = raws[i]
    if (!p.pix.length) continue
    for (let j = i + 1; j < raws.length && raws[j].x0 <= p.x1; j++) {
      const q = raws[j]
      if (!q.pix.length) continue
      const shared = Math.min(p.x1, q.x1) - Math.max(p.x0, q.x0) + 1
      const narrow = Math.min(p.x1 - p.x0, q.x1 - q.x0) + 1
      const gap = Math.max(q.y0 - p.y1, p.y0 - q.y1)
      const tall = Math.max(p.y1, q.y1) - Math.min(p.y0, q.y0) + 1
      if (shared >= narrow * 0.5 && gap <= reach * 2 + 2 && tall <= sp * 1.15) {
        p.pix.push(...q.pix)
        p.x0 = Math.min(p.x0, q.x0)
        p.x1 = Math.max(p.x1, q.x1)
        p.y0 = Math.min(p.y0, q.y0)
        p.y1 = Math.max(p.y1, q.y1)
        q.pix = []
        j = i
      }
    }
  }
  const glyphs: Glyph[] = []
  for (const r of raws) {
    const pix = r.pix
    const gx0 = r.x0
    const gx1 = r.x1
    const gy0 = r.y0
    const gy1 = r.y1
    const gh = gy1 - gy0 + 1
    const gw = gx1 - gx0 + 1
    if (gh < sp * 0.4 || gh > sp * 1.15 || gw > sp * 1.6 || pix.length < 8) continue
    const cy = y0 + (gy0 + gy1) / 2
    let line = 0
    for (let k = 1; k < 6; k++) if (Math.abs(staff.lines[k] - cy) < Math.abs(staff.lines[line] - cy)) line = k
    if (Math.abs(staff.lines[line] - cy) > sp * 0.42) continue
    const shape = new Float32Array(GLYPH_W * GLYPH_H)
    // Scale by height; centre horizontally.
    const scale = GLYPH_H / gh
    const off = (GLYPH_W - gw * scale) / 2
    for (const p of pix) {
      const px = p % bw
      const py = (p - px) / bw
      const tx = (px - gx0 + 0.5) * scale + off
      const ty = (py - gy0 + 0.5) * scale
      // Spread each source pixel over the cells it covers.
      const r = scale / 2
      for (let yy = Math.floor(ty - r); yy <= Math.floor(ty + r); yy++) {
        if (yy < 0 || yy >= GLYPH_H) continue
        const oy = Math.min(yy + 1, ty + r) - Math.max(yy, ty - r)
        if (oy <= 0) continue
        for (let xx = Math.floor(tx - r); xx <= Math.floor(tx + r); xx++) {
          if (xx < 0 || xx >= GLYPH_W) continue
          const ox = Math.min(xx + 1, tx + r) - Math.max(xx, tx - r)
          if (ox > 0) shape[yy * GLYPH_W + xx] += ox * oy
        }
      }
    }
    for (let i = 0; i < shape.length; i++) shape[i] = Math.min(1, shape[i])
    glyphs.push({ x0: x0 + gx0, x1: x0 + gx1 + 1, y0: y0 + gy0, y1: y0 + gy1 + 1, cx: x0 + (gx0 + gx1 + 1) / 2, cy, line, shape })
  }
  glyphs.sort((a, b) => a.cx - b.cx)
  return { glyphs, bars }
}

/** Zero-mean, unit-length copy of a shape, for comparing by correlation. */
export function normShape(v: ArrayLike<number>): Float32Array {
  const out = new Float32Array(v.length)
  let mean = 0
  for (let i = 0; i < v.length; i++) mean += v[i]
  mean /= v.length
  let norm = 0
  for (let i = 0; i < v.length; i++) {
    out[i] = v[i] - mean
    norm += out[i] * out[i]
  }
  norm = Math.sqrt(norm) || 1
  for (let i = 0; i < v.length; i++) out[i] /= norm
  return out
}
