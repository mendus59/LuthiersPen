import { type Measure, type Score, beatTicks, notePitch } from './score'

const SHARP = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const FLAT = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']

const KINDS: Array<[string, number[]]> = [
  ['', [0, 4, 7]],
  ['m', [0, 3, 7]],
  ['7', [0, 4, 7, 10]],
  ['m7', [0, 3, 7, 10]],
  ['maj7', [0, 4, 7, 11]],
  ['dim', [0, 3, 6]],
]

/**
 * Name the harmony of a measure from its notes, weighted by how long each lasts, in the style
 * of a guitar edition's chord symbols (Em, B7, Am/F♯). Returns '' when nothing fits well.
 */
export function chordName(score: Score, measure: Measure): string {
  const weight = new Array<number>(12).fill(0)
  let bass = Infinity
  let total = 0
  for (const voice of measure.voices) {
    for (const beat of voice) {
      const w = beatTicks(beat)
      for (const n of beat.notes) {
        const p = notePitch(score, n)
        weight[p % 12] += w
        total += w
        if (!n.tie || bass === Infinity) bass = Math.min(bass, p)
      }
    }
  }
  if (total === 0) return ''
  const names = score.key < 0 ? FLAT : SHARP
  const bassPc = bass % 12
  let best = { fit: -Infinity, root: 0, kind: '' }
  for (let root = 0; root < 12; root++) {
    for (const [kind, tones] of KINDS) {
      let inside = 0
      for (const t of tones) inside += weight[(root + t) % 12]
      const outside = total - inside
      const missing = tones.filter((t) => weight[(root + t) % 12] === 0).length
      // Reward covered notes, punish foreign ones and absent chord tones; prefer the bass as root and plain triads.
      const fit = inside - 1.2 * outside - 0.12 * total * missing + (root === bassPc ? 0.15 * total : 0) - (tones.length > 3 ? 0.12 * total : 0)
      if (fit > best.fit) best = { fit, root, kind }
    }
  }
  if (best.fit < 0.6 * total) return ''
  const name = names[best.root] + best.kind
  return bassPc === best.root ? name : `${name}/${names[bassPc]}`
}
