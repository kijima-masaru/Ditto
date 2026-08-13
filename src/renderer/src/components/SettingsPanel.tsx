import { useEffect, useRef, useState } from 'react'
import type {
  ClipboardTemplateFolder,
  HotkeyCombo,
  PreviewKind,
  TestFolder,
  ThemeMode,
  TopPage,
  UpdateStatus
} from '../../../shared/types'
import { flattenFolders } from '../folderTree'

interface Props {
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
}

const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'verbose', 'debug', 'silly'] as const

const LOG_ENTRY_START = /^\[[\d-]+ [\d:.]+\] \[(\w+)\]/

/**
 * ログの各行は "[日時] [レベル] メッセージ" で始まるが、スタックトレースやオブジェクトの
 * ダンプ等で複数行にまたがることがある。レベルで絞り込む際は、レベル行から次のレベル行の
 * 直前までを1エントリとしてまとめて表示・非表示を判定する(そうしないと継続行だけ表示されて
 * 意味が分からなくなる)
 */
function filterLogByLevel(text: string, level: string): string {
  if (level === 'all') return text
  const lines = text.split('\n')
  const kept: string[] = []
  let currentLevel: string | null = null
  for (const line of lines) {
    const match = LOG_ENTRY_START.exec(line)
    if (match) currentLevel = match[1]
    if (currentLevel === level) kept.push(line)
  }
  return kept.join('\n')
}

const TOP_PAGE_NONE = 'none'

function encodeTopPage(kind: PreviewKind, folderId: string | null): string {
  return `${kind}:${folderId ?? ''}`
}

function decodeTopPage(value: string): TopPage | null {
  if (value === TOP_PAGE_NONE) return null
  const [kind, folderId] = value.split(':') as [PreviewKind, string]
  return { kind, folderId: folderId === '' ? null : folderId }
}

