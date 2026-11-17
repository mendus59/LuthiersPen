import { useEffect, useRef, useState } from 'react'
import { ALL_KEYS, type Key, keyName, keyValue, parseKey, signatureName } from '../model/keys'
import { type Capture, captureMicrophone, captureTab, youtubeId } from '../transcribe/capture'

export interface TranscribeSettings {
  timeSig: [number, number]
  /** -1 = work it out. */
  pickup: number
  grid: 8 | 16
  twoVoices: boolean
  /** 1 = as tracked, 0.5 = half as many beats, 2 = twice as many. */
  pulse: 0.5 | 1 | 2
  /** null = the key heard in the recording. */
  key: Key | null
}

interface Props {
  busy: string | null
  progress: number
  hasCapture: boolean
  settings: TranscribeSettings
  detected: { tempo: number; notes: number; pickup: number; key: Key } | null
  /** `range` limits the transcription to part of the recording, in seconds. */
  onAudio(data: ArrayBuffer, name: string, range?: { from: number; to: number }): void
  onSettings(s: TranscribeSettings): void
  onError(message: string): void
}

/** "1:23", "83" or "1:23.5" → seconds; anything else → null. */
export function parseTime(text: string): number | null {
  const hit = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(text)
  return hit ? Number(hit[1] ?? 0) * 60 + Number(hit[2]) : null
}

const SIGS: Array<[number, number]> = [[4, 4], [3, 4], [2, 4], [6, 8], [3, 8], [9, 8], [12, 8], [2, 2]]

