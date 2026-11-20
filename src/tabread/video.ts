import { readPicture } from './read'
import { type FrameReading, joinSheet, type TabSheet } from './sheet'
import { findStaves, type Gray } from './staff'

/** Frames are read at this width, whatever the video's size (small videos are scaled up). */
const WIDTH = 1280
/** Frames looked at first, spread through the video, to see whether it shows tab at all. */
const PEEK = 12
/** Then a frame every this many seconds is read. */
const STEP = 2

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', fail)
      resolve()
    }
    const fail = () => {
      video.removeEventListener('seeked', done)
      video.removeEventListener('error', fail)
      reject(new Error('The video could not be read.'))
    }
    video.addEventListener('seeked', done)
    video.addEventListener('error', fail)
    video.currentTime = t
  })
}

/**
 * Look through a video for tablature on screen and read it: a quick look at a dozen frames first,
 * and only if one of them shows a tab staff, a frame every two seconds. Everything happens in the
 * browser. Returns null when the video shows no tab that can be read.
 */
export async function readVideoTab(file: Blob, onProgress: (fraction: number) => void = () => {}): Promise<TabSheet | null> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  video.src = url
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve()
      video.onerror = () => reject(new Error('The video could not be read.'))
    })
    const duration = video.duration
    if (!Number.isFinite(duration) || duration <= 0 || !video.videoWidth) return null
    const height = Math.round((video.videoHeight * WIDTH) / video.videoWidth)
    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    const grab = async (t: number): Promise<Gray> => {
      await seek(video, t)
      ctx.drawImage(video, 0, 0, WIDTH, height)
      const rgba = ctx.getImageData(0, 0, WIDTH, height).data
      const data = new Uint8Array(WIDTH * height)
      for (let i = 0, j = 0; j < data.length; i += 4, j++) data[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8
      return { width: WIDTH, height, data }
    }
    let shown = false
    for (let k = 0; k < PEEK && !shown; k++) {
      shown = findStaves(await grab(((k + 0.5) * duration) / PEEK)).length > 0
      onProgress((0.1 * (k + 1)) / PEEK)
    }
    if (!shown) return null
    const frames: FrameReading[] = []
    const count = Math.floor(duration / STEP)
    for (let k = 0; k <= count; k++) {
      const t = Math.min(duration - 0.05, k * STEP)
      frames.push({ t, staves: readPicture(await grab(t)) })
      onProgress(0.1 + (0.9 * (k + 1)) / (count + 1))
    }
    const sheet = joinSheet(frames)
    return sheet.bars.length ? sheet : null
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}
