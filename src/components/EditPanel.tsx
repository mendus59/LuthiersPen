import * as ed from '../model/edit'
import { type Dur, type RhFinger, type Score, notePitch, pitchName } from '../model/score'

interface Props {
  score: Score
  selection: ed.Selection | null
  canUndo: boolean
  canRedo: boolean
  apply(edit: ed.Edit | null): void
  setScore(score: Score): void
  select(sel: ed.Selection): void
  undo(): void
  redo(): void
}

const DURS: Array<[Dur, string, string]> = [[1, '𝅝', 'Whole'], [2, '𝅗𝅥', 'Half'], [4, '♩', 'Quarter'], [8, '♪', 'Eighth'], [16, '𝅘𝅥𝅯', 'Sixteenth'], [32, '𝅘𝅥𝅰', 'Thirty-second']]
const LETTERS: Array<[string, number]> = [['C', 0], ['D', 2], ['E', 4], ['F', 5], ['G', 7], ['A', 9], ['B', 11]]

/** The sounding pitch nearest to `near` with the given pitch class. */
export function nearestPitch(pc: number, near: number): number {
  let p = near - ((((near - pc) % 12) + 12) % 12)
  if (near - p > 6) p += 12
  return Math.max(40, Math.min(83, p))
}

export function EditPanel({ score, selection: sel, apply, setScore, select, undo, redo, canUndo, canRedo }: Props) {
  const beat = ed.selectedBeat(score, sel)
  const note = ed.selectedNote(score, sel)
  const balance = sel ? ed.measureBalance(score, sel) : 0
  const hasBass = score.measures.some((m) => m.voices.length > 1)
  const near = note ? notePitch(score, note) : 64

  return (
    <div className="panel-body">
      <h2>Edit</h2>
      <div className="row">
        <button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">Undo</button>
        <button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">Redo</button>
      </div>

      <h3>Piece</h3>
      <div className="grid2">
        <label>
          Subtitle
          <input type="text" value={score.subtitle ?? ''} placeholder="e.g. Suite Española, Op. 47" onChange={(e) => setScore({ ...score, subtitle: e.target.value })} />
        </label>
        <label>
          Tempo marking
          <input type="text" value={score.tempoText ?? ''} placeholder="e.g. Allegro" onChange={(e) => setScore({ ...score, tempoText: e.target.value })} />
        </label>
        <label>
          Tempo
          <input type="number" min={20} max={240} value={score.tempo} onChange={(e) => setScore({ ...score, tempo: Math.max(20, Math.min(240, Number(e.target.value) || 60)) })} />
        </label>
        <label>
          Key signature
          <select value={score.key} onChange={(e) => setScore({ ...score, key: Number(e.target.value) })}>
            {[-7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7].map((k) => (
              <option key={k} value={k}>{k === 0 ? 'No sharps or flats' : k > 0 ? `${k} sharp${k > 1 ? 's' : ''}` : `${-k} flat${k < -1 ? 's' : ''}`}</option>
            ))}
          </select>
        </label>
        <label>
          Time signature
          <select
            value={score.timeSig.join('/')}
            onChange={(e) => setScore({ ...score, timeSig: e.target.value.split('/').map(Number) as [number, number] })}
          >
            {['4/4', '3/4', '2/4', '6/8', '3/8', '9/8', '12/8', '2/2'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <label>
          Sixth string
          <select
            value={score.tuning[5]}
            onChange={(e) => setScore({ ...score, tuning: [...score.tuning.slice(0, 5), Number(e.target.value)] })}
          >
            <option value={40}>E (standard)</option>
            <option value={38}>D (drop D)</option>
          </select>
        </label>
      </div>

      {!sel || !beat ? (
        <p className="hint">Click a note or rest in the score to edit it.</p>
      ) : (
        <>
          <h3>
            Measure {sel.m + 1}, {sel.v === 0 ? 'upper voice' : 'bass voice'}
            {note ? ` · ${pitchName(notePitch(score, note) + 12, score.key)}` : beat.notes.length === 0 ? ' · rest' : ''}
          </h3>
          {balance !== 0 && (
            <p className="warn">
              This voice is {balance < 0 ? 'shorter' : 'longer'} than the measure.{' '}
              <button className="link" onClick={() => apply(ed.fitMeasure(score, sel))}>Fit to measure</button>
            </p>
          )}

          <div className="label">Length</div>
          <div className="row wrap">
            {DURS.map(([d, glyph, name], i) => (
              <button key={d} className={`glyph ${beat.dur === d ? 'on' : ''}`} title={`${name} (${i + 1})`} onClick={() => apply(ed.setDuration(score, sel, d))}>{glyph}</button>
            ))}
            <button className={beat.dots ? 'on' : ''} title="Dotted (.)" onClick={() => apply(ed.toggleDot(score, sel))}>•</button>
            <button className={beat.tuplet ? 'on' : ''} title="Triplet" onClick={() => apply(ed.toggleTriplet(score, sel))}>3</button>
          </div>

          <div className="label">Add a note</div>
          <div className="row wrap">
            {LETTERS.map(([name, pc]) => (
              <button key={name} title={`Add ${name} (${name})`} onClick={() => apply(ed.addPitch(score, sel, nearestPitch(pc, near)))}>{name}</button>
            ))}
          </div>

          <div className="label">Strings and frets</div>
          <div className="frets">
            {score.tuning.map((_, i) => {
              const string = i + 1
              const n = beat.notes.find((x) => x.string === string)
              return (
                <label key={string} className={sel.string === string ? 'on' : ''}>
                  <span className="circ">{string}</span>
                  <input
                    type="number"
                    min={0}
                    max={19}
                    value={n ? n.fret : ''}
                    placeholder="–"
                    aria-label={`Fret on string ${string}`}
                    onFocus={() => n && select({ ...sel, string })}
                    onChange={(e) => {
                      if (e.target.value === '') apply(ed.removeNote(score, { ...sel, string }))
                      else apply(ed.setFret(score, sel, string, Number(e.target.value)))
                    }}
                  />
                </label>
              )
            })}
          </div>

          {note && (
            <>
              <div className="label">Pitch</div>
              <div className="row wrap">
                <button title="Up a semitone (↑)" onClick={() => apply(ed.transpose(score, sel, 1))}>♯ Up</button>
                <button title="Down a semitone (↓)" onClick={() => apply(ed.transpose(score, sel, -1))}>♭ Down</button>
                <button title="Same pitch on the next lower string" onClick={() => apply(ed.moveString(score, sel, 1))}>String +</button>
                <button title="Same pitch on the next higher string" onClick={() => apply(ed.moveString(score, sel, -1))}>String −</button>
              </div>
              <div className="label">Left hand</div>
              <div className="row wrap">
                {[1, 2, 3, 4].map((f) => (
                  <button key={f} className={note.lh === f ? 'on' : ''} onClick={() => apply(ed.setLh(score, sel, f))}>{f}</button>
                ))}
                <button className={note.showString ? 'on' : ''} title="Show the circled string number" onClick={() => apply(ed.toggleStringNumber(score, sel))}>
                  <span className="circ">{note.string}</span>
                </button>
              </div>
              <div className="label">Right hand</div>
              <div className="row wrap">
                {(['p', 'i', 'm', 'a'] as RhFinger[]).map((f) => (
                  <button key={f} className={`ital ${note.rh === f ? 'on' : ''}`} onClick={() => apply(ed.setRh(score, sel, f))}>{f}</button>
                ))}
                <button className={note.tie ? 'on' : ''} title="Tie from the previous note (T)" onClick={() => apply(ed.toggleTie(score, sel))}>Tie</button>
              </div>
            </>
          )}

          <div className="grid2">
            <label>
              Barre at fret
              <input type="number" min={0} max={15} value={beat.barre?.fret ?? 0} onChange={(e) => apply(ed.setBarre(score, sel, Number(e.target.value), !!beat.barre?.half))} />
            </label>
            <label className="check inline">
              <input type="checkbox" checked={!!beat.barre?.half} disabled={!beat.barre} onChange={(e) => apply(ed.setBarre(score, sel, beat.barre?.fret ?? 0, e.target.checked))} />
              Half barre
            </label>
          </div>
          <label>
            Text above the staff
            <input type="text" value={beat.text ?? ''} placeholder="e.g. VII, rit., dolce" onChange={(e) => apply(ed.setText(score, sel, e.target.value))} />
          </label>

          <div className="label">Beat</div>
          <div className="row wrap">
            <button title="Insert a beat after this one (Insert)" onClick={() => apply(ed.insertBeat(score, sel))}>Insert after</button>
            <button title="Make this beat a rest, or delete the selected note (Delete)" onClick={() => apply(ed.removeNote(score, sel))}>{note ? 'Delete note' : 'Clear'}</button>
            <button onClick={() => apply(ed.deleteBeat(score, sel))}>Remove beat</button>
          </div>
          <div className="label">Measure</div>
          <div className="row wrap">
            <button onClick={() => apply(ed.addMeasure(score, sel.m))}>Add after</button>
            <button onClick={() => apply(ed.deleteMeasure(score, sel.m))}>Delete</button>
            {hasBass ? (
              <button onClick={() => select({ m: sel.m, v: sel.v === 0 ? 1 : 0, b: 0, string: score.measures[sel.m].voices[sel.v === 0 ? 1 : 0]?.[0]?.notes[0]?.string })}>
                Switch to {sel.v === 0 ? 'bass' : 'upper'} voice
              </button>
            ) : (
              <button onClick={() => setScore(ed.ensureSecondVoice(score))}>Add bass voice</button>
            )}
          </div>
          <p className="hint keys">
            Keys: ← → move · ↑ ↓ pitch · C–G, A, B add a note · 1–6 length · . dot · T tie · Insert new beat · Delete remove · Space play
          </p>
        </>
      )}
    </div>
  )
}
