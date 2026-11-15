import model from './repeat-model.json'

/** Time grid for comparing passages, in seconds. */
const BIN = 0.1
/** Length of passage compared around each moment, in bins (3 s). */
const SPAN = 30
/** A repeat starts at least this many bins (2 s) away. */
const MIN_LAG = 20
/** Passages count as the same music above this similarity. */
const ALIKE = 0.3
/** Repeats looked at for each moment. */
const TOP = 3
/** How far a note may drift between repeats, in seconds. */
const DRIFT = 0.2

/**
 * For each candidate, what the same moment in repeated passages says about it. Music repeats
 * (a theme, a refrain, a da capo), and a note the guitarist played clearly in one repeat is
 * likely meant in another where it came out softer. Passages are compared by the pitches
 * proposed in each tenth of a second, weighted by how likely each is a played note.
 *
 * Returns per candidate: [best chance of the same pitch at the same spot in a repeat,
 * mean of those chances, repeats found, similarity of the closest repeat, repeats that agree].
 */
export function repeatFeatures(start: number[], pitch: number[], chance: number[]): number[][] {
  const n = start.length
  if (n === 0) return []
  const T = Math.floor(Math.max(...start) / BIN) + 2
  const V = Array.from({ length: T }, () => new Float64Array(88))
  for (let i = 0; i < n; i++) V[Math.floor(start[i] / BIN)][pitch[i] - 21] += chance[i]
  // Tolerate small timing differences: a pitch also counts half in the next bin.
  const W = V.map((row, t) => row.map((v, q) => Math.max(v, t > 0 ? V[t - 1][q] * 0.5 : V[T - 1][q] * 0.5)))
  const norm = W.map((row) => Math.sqrt(row.reduce((s, v) => s + v * v, 0)) + 1e-6)
  const sim = (a: number, b: number) => {
    let s = 0
    for (let q = 0; q < 88; q++) s += W[a][q] * W[b][q]
    return s / (norm[a] * norm[b])
  }
  // For each moment, the lags at which a passage of SPAN bins around it matches.
  const lags: number[] = []
  for (let L = -T + MIN_LAG; L < T - MIN_LAG; L++) lags.push(L)
  // Similarities kept to four decimals in two bytes each (0 = no comparison), so a long piece fits in memory.
  const Sd = Array.from({ length: T }, () => new Uint16Array(lags.length))
  const half = Math.floor((SPAN - 1) / 2)
  lags.forEach((L, j) => {
    if (Math.abs(L) < MIN_LAG) return
    const a = Math.max(0, -L)
    const b = Math.min(T, T - L)
    if (b - a < SPAN) return
    const dg = new Float64Array(b - a)
    for (let t = a; t < b; t++) dg[t - a] = sim(t, t + L)
    const pre = new Float64Array(dg.length + 1)
    for (let i = 0; i < dg.length; i++) pre[i + 1] = pre[i] + dg[i]
    for (let i = 0; i < dg.length; i++) {
      const lo = Math.max(0, i + half - SPAN + 1)
      const hi = Math.min(dg.length - 1, i + half)
      Sd[a + i][j] = 1 + Math.round(Math.max(0, (pre[hi + 1] - pre[lo]) / SPAN) * 60000)
    }
  })
  const best = new Map<number, { lag: number; sim: number }[]>()
  const bins = start.map((s) => Math.floor(s / BIN))
  for (const t of new Set(bins)) {
    const row = Float64Array.from(Sd[t], (v) => (v === 0 ? -1 : (v - 1) / 60000))
    const sel: { lag: number; sim: number }[] = []
    for (let k = 0; k < TOP; k++) {
      let j = 0
      for (let x = 1; x < row.length; x++) if (row[x] > row[j]) j = x
      if (row[j] < ALIKE) break
      sel.push({ lag: lags[j], sim: row[j] })
      for (let x = Math.max(0, j - MIN_LAG); x < Math.min(row.length, j + MIN_LAG); x++) row[x] = -1
    }
    best.set(t, sel)
  }
  return start.map((s, i) => {
    const sel = best.get(bins[i])!
    const vals = sel.map(({ lag }) => {
      const at = s + lag * BIN
      let m = 0
      for (let j = 0; j < n; j++) if (pitch[j] === pitch[i] && Math.abs(start[j] - at) <= DRIFT) m = Math.max(m, chance[j])
      return m
    })
    if (vals.length === 0) return [-1, -1, 0, 0, 0]
    return [Math.max(...vals), vals.reduce((a, b) => a + b, 0) / vals.length, sel.length, sel[0].sim, vals.filter((v) => v > 0.5).length]
  })
}

/** Revise a candidate's chance with what its repeats say (a logistic blend fitted on the lesson videos). */
export function withRepeats(chance: number[], rep: number[][]): number[] {
  return chance.map((p, i) => {
    const c = Math.min(Math.max(p, 1e-4), 1 - 1e-4)
    let z = model.b + model.w[0] * Math.log(c / (1 - c))
    for (let k = 0; k < 5; k++) z += model.w[k + 1] * rep[i][k]
    return 1 / (1 + Math.exp(-z))
  })
}
