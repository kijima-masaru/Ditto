import { useCallback, useEffect, useRef, useState } from 'react'
import type { HotkeyCombo } from '../../../shared/types'

// 停止キーの初期値。未設定のまま使い始めると誤って停止キーなしで進めてしまいがちなため、
// 最初からEscキーを既定値として登録しておく(クリックしていつでも自由に変更できる)
export const DEFAULT_STOP_HOTKEY: HotkeyCombo = {
  ctrl: false,
  shift: false,
  alt: false,
  meta: false,
  keycode: 1,
  label: 'Esc'
}

/**
 * 記録・再生モーダルの「停止キー」入力欄が使う共通ロジック。
 * キャプチャUI(hotkey-capture:*)は設定画面のホットキー設定と同じIPCチャンネルを
 * 共有するグローバルなものなので、このコンポーネント自身が現在キャプチャ中かどうかを
 * capturingRefで判定し、他所からの結果を誤って取り込まないようにする。
 */
export function useStopHotkey(onTrigger: () => void): {
  stopHotkey: HotkeyCombo | null
  capturing: boolean
  previewLabel: string
  startCapture: () => void
  cancelCapture: () => void
} {
  const [stopHotkey, setStopHotkeyState] = useState<HotkeyCombo | null>(DEFAULT_STOP_HOTKEY)
  const [capturing, setCapturing] = useState(false)
  const [previewLabel, setPreviewLabel] = useState('')
  const capturingRef = useRef(false)
  const onTriggerRef = useRef(onTrigger)

  useEffect(() => {
    onTriggerRef.current = onTrigger
  }, [onTrigger])

  // 既定の停止キーをマウント時に実際に登録する(表示上だけでなく即座に有効にする)
  useEffect(() => {
    void window.api.setStopHotkey(DEFAULT_STOP_HOTKEY)
  }, [])

  useEffect(() => {
    const unsubPreview = window.api.onHotkeyCapturePreview((label) => {
      if (capturingRef.current) setPreviewLabel(label)
    })
    const unsubResult = window.api.onHotkeyCaptureResult((combo) => {
      if (!capturingRef.current) return
      capturingRef.current = false
      setCapturing(false)
      setStopHotkeyState(combo)
      void window.api.setStopHotkey(combo)
    })
    const unsubTrigger = window.api.onStopHotkeyTriggered(() => {
      onTriggerRef.current()
    })
    return () => {
      unsubPreview()
      unsubResult()
      unsubTrigger()
    }
  }, [])

  // モーダルが閉じられた際に、登録済みの停止キーを確実に解除する
  useEffect(() => {
    return () => {
      void window.api.clearStopHotkey()
    }
  }, [])

  const startCapture = useCallback(() => {
    if (capturingRef.current) return
    capturingRef.current = true
    setCapturing(true)
    setPreviewLabel('キーを押してください...')
    void window.api.startHotkeyCapture()
  }, [])

  const cancelCapture = useCallback(() => {
    if (!capturingRef.current) return
    capturingRef.current = false
    setCapturing(false)
    void window.api.cancelHotkeyCapture()
  }, [])

  return { stopHotkey, capturing, previewLabel, startCapture, cancelCapture }
}
