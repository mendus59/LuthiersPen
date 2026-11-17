import { describe, expect, it, vi } from 'vitest'

vi.mock('firebase/app', () => ({ initializeApp: () => ({}) }))
vi.mock('firebase/auth', () => ({ getAuth: () => ({}), GoogleAuthProvider: class {} }))
vi.mock('firebase/firestore', () => ({ getFirestore: () => ({}) }))

const { retitleData } = await import('./firebase')

describe('retitleData', () => {
  it('changes only the title of the stored score', () => {
    const before = { score: { title: 'Old', composer: 'Tárrega', measures: [[1]] }, timing: { beats: [0, 0.5] } }
    const after = JSON.parse(retitleData(JSON.stringify(before), 'Lágrima'))
    expect(after.score.title).toBe('Lágrima')
    expect(after.score.composer).toBe('Tárrega')
    expect(after.score.measures).toEqual([[1]])
    expect(after.timing).toEqual(before.timing)
  })
})
