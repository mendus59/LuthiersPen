import { MAX_FRET, type RhFinger } from '../model/score'

/** A quantized note waiting for a place on the fingerboard. */
export interface GridNote {
  step: number
  end: number
  pitch: number
  amplitude: number
  bass: boolean
  /** Filled in by assignFingerboard; a string already set (with its fret) is where the tab says the note is played. */
  string: number
  fret: number
  lh?: number
  rh?: RhFinger
  showString?: boolean
}

export interface GroupMark {
  step: number
  barre?: { fret: number; half?: boolean }
  text?: string
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI']
const MAX_POS = 15
const INF = 1e9

interface Choice {
  cost: number
  places: Array<{ string: number; fret: number }>
}

function candidates(tuning: number[], pitch: number) {
  const out: Array<{ string: number; fret: number }> = []
  for (let s = 1; s <= tuning.length; s++) {
    const fret = pitch - tuning[s - 1]
    if (fret >= 0 && fret <= MAX_FRET) out.push({ string: s, fret })
  }
  return out
}

/** Cheapest way to play a chord with the hand in position `pos` (index finger at fret `pos`). */
function bestInPosition(cands: Array<Array<{ string: number; fret: number }>>, pos: number): Choice {
  let best: Choice = { cost: INF, places: [] }
  const used = new Set<number>()
  const cur: Array<{ string: number; fret: number }> = []
  const walk = (i: number, cost: number) => {
    if (cost >= best.cost) return
    if (i === cands.length) {
      best = { cost, places: cur.map((c) => ({ ...c })) }
      return
    }
    for (const c of cands[i]) {
      if (used.has(c.string)) continue
      let extra = 0
      if (c.fret > 0) {
        if (c.fret < pos) extra += 40 * (pos - c.fret)
        else if (c.fret > pos + 3) extra += 6 * (c.fret - pos - 3) ** 2
        extra += 0.08 * c.fret
      } else if (pos > 4) {
        extra += 0.3 // open strings sound different high up the neck; allow, but prefer stopped notes a little less
      }
      used.add(c.string)
      cur.push(c)
      walk(i + 1, cost + extra)
      cur.pop()
      used.delete(c.string)
    }
  }
  walk(0, 0)
  return best
}

/**
 * Choose a string and fret for every note so that the left hand stays in position where it can
 * and shifts where it must (Viterbi over hand positions), then add the fingerings, string
 * numbers, barre and position marks a printed classical guitar edition would carry.
 * Notes that cannot be played together are removed from `notes`.
 */
export function assignFingerboard(notes: GridNote[], tuning: number[]): { notes: GridNote[]; marks: GroupMark[] } {
  const bySteps = new Map<number, GridNote[]>()
  for (const n of notes) {
    const g = bySteps.get(n.step)
    if (g) g.push(n)
    else bySteps.set(n.step, [n])
  }
  const steps = [...bySteps.keys()].sort((a, b) => a - b)
  const groups: GridNote[][] = []
  const kept: GridNote[] = []

  // Per group and position: the best assignment.
  const table: Choice[][] = []
  for (const step of steps) {
    let group = bySteps.get(step)!.sort((a, b) => a.pitch - b.pitch)
    let row: Choice[] = []
    for (;;) {
      // A place given by the tab is kept; others are chosen.
      const cands = group.map((n) => (n.string && tuning[n.string - 1] + n.fret === n.pitch && n.fret <= MAX_FRET ? [{ string: n.string, fret: n.fret }] : candidates(tuning, n.pitch)))
      row = []
      for (let p = 1; p <= MAX_POS; p++) row.push(bestInPosition(cands, p))
      if (row.some((c) => c.cost < INF) || group.length === 0) break
      // Unplayable together (two notes that only exist on one string): drop the quietest.
      const quiet = group.reduce((a, b) => (b.amplitude < a.amplitude ? b : a))
      group = group.filter((n) => n !== quiet)
    }
    if (group.length === 0) continue
    groups.push(group)
    table.push(row)
    kept.push(...group)
  }

  // Viterbi over hand positions.
  const G = groups.length
  const cost: Float64Array[] = []
  const from: Int8Array[] = []
  for (let g = 0; g < G; g++) {
    cost.push(new Float64Array(MAX_POS).fill(INF))
    from.push(new Int8Array(MAX_POS).fill(-1))
    for (let p = 0; p < MAX_POS; p++) {
      const here = table[g][p].cost + 0.04 * p
      if (g === 0) {
        cost[g][p] = here
        continue
      }
      for (let q = 0; q < MAX_POS; q++) {
        const move = q === p ? 0 : 1.2 + 0.9 * Math.abs(p - q)
        const v = cost[g - 1][q] + move + here
        if (v < cost[g][p]) {
          cost[g][p] = v
          from[g][p] = q
        }
      }
    }
  }
  const pos = new Array<number>(G).fill(1)
  if (G > 0) {
    let p = 0
    for (let q = 1; q < MAX_POS; q++) if (cost[G - 1][q] < cost[G - 1][p]) p = q
    for (let g = G - 1; g >= 0; g--) {
      pos[g] = p + 1
      p = from[g][p] >= 0 ? from[g][p] : p
    }
  }

  // A group of only open strings has no position of its own: carry the neighbours' position through.
  const marks: GroupMark[] = []
  let printedPos = -1
  let shown = new Set<string>()
  let lastUpper: { string: number; rh: RhFinger } | null = null

  for (let g = 0; g < G; g++) {
    const group = groups[g]
    const places = table[g][pos[g] - 1].places
    group.forEach((n, i) => {
      n.string = places[i].string
      n.fret = places[i].fret
    })
    const fretted = group.filter((n) => n.fret > 0)
    const handPos = fretted.length ? Math.min(pos[g], Math.min(...fretted.map((n) => n.fret))) : printedPos
    const mark: GroupMark = { step: group[0].step }

    const shifted = fretted.length > 0 && handPos !== printedPos
    if (shifted) {
      shown = new Set()
      if (printedPos !== -1 || handPos > 1) {
        if (handPos >= 2) mark.text = ROMAN[handPos] ?? String(handPos)
      }
      printedPos = handPos
    }

    // Barre: two or more notes stopped by the first finger.
    const atIndex = fretted.filter((n) => n.fret === handPos)
    if (atIndex.length >= 2 && group.length >= 3) {
      const lowString = Math.max(...atIndex.map((n) => n.string))
      const blocked = group.some((n) => n.fret === 0 && n.string < lowString)
      if (!blocked) {
        // Every beat under the barre carries it, so the engraver can draw one bracket over the run.
        mark.barre = { fret: handPos, half: lowString <= 4 }
        delete mark.text
      }
    }

    for (const n of group) {
      if (n.fret > 0) {
        const finger = Math.max(1, Math.min(4, n.fret - handPos + 1))
        const key = `${n.string}:${n.fret}`
        if (!shown.has(key)) {
          shown.add(key)
          n.lh = finger
          // A string number where the note is not in its usual, lowest place.
          const lowest = candidates(tuning, n.pitch).sort((a, b) => a.fret - b.fret)[0]
          if (lowest.string !== n.string) n.showString = true
        }
      }
      // Right hand: thumb for the bass, i-m-a on the trebles, alternating on a repeated string.
      if (n.bass || n.string >= 5) n.rh = 'p'
      else if (n.string === 4) n.rh = group.length > 1 && group[0] === n ? 'p' : 'i'
      else n.rh = n.string === 3 ? 'i' : n.string === 2 ? 'm' : 'a'
    }
    const upper = group.filter((n) => !n.bass && n.rh !== 'p')
    if (upper.length === 1) {
      const n = upper[0]
      if (lastUpper && lastUpper.string === n.string && lastUpper.rh === n.rh) n.rh = n.rh === 'i' ? 'm' : 'i'
      lastUpper = { string: n.string, rh: n.rh! }
    } else if (upper.length > 1) {
      lastUpper = null
    }

    if (mark.barre || mark.text) marks.push(mark)
  }

  return { notes: kept, marks }
}
