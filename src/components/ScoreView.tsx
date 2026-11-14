import * as alphaTab from '@coderline/alphatab'
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import type { Selection } from '../model/edit'
import type { Score } from '../model/score'
import { type RenderOptions, toAlphaTab } from '../model/toAlphaTab'

export interface PlayerPosition {
  /** Seconds into the score at the written tempo. */
  time: number
  end: number
}

export interface ScoreViewHandle {
  playPause(): void
  stop(): void
  setSpeed(speed: number): void
  setLooping(on: boolean): void
  setMetronome(on: boolean): void
  setCountIn(on: boolean): void
  setVolume(volume: number): void
  seekMeasure(index: number): void
  print(): void
  downloadMidi(): void
  downloadGuitarPro(): void
}

interface Props {
  score: Score
  options: RenderOptions
  zoom: number
  selection: Selection | null
  flagged: number[]
  onSelect(sel: Selection | null): void
  onPlaying(playing: boolean): void
  onPosition(pos: PlayerPosition): void
  onReady(ready: boolean): void
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

const base = import.meta.env.BASE_URL

export const ScoreView = forwardRef<ScoreViewHandle, Props>(function ScoreView(props, ref) {
  const host = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const api = useRef<alphaTab.AlphaTabApi | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [renderCount, setRenderCount] = useState(0)
  const [selBox, setSelBox] = useState<Box | null>(null)
  const [noteBox, setNoteBox] = useState<Box | null>(null)
  const [flagBoxes, setFlagBoxes] = useState<Box[]>([])

  // Create the alphaTab instance once.
  useEffect(() => {
    const settings = new alphaTab.Settings()
    settings.core.fontDirectory = `${base}font/`
    settings.core.includeNoteBounds = true
    settings.core.engine = 'svg'
    settings.player.playerMode = alphaTab.PlayerMode.EnabledSynthesizer
    settings.player.soundFont = `${base}soundfont/sonivox.sf2`
    settings.player.scrollElement = scroller.current!
    settings.player.enableCursor = true
    settings.player.enableUserInteraction = true
    settings.player.scrollOffsetY = -160
    settings.display.stretchForce = 0.55
    settings.display.resources.barNumberColor = new alphaTab.model.Color(42, 33, 27)
    // Print the bass voice as black as the melody, like an engraved edition.
    settings.display.resources.secondaryGlyphColor = settings.display.resources.mainGlyphColor
    settings.display.layoutMode = alphaTab.LayoutMode.Page
    settings.display.scale = latest.current.zoom
    settings.display.resources.copyrightFont = alphaTab.model.Font.withFamilyList(['Georgia', 'serif'], 10)
    const el = settings.notation.elements
    el.set(alphaTab.NotationElement.GuitarTuning, false)
    el.set(alphaTab.NotationElement.TrackNames, false)
    el.set(alphaTab.NotationElement.ChordDiagrams, false)
    el.set(alphaTab.NotationElement.ScoreWordsAndMusic, true)
    el.set(alphaTab.NotationElement.EffectDynamics, false)
    const a = new alphaTab.AlphaTabApi(host.current!, settings)
    api.current = a

    let pendingString: number | undefined
    a.noteMouseDown.on((note) => {
      pendingString = note.beat.voice.bar.staff.tuning.length - note.string + 1
    })
    a.beatMouseDown.on((beat) => {
      // The note event (if any) arrives alongside the beat event; combine the two.
      setTimeout(() => {
        const { score, onSelect } = latest.current
        const m = beat.voice.bar.index
        const v = beat.voice.index
        const voice = score.measures[m]?.voices[v]
        if (!voice || beat.index >= voice.length) {
          onSelect(score.measures[m] ? { m, v: 0, b: 0 } : null)
        } else {
          const string = pendingString ?? voice[beat.index].notes[0]?.string
          onSelect({ m, v, b: beat.index, string })
        }
        pendingString = undefined
      }, 0)
    })
    a.playerStateChanged.on((e) => latest.current.onPlaying(e.state === alphaTab.synth.PlayerState.Playing))
    a.playerPositionChanged.on((e) => latest.current.onPosition({ time: e.currentTime / 1000, end: e.endTime / 1000 }))
    a.playerReady.on(() => latest.current.onReady(true))
    a.postRenderFinished.on(() => setRenderCount((c) => c + 1))
    // alphaTab labels a barre "B VII" / "1/2B VII"; classical editions print "CVII" / "½CVII".
    const relabel = () => {
      for (const t of host.current?.querySelectorAll('text') ?? []) {
        const hit = /^(1\/2)?B ([IVXL]+)$/.exec(t.textContent ?? '')
        if (hit) t.textContent = `${hit[1] ? '½' : ''}C${hit[2]}`
      }
    }
    const observer = new MutationObserver(relabel)
    observer.observe(host.current!, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      a.destroy()
      api.current = null
    }
  }, [])

  // Re-engrave whenever the score or the display options change.
  const { score, options, zoom } = props
  useEffect(() => {
    const a = api.current
    if (!a) return
    if (a.settings.display.scale !== zoom) {
      a.settings.display.scale = zoom
      a.updateSettings()
    }
    a.renderScore(toAlphaTab(score, options, a.settings))
  }, [score, options, zoom])

  // Position the selection and verification overlays from alphaTab's layout.
  const { selection, flagged } = props
  useEffect(() => {
    const a = api.current
    const lookup = a?.boundsLookup
    const at = a?.score
    if (!a || !lookup || !at) return
    const scale = 1
    const toBox = (b: { x: number; y: number; w: number; h: number }): Box => ({ x: b.x * scale, y: b.y * scale, w: b.w * scale, h: b.h * scale })
    let sel: Box | null = null
    let note: Box | null = null
    if (selection) {
      const beat = at.tracks[0]?.staves[0]?.bars[selection.m]?.voices[selection.v]?.beats[selection.b]
      const bounds = beat ? lookup.findBeat(beat) : null
      if (bounds) {
        sel = toBox(bounds.visualBounds)
        const atString = at.tracks[0].staves[0].tuning.length - (selection.string ?? 0) + 1
        const nb = bounds.notes?.find((n) => n.note.string === atString)
        if (nb) note = toBox(nb.noteHeadBounds)
      }
    }
    setSelBox(sel)
    setNoteBox(note)
    setFlagBoxes(
      flagged
        .map((i) => lookup.findMasterBarByIndex(i)?.visualBounds)
        .filter((b): b is alphaTab.rendering.Bounds => !!b)
        .map(toBox),
    )
  }, [selection, flagged, renderCount])

  useImperativeHandle(ref, () => ({
    playPause: () => api.current?.playPause(),
    stop: () => api.current?.stop(),
    setSpeed: (s) => {
      if (api.current) api.current.playbackSpeed = s
    },
    setLooping: (on) => {
      if (api.current) api.current.isLooping = on
    },
    setMetronome: (on) => {
      if (api.current) api.current.metronomeVolume = on ? 1 : 0
    },
    setCountIn: (on) => {
      if (api.current) api.current.countInVolume = on ? 1 : 0
    },
    setVolume: (v) => {
      if (api.current) api.current.masterVolume = v
    },
    seekMeasure: (index) => {
      const a = api.current
      const mb = a?.score?.masterBars[index]
      if (a && mb) a.tickPosition = mb.start
      const box = a?.boundsLookup?.findMasterBarByIndex(index)?.visualBounds
      if (box && scroller.current) scroller.current.scrollTo({ top: Math.max(0, box.y - 80), behavior: 'smooth' })
    },
    print: () => api.current?.print(),
    downloadMidi: () => api.current?.downloadMidi(),
    downloadGuitarPro: () => {
      const a = api.current
      if (!a?.score) return
      const bytes = new alphaTab.exporter.Gp7Exporter().export(a.score, a.settings)
      const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: 'application/octet-stream' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `${a.score.title || 'score'}.gp`
      link.click()
      URL.revokeObjectURL(url)
    },
  }))

  return (
    <div className="score-scroll" ref={scroller}>
      <div className="score-paper">
        <div ref={host} />
        {flagBoxes.map((b, i) => (
          <div key={i} className="overlay flag" style={{ left: b.x, top: b.y, width: b.w, height: b.h }} />
        ))}
        {selBox && <div className="overlay beat" style={{ left: selBox.x - 2, top: selBox.y - 4, width: selBox.w + 4, height: selBox.h + 8 }} />}
        {noteBox && <div className="overlay note" style={{ left: noteBox.x - 3, top: noteBox.y - 3, width: noteBox.w + 6, height: noteBox.h + 6 }} />}
      </div>
    </div>
  )
})
