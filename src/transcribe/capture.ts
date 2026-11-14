/** A recording in progress from a browser tab or the microphone. */
export interface Capture {
  stop(): Promise<Blob>
  cancel(): void
}

function record(stream: MediaStream, all: MediaStream = stream): Capture {
  const chunks: Blob[] = []
  const rec = new MediaRecorder(stream)
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data)
  }
  rec.start(1000)
  const release = () => all.getTracks().forEach((t) => t.stop())
  return {
    stop: () =>
      new Promise<Blob>((resolve) => {
        rec.onstop = () => {
          release()
          resolve(new Blob(chunks, { type: rec.mimeType }))
        }
        if (rec.state === 'inactive') rec.onstop?.(new Event('stop'))
        else rec.stop()
      }),
    cancel: () => {
      if (rec.state !== 'inactive') rec.stop()
      release()
    },
  }
}

const RAW = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }

/**
 * Record the sound of this browser tab (used for YouTube: a static site cannot download a
 * video's audio, but the browser can record what the tab plays, with the person's permission).
 */
export async function captureTab(): Promise<Capture> {
  if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('This browser cannot record tab audio. Use Chrome or Edge on a computer.')
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: true,
    audio: RAW,
    // Chromium hints: offer this tab first, and include its audio.
    ...({ preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include' } as object),
  })
  const audio = stream.getAudioTracks()
  if (audio.length === 0) {
    stream.getTracks().forEach((t) => t.stop())
    throw new Error('No audio was shared. Choose this tab and switch on "Also share tab audio".')
  }
  return record(new MediaStream(audio), stream)
}

export async function captureMicrophone(): Promise<Capture> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot record from the microphone.')
  return record(await navigator.mediaDevices.getUserMedia({ audio: RAW }))
}

/** Pull the video id out of the usual YouTube link shapes. */
export function youtubeId(url: string): string | null {
  const m = url.trim().match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/))([\w-]{11})/)
  if (m) return m[1]
  return /^[\w-]{11}$/.test(url.trim()) ? url.trim() : null
}