function HelpIcon({ text }: { text: string }): React.JSX.Element {
  return (
    <span className="help-icon" tabIndex={0}>
      ?<span className="help-icon-tooltip">{text}</span>
    </span>
  )
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

  const [topPage, setTopPage] = useState<TopPage | null>(null)
  const [clipboardFolders, setClipboardFolders] = useState<ClipboardTemplateFolder[]>([])
  const [testFolders, setTestFolders] = useState<TestFolder[]>([])

  const [showLog, setShowLog] = useState(false)
  const [logText, setLogText] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const [logLevelFilter, setLogLevelFilter] = useState<(typeof LOG_LEVELS)[number]>('all')
  const logBodyRef = useRef<HTMLPreElement>(null)

  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setHotkey(s.hotkey)
      setTopPage(s.topPage)
      setLoading(false)
    })
    window.api.getAppVersion().then(setAppVersion)
    window.api.listClipboardTemplateFolders().then(setClipboardFolders)
    window.api.listFolders().then(setTestFolders)
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

  const handleTopPageChange = async (value: string): Promise<void> => {
    const next = decodeTopPage(value)
    setTopPage(next)
    await window.api.setTopPage(next)
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

  const filteredLogText = filterLogByLevel(logText, logLevelFilter)

  const copyLog = async (): Promise<void> => {
    await window.api.copyToClipboard(filteredLogText)
  }

  const handleCheckForUpdates = async (): Promise<void> => {
    setUpdateStatus({ state: 'checking' })
    await window.api.checkForUpdates()
  }

  if (loading || !hotkey) return <div className="panel">読み込み中...</div>

  const flatClipboardFolders = flattenFolders(clipboardFolders)
  const flatTestFolders = flattenFolders(testFolders)
  const topPageValue = topPage ? encodeTopPage(topPage.kind, topPage.folderId) : TOP_PAGE_NONE

  return (
    <div className="panel">
      <h2>設定</h2>

      <div className="settings-item">
        <div className="settings-item-row">
          <span className="settings-item-label">
            ウィンドウ表示ホットキー
            <HelpIcon text={'「変更」を押してからキーを押してください。\n修飾キー(Ctrl/Shift/Alt/Win)単体なら素早く2回、修飾キーを押しながら別のキーを押せば1回押しで発火します。'} />
          </span>
          {capturing ? (
            <div className="settings-item-control">
              <span className="hotkey-preview">{previewLabel}</span>
              <button className="settings-action-btn" onClick={cancelCapture}>
                キャンセル
              </button>
            </div>
          ) : (
            <button className="settings-action-btn" onClick={startCapture}>
              {hotkey.label}
            </button>
          )}
        </div>
      </div>

      <div className="settings-item">
        <div className="settings-item-row">
          <span className="settings-item-label">
            トップページ
            <HelpIcon text={'ウィンドウ表示ホットキーでDittoを表示した際に開く画面を指定します。'} />
          </span>
          <select className="settings-select" value={topPageValue} onChange={(e) => handleTopPageChange(e.target.value)}>
            <option value={TOP_PAGE_NONE}>未設定</option>
            <optgroup label="クリップボード">
              <option value={encodeTopPage('clipboard', null)}>home</option>
              {flatClipboardFolders.map(({ folder, depth }) => (
                <option key={folder.id} value={encodeTopPage('clipboard', folder.id)}>
                  {'　'.repeat(depth + 1)}
                  {folder.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="テスト">
              <option value={encodeTopPage('test', null)}>home</option>
              {flatTestFolders.map(({ folder, depth }) => (
                <option key={folder.id} value={encodeTopPage('test', folder.id)}>
                  {'　'.repeat(depth + 1)}
                  {folder.name}
                </option>
              ))}
            </optgroup>
          </select>
        </div>
      </div>

      <div className="settings-item">
        <div className="settings-item-row">
          <span className="settings-item-label">テーマカラー</span>
          <label className="theme-toggle-switch">
            <input
              type="checkbox"
              checked={theme === 'dark'}
              onChange={(e) => handleThemeChange(e.target.checked ? 'dark' : 'light')}
            />
            <span className="theme-toggle-slider" />
          </label>
        </div>
      </div>

      <div className="settings-item">
        <div className="settings-item-row">
          <span className="settings-item-label">現在のバージョン: v{appVersion}</span>
          <button className="settings-action-btn" onClick={handleCheckForUpdates} disabled={updateStatus?.state === 'checking'}>
            アップデートを確認
          </button>
        </div>
        {updateStatus && <p className="hint">{updateStatusLabel(updateStatus)}</p>}
      </div>

      <div className="settings-item">
        <div className="settings-item-row">
          <span className="settings-item-label">
            デバッグログ
            <HelpIcon text={'Dittoの動作記録です。\n不具合が起きた時や、突然終了してしまった時の原因調査に使えます。\n直近3日分を保存し、それより古いログは自動的に削除されます。'} />
          </span>
          <button className="settings-action-btn" onClick={openLog}>
            ログを表示
          </button>
        </div>
      </div>

      {showLog && (
        <div className="debug-log-overlay" onClick={() => setShowLog(false)}>
          <div className="debug-log-modal" onClick={(e) => e.stopPropagation()}>
            <div className="debug-log-modal-header">
              <select value={logLevelFilter} onChange={(e) => setLogLevelFilter(e.target.value as (typeof LOG_LEVELS)[number])}>
                {LOG_LEVELS.map((lv) => (
                  <option key={lv} value={lv}>
                    {lv === 'all' ? 'すべてのレベル' : lv}
                  </option>
                ))}
              </select>
              <button className="debug-log-icon-btn" onClick={loadLog} disabled={logLoading} title="更新">
                ⟳
              </button>
              <button className="debug-log-icon-btn" onClick={() => window.api.openDebugLogFolder()} title="フォルダを開く">
                📁
              </button>
              <button className="debug-log-icon-btn" onClick={copyLog} title="ログをコピー">
                📋
              </button>
              <button className="debug-log-close-btn" onClick={() => setShowLog(false)} title="閉じる">
                ×
              </button>
            </div>
            <pre className="debug-log-modal-body" ref={logBodyRef}>
              {logLoading
                ? '読み込み中...'
                : !logText.trim()
                  ? 'ログはまだありません。'
                  : filteredLogText.trim() || '選択したレベルのログはありません。'}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
