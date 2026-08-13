import { useEffect, useRef, useState } from 'react'
import type { HotkeyCombo, ThemeMode, UpdateStatus } from '../../../shared/types'

interface Props {
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
}

function updateStatusLabel(status: UpdateStatus | null): string {
  if (!status) return ''
  switch (status.state) {
    case 'checking':
      return '確認中...'
    case 'available':
      return `新しいバージョン v${status.version} が見つかりました。ダウンロード中です...`
    case 'not-available':
      return 'お使いのバージョンは最新です。'
    case 'downloading':
      return `ダウンロード中... ${status.percent}%`
    case 'downloaded':
      return `v${status.version} の準備ができました。再起動すると更新されます。`
    case 'error':
      return `確認に失敗しました: ${status.message}`
    default:
      return ''
  }
}

export default function SettingsPanel({ theme, onThemeChange }: Props): React.JSX.Element {
  const [hotkey, setHotkey] = useState<HotkeyCombo | null>(null)
  const [loading, setLoading] = useState(true)
  const [capturing, setCapturing] = useState(false)
  const [previewLabel, setPreviewLabel] = useState('')

  const [showLog, setShowLog] = useState(false)
  const [logText, setLogText] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const logBodyRef = useRef<HTMLPreElement>(null)

  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setHotkey(s.hotkey)
      setLoading(false)
    })
    window.api.getAppVersion().then(setAppVersion)
  }, [])

  useEffect(() => {
    return window.api.onUpdateStatus(setUpdateStatus)
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

  const loadLog = async (): Promise<void> => {
    setLogLoading(true)
    const text = await window.api.readDebugLog()
    setLogText(text)
    setLogLoading(false)
    // 直近のログが末尾にあるので、開いた時点で自動的に一番下までスクロールしておく
    requestAnimationFrame(() => {
      const el = logBodyRef.current
      if (el) el.scrollTop = el.scrollHeight
    })
  }

  const openLog = async (): Promise<void> => {
    setShowLog(true)
    await loadLog()
  }

  const handleCheckForUpdates = async (): Promise<void> => {
    setUpdateStatus({ state: 'checking' })
    await window.api.checkForUpdates()
  }

  if (loading || !hotkey) return <div className="panel">読み込み中...</div>

  return (
    <div className="panel">
      <h2>設定</h2>

      <div className="field">
        <label>ウィンドウ表示ホットキー</label>
        <p className="hint">「変更」を押してからキーを押してください。</p>
        <p className="hint">修飾キー(Ctrl/Shift/Alt/Win)単体なら素早く2回、修飾キーを押しながら別のキーを押せば1回押しで発火します。</p>
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

      <div className="field">
        <label>バージョン情報</label>
        <p className="hint">現在のバージョン: v{appVersion}</p>
        <div className="row">
          <button onClick={handleCheckForUpdates} disabled={updateStatus?.state === 'checking'}>
            アップデートを確認
          </button>
        </div>
        {updateStatus && <p className="hint">{updateStatusLabel(updateStatus)}</p>}
      </div>

      <div className="field">
        <label>デバッグログ</label>
        <p className="hint">Dittoの動作記録です。不具合が起きた時や、突然終了してしまった時の原因調査に使えます。</p>
        <div className="row">
          <button onClick={openLog}>確認する</button>
        </div>
      </div>

      {showLog && (
        <div className="debug-log-overlay" onClick={() => setShowLog(false)}>
          <div className="debug-log-modal" onClick={(e) => e.stopPropagation()}>
            <div className="debug-log-modal-header">
              <span>デバッグログ</span>
              <div className="row">
                <button onClick={loadLog} disabled={logLoading}>
                  更新
                </button>
                <button onClick={() => window.api.openDebugLogFolder()}>フォルダを開く</button>
                <button onClick={() => setShowLog(false)}>閉じる</button>
              </div>
            </div>
            <pre className="debug-log-modal-body" ref={logBodyRef}>
              {logLoading ? '読み込み中...' : logText.trim() ? logText : 'ログはまだありません。'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
