import { expect, it } from 'vitest'
import { parseTime } from './TranscribePanel'

it('reads times typed as seconds or minutes:seconds', () => {
  expect(parseTime('83')).toBe(83)
  expect(parseTime('1:23')).toBe(83)
  expect(parseTime(' 2:05.5 ')).toBe(125.5)
  expect(parseTime('')).toBeNull()
  expect(parseTime('end')).toBeNull()
})
