import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type {
  AutoMaskCategory,
  AutoMaskSettings,
  ClipboardPiiProtectionMode,
  ClipboardPiiProtectionSettings,
  ClipboardTemplateFolder,
  HotkeyBinding,
  HotkeyCombo,
  NavigationTarget,
  PreviewKind,
  TestFolder,
  ThemeMode,
  UpdateStatus
} from '../../../shared/types'
import { flattenFolders } from '../folderTree'

interface Props {
  theme: ThemeMode
  onThemeChange: (theme: ThemeMode) => void
}

const LOG_LEVELS = ['all', 'error', 'warn', 'info', 'verbose', 'debug', 'silly'] as const

/** 機密情報の自動マスキング設定画面に表示する項目一覧(表示順) */
const AUTO_MASK_CATEGORIES: { key: AutoMaskCategory; label: string }[] = [
  { key: 'phone', label: '電話番号' },
  { key: 'postalCode', label: '郵便番号' },
  { key: 'email', label: 'メールアドレス' },
  { key: 'creditCard', label: 'クレジットカード番号・マイナンバー' }
]

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

const NAVIGATION_TARGET_NONE = 'none'
const RECORDING_FRAME_VALUE = 'recording-frame'

function encodeNavigationTarget(target: NavigationTarget): string {
  if (target.kind === 'recording-frame') return RECORDING_FRAME_VALUE
  return `${target.kind}:${target.folderId ?? ''}`
}

function decodeNavigationTarget(value: string): NavigationTarget | null {
  if (value === NAVIGATION_TARGET_NONE) return null
  if (value === RECORDING_FRAME_VALUE) return { kind: 'recording-frame' }
  const [kind, folderId] = value.split(':') as [PreviewKind, string]
  return { kind, folderId: folderId === '' ? null : folderId }
}

/** リストに新規追加した直後の、まだキーが未設定のホットキー */
const UNSET_HOTKEY: HotkeyCombo = { ctrl: false, shift: false, alt: false, meta: false, keycode: null, label: '(未設定)' }

/**
 * 設定画面はウィンドウが狭く縦スクロールもあるため、常に「アイコンの下」にツールチップを
 * 開くCSSだけだと下端付近の項目でウィンドウ外・スクロール領域外にはみ出て見えなくなる。
 * 表示時にアイコン位置とツールチップの実サイズを測り、画面下端に収まらなければ上に開き、
 * 左右も画面内に収まるようposition:fixedで座標を計算し直す。
 */
