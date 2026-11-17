import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckPanel } from './components/CheckPanel'
import { EditPanel, nearestPitch } from './components/EditPanel'
import { LibraryPanel } from './components/LibraryPanel'
import { type PlayerPosition, ScoreView, type ScoreViewHandle } from './components/ScoreView'
import { TranscribePanel, type TranscribeSettings } from './components/TranscribePanel'
import { type SavedScore, type User, deleteScore, explain, listScores, loadScore, renameScore, saveScore, signOutUser, watchUser } from './firebase'
import { demoScore } from './model/demo'
import * as ed from './model/edit'
import type { Key } from './model/keys'
import { type Dur, type Score, newScore, notePitch, scoreKey } from './model/score'
import type { RenderOptions } from './model/toAlphaTab'
import { MODEL_RATE, decodeToMono, monoToWav } from './transcribe/audio'
import { detectNotes } from './transcribe/detect'
import { fitBars } from './transcribe/bars'
import { guessKey, guessMeter, hearSwing, quantize, stepsPerBeat } from './transcribe/quantize'
import { type Timing, beatsToTime, rescaleTiming, timingTempo, trackBeats } from './transcribe/tempo'
import type { NoteEvent } from './transcribe/types'
import { type VerifyResult, verify } from './verify/verify'

type Tab = 'transcribe' | 'edit' | 'check' | 'library'
type Source = 'score' | 'recording' | 'both'

interface Recording {
  name: string
  mono: Float32Array
  url: string
  events: NoteEvent[]
  timing: Timing
  key: Key
}

const NONE: number[] = []
const DEFAULT_SETTINGS: TranscribeSettings = { timeSig: [4, 4], pickup: -1, grid: 16, twoVoices: true, pulse: 1, key: null }

