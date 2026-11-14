import { useState } from 'react'
import { type SavedScore, type User, explain, registerEmail, signInEmail, signInGoogle } from '../firebase'

interface Props {
  user: User | null
  scores: SavedScore[] | null
  currentId: string | null
  error: string | null
  onOpen(id: string): void
  onDelete(id: string): void
  onRefresh(): void
}

export function LibraryPanel({ user, scores, currentId, error, onOpen, onDelete, onRefresh }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    setWorking(true)
    setAuthError(null)
    try {
      await fn()
    } catch (err) {
      setAuthError(explain(err))
    } finally {
      setWorking(false)
    }
  }

  if (!user) {
    return (
      <div className="panel-body">
        <h2>Your library</h2>
        <p className="hint">Sign in to save transcriptions and scores you write, and to open them again on any device.</p>
        <button className="primary" disabled={working} onClick={() => void run(signInGoogle)}>Continue with Google</button>
        <div className="or">or</div>
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault()
            void run(() => signInEmail(email, password))
          }}
        >
          <input type="email" placeholder="Email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
          <div className="row">
            <button type="submit" disabled={working}>Sign in</button>
            <button type="button" disabled={working || !email || password.length < 6} onClick={() => void run(() => registerEmail(email, password))}>Create account</button>
          </div>
        </form>
        {authError && <p className="warn" role="alert">{authError}</p>}
      </div>
    )
  }

  return (
    <div className="panel-body">
      <h2>Your library</h2>
      {error && <p className="warn" role="alert">{error}</p>}
      {scores === null ? (
        <p className="hint">Loading…</p>
      ) : scores.length === 0 ? (
        <p className="hint">Nothing saved yet. Use Save in the top bar to keep the score you are working on.</p>
      ) : (
        <ul className="library">
          {scores.map((s) => (
            <li key={s.id} className={s.id === currentId ? 'on' : ''}>
              <button className="open" onClick={() => onOpen(s.id)}>
                <strong>{s.title || 'Untitled'}</strong>
                <span>
                  {s.composer ? `${s.composer} · ` : ''}
                  {s.measures} measures{s.updated ? ` · ${s.updated.toLocaleDateString()}` : ''}
                </span>
              </button>
              <button
                className="link danger"
                aria-label={`Delete ${s.title}`}
                onClick={() => {
                  if (window.confirm(`Delete “${s.title || 'Untitled'}” from your library?`)) onDelete(s.id)
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <button className="link" onClick={onRefresh}>Refresh</button>
    </div>
  )
}
