import { useEffect, useState } from 'react'
import type { HotkeyCombo, ThemeMode } from '../../../shared/types'

interface Props {
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
}

export default function SettingsPanel({ theme, onThemeChange }: Props): React.JSX.Element {
  const [hotkey, setHotkey] = useState<HotkeyCombo | null>(null)
  const [loading, setLoading] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [previewLabel, setPreviewLabel] = useState('')

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setHotkey(s.hotkey)
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    const unsubPreview = window.api.onHotkeyCapturePreview((label) => setPreviewLabel(label))
    const unsubResult = window.api.onHotkeyCaptureResult((combo) => {
      setHotkey(combo)
      setCapturing(false)
      window.api.setHotkey(combo)
    })
    return () => {
      unsubPreview()
      unsubResult()
    }
  }, [])

  const startCapture = async (): Promise<void> => {
    setPreviewLabel('キーを押してください...')
    setCapturing(true)
    await window.api.startHotkeyCapture()
  }

  const cancelCapture = async (): Promise<void> => {
    await window.api.cancelHotkeyCapture()
    setCapturing(false)
  }

  const handleThemeChange = async (value: ThemeMode): Promise<void> => {
    onThemeChange(value)
    await window.api.setTheme(value)
  }

  if (loading || !hotkey) return <div className="panel">読み込み中...</div>

  return (
    <div className="panel">
      <h2>設定</h2>

      <div className="field">
        <label>ウィンドウ表示ホットキー</label>
        <p className="hint">
          「変更」を押してからキーを押してください。修飾キー(Ctrl/Shift/Alt/Win)単体なら素早く2回、
          修飾キーを押しながら別のキーを押せば1回押しで発火します。
        </p>
        {capturing ? (
          <div className="row inline-form">
            <span className="hotkey-preview">{previewLabel}</span>
            <button onClick={cancelCapture}>キャンセル</button>
          </div>
        ) : (
          <div className="row">
            <span className="hotkey-current">{hotkey.label}</span>
            <button onClick={startCapture}>変更</button>
          </div>
        )}
      </div>

      <div className="field">
        <label>テーマカラー</label>
        <div className="target-type-toggle">
          <button className={theme === 'light' ? 'active' : ''} onClick={() => handleThemeChange('light')}>
            ライト
          </button>
          <button className={theme === 'dark' ? 'active' : ''} onClick={() => handleThemeChange('dark')}>
            ダーク
          </button>
        </div>
      </div>
    </div>
  )
}
