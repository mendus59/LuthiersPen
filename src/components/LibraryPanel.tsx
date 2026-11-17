import { useState } from 'react'
import { type SavedScore, type User, explain, registerEmail, signInEmail, signInGoogle } from '../firebase'

interface Props {
  user: User | null
  scores: SavedScore[] | null
  currentId: string | null
  error: string | null
  onOpen(id: string): void
  onDelete(id: string): void
  /** Save a new title for a saved piece. Rejects with the reason if it could not. */
  onRename(id: string, title: string): Promise<void>
  onRefresh(): void
}

export function LibraryPanel({ user, scores, currentId, error, onOpen, onDelete, onRename, onRefresh }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)
  /** The piece whose title is being edited, and the text typed so far. */
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [renameSaving, setRenameSaving] = useState(false)

  const commitRename = async () => {
    if (!renaming || renameSaving) return
    const title = renaming.title.trim()
    const before = scores?.find((s) => s.id === renaming.id)?.title ?? ''
    if (!title || title === before) {
      setRenaming(null)
      return
    }
    setRenameSaving(true)
    setRenameError(null)
    try {
      await onRename(renaming.id, title)
      setRenaming(null)
    } catch (err) {
      setRenameError(`Could not rename: ${explain(err)}`)
    } finally {
      setRenameSaving(false)
    }
  }

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
              {renaming?.id === s.id ? (
                <form
                  className="rename"
                  onSubmit={(e) => {
                    e.preventDefault()
                    void commitRename()
                  }}
                >
                  <input
                    autoFocus
                    aria-label="New title"
                    value={renaming.title}
                    readOnly={renameSaving}
                    onChange={(e) => setRenaming({ id: s.id, title: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setRenaming(null)
                        setRenameError(null)
                      }
                    }}
                  />
                  <button type="submit" className="primary" disabled={renameSaving || !renaming.title.trim()}>
                    {renameSaving ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" className="link" disabled={renameSaving} onClick={() => { setRenaming(null); setRenameError(null) }}>
                    Cancel
                  </button>
                </form>
              ) : (
              <>
              <button className="open" onClick={() => onOpen(s.id)}>
                <strong>{s.title || 'Untitled'}</strong>
                <span>
                  {s.composer ? `${s.composer} · ` : ''}
                  {s.measures} measures{s.updated ? ` · ${s.updated.toLocaleDateString()}` : ''}
                </span>
              </button>
              <button
                className="link"
                aria-label={`Rename ${s.title}`}
                onClick={() => {
                  setRenameError(null)
                  setRenaming({ id: s.id, title: s.title })
                }}
              >
                Rename
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
              </>
              )}
            </li>
          ))}
        </ul>
      )}
      {renameError && <p className="warn" role="alert">{renameError}</p>}
      <button className="link" onClick={onRefresh}>Refresh</button>
    </div>
  )
}
