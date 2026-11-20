import { chordKey, layout, lookChange, type PlacedNumber, type StaffReading, type TabChord } from './read'

/** The tablature of a whole video, as written: systems joined, each bar its chords. */
export interface TabSheet {
  bars: TabChord[][]
  /** Number of different tab systems (lines of tab) read. */
  systems: number
  /** When each system was first on screen (seconds), and the index in `bars` of its first bar. */
  shown: Array<{ t: number; bar: number }>
}

/** What was read on one sampled frame, top staff first. */
export interface FrameReading {
  t: number
  staves: StaffReading[]
}

function chords(r: StaffReading): string[] {
  return r.bars.flatMap((b) => b.map(chordKey))
}

/** Longest common subsequence length of two lists. */
function lcs(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0
  let prev = new Uint16Array(b.length + 1)
  let cur = new Uint16Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** How alike two readings are, 0..1, by the chords they share in order. */
export function similarity(a: StaffReading, b: StaffReading): number {
  const x = chords(a)
  const y = chords(b)
  return lcs(x, y) / Math.max(1, x.length, y.length)
}

/** Lines of tab read at least this alike are the same line shown again. */
const SHOWN_AGAIN = 0.9

/**
 * Whether two frames in a row show the same line of tab. A moving cursor changes a few cells of
 * the picture; the next page, even one much like the last, changes more, and reads differently.
 */
function samePage(a: StaffReading, b: StaffReading): boolean {
  const change = lookChange(a, b)
  return change < 0.03 || (change < 0.1 && similarity(a, b) >= 0.93)
}

/**
 * One reading of a line of tab from all the frames that show it. A cursor or a hand covers a
 * different digit in each frame, so each number and barline is taken where most frames see it,
 * with the fret most of them read.
 */
export function vote(frames: StaffReading[]): StaffReading {
  const sp = frames[0].spacing
  const half = frames.length / 2
  const spots: Array<{ x: number; string: number; frets: Map<number, number>; harm: number; seen: number }> = []
  for (const r of frames) {
    for (const n of r.numbers) {
      let spot = spots.find((s) => s.string === n.string && Math.abs(s.x - n.x) < sp * 0.4)
      if (!spot) {
        spot = { x: n.x, string: n.string, frets: new Map(), harm: 0, seen: 0 }
        spots.push(spot)
      }
      spot.seen++
      if (n.harmonic) spot.harm++
      spot.frets.set(n.fret, (spot.frets.get(n.fret) ?? 0) + 1)
    }
  }
  const numbers: PlacedNumber[] = spots
    .filter((s) => s.seen > half)
    .map((s) => ({ x: s.x, string: s.string, fret: [...s.frets.entries()].sort((a, b) => b[1] - a[1])[0][0], ...(s.harm > s.seen / 2 ? { harmonic: true } : {}) }))
  const barSpots: Array<{ x: number; seen: number }> = []
  for (const r of frames) {
    for (const x of r.barXs) {
      const spot = barSpots.find((b) => Math.abs(b.x - x) < sp * 0.4)
      if (spot) spot.seen++
      else barSpots.push({ x, seen: 1 })
    }
  }
  const barXs = barSpots.filter((b) => b.seen > half).map((b) => b.x).sort((a, b) => a - b)
  return { ...frames[0], numbers, barXs, bars: layout(numbers, barXs, sp), unsure: 0 }
}

/**
 * Join the readings of frames sampled through a video into the tab of the whole piece. A line
 * of tab stays on screen over several frames: each is read the way most of its frames read it.
 * Lines are put in the order they first appear (top to bottom within a frame); a line that comes
 * back later (a lesson often shows the whole tab twice) is not added again, and where a new
 * page starts by repeating the last notes of the one before, those notes are taken once.
 */
export function joinSheet(frames: FrameReading[]): TabSheet {
  type Line = StaffReading[] & { t?: number }
  const lines: Line[] = []
  let open: Array<{ line: Line; reading: StaffReading }> = []
  for (const f of frames) {
    const now: Array<{ line: Line; reading: StaffReading }> = []
    for (const r of f.staves) {
      let line = open.find((o) => !now.some((n) => n.line === o.line) && samePage(o.reading, r))?.line
      if (!line) {
        line = Object.assign([], { t: f.t })
        lines.push(line)
      }
      line.push(r)
      now.push({ line, reading: r })
    }
    open = now
  }
  const shownAt = lines.filter((l) => l.length >= 2)
  const best = shownAt.map(vote)
  // The whole tab shown a second time: the lines start over from the first two.
  let end = best.length
  // (A song's verse can come back as the same lines too, so ask for four lines over again, or all
  // that is left.)
  for (let i = 2; i + 1 < best.length; i++) {
    const run = Math.min(4, best.length - i)
    if (run >= 3 && Array.from({ length: run }, (_, k) => similarity(best[i + k], best[k]) >= SHOWN_AGAIN).every(Boolean)) {
      end = i
      break
    }
  }
  // A line that seems to change for a moment (a fade, a hand passing) and comes straight back is
  // one line; the same line shown again after a while is played again.
  const keep = best.map((r, i) => i < end && (i === 0 || similarity(best[i - 1], r) < SHOWN_AGAIN || (shownAt[i].t ?? 0) - (shownAt[i - 1].t ?? 0) > 6))
  const kept = best.filter((_, i) => keep[i])
  const times = shownAt.filter((_, i) => keep[i]).map((l) => l.t ?? 0)
  const bars: TabChord[][] = []
  const shown: TabSheet['shown'] = []
  kept.forEach((r, i) => {
    shown.push({ t: times[i], bar: bars.length })
    let mine = r.bars.map((b) => [...b])
    if (i > 0 && bars.length) {
      const before = bars.flat().slice(-24).map(chordKey)
      const now = mine.flat().map(chordKey)
      let overlap = 0
      // Only a page that opens with part of a bar: a tab strip that carries on from the last page.
      const sizes = mine.map((b) => b.length).sort((a, b) => a - b)
      const partial = mine.length > 1 && mine[0].length < sizes[Math.floor(sizes.length / 2)]
      for (let k = partial ? Math.min(before.length, mine[0].length) : 0; k >= 5; k--) {
        // The repeated notes sit at the edge of the old page and may be read a little differently there.
        const tail = before.slice(-k)
        let same = 0
        for (let q = 0; q < k; q++) if (tail[q] === now[q]) same++
        if (same >= k * 0.8) {
          overlap = k
          break
        }
      }
      let drop = overlap
      mine = mine.map((b) => {
        const cut = Math.min(drop, b.length)
        drop -= cut
        return b.slice(cut)
      })
    }
    bars.push(...mine.filter((b) => b.length))
  })
  return { bars, systems: kept.length, shown }
}
