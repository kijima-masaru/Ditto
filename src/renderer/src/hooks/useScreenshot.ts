import { useCallback, useRef, useState } from 'react'

export interface ScreenshotApi {
  capturing: boolean
  errorMessage: string | null
  capture: () => Promise<void>
  dismissError: () => void
  videoRef: React.RefObject<HTMLVideoElement | null>
  canvasRef: React.RefObject<HTMLCanvasElement | null>
}

/**
 * 録画枠の範囲を静止画1枚としてキャプチャする。動画録画(useScreenRecording)と同じ
 * desktopCapturer+<video>+<canvas>の組み合わせを使うが、MediaRecorderは使わず
 * 1フレームだけcanvasに描画してPNGのdata URLを得る。
 * 撮影後の確認・注釈編集はメインウィンドウ内ではなく別の最大化ウィンドウで行うため、
 * data URLはこのフックの状態には残さずopenScreenshotEditorへそのまま渡す。
 */
export function useScreenshot(): ScreenshotApi {
  const [capturing, setCapturing] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const videoRef = useRef<HTMLVideoElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)

  const capture = useCallback(async () => {
    setCapturing(true)
    setErrorMessage(null)
    let stream: MediaStream | null = null
    try {
      const captureInfo = await window.api.getRecordingFrameCaptureInfo()
      const sources = await window.api.getDesktopSources()
      const matched = sources.find((s) => s.displayId === captureInfo.displayId) ?? sources[0]
      if (!matched) throw new Error('画面ソースが見つかりません')

      const scale = captureInfo.scaleFactor
      const constraints = {
        audio: false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: matched.id,
            minWidth: Math.round(captureInfo.displayBounds.width * scale),
            maxWidth: Math.round(captureInfo.displayBounds.width * scale),
            minHeight: Math.round(captureInfo.displayBounds.height * scale),
            maxHeight: Math.round(captureInfo.displayBounds.height * scale)
          }
        }
      } as unknown as MediaStreamConstraints

      stream = await navigator.mediaDevices.getUserMedia(constraints)

      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas) throw new Error('キャプチャの初期化に失敗しました')
      video.srcObject = stream
      await video.play()
      // 再生開始直後の数フレームは未初期化(真っ黒)なことがあるため少し待ってから撮る
      await new Promise((resolve) => setTimeout(resolve, 150))

      const outW = Math.max(2, Math.round(captureInfo.bounds.width * scale))
      const outH = Math.max(2, Math.round(captureInfo.bounds.height * scale))
      const sx = Math.round((captureInfo.bounds.x - captureInfo.displayBounds.x) * scale)
      const sy = Math.round((captureInfo.bounds.y - captureInfo.displayBounds.y) * scale)
      canvas.width = outW
      canvas.height = outH
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('キャプチャの初期化に失敗しました')
      ctx.drawImage(video, sx, sy, outW, outH, 0, 0, outW, outH)

      await window.api.openScreenshotEditor(canvas.toDataURL('image/png'))
    } catch (e) {
      setErrorMessage((e as Error).message)
    } finally {
      stream?.getTracks().forEach((t) => t.stop())
      if (videoRef.current) videoRef.current.srcObject = null
      setCapturing(false)
    }
  }, [])

  const dismissError = useCallback(() => {
    setErrorMessage(null)
  }, [])

  return { capturing, errorMessage, capture, dismissError, videoRef, canvasRef }
}
