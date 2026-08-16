import { useCallback, useEffect, useRef, useState } from 'react'

export type ScreenRecordingState = 'idle' | 'recording' | 'paused'

export interface ScreenRecorderApi {
  frameVisible: boolean
  toggleFrame: () => Promise<void>
  showFrame: () => Promise<void>
  recordingState: ScreenRecordingState
  elapsedMs: number
  savedPath: string | null
  errorMessage: string | null
  start: (macroName: string) => Promise<void>
  pause: () => void
  resume: () => void
  stop: () => Promise<void>
  dismissSaved: () => void
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

export function useScreenRecording(): ScreenRecorderApi {
  const [frameVisible, setFrameVisible] = useState(false)
  const [recordingState, setRecordingState] = useState<ScreenRecordingState>('idle')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const rafRef = useRef<number | null>(null)
  const drawInfoRef = useRef<{ sx: number; sy: number; sw: number; sh: number } | null>(null)
  const timerRef = useRef<number | null>(null)
  const startedAtRef = useRef(0)
  const pausedAccumRef = useRef(0)
  const pauseStartRef = useRef(0)

  useEffect(() => {
    return window.api.onRecordingFrameVisibilityChanged((visible) => setFrameVisible(visible))
  }, [])

  const toggleFrame = useCallback(async () => {
    if (frameVisible) {
      await window.api.hideRecordingFrame()
      setFrameVisible(false)
    } else {
      await window.api.showRecordingFrame()
      setFrameVisible(true)
    }
  }, [frameVisible])

  // toggleFrameと違い、既に表示中なら何もしない(ホットキーで「録画枠を表示」を
  // 選んだ際に、表示中の枠を誤って隠してしまわないようにするための表示専用版)
  const showFrame = useCallback(async () => {
    if (frameVisible) return
    await window.api.showRecordingFrame()
    setFrameVisible(true)
  }, [frameVisible])

  const drawLoop = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const info = drawInfoRef.current
    if (video && canvas && info) {
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(video, info.sx, info.sy, info.sw, info.sh, 0, 0, canvas.width, canvas.height)
      }
    }
    rafRef.current = requestAnimationFrame(drawLoop)
  }, [])

  const stopTimer = (): void => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const cleanupStream = (): void => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    drawInfoRef.current = null
  }

  const start = useCallback(
    async (macroName: string) => {
      setErrorMessage(null)
      setSavedPath(null)
      try {
        const capture = await window.api.getRecordingFrameCaptureInfo()
        const sources = await window.api.getDesktopSources()
        const matched = sources.find((s) => s.displayId === capture.displayId) ?? sources[0]
        if (!matched) throw new Error('画面ソースが見つかりません')

        const scale = capture.scaleFactor
        const constraints = {
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: matched.id,
              minWidth: Math.round(capture.displayBounds.width * scale),
              maxWidth: Math.round(capture.displayBounds.width * scale),
              minHeight: Math.round(capture.displayBounds.height * scale),
              maxHeight: Math.round(capture.displayBounds.height * scale)
            }
          }
        } as unknown as MediaStreamConstraints

        const stream = await navigator.mediaDevices.getUserMedia(constraints)
        streamRef.current = stream

        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas) throw new Error('録画の初期化に失敗しました')
        video.srcObject = stream
        await video.play()

        const outW = Math.max(2, Math.round(capture.bounds.width * scale))
        const outH = Math.max(2, Math.round(capture.bounds.height * scale))
        canvas.width = outW
        canvas.height = outH
        drawInfoRef.current = {
          sx: Math.round((capture.bounds.x - capture.displayBounds.x) * scale),
          sy: Math.round((capture.bounds.y - capture.displayBounds.y) * scale),
          sw: outW,
          sh: outH
        }

        await window.api.startScreenRecordingSession(macroName)

        const canvasStream = canvas.captureStream(30)
        const mimeType = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) =>
          MediaRecorder.isTypeSupported(t)
        )
        const recorder = new MediaRecorder(canvasStream, mimeType ? { mimeType } : undefined)
        recorder.ondataavailable = async (e) => {
          if (e.data.size > 0) {
            const buf = new Uint8Array(await e.data.arrayBuffer())
            await window.api.appendScreenRecordingChunk(buf)
          }
        }
        recorder.start(1000)
        recorderRef.current = recorder

        rafRef.current = requestAnimationFrame(drawLoop)

        startedAtRef.current = Date.now()
        pausedAccumRef.current = 0
        setElapsedMs(0)
        timerRef.current = window.setInterval(() => {
          setElapsedMs(Date.now() - startedAtRef.current - pausedAccumRef.current)
        }, 250)

        setRecordingState('recording')
      } catch (e) {
        setErrorMessage((e as Error).message)
        cleanupStream()
        setRecordingState('idle')
      }
    },
    [drawLoop]
  )

  const pause = useCallback(() => {
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.pause()
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      pauseStartRef.current = Date.now()
      setRecordingState('paused')
    }
  }, [])

  const resume = useCallback(() => {
    if (recorderRef.current?.state === 'paused') {
      recorderRef.current.resume()
      if (pauseStartRef.current) {
        pausedAccumRef.current += Date.now() - pauseStartRef.current
        pauseStartRef.current = 0
      }
      rafRef.current = requestAnimationFrame(drawLoop)
      setRecordingState('recording')
    }
  }, [drawLoop])

  const stop = useCallback(async () => {
    const recorder = recorderRef.current
    if (!recorder) return
    await new Promise<void>((resolve) => {
      recorder.onstop = () => resolve()
      recorder.stop()
    })
    recorderRef.current = null
    cleanupStream()
    stopTimer()
    const path = await window.api.finishScreenRecordingSession()
    setSavedPath(path)
    setRecordingState('idle')
  }, [])

  const dismissSaved = useCallback(() => {
    setSavedPath(null)
    setErrorMessage(null)
  }, [])

  useEffect(
    () => () => {
      cleanupStream()
      stopTimer()
    },
    []
  )

  return {
    frameVisible,
    toggleFrame,
    showFrame,
    recordingState,
    elapsedMs,
    savedPath,
    errorMessage,
    start,
    pause,
    resume,
    stop,
    dismissSaved,
    videoRef,
    canvasRef
  }
}