function HelpIcon({ text }: { text: string }): React.JSX.Element {
  const lines = text.split('\n')
  const iconRef = useRef<HTMLSpanElement>(null)
  const tooltipRef = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  const [style, setStyle] = useState<React.CSSProperties>({})

  useLayoutEffect(() => {
    if (!visible) return
    const icon = iconRef.current
    const tooltip = tooltipRef.current
    if (!icon || !tooltip) return
    const margin = 8
    const gap = 6
    const iconRect = icon.getBoundingClientRect()
    const tooltipRect = tooltip.getBoundingClientRect()

    const spaceBelow = window.innerHeight - iconRect.bottom
    const openUp = spaceBelow < tooltipRect.height + margin + gap && iconRect.top > tooltipRect.height + margin + gap
    const top = openUp ? iconRect.top - tooltipRect.height - gap : iconRect.bottom + gap

    let left = iconRect.left
    const maxLeft = window.innerWidth - tooltipRect.width - margin
    left = Math.min(left, Math.max(margin, maxLeft))
    left = Math.max(left, margin)

    setStyle({ position: 'fixed', top, left })
  }, [visible])

  return (
    <span
      className="help-icon"
      tabIndex={0}
      ref={iconRef}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
    >
      ?
      <span
        className={`help-icon-tooltip${visible ? ' help-icon-tooltip-visible' : ''}`}
        ref={tooltipRef}
        style={visible ? style : undefined}
      >
        {lines.map((line, i) => (
          <span className="help-icon-tooltip-line" key={i}>
            {line}
          </span>
        ))}
      </span>
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
  const [hotkeyBindings, setHotkeyBindings] = useState<HotkeyBinding[] | null>(null)
  const [loading, setLoading] = useState(true)
  // どのバインディング行(binding.id)がキーキャプチャ中か。同時に1行のみキャプチャ可能
  const [capturingId, setCapturingId] = useState<string | null>(null)
  const [previewLabel, setPreviewLabel] = useState('')
  // onHotkeyCaptureResultのリスナー(マウント時に1度だけ購読)から現在の値を参照するためのref
  const capturingIdRef = useRef<string | null>(null)
  useEffect(() => {
    capturingIdRef.current = capturingId
  }, [capturingId])

  const [clipboardFolders, setClipboardFolders] = useState<ClipboardTemplateFolder[]>([])
  const [testFolders, setTestFolders] = useState<TestFolder[]>([])
  const [windowSizeLocked, setWindowSizeLocked] = useState(false)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [autoMaskSensitiveInfo, setAutoMaskSensitiveInfo] = useState<AutoMaskSettings>({
    phone: false,
    postalCode: false,
    email: false,
    creditCard: false
  })
  const [clipboardPiiProtection, setClipboardPiiProtection] = useState<ClipboardPiiProtectionSettings>({
    mode: 'mask',
    categories: { phone: false, postalCode: false, email: false, creditCard: false }
  })

  const [showLog, setShowLog] = useState(false)
  const [logText, setLogText] = useState('')
  const [logLoading, setLogLoading] = useState(false)
  const [logLevelFilter, setLogLevelFilter] = useState<(typeof LOG_LEVELS)[number]>('all')
  const logBodyRef = useRef<HTMLPreElement>(null)

  const [appVersion, setAppVersion] = useState('')
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setHotkeyBindings(s.hotkeyBindings)
      setWindowSizeLocked(s.windowSizeLocked)
      setAlwaysOnTop(s.alwaysOnTop)
      setAutoMaskSensitiveInfo(s.autoMaskSensitiveInfo)
      setClipboardPiiProtection(s.clipboardPiiProtection)
      setLoading(false)
    })
    window.api.getAppVersion().then(setAppVersion)
    window.api.listClipboardTemplateFolders().then(setClipboardFolders)
    window.api.listFolders().then(setTestFolders)
  }, [])

  useEffect(() => {
    return window.api.onUpdateStatus(setUpdateStatus)
  }, [])

  // ホットキーの組み合わせをbindingId分だけ更新して保存する共通ヘルパー
  const updateBindings = (updater: (prev: HotkeyBinding[]) => HotkeyBinding[]): void => {
    setHotkeyBindings((prev) => {
      const next = updater(prev ?? [])
      window.api.setHotkeyBindings(next)
      return next
    })
  }

  useEffect(() => {
    const unsubPreview = window.api.onHotkeyCapturePreview((label) => setPreviewLabel(label))
    const unsubResult = window.api.onHotkeyCaptureResult((combo) => {
      const id = capturingIdRef.current
      setCapturingId(null)
      if (!id) return
      updateBindings((prev) => prev.map((b) => (b.id === id ? { ...b, hotkey: combo } : b)))
    })
    return () => {
      unsubPreview()
      unsubResult()
    }
  }, [])

  const startCapture = async (id: string): Promise<void> => {
    setPreviewLabel('キーを押してください...')
    setCapturingId(id)
    await window.api.startHotkeyCapture()
  }

  const cancelCapture = async (): Promise<void> => {
    await window.api.cancelHotkeyCapture()
    setCapturingId(null)
  }

  const addBinding = (): void => {
    const newBinding: HotkeyBinding = { id: crypto.randomUUID(), hotkey: UNSET_HOTKEY, target: null }
    updateBindings((prev) => [...prev, newBinding])
  }

  const removeBinding = (id: string): void => {
    if (capturingId === id) void cancelCapture()
    updateBindings((prev) => prev.filter((b) => b.id !== id))
  }

  const changeBindingTarget = (id: string, value: string): void => {
    const target = decodeNavigationTarget(value)
    updateBindings((prev) => prev.map((b) => (b.id === id ? { ...b, target } : b)))
  }

  const handleThemeChange = async (value: ThemeMode): Promise<void> => {
    onThemeChange(value)
    await window.api.setTheme(value)
  }

  const handleWindowSizeLockedChange = async (locked: boolean): Promise<void> => {
    setWindowSizeLocked(locked)
    await window.api.setWindowSizeLocked(locked)
  }

  const handleAlwaysOnTopChange = async (value: boolean): Promise<void> => {
    setAlwaysOnTop(value)
    await window.api.setAlwaysOnTop(value)
  }

  const handleAutoMaskCategoryChange = async (category: AutoMaskCategory, value: boolean): Promise<void> => {
    setAutoMaskSensitiveInfo((prev) => ({ ...prev, [category]: value }))
    await window.api.setAutoMaskSensitiveInfo(category, value)
  }

  const handleClipboardPiiCategoryChange = async (category: AutoMaskCategory, value: boolean): Promise<void> => {
    setClipboardPiiProtection((prev) => ({ ...prev, categories: { ...prev.categories, [category]: value } }))
    await window.api.setClipboardPiiProtectionCategory(category, value)
  }

  const handleClipboardPiiModeChange = async (mode: ClipboardPiiProtectionMode): Promise<void> => {
    setClipboardPiiProtection((prev) => ({ ...prev, mode }))
    await window.api.setClipboardPiiProtectionMode(mode)
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

  if (loading || !hotkeyBindings) return <div className="settings-page">読み込み中...</div>

  const flatClipboardFolders = flattenFolders(clipboardFolders)
  const flatTestFolders = flattenFolders(testFolders)

  const renderTargetSelect = (binding: HotkeyBinding): React.JSX.Element => {
    const value = binding.target ? encodeNavigationTarget(binding.target) : NAVIGATION_TARGET_NONE
    return (
      <select
        className="settings-select"
        value={value}
        onChange={(e) => changeBindingTarget(binding.id, e.target.value)}
      >
        <option value={NAVIGATION_TARGET_NONE}>未設定(表示のみ)</option>
        <option value={RECORDING_FRAME_VALUE}>録画枠を表示</option>
        <optgroup label="クリップボード">
          <option value={encodeNavigationTarget({ kind: 'clipboard', folderId: null })}>home</option>
          {flatClipboardFolders.map(({ folder, depth }) => (
            <option key={folder.id} value={encodeNavigationTarget({ kind: 'clipboard', folderId: folder.id })}>
              {'　'.repeat(depth + 1)}
              {folder.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="テスト">
          <option value={encodeNavigationTarget({ kind: 'test', folderId: null })}>home</option>
          {flatTestFolders.map(({ folder, depth }) => (
            <option key={folder.id} value={encodeNavigationTarget({ kind: 'test', folderId: folder.id })}>
              {'　'.repeat(depth + 1)}
              {folder.name}
            </option>
          ))}
        </optgroup>
      </select>
    )
  }

  return (
    <div className="settings-page">
      <h2>設定</h2>

      <div className="settings-list">
        <div className="settings-item">
          <div className="settings-item-row">
            <span className="settings-item-label">
              ウィンドウ表示ホットキー
              <HelpIcon
                text={
                  'ホットキーを押すとDittoのウィンドウを表示します。「遷移先」を指定すると、表示と同時にその画面へ切り替えます。\n' +
                  '「+ 追加」で複数のホットキーを登録できます(画面ごとに別々のホットキーを割り当てる等)。\n' +
                  'ホットキーの変更は「変更」を押してからキーを押してください。修飾キー(Ctrl/Shift/Alt/Win)単体なら素早く2回、修飾キーを押しながら別のキーを押せば1回押しで発火します。'
                }
              />
            </span>
            <button className="settings-action-btn" onClick={addBinding}>
              + 追加
            </button>
          </div>

          {hotkeyBindings.length === 0 ? (
            <p className="hint">登録されたホットキーはありません。「+ 追加」から追加してください。</p>
          ) : (
            <div className="hotkey-binding-list">
              {hotkeyBindings.map((binding) => (
                <div className="hotkey-binding-row" key={binding.id}>
                  {renderTargetSelect(binding)}
                  {capturingId === binding.id ? (
                    <div className="settings-item-control">
                      <span className="hotkey-preview">{previewLabel}</span>
                      <button className="settings-action-btn" onClick={cancelCapture}>
                        キャンセル
                      </button>
                    </div>
                  ) : (
                    <button className="settings-action-btn" onClick={() => startCapture(binding.id)}>
                      {binding.hotkey.label}
                    </button>
                  )}
                  <button
                    className="hotkey-binding-delete-btn"
                    onClick={() => removeBinding(binding.id)}
                    title="このホットキーを削除"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="settings-item">
          <div className="settings-item-row">
            <span className="settings-item-label">テーマカラー</span>
            <div className="settings-item-control">
              <span className="toggle-state-label">{theme === 'dark' ? 'ダーク' : 'ライト'}</span>
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
        </div>

        <div className="settings-item">
          <div className="settings-item-row">
            <span className="settings-item-label">
              ウィンドウサイズ
              <HelpIcon text={'Dittoのウィンドウの大きさを固定するか、自由に変更できるようにするかを切り替えます。'} />
            </span>
            <div className="settings-item-control">
              <span className="toggle-state-label">{windowSizeLocked ? '固定' : '自由'}</span>
              <label className="theme-toggle-switch">
                <input
                  type="checkbox"
                  checked={windowSizeLocked}
                  onChange={(e) => handleWindowSizeLockedChange(e.target.checked)}
                />
                <span className="theme-toggle-slider" />
              </label>
            </div>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-row">
            <span className="settings-item-label">
              常に最前面に表示
              <HelpIcon text={'ONにすると、Dittoのウィンドウを他のアプリより常に前面に表示します。'} />
            </span>
            <div className="settings-item-control">
              <span className="toggle-state-label">{alwaysOnTop ? 'ON' : 'OFF'}</span>
              <label className="theme-toggle-switch">
                <input
                  type="checkbox"
                  checked={alwaysOnTop}
                  onChange={(e) => handleAlwaysOnTopChange(e.target.checked)}
                />
                <span className="theme-toggle-slider" />
              </label>
            </div>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-row">
            <span className="settings-item-label">
              機密情報の自動マスキング
              <HelpIcon
                text={
                  'ONにした項目について、スクリーンショットや自動テスト失敗時のエビデンス画像を保存する前に、\n' +
                  'それらしき文字列をOCRで検出し、自動で黒塗りします。\n' +
                  '画面録画(動画)には適用されません。処理のぶん、保存に数秒かかる場合があります。'
                }
              />
            </span>
          </div>
          <div className="settings-subitem-list">
            {AUTO_MASK_CATEGORIES.map(({ key, label }) => (
              <div className="settings-subitem-row" key={key}>
                <span className="settings-subitem-label">{label}</span>
                <div className="settings-item-control">
                  <span className="toggle-state-label">{autoMaskSensitiveInfo[key] ? 'ON' : 'OFF'}</span>
                  <label className="theme-toggle-switch">
                    <input
                      type="checkbox"
                      checked={autoMaskSensitiveInfo[key]}
                      onChange={(e) => handleAutoMaskCategoryChange(key, e.target.checked)}
                    />
                    <span className="theme-toggle-slider" />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-row">
            <span className="settings-item-label">
              クリップボード履歴の機密情報保護
              <HelpIcon
                text={
                  'ONにした項目について、電話番号・メールアドレス等の機密情報らしき内容がコピーされた際、\n' +
                  'クリップボード履歴への保存方法を選べます。\n' +
                  '「マスキング」: 該当箇所を*に置き換えて履歴に保存します(コピーした内容自体は変わりません)。\n' +
                  '「自動消去」: 履歴に一切保存しません。\n' +
                  '画像(スクリーンショット等)をコピーした場合もOCRで検出し、同様に保護します。'
                }
              />
            </span>
            <select
              className="settings-select"
              value={clipboardPiiProtection.mode}
              onChange={(e) => handleClipboardPiiModeChange(e.target.value as ClipboardPiiProtectionMode)}
            >
              <option value="mask">マスキング</option>
              <option value="delete">自動消去</option>
            </select>
          </div>
          <div className="settings-subitem-list">
            {AUTO_MASK_CATEGORIES.map(({ key, label }) => (
              <div className="settings-subitem-row" key={key}>
                <span className="settings-subitem-label">{label}</span>
                <div className="settings-item-control">
                  <span className="toggle-state-label">{clipboardPiiProtection.categories[key] ? 'ON' : 'OFF'}</span>
                  <label className="theme-toggle-switch">
                    <input
                      type="checkbox"
                      checked={clipboardPiiProtection.categories[key]}
                      onChange={(e) => handleClipboardPiiCategoryChange(key, e.target.checked)}
                    />
                    <span className="theme-toggle-slider" />
                  </label>
                </div>
              </div>
            ))}
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
