// Keys and the spelling of notes in them, the way a printed edition writes them: the key
// signature gives the scale, and the notes outside it take the accidental a musician expects
// (the raised leading tone in a minor key, F♯ rather than G♭ as the way into G in C major).

export interface Key {
  /** Sharps (positive) or flats (negative) in the key signature, -7..7. */
  sharps: number
  minor: boolean
}

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]
const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11]
const MINOR_STEPS = [0, 2, 3, 5, 7, 8, 10]
/**
 * The scale degree (0-6) a note outside the scale is written on, by semitones above the tonic.
 * Major: ♭2, ♭3, ♯4, ♯5, ♭7. Minor: ♭2 (Neapolitan), ♯3 (major tonic chord), ♯4, ♯6 and ♯7 (melodic and harmonic minor).
 */
const MAJOR_CHROMATIC: Record<number, number> = { 1: 1, 3: 2, 6: 3, 8: 4, 10: 6 }
const MINOR_CHROMATIC: Record<number, number> = { 1: 1, 4: 2, 6: 3, 9: 5, 11: 6 }

const mod = (x: number, m: number) => ((x % m) + m) % m

/** Letter (0 = C … 6 = B) of the key's tonic. */
function tonicLetter(k: Key): number {
  // Each sharp moves the major tonic up a fifth (four letters); the minor tonic is a sixth above it.
  return mod(4 * k.sharps + (k.minor ? 5 : 0), 7)
}

/** Pitch class (0 = C) of the key's tonic. */
export function keyTonic(k: Key): number {
  return mod(7 * k.sharps + (k.minor ? 9 : 0), 12)
}

/** 2 for a double accidental, 1 for a sharp or flat on a white key's pitch (B♯, E♯, C♭, F♭), else 0. */
function awkward(s: Spelling): number {
  if (Math.abs(s.offset) > 1) return 2
  return s.offset !== 0 && [0, 2, 4, 5, 7, 9, 11].includes(mod(LETTER_PC[s.letter] + s.offset, 12)) ? 1 : 0
}

export interface Spelling {
  /** 0 = C … 6 = B. */
  letter: number
  /** -2 double flat … 2 double sharp. */
  offset: number
}

/** How a pitch class is written in a key. */
export function spell(pc: number, k: Key): Spelling {
  const tonic = keyTonic(k)
  const t0 = tonicLetter(k)
  const steps = k.minor ? MINOR_STEPS : MAJOR_STEPS
  const above = mod(pc - tonic, 12)
  const on = (degree: number): Spelling => {
    const letter = mod(t0 + degree, 7)
    // How far the note is from the letter's own pitch.
    return { letter, offset: mod(pc - LETTER_PC[letter] + 6, 12) - 6 }
  }
  const degree = steps.indexOf(above)
  if (degree >= 0) return on(degree)
  const d = (k.minor ? MINOR_CHROMATIC : MAJOR_CHROMATIC)[above]
  const usual = on(d)
  // The raised notes of a minor key keep their letter (F𝄪 in G♯ minor). Otherwise a double
  // accidental, or a B♯, E♯, C♭ or F♭, gives way to the neighbouring letter: C rather than B♯ in E major.
  if (k.minor && above !== 1) return usual
  const other = on(steps[d] < above ? d + 1 : d - 1)
  return awkward(usual) > awkward(other) ? other : usual
}

const SIGNS: Record<number, string> = { [-2]: '𝄫', [-1]: '♭', 0: '', 1: '♯', 2: '𝄪' }

/** Written name of a pitch class in a key, e.g. "F♯". */
export function pcName(pc: number, k: Key): string {
  const s = spell(mod(pc, 12), k)
  return LETTERS[s.letter] + SIGNS[s.offset]
}

/** "D major", "F♯ minor". */
export function keyName(k: Key): string {
  return `${pcName(keyTonic(k), k)} ${k.minor ? 'minor' : 'major'}`
}

/** "2 sharps", "1 flat", "no sharps or flats". */
export function signatureName(sharps: number): string {
  if (sharps === 0) return 'no sharps or flats'
  const n = Math.abs(sharps)
  return `${n} ${sharps > 0 ? 'sharp' : 'flat'}${n > 1 ? 's' : ''}`
}

/** Every key a score can be in, from seven flats to seven sharps, major then minor. */
export const ALL_KEYS: Key[] = []
for (let s = -7; s <= 7; s++) ALL_KEYS.push({ sharps: s, minor: false }, { sharps: s, minor: true })

export const keyValue = (k: Key) => `${k.sharps}${k.minor ? 'm' : ''}`
export const parseKey = (v: string): Key => ({ sharps: parseInt(v, 10), minor: v.endsWith('m') })

/** Krumhansl-Kessler key profiles, from the tonic up. */
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
/** The usual signature for each major tonic (D♭ rather than C♯ major, F♯ rather than G♭)… */
const SHARPS_OF_MAJOR = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5]
/** …and for each minor tonic (E♭ rather than D♯ minor). */
const SHARPS_OF_MINOR = [-3, 4, -1, -6, 1, -4, 3, -2, 5, 0, -5, 2]

function correlation(hist: number[], profile: number[], tonic: number): number {
  const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / xs.length
  const hm = mean(hist)
  const pm = mean(profile)
  let num = 0
  let dp = 0
  let dh = 0
  for (let i = 0; i < 12; i++) {
    const h = hist[(i + tonic) % 12] - hm
    const q = profile[i] - pm
    num += h * q
    dp += q * q
    dh += h * h
  }
  return num / (Math.sqrt(dp * dh) || 1)
}

/**
 * The key whose profile best matches how long each pitch class sounds (Krumhansl-Schmuckler
 * key finding). `hist[pc]` is the weight of pitch class pc.
 */
export function keyFromHistogram(hist: number[]): Key {
  let best = { v: -Infinity, key: { sharps: 0, minor: false } as Key }
  for (let t = 0; t < 12; t++) {
    const mj = correlation(hist, MAJOR_PROFILE, t)
    if (mj > best.v) best = { v: mj, key: { sharps: SHARPS_OF_MAJOR[t], minor: false } }
    const mn = correlation(hist, MINOR_PROFILE, t)
    if (mn > best.v) best = { v: mn, key: { sharps: SHARPS_OF_MINOR[t], minor: true } }
  }
  return best.key
}
