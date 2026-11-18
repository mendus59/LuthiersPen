import { useRef } from 'react'
import type { Comparison, MissingNote, StrayNote } from '../compare/compare'
import type { OriginalScore } from '../compare/original'
import type { Key } from '../model/keys'
import { pitchName } from '../model/score'

interface Props {
  original: { name: string; score: OriginalScore } | null
  result: Comparison | null
  keySig: Key
  busy: boolean
  stale: boolean
  error: string | null
  onFile(data: ArrayBuffer, name: string): void
  onCompare(): void
  onShow(at: { measure: number; voice: number; beat: number; string?: number }): void
  onAdd(note: MissingNote): void
  onRemove(note: StrayNote): void
}

/** A good arrangement keeps nearly all of the tune. */
const KEEPS = 0.9
/** Below this the two are probably not the same music, or not the same part of it. */
const SAME = 0.65

const INTERVALS = ['', 'a half step', 'a whole step', 'a minor third', 'a major third', 'a fourth', 'a tritone']

function keyChange(semitones: number): string {
  if (semitones === 0) return 'Same key as the original.'
  const up = semitones > 0
  return `Played ${INTERVALS[Math.abs(semitones)]} ${up ? 'higher' : 'lower'} than the original.`
}

function noteValues(ratio: number): string | null {
  if (ratio === 1) return null
  return ratio === 2 ? 'Written in halved note values (an original quarter is an eighth here).' : 'Written in doubled note values (an original eighth is a quarter here).'
}

export function ComparePanel({ original, result, keySig, busy, stale, error, onFile, onCompare, onShow, onAdd, onRemove }: Props) {
  const input = useRef<HTMLInputElement>(null)
  const name = (p: number) => pitchName(p + 12, keySig)
  const melodyShare = result && result.melody.total ? result.melody.found / result.melody.total : 0
  const missingMelody = result?.missing.filter((m) => m.role === 'melody') ?? []
  const missingBass = result?.missing.filter((m) => m.role === 'bass') ?? []
  return (
    <div className="panel-body">
      <h2>Compare with the original</h2>
      <p className="hint">
        Open the composer’s original score to check this arrangement against it. LuthiersPen lines the two up, even in another key or
        tempo, then lists melody notes the guitar version leaves out and notes the original doesn’t have, which are often transcription
        or playing slips.
      </p>
      <input
        ref={input}
        type="file"
        accept=".musicxml,.xml,.mxl,.gp,.gp3,.gp4,.gp5,.gpx,.gp7,.capx"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) onFile(await f.arrayBuffer(), f.name)
        }}
      />
      <div className="row">
        <button className={original ? '' : 'primary'} disabled={busy} onClick={() => input.current?.click()}>
          {original ? 'Open another original' : 'Open the original score'}
        </button>
        {original && (
          <button className="primary" disabled={busy} onClick={onCompare}>
            Compare again
          </button>
        )}
      </div>
      <p className="hint">MusicXML (.musicxml, .xml, .mxl) from MuseScore, IMSLP or most notation programs, or a Guitar Pro file.</p>
      {error && <p className="warn">{error}</p>}
      {busy && <p className="hint" role="status">Comparing…</p>}
      {original && (
        <p className="hint">
          <strong>{original.score.title || original.name}</strong>
          {original.score.composer ? `, ${original.score.composer}` : ''} · {original.score.measures} measures
        </p>
      )}
      {result && (
        <>
          <div className="scorecard">
            <div className={`big ${melodyShare >= KEEPS ? 'good' : melodyShare >= SAME ? 'fair' : 'poor'}`}>{Math.round(melodyShare * 100)}%</div>
            <div>
              <strong>of the original’s melody is in the arrangement</strong>
              <span>
                {result.melody.found} of {result.melody.total} melody notes
                {result.melodyOnly ? '' : `, ${result.bass.found} of ${result.bass.total} bass notes`}
                {result.melodyOnly ? '' : `, ${result.stray.length} note${result.stray.length === 1 ? '' : 's'} the original doesn’t have`}.
              </span>
              {stale && <span className="warn">The score has changed since this comparison.</span>}
            </div>
          </div>
          {melodyShare < SAME && (
            <p className="warn">
              Few of the original’s notes line up with this score. Check that it is the same piece, and if the recording covers only part of it,
              that the original is the matching movement.
            </p>
          )}
          <ul className="facts">
            <li>{keyChange(result.transpose)}</li>
            {noteValues(result.ratio) && <li>{noteValues(result.ratio)}</li>}
            <li>
              Covers measures {result.span[0] + 1} to {result.span[1] + 1} of the original.
            </li>
            {result.melodyOnly && <li>The original has a single line, so only the melody is compared.</li>}
            {result.skipped.map(([a, b]) => (
              <li key={a}>
                Leaves out measures {a + 1} to {b + 1} of the original.
              </li>
            ))}
          </ul>
          <p className="hint">Measures with something to look at are underlined in the score, and notes the original doesn’t have are orange.</p>
          {missingMelody.length > 0 && (
            <>
              <h3>Melody notes not in the arrangement</h3>
              <ul className="findings">
                {missingMelody.slice(0, 60).map((m, i) => (
                  <li key={i}>
                    <button className="link" onClick={() => onShow(m)}>
                      Measure {m.measure + 1}
                    </button>{' '}
                    {name(m.pitch)} <span className="dim">(original m. {m.originalMeasure + 1})</span>
                    <button className="small" onClick={() => onAdd(m)} title="Add this note to the arrangement">
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {result.stray.length > 0 && (
            <>
              <h3>Notes the original doesn’t have</h3>
              <ul className="findings">
                {result.stray.slice(0, 60).map((s, i) => (
                  <li key={i}>
                    <button className="link" onClick={() => onShow(s)}>
                      Measure {s.measure + 1}
                    </button>{' '}
                    {name(s.pitch)} <span className="dim">(original m. {s.originalMeasure + 1})</span>
                    <button className="small" onClick={() => onRemove(s)} title="Remove this note from the arrangement">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {missingBass.length > 0 && (
            <details>
              <summary>
                Bass notes not in the arrangement ({missingBass.length}). Guitar arrangements often thin the bass, so these matter less.
              </summary>
              <ul className="findings">
                {missingBass.slice(0, 60).map((m, i) => (
                  <li key={i}>
                    <button className="link" onClick={() => onShow(m)}>
                      Measure {m.measure + 1}
                    </button>{' '}
                    {name(m.pitch)} <span className="dim">(original m. {m.originalMeasure + 1})</span>
                    <button className="small" onClick={() => onAdd(m)} title="Add this note to the arrangement">
                      Add
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  )
}