export default function App() {
  const view = useRef<ScoreViewHandle>(null)
  const audio = useRef<HTMLAudioElement>(null)
  const [score, setScoreState] = useState<Score>(demoScore)
  const [undoStack, setUndo] = useState<Score[]>([])
  const [redoStack, setRedo] = useState<Score[]>([])
  const [selection, setSelection] = useState<ed.Selection | null>(null)
  const [tab, setTab] = useState<Tab>('transcribe')
  const [options, setOptions] = useState<RenderOptions>({ showLh: true, showRh: true, showStrings: true, showTab: true, showChords: true })
  const [zoom, setZoom] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [ready, setReady] = useState(false)
  const [position, setPosition] = useState<PlayerPosition>({ time: 0, end: 0 })
  const [speed, setSpeed] = useState(1)
  const [looping, setLooping] = useState(false)
  const [metronome, setMetronome] = useState(false)
  const [countIn, setCountIn] = useState(false)
  const [source, setSource] = useState<Source>('score')

  const [recording, setRecording] = useState<Recording | null>(null)
  const [settings, setSettings] = useState<TranscribeSettings>(DEFAULT_SETTINGS)
  /** Beat times of the recording, lined up with the current score. */
  const [sync, setSync] = useState<Timing | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [checkedScore, setCheckedScore] = useState<Score | null>(null)
  const [notice, setNotice] = useState<{ kind: 'error' | 'ok'; text: string } | null>(null)

  const [user, setUser] = useState<User | null>(null)
  const [library, setLibrary] = useState<SavedScore[] | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [docId, setDocId] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  // ---- score changes, with undo -------------------------------------------------------------
  const scoreRef = useRef(score)
  scoreRef.current = score
  const setScore = useCallback((next: Score) => {
    setUndo((u) => [...u.slice(-99), scoreRef.current])
    setRedo([])
    setScoreState(next)
    setDirty(true)
  }, [])
  const apply = useCallback(
    (edit: ed.Edit | null) => {
      if (!edit) return
      setScore(edit.score)
      setSelection(edit.sel)
    },
    [setScore],
  )
  const undo = () => {
    if (undoStack.length === 0) return
    setRedo([...redoStack, score])
    setScoreState(undoStack[undoStack.length - 1])
    setUndo(undoStack.slice(0, -1))
    setDirty(true)
  }
  const redo = () => {
    if (redoStack.length === 0) return
    setUndo([...undoStack, score])
    setScoreState(redoStack[redoStack.length - 1])
    setRedo(redoStack.slice(0, -1))
    setDirty(true)
  }
  /** Replace the whole document (new, opened, transcribed): clears history. */
  const openScore = useCallback((next: Score, opts: { id?: string | null; sync?: Timing | null; keepRecording?: boolean } = {}) => {
    view.current?.stop()
    setScoreState(next)
    setUndo([])
    setRedo([])
    setSelection(null)
    setDocId(opts.id ?? null)
    setSync(opts.sync ?? null)
    setResult(null)
    setCheckedScore(null)
    setDirty(false)
    if (!opts.keepRecording) {
      setRecording((r) => {
        if (r) URL.revokeObjectURL(r.url)
        return null
      })
      setSource('score')
    }
  }, [])

  // ---- transcription ------------------------------------------------------------------------
  const requantize = useCallback(
    (rec: Recording, s: TranscribeSettings, title?: string) => {
      const heard = s.pulse === 1 ? rec.timing : rescaleTiming(rec.timing, s.pulse)
      // Unless the pickup is fixed by hand, follow the bars of the performance to place the barlines.
      const fit = s.pickup >= 0 ? { timing: heard, pickup: s.pickup } : fitBars(rec.events, heard, s.timeSig)
      const { timing, pickup } = fit
      const out = quantize(rec.events, {
        timing,
        barBeats: 'barBeats' in fit ? fit.barBeats : undefined,
        timeSig: s.timeSig,
        pickupBeats: pickup,
        twoVoices: s.twoVoices,
        swing: hearSwing(rec.events, timing),
        grid: s.grid,
        key: s.key ?? rec.key,
        title: title ?? scoreRef.current.title,
        composer: scoreRef.current.composer,
      })
      openScore(out.score, { sync: out.timing, keepRecording: true })
      setDirty(true)
    },
    [openScore],
  )

  const onAudio = useCallback(
    async (data: ArrayBuffer, name: string, range?: { from: number; to: number }) => {
      setNotice(null)
      try {
        setBusy('Reading the audio…')
        setProgress(0)
        const whole = await decodeToMono(data)
        const mono = range ? whole.slice(Math.round(range.from * MODEL_RATE), Number.isFinite(range.to) ? Math.round(range.to * MODEL_RATE) : undefined) : whole
        if (mono.length < MODEL_RATE) throw new Error('That recording is too short to transcribe.')
        setBusy('Listening for notes…')
        const events = await detectNotes(mono, setProgress)
        if (events.length < 4) throw new Error('No guitar notes were found in that recording.')
        const rec: Recording = { name, mono, url: URL.createObjectURL(monoToWav(mono)), events, timing: trackBeats(events), key: guessKey(events) }
        setRecording((old) => {
          if (old) URL.revokeObjectURL(old.url)
          return rec
        })
        const s = { ...DEFAULT_SETTINGS, timeSig: guessMeter(rec.events, rec.timing), twoVoices: settings.twoVoices, grid: settings.grid }
        setSettings(s)
        scoreRef.current = { ...scoreRef.current, composer: '' }
        requantize(rec, s, name)
        setNotice({ kind: 'ok', text: `Transcribed ${events.length} notes. Open “Check” to compare it with the recording.` })
      } catch (err) {
        setNotice({ kind: 'error', text: (err as Error).message || 'That file could not be read as audio.' })
      } finally {
        setBusy(null)
      }
    },
    [requantize, settings.twoVoices, settings.grid],
  )

  const detected = useMemo(() => {
    if (!recording) return null
    const timing = settings.pulse === 1 ? recording.timing : rescaleTiming(recording.timing, settings.pulse)
    return { tempo: timingTempo(timing), notes: recording.events.length, pickup: fitBars(recording.events, timing, settings.timeSig).pickup, key: recording.key }
  }, [recording, settings.pulse, settings.timeSig])

  // ---- verification -------------------------------------------------------------------------
  const check = useCallback(async () => {
    if (!recording || !sync) return
    setBusy('Checking every note against the recording…')
    setProgress(0)
    // Let the progress message paint before the (synchronous) analysis starts.
    await new Promise((r) => setTimeout(r, 30))
    try {
      const current = scoreRef.current
      setResult(verify(current, recording.mono, MODEL_RATE, sync, recording.events))
      setCheckedScore(current)
    } catch (err) {
      setNotice({ kind: 'error', text: `The check could not run: ${(err as Error).message}` })
    } finally {
      setBusy(null)
    }
  }, [recording, sync])

  // ---- playback: keep the original recording in step with the score cursor -------------------
  useEffect(() => {
    view.current?.setVolume(source === 'recording' && recording ? 0 : 1)
  }, [source, recording, ready])
  useEffect(() => {
    const el = audio.current
    if (!el) return
    const wanted = playing && recording && sync && source !== 'score'
    if (!wanted) {
      if (!el.paused) el.pause()
      return
    }
    // Score seconds → beats of the tracked pulse → seconds in the recording.
    const pulseSec = (60 / score.tempo) * (stepsPerBeat(score.timeSig) / 4)
    const beats = position.time / pulseSec
    const target = beatsToTime(sync, beats)
    const local = pulseSec / Math.max(0.05, beatsToTime(sync, beats + 1) - target)
    const err = el.currentTime - target
    if (el.paused || Math.abs(err) > 0.35) {
      el.currentTime = Math.max(0, target)
      void el.play().catch(() => {})
    }
    el.playbackRate = Math.max(0.25, Math.min(4, speed * (1 / local) * (1 - Math.max(-0.2, Math.min(0.2, err)))))
    el.volume = source === 'both' ? 0.8 : 1
  }, [playing, position, recording, sync, source, speed, score.tempo, score.timeSig])

  useEffect(() => view.current?.setSpeed(speed), [speed, ready])
  useEffect(() => view.current?.setLooping(looping), [looping, ready])
  useEffect(() => view.current?.setMetronome(metronome), [metronome, ready])
  useEffect(() => view.current?.setCountIn(countIn), [countIn, ready])

  // ---- account and library ------------------------------------------------------------------
  const refreshLibrary = useCallback(async (u: User | null) => {
    if (!u) {
      setLibrary(null)
      return
    }
    try {
      setLibraryError(null)
      setLibrary(await listScores(u.uid))
    } catch (err) {
      setLibrary([])
      setLibraryError(explain(err))
    }
  }, [])
  useEffect(
    () =>
      watchUser((u) => {
        setUser(u)
        void refreshLibrary(u)
      }),
    [refreshLibrary],
  )

  const save = async () => {
    if (!user) {
      setTab('library')
      setNotice({ kind: 'ok', text: 'Sign in to save this score to your library.' })
      return
    }
    try {
      const id = await saveScore(user.uid, docId, { score, timing: sync })
      setDocId(id)
      setDirty(false)
      setNotice({ kind: 'ok', text: 'Saved to your library.' })
      void refreshLibrary(user)
    } catch (err) {
      setNotice({ kind: 'error', text: `Could not save: ${explain(err)}` })
    }
  }
  const confirmDiscard = () => !dirty || window.confirm('Discard the changes to the current score?')
  const open = async (id: string) => {
    if (!user || !confirmDiscard()) return
    try {
      const data = await loadScore(user.uid, id)
      if (!data) throw new Error('That score no longer exists.')
      openScore(data.score, { id })
      setTab('edit')
    } catch (err) {
      setNotice({ kind: 'error', text: `Could not open: ${explain(err)}` })
    }
  }
  /** Rename a saved piece from the library. The open copy follows if it is the same piece. */
  const rename = async (id: string, title: string) => {
    if (!user) return
    await renameScore(user.uid, id, title)
    if (id === docId) setScoreState((s) => ({ ...s, title }))
    setLibrary((list) => list?.map((x) => (x.id === id ? { ...x, title } : x)) ?? list)
  }
  /** Whether the score had unsaved changes when the title box was focused. */
  const titleFocus = useRef<{ dirty: boolean; title: string } | null>(null)
  /** Typing a new title for a saved piece keeps it in the library as soon as you leave the box. */
  const commitTitle = async () => {
    const before = titleFocus.current
    titleFocus.current = null
    const title = score.title.trim()
    if (!user || !docId || !before || !title || title === before.title) return
    try {
      await renameScore(user.uid, docId, title)
      setLibrary((list) => list?.map((x) => (x.id === docId ? { ...x, title } : x)) ?? list)
      // Only the title changed since the last save, so the piece is saved again.
      if (!before.dirty) setDirty(false)
    } catch (err) {
      setNotice({ kind: 'error', text: `Could not rename: ${explain(err)}` })
    }
  }
  const remove = async (id: string) => {
    if (!user) return
    try {
      await deleteScore(user.uid, id)
      if (id === docId) setDocId(null)
      void refreshLibrary(user)
    } catch (err) {
      setLibraryError(explain(err))
    }
  }

  // ---- keyboard -----------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, select, textarea, [contenteditable]')) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        redo()
        return
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void save()
        return
      }
      if (mod || e.altKey) return
      if (e.key === ' ') {
        e.preventDefault()
        view.current?.playPause()
        return
      }
      const sel = selection
      const s = scoreRef.current
      if (!sel) return
      const key = e.key
      let handled = true
      if (key === 'ArrowRight') setSelection(ed.stepSelection(s, sel, 1))
      else if (key === 'ArrowLeft') setSelection(ed.stepSelection(s, sel, -1))
      else if (key === 'ArrowUp') apply(ed.transpose(s, sel, 1))
      else if (key === 'ArrowDown') apply(ed.transpose(s, sel, -1))
      else if (key === 'Delete' || key === 'Backspace') apply(ed.removeNote(s, sel))
      else if (key === 'Insert') apply(ed.insertBeat(s, sel))
      else if (key === '.') apply(ed.toggleDot(s, sel))
      else if (key.toLowerCase() === 't') apply(ed.toggleTie(s, sel))
      else if (/^[1-6]$/.test(key)) apply(ed.setDuration(s, sel, ([1, 2, 4, 8, 16, 32] as Dur[])[Number(key) - 1]))
      else if (/^[a-g]$/i.test(key)) {
        const pc = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }[key.toLowerCase()]!
        const note = ed.selectedNote(s, sel)
        apply(ed.addPitch(s, sel, nearestPitch(pc, note ? notePitch(s, note) : 64)))
      } else handled = false
      if (handled) {
        e.preventDefault()
        setTab('edit')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // Development hook for tuning the pipeline against known material; stripped from production builds.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    ;(window as unknown as Record<string, unknown>).__lp = {
      recording,
      result,
      score,
      sync,
      useEvents: (events: NoteEvent[]) => {
        if (!recording) return
        const rec = { ...recording, events, timing: trackBeats(events), key: guessKey(events) }
        setRecording(rec)
        requantize(rec, settings)
      },
    }
  })

  useEffect(() => {
    if (!notice || notice.kind === 'error') return
    const t = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const fmt = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`
  const fresh = result && checkedScore === score ? result : null
  const flagged = fresh ? fresh.flagged : NONE
  const renderOptions = useMemo(() => ({ ...options, doubts: fresh ? new Set(fresh.doubts) : undefined }), [options, fresh])

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <svg viewBox="0 0 32 32" aria-hidden="true">
            <path d="M22 3l7 7-13 13-8 2 2-8z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            <circle cx="8" cy="24" r="4.5" fill="currentColor" />
          </svg>
          <span>LuthiersPen</span>
          <span className="version" title={`Commit ${__APP_COMMIT__}, built ${__APP_BUILT__}`}>
            v{__APP_VERSION__} · {__APP_COMMIT__}
          </span>
        </div>
        <div className="titles">
          <input
            className="title"
            aria-label="Title"
            value={score.title}
            placeholder="Title"
            onFocus={() => { titleFocus.current = { dirty, title: score.title } }}
            onChange={(e) => setScore({ ...score, title: e.target.value })}
            onBlur={() => void commitTitle()}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
          <input className="composer" aria-label="Composer" value={score.composer} placeholder="Composer" onChange={(e) => setScore({ ...score, composer: e.target.value })} />
        </div>
        <div className="actions">
          <button
            onClick={() => {
              if (!confirmDiscard()) return
              openScore(newScore('Untitled', 8))
              setSelection({ m: 0, v: 0, b: 0 })
              setTab('edit')
            }}
          >
            New score
          </button>
          <button className="primary" onClick={() => void save()}>{dirty ? 'Save' : 'Saved'}</button>
          <details className="menu">
            <summary>Export</summary>
            <div>
              <button onClick={() => view.current?.print()}>Print or save as PDF</button>
              <button onClick={() => view.current?.downloadMidi()}>MIDI file</button>
              <button onClick={() => view.current?.downloadGuitarPro()}>Guitar Pro file</button>
            </div>
          </details>
          {user ? (
            <button className="link" onClick={() => void signOutUser()} title={user.email ?? ''}>Sign out</button>
          ) : (
            <button className="link" onClick={() => setTab('library')}>Sign in</button>
          )}
        </div>
      </header>

      <div className="transport">
        <button className="play" onClick={() => view.current?.playPause()} disabled={!ready} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button onClick={() => view.current?.stop()} disabled={!ready} aria-label="Stop">■</button>
        <span className="time">{fmt(position.time)} / {fmt(position.end)}</span>
        <label className="slider">
          Speed {Math.round(speed * 100)}%
          <input type="range" min={0.25} max={1.5} step={0.05} value={speed} onChange={(e) => setSpeed(Number(e.target.value))} />
        </label>
        <button className={looping ? 'on' : ''} onClick={() => setLooping(!looping)} title="Loop the passage you drag across in the score (or the whole piece)">Loop</button>
        <button className={metronome ? 'on' : ''} onClick={() => setMetronome(!metronome)}>Metronome</button>
        <button className={countIn ? 'on' : ''} onClick={() => setCountIn(!countIn)}>Count-in</button>
        {recording && sync && (
          <div className="seg small" title="What you hear on playback">
            {(['score', 'recording', 'both'] as Source[]).map((k) => (
              <button key={k} className={source === k ? 'on' : ''} onClick={() => setSource(k)}>{k === 'score' ? 'Score' : k === 'recording' ? 'Recording' : 'Both'}</button>
            ))}
          </div>
        )}
        <span className="spacer" />
        <div className="toggles">
          {([['showLh', 'Left hand'], ['showRh', 'Right hand'], ['showStrings', 'Strings'], ['showChords', 'Chords'], ['showTab', 'Tab']] as const).map(([k, label]) => (
            <label key={k} className="check">
              <input type="checkbox" checked={options[k]} onChange={(e) => setOptions({ ...options, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
          <button onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))} aria-label="Zoom out">−</button>
          <button onClick={() => setZoom((z) => Math.min(1.8, +(z + 0.1).toFixed(2)))} aria-label="Zoom in">+</button>
        </div>
      </div>

      {notice && (
        <div className={`notice ${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
          {notice.text}
          <button className="link" onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      <main>
        <ScoreView
          ref={view}
          score={score}
          options={renderOptions}
          zoom={zoom}
          selection={selection}
          flagged={flagged}
          onSelect={(sel) => {
            setSelection(sel)
            if (sel && tab !== 'check') setTab('edit')
          }}
          onPlaying={setPlaying}
          onPosition={setPosition}
          onReady={setReady}
        />
        <aside>
          <nav role="tablist">
            {(['transcribe', 'edit', 'check', 'library'] as Tab[]).map((k) => (
              <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {k === 'transcribe' ? 'Transcribe' : k === 'edit' ? 'Edit' : k === 'check' ? 'Check' : 'Library'}
              </button>
            ))}
          </nav>
          {tab === 'transcribe' && (
            <TranscribePanel
              busy={busy}
              progress={progress}
              hasCapture={!!recording}
              settings={settings}
              detected={detected}
              onAudio={(d, n, r) => void onAudio(d, n, r)}
              onSettings={(s) => {
                setSettings(s)
                if (recording) requantize(recording, s)
              }}
              onError={(text) => setNotice({ kind: 'error', text })}
            />
          )}
          {tab === 'edit' && (
            <EditPanel
              score={score}
              selection={selection}
              apply={apply}
              setScore={setScore}
              select={setSelection}
              undo={undo}
              redo={redo}
              canUndo={undoStack.length > 0}
              canRedo={redoStack.length > 0}
            />
          )}
          {tab === 'check' && (
            <CheckPanel
              result={result}
              keySig={scoreKey(score)}
              canCheck={!!recording && !!sync}
              busy={busy}
              progress={progress}
              stale={!!result && checkedScore !== score}
              onCheck={() => void check()}
              onMeasure={(i) => view.current?.seekMeasure(i)}
            />
          )}
          {tab === 'library' && (
            <LibraryPanel
              user={user}
              scores={library}
              currentId={docId}
              error={libraryError}
              onOpen={(id) => void open(id)}
              onDelete={(id) => void remove(id)}
              onRename={rename}
              onRefresh={() => void refreshLibrary(user)}
            />
          )}
        </aside>
      </main>
      <audio ref={audio} src={recording?.url} preload="auto" hidden />
    </div>
  )
}
