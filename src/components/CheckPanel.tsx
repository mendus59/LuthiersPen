import { pitchName } from '../model/score'
import { DOUBT, GOOD, type VerifyResult } from '../verify/verify'

interface Props {
  result: VerifyResult | null
  keySig: number
  canCheck: boolean
  busy: string | null
  progress: number
  stale: boolean
  onCheck(): void
  onMeasure(index: number): void
}

export function CheckPanel({ result, keySig, canCheck, busy, progress, stale, onCheck, onMeasure }: Props) {
  return (
    <div className="panel-body">
      <h2>Check against the recording</h2>
      <p className="hint">
        LuthiersPen takes every note the score will play and looks for it in the original recording at that moment, then checks that
        nothing it heard is missing from the score. Notes without support are printed in orange and weak measures are underlined.
      </p>
      {!canCheck ? (
        <p className="hint">Transcribe a recording first. Scores opened from your library or written by hand have no recording to compare with.</p>
      ) : (
        <button className="primary" disabled={!!busy} onClick={onCheck}>{result ? 'Check again' : 'Check the transcription'}</button>
      )}
      {busy && (
        <div className="progress" role="status">
          <span>{busy}</span>
          <progress value={progress} max={1} />
        </div>
      )}
      {result && (
        <>
          <div className="scorecard">
            <div className={`big ${result.overall >= GOOD ? 'good' : result.overall >= DOUBT ? 'fair' : 'poor'}`}>{Math.round(result.overall * 100)}%</div>
            <div>
              <strong>{result.overall >= GOOD ? 'Close match' : result.overall >= DOUBT ? 'Partial match' : 'Weak match'}</strong>
              <span>
                {result.notes - result.doubts.length} of {result.notes} written notes found in the recording
                {result.missing.length ? `, ${result.missing.length} heard but not written` : ''}.
              </span>
              {stale && <span className="warn">The score has changed since this check.</span>}
            </div>
          </div>
          <div className="heat" aria-label="Agreement by measure">
            {result.measures.map((v, i) => (
              <button
                key={i}
                className={Number.isNaN(v) ? 'na' : v >= GOOD ? 'good' : v >= DOUBT ? 'fair' : 'poor'}
                title={`Measure ${i + 1}: ${Number.isNaN(v) ? 'silent' : `${Math.round(v * 100)}%`}`}
                onClick={() => onMeasure(i)}
              >
                {i + 1}
              </button>
            ))}
          </div>
          <p className="hint">Click a measure to jump to it. Switch playback to “Recording” or “Both” to hear the difference.</p>
          {result.missing.length > 0 && (
            <>
              <h3>Heard but not written</h3>
              <ul className="missing">
                {result.missing.slice(0, 40).map((x, i) => (
                  <li key={i}>
                    <button className="link" onClick={() => onMeasure(x.measure)}>Measure {x.measure + 1}</button> {pitchName(x.pitch + 12, keySig)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  )
}
