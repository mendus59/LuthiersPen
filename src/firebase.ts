import { initializeApp } from 'firebase/app'
import {
  GoogleAuthProvider, type User, createUserWithEmailAndPassword, getAuth, onAuthStateChanged,
  signInWithEmailAndPassword, signInWithPopup, signOut,
} from 'firebase/auth'
import {
  addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, orderBy, query, serverTimestamp, setDoc, updateDoc,
} from 'firebase/firestore'
import type { Score } from './model/score'
import type { Timing } from './transcribe/tempo'

// Public web configuration for the "luthierspen" Firebase project. These values identify the
// project to Google; access is controlled by Firebase Auth and the Firestore security rules.
const firebaseConfig = {
  apiKey: 'AIzaSyBA7FTNCG-6-uQyXcShgLccmRbU6rO-MD4',
  authDomain: 'luthierspen.firebaseapp.com',
  projectId: 'luthierspen',
  storageBucket: 'luthierspen.firebasestorage.app',
  messagingSenderId: '1044203939856',
  appId: '1:1044203939856:web:4beda77fdc26314ff48295',
  measurementId: 'G-G8KQYLBYG9',
}

const app = initializeApp(firebaseConfig)
const auth = getAuth(app)
const db = getFirestore(app)

export type { User }

export const watchUser = (cb: (user: User | null) => void) => onAuthStateChanged(auth, cb)
export const signInGoogle = () => signInWithPopup(auth, new GoogleAuthProvider())
export const signInEmail = (email: string, password: string) => signInWithEmailAndPassword(auth, email, password)
export const registerEmail = (email: string, password: string) => createUserWithEmailAndPassword(auth, email, password)
export const signOutUser = () => signOut(auth)

export interface SavedScore {
  id: string
  title: string
  composer: string
  measures: number
  updated: Date | null
}

export interface ScoreDocument {
  score: Score
  /** Beat times of the recording the score was transcribed from, if any. */
  timing: Timing | null
}

const scoresOf = (uid: string) => collection(db, 'users', uid, 'scores')

/** Save a score to the signed-in user's library. Returns the document id. */
export async function saveScore(uid: string, id: string | null, data: ScoreDocument): Promise<string> {
  const body = {
    title: data.score.title,
    composer: data.score.composer,
    measures: data.score.measures.length,
    updated: serverTimestamp(),
    // Firestore cannot store arrays of arrays, so the score itself is kept as JSON text.
    data: JSON.stringify(data),
  }
  if (id) {
    await setDoc(doc(scoresOf(uid), id), body)
    return id
  }
  return (await addDoc(scoresOf(uid), body)).id
}

export async function listScores(uid: string): Promise<SavedScore[]> {
  const snap = await getDocs(query(scoresOf(uid), orderBy('updated', 'desc')))
  return snap.docs.map((d) => {
    const x = d.data()
    return { id: d.id, title: x.title ?? 'Untitled', composer: x.composer ?? '', measures: x.measures ?? 0, updated: x.updated?.toDate?.() ?? null }
  })
}

export async function loadScore(uid: string, id: string): Promise<ScoreDocument | null> {
  const snap = await getDoc(doc(scoresOf(uid), id))
  if (!snap.exists()) return null
  return JSON.parse(snap.data().data as string) as ScoreDocument
}

/** Put a new title into a saved document's JSON text, leaving the rest as it was. */
export function retitleData(json: string, title: string): string {
  const data = JSON.parse(json) as ScoreDocument
  return JSON.stringify({ ...data, score: { ...data.score, title } })
}

/**
 * Rename a saved score without touching anything else in it. The library list shows the
 * `title` field and opening a score reads the JSON, so both are changed together.
 */
export async function renameScore(uid: string, id: string, title: string): Promise<void> {
  const ref = doc(scoresOf(uid), id)
  const snap = await getDoc(ref)
  if (!snap.exists()) throw new Error('That score no longer exists.')
  await updateDoc(ref, { title, data: retitleData(snap.data().data as string, title) })
}

export const deleteScore = (uid: string, id: string) => deleteDoc(doc(scoresOf(uid), id))

/** Turn a Firebase error into a sentence a person can act on. */
export function explain(err: unknown): string {
  const code = (err as { code?: string }).code ?? ''
  const map: Record<string, string> = {
    'auth/popup-closed-by-user': 'The sign-in window was closed before finishing.',
    'auth/unauthorized-domain': 'This site is not yet an authorized domain in the Firebase project.',
    'auth/operation-not-allowed': 'This sign-in method is not enabled in the Firebase project.',
    'auth/invalid-credential': 'That email and password do not match an account.',
    'auth/email-already-in-use': 'An account with that email already exists. Try signing in.',
    'auth/weak-password': 'Choose a password of at least six characters.',
    'auth/invalid-email': 'That does not look like an email address.',
    'permission-denied': 'The score library is not set up yet (Firestore rules refused the request).',
    'unavailable': 'Could not reach the score library. Check your connection and try again.',
  }
  return map[code] ?? (err as Error).message ?? 'Something went wrong.'
}
