import { expect, it } from 'vitest'
import { cleanEvents } from './clean'

const RATE = 22050

/** A plucked string: a few partials that start at once and die away. */
function pluck(mono: Float32Array, pitch: number, start: number, seconds: number) {
  const f0 = 440 * Math.pow(2, (pitch - 69) / 12)
  const from = Math.round(start * RATE)
  for (let i = 0; i < seconds * RATE && from + i < mono.length; i++) {
    const t = i / RATE
    for (let h = 1; h <= 4; h++) mono[from + i] += (0.2 / h) * Math.exp(-1.2 * t) * Math.sin(2 * Math.PI * f0 * h * t)
  }
}

it('keeps plucked notes and drops a ringing string reported as plucked again', () => {
  const mono = new Float32Array(RATE * 3)
  pluck(mono, 45, 0.2, 2.5)
  pluck(mono, 64, 1.0, 1.5)
  const events = [
    { start: 0.2, duration: 0.75, pitch: 45, amplitude: 0.8 },
    { start: 1.0, duration: 0.5, pitch: 64, amplitude: 0.7 },
    { start: 1.0, duration: 0.6, pitch: 45, amplitude: 0.7 },
  ]
  const kept = cleanEvents(events, mono, RATE)
  expect(kept.map((e) => [e.start, e.pitch])).toEqual([
    [0.2, 45],
    [1.0, 64],
  ])
  // The bass note rings on through the false re-attack.
  expect(kept[0].duration).toBeCloseTo(1.4)
})
