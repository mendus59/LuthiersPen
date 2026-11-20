/** A greyscale picture: one byte per pixel, rows top to bottom. */
export interface Gray {
  width: number
  height: number
  data: Uint8Array | Uint8ClampedArray
}

/** Six tablature lines found in a picture. */
export interface Staff {
  /** Line centres, top (string 1, high E) to bottom (string 6). */
  lines: number[]
  /** Distance between neighbouring lines, in pixels. */
  spacing: number
  /** Where the lines start and end. */
  x0: number
  x1: number
  /** Light lines on a dark picture (true) or dark lines on a light one. */
  light: boolean
}

interface Line {
  y: number
  cover: number
  light: boolean
}

/** A row counts as a line where at least this fraction of the picture's width is a thin stroke. */
const MIN_COVER = 0.22
/** Neighbouring tab lines are evenly spaced: the gaps may differ from their mean by this much. */
const EVEN = 0.14
/** How much a thin line must stand out from the rows just above and below it. */
const CONTRAST = 22

/**
 * Rows of a picture that are thin horizontal lines across a good part of its width, as either dark
 * strokes on a light ground or light strokes on a dark one.
 */
function lineRows(img: Gray): Line[] {
  const { width: w, height: h, data } = img
  const darkCover = new Float32Array(h)
  const lightCover = new Float32Array(h)
  const step = 2
  const cols = Math.ceil(w / step)
  for (let y = 3; y < h - 3; y++) {
    let dark = 0
    let light = 0
    const row = y * w
    for (let x = 0; x < w; x += step) {
      const v = data[row + x]
      // A stroke one to three pixels thick: compare with the rows two and three away on both sides.
      const up = Math.min(data[row - 2 * w + x], data[row - 3 * w + x])
      const upMax = Math.max(data[row - 2 * w + x], data[row - 3 * w + x])
      const dn = Math.min(data[row + 2 * w + x], data[row + 3 * w + x])
      const dnMax = Math.max(data[row + 2 * w + x], data[row + 3 * w + x])
      if (up - v > CONTRAST && dn - v > CONTRAST) dark++
      else if (v - upMax > CONTRAST && v - dnMax > CONTRAST) light++
    }
    darkCover[y] = dark / cols
    lightCover[y] = light / cols
  }
  const out: Line[] = []
  for (const [cover, light] of [[darkCover, false], [lightCover, true]] as const) {
    let run: number[] = []
    const flush = () => {
      if (!run.length) return
      let wsum = 0
      let ysum = 0
      let top = 0
      for (const y of run) {
        wsum += cover[y]
        ysum += y * cover[y]
        top = Math.max(top, cover[y])
      }
      out.push({ y: ysum / wsum, cover: top, light })
      run = []
    }
    for (let y = 0; y < h; y++) {
      if (cover[y] >= MIN_COVER) {
        if (run.length && y - run[run.length - 1] > 1) flush()
        run.push(y)
      } else if (run.length && y - run[run.length - 1] > 1) flush()
    }
    flush()
  }
  return out.sort((a, b) => a.y - b.y)
}

/** Columns where most of the six lines are drawn: the staff runs from the first to the last of them. */
function extent(img: Gray, lines: number[], light: boolean, spacing: number): [number, number] | null {
  const { width: w, data } = img
  const hits = new Uint8Array(w)
  for (const ly of lines) {
    const y = Math.round(ly)
    for (let x = 0; x < w; x++) {
      let on = false
      for (let d = -1; d <= 1 && !on; d++) {
        const yy = y + d
        const r = yy * w + x
        const v = data[r]
        const a = Math.min(data[r - 2 * w], data[r - 3 * w])
        const b = Math.min(data[r + 2 * w], data[r + 3 * w])
        const A = Math.max(data[r - 2 * w], data[r - 3 * w])
        const B = Math.max(data[r + 2 * w], data[r + 3 * w])
        on = light ? v - A > CONTRAST && v - B > CONTRAST : a - v > CONTRAST && b - v > CONTRAST
      }
      if (on) hits[x]++
    }
  }
  // Runs of columns where at least four lines show, bridging gaps a digit or two wide.
  const gap = Math.round(spacing * 2.5)
  let best: [number, number] | null = null
  let start = -1
  let last = -1
  for (let x = 0; x <= w; x++) {
    const on = x < w && hits[x] >= 4
    if (on) {
      if (start < 0 || x - last > gap) {
        if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last]
        start = x
      }
      last = x
    }
  }
  if (start >= 0 && (!best || last - start > best[1] - best[0])) best = [start, last]
  return best
}

/**
 * Find the tablature staves in a picture: six evenly spaced thin lines (a music staff has five)
 * running across a good part of it. Works on light or dark backgrounds.
 */
export function findStaves(img: Gray): Staff[] {
  const rows = lineRows(img)
  const out: Staff[] = []
  for (const light of [false, true]) {
    const ls = rows.filter((r) => r.light === light)
    for (let i = 0; i + 6 <= ls.length; i++) {
      const six = ls.slice(i, i + 6)
      const ys = six.map((l) => l.y)
      const covers = six.map((l) => l.cover)
      const gaps = ys.slice(1).map((y, k) => y - ys[k])
      const mean = (ys[5] - ys[0]) / 5
      if (mean < 6 || mean > img.height / 8) continue
      // All six are drawn across the staff; a five-line staff with one stray row is not.
      if (Math.min(...covers) < Math.max(...covers) * 0.5) continue
      if (gaps.some((g) => Math.abs(g - mean) > Math.max(1.5, mean * EVEN))) continue
      // A seventh line at the same spacing means this is not a six-line tab staff.
      const before = ls[i - 1]
      const after = ls[i + 6]
      if (before && Math.abs(ys[0] - before.y - mean) <= Math.max(1.5, mean * EVEN)) continue
      if (after && Math.abs(after.y - ys[5] - mean) <= Math.max(1.5, mean * EVEN)) continue
      const ext = extent(img, ys, light, mean)
      if (!ext || ext[1] - ext[0] < img.width * 0.3) continue
      out.push({ lines: ys, spacing: mean, x0: ext[0], x1: ext[1], light })
      i += 5
    }
  }
  return out.sort((a, b) => a.lines[0] - b.lines[0])
}