export function TranscribePanel(p: Props) {
  const [source, setSource] = useState<'file' | 'youtube' | 'mic'>('file')
  const [link, setLink] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [recording, setRecording] = useState<'tab' | 'mic' | null>(null)
  const [seconds, setSeconds] = useState(0)
  const capture = useRef<Capture | null>(null)
  const frame = useRef<HTMLIFrameElement>(null)
  const videoId = youtubeId(link)

  useEffect(() => {
    if (!recording) return
    setSeconds(0)
    const t = setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => clearInterval(t)
  }, [recording])

  useEffect(() => () => capture.current?.cancel(), [])

  const command = (func: string, args: unknown[] = []) =>
    frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*')

  const finish = async (name: string) => {
    const c = capture.current
    capture.current = null
    setRecording(null)
    if (!c) return
    command('pauseVideo')
    const blob = await c.stop()
    p.onAudio(await blob.arrayBuffer(), name)
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  // Stop by itself when the YouTube video ends.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!/youtube/.test(e.origin) || typeof e.data !== 'string') return
      try {
        const msg = JSON.parse(e.data)
        if (msg.event === 'infoDelivery' && msg.info?.playerState === 0 && capture.current) void finishRef.current('YouTube recording')
      } catch {
        /* not ours */
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const start = async (kind: 'tab' | 'mic') => {
    try {
      capture.current = kind === 'tab' ? await captureTab() : await captureMicrophone()
      setRecording(kind)
      if (kind === 'tab') {
        command('seekTo', [0, true])
        command('playVideo')
      }
    } catch (err) {
      if ((err as Error).name !== 'NotAllowedError') p.onError((err as Error).message)
    }
  }

  const s = p.settings
  const set = (patch: Partial<TranscribeSettings>) => p.onSettings({ ...s, ...patch })
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  const locked = !!p.busy || !!recording

  return (
    <div className="panel-body">
      <h2>Transcribe a recording</h2>
      <p className="hint">Solo guitar works best. The recording is analysed in your browser and never uploaded.</p>
      <div className="seg" role="tablist">
        {(['file', 'youtube', 'mic'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={source === k} className={source === k ? 'on' : ''} disabled={locked} onClick={() => setSource(k)}>
            {k === 'file' ? 'File' : k === 'youtube' ? 'YouTube' : 'Microphone'}
          </button>
        ))}
      </div>

      {source === 'file' && (
        <div className="stack">
          <label className={`drop ${locked ? 'disabled' : ''}`}>
            <input
              type="file"
              accept="audio/*,video/mp4,video/quicktime,video/webm,.mp3,.wav,.m4a,.ogg,.flac,.mp4,.mov,.webm"
              disabled={locked}
              onChange={async (e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (!f) return
                const start = parseTime(from) ?? 0
                const end = parseTime(to) ?? Infinity
                if (end <= start) return p.onError('The end of the part to transcribe must come after its start.')
                p.onAudio(await f.arrayBuffer(), f.name.replace(/\.[^.]+$/, ''), from.trim() || to.trim() ? { from: start, to: end } : undefined)
              }}
            />
            <strong>Choose an audio or video file</strong>
            <span>MP3, WAV, M4A, OGG, FLAC, or an MP4 video (its sound is used)</span>
          </label>
          <div className="grid2">
            <label>
              From
              <input type="text" inputMode="numeric" placeholder="0:00" value={from} disabled={locked} onChange={(e) => setFrom(e.target.value)} />
            </label>
            <label>
              To
              <input type="text" inputMode="numeric" placeholder="end" value={to} disabled={locked} onChange={(e) => setTo(e.target.value)} />
            </label>
          </div>
          <p className="hint">Leave these empty for the whole recording. For a lesson video, give only the performance, without the slow part or a metronome.</p>
        </div>
      )}

      {source === 'youtube' && (
        <div className="stack">
          <input type="url" placeholder="https://www.youtube.com/watch?v=…" value={link} disabled={locked} onChange={(e) => setLink(e.target.value)} aria-label="YouTube link" />
          {link && !videoId && <p className="warn">That does not look like a YouTube link.</p>}
          {videoId && (
            <>
              <iframe
                ref={frame}
                className="yt"
                title="YouTube video"
                src={`https://www.youtube-nocookie.com/embed/${videoId}?enablejsapi=1&playsinline=1&origin=${encodeURIComponent(location.origin)}`}
                allow="autoplay; encrypted-media"
                onLoad={() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }), '*')}
              />
              {recording === 'tab' ? (
                <button className="primary rec" onClick={() => void finish('YouTube recording')}>Stop and transcribe ({clock})</button>
              ) : (
                <button className="primary" disabled={locked} onClick={() => void start('tab')}>Record this video and transcribe</button>
              )}
              <p className="hint">
                A website cannot download YouTube audio, so LuthiersPen records what the video plays. When your browser asks what to share,
                choose <em>this tab</em> and keep <em>Also share tab audio</em> switched on. The video plays through once, in real time.
                Works in Chrome and Edge on a computer.
              </p>
            </>
          )}
        </div>
      )}

      {source === 'mic' && (
        <div className="stack">
          {recording === 'mic' ? (
            <button className="primary rec" onClick={() => void finish('Microphone recording')}>Stop and transcribe ({clock})</button>
          ) : (
            <button className="primary" disabled={locked} onClick={() => void start('mic')}>Start recording</button>
          )}
          <p className="hint">Play your guitar close to the microphone in a quiet room.</p>
        </div>
      )}

      {p.busy && (
        <div className="progress" role="status">
          <span>{p.busy}</span>
          <progress value={p.progress} max={1} />
        </div>
      )}

      {p.hasCapture && p.detected && (
        <>
          <h3>Reading of the recording</h3>
          <p className="hint">
            Found {p.detected.notes} notes in {keyName(p.detected.key)} at about {p.detected.tempo} beats per minute. Adjust these if the notation does not sit right; the score is redrawn each time.
          </p>
          <div className="grid2">
            <label className="wide">
              Key
              <select value={s.key ? keyValue(s.key) : ''} disabled={locked} onChange={(e) => set({ key: e.target.value ? parseKey(e.target.value) : null })}>
                <option value="">{`As heard: ${keyName(p.detected.key)} (${signatureName(p.detected.key.sharps)})`}</option>
                {ALL_KEYS.map((k) => <option key={keyValue(k)} value={keyValue(k)}>{`${keyName(k)} (${signatureName(k.sharps)})`}</option>)}
              </select>
            </label>
            <label>
              Time signature
              <select value={s.timeSig.join('/')} disabled={locked} onChange={(e) => set({ timeSig: e.target.value.split('/').map(Number) as [number, number] })}>
                {SIGS.map((x) => <option key={x.join('/')}>{x.join('/')}</option>)}
              </select>
            </label>
            <label>
              Pickup beats
              <select value={s.pickup} disabled={locked} onChange={(e) => set({ pickup: Number(e.target.value) })}>
                <option value={-1}>Auto ({p.detected.pickup})</option>
                {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label>
              Shortest note
              <select value={s.grid} disabled={locked} onChange={(e) => set({ grid: Number(e.target.value) as 8 | 16 })}>
                <option value={16}>Sixteenth</option>
                <option value={8}>Eighth</option>
              </select>
            </label>
            <label>
              Beat
              <select value={s.pulse} disabled={locked} onChange={(e) => set({ pulse: Number(e.target.value) as 0.5 | 1 | 2 })}>
                <option value={1}>As heard</option>
                <option value={0.5}>Half as fast</option>
                <option value={2}>Twice as fast</option>
              </select>
            </label>
          </div>
          <label className="check">
            <input type="checkbox" checked={s.twoVoices} disabled={locked} onChange={(e) => set({ twoVoices: e.target.checked })} />
            Write the bass as its own voice (stems down)
          </label>
        </>
      )}
    </div>
  )
}
