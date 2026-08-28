import { useEffect, useRef, useState } from 'react'
import HelpIcon from './HelpIcon'
import type {
  AutoMaskCategory,
  ClipboardPiiProtectionMode,
  ClipboardPiiProtectionSettings,
  ClipboardTemplateFolder,
  CommandPaletteMaxPerSection,
  CommandPalettePerSectionCategory,
  HotkeyBinding,
  HotkeyCombo,
  NavigationTarget,
  PairedDevice,
  PreviewKind,
  ScreenshotMaskSettings,
  MacroFolder,
  ThemeMode,
  UpdateStatus
} from '../../../shared/types'
import { DITTO_REMOTE_ENABLED } from '../../../shared/featureFlags'
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

/** capturingIdに使う特別な値。ウィンドウ表示ホットキーの各バインディングid(UUID)とは
 *  衝突しないユニークな文字列で、コマンドパレットのホットキーをキャプチャ中であることを表す */
const COMMAND_PALETTE_CAPTURE_ID = '__command-palette-hotkey__'

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
  const [macroFolders, setMacroFolders] = useState<MacroFolder[]>([])
  const [windowSizeLocked, setWindowSizeLocked] = useState(false)
  const [fixedWidth, setFixedWidth] = useState('360')
  const [fixedHeight, setFixedHeight] = useState('640')
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  const [textExpansionEnabled, setTextExpansionEnabled] = useState(false)
  const [commandPaletteHotkey, setCommandPaletteHotkey] = useState<HotkeyCombo | null>(null)
  const [commandPaletteMaxPerSection, setCommandPaletteMaxPerSection] = useState<CommandPaletteMaxPerSection>({
    history: 6,
    templates: 6,
    macros: 6,
    notes: 6
  })
  const [autoMaskSensitiveInfo, setAutoMaskSensitiveInfo] = useState<ScreenshotMaskSettings>({
    enabled: false,
    categories: { phone: false, postalCode: false, email: false, creditCard: false }
  })
  const [clipboardPiiProtection, setClipboardPiiProtection] = useState<ClipboardPiiProtectionSettings>({
    enabled: false,
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

  const [remoteDevices, setRemoteDevices] = useState<PairedDevice[]>([])
  const [showRemotePairing, setShowRemotePairing] = useState(false)
  const [pairingInfo, setPairingInfo] = useState<{
    urls: string[]
    port: number
    code: string
    expiresAtMs: number
    qrDataUrl: string
  } | null>(null)
  const [pairingLoading, setPairingLoading] = useState(false)
  // ペアリングコードの残り有効時間(バー表示用)。pairingTotalMsはコード取得時点での
  // 残り時間を初期値として固定し、以後はそれを100%とした割合を計算する基準にする
  const [pairingRemainingMs, setPairingRemainingMs] = useState(0)
  const [pairingTotalMs, setPairingTotalMs] = useState(0)

  useEffect(() => {
    window.api.getSettings().then((s) => {
      setHotkeyBindings(s.hotkeyBindings)
      setWindowSizeLocked(s.windowSizeLocked)
      if (s.fixedWindowSize) {
        setFixedWidth(String(s.fixedWindowSize.width))
        setFixedHeight(String(s.fixedWindowSize.height))
      }
      setAlwaysOnTop(s.alwaysOnTop)
      setTextExpansionEnabled(s.textExpansionEnabled)
      setCommandPaletteHotkey(s.commandPaletteHotkey)
      setCommandPaletteMaxPerSection(s.commandPaletteMaxPerSection)
      setAutoMaskSensitiveInfo(s.autoMaskSensitiveInfo)
      setClipboardPiiProtection(s.clipboardPiiProtection)
      setLoading(false)
    })
    window.api.getAppVersion().then(setAppVersion)
    window.api.listClipboardTemplateFolders().then(setClipboardFolders)
    window.api.listFolders().then(setMacroFolders)
    window.api.listPairedRemoteDevices().then(setRemoteDevices)
  }, [])

  useEffect(() => {
    return window.api.onRemoteDeviceEvent(() => {
      window.api.listPairedRemoteDevices().then(setRemoteDevices)
    })
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
      if (id === COMMAND_PALETTE_CAPTURE_ID) {
        setCommandPaletteHotkey(combo)
        window.api.setCommandPaletteHotkey(combo)
        return
      }
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

  // コマンドパレットのホットキーを未設定に戻す(=機能自体を無効化する)
  const clearCommandPaletteHotkey = async (): Promise<void> => {
    if (capturingId === COMMAND_PALETTE_CAPTURE_ID) await cancelCapture()
    setCommandPaletteHotkey(UNSET_HOTKEY)
    await window.api.setCommandPaletteHotkey(UNSET_HOTKEY)
  }

  // コマンドパレットに一度に表示する件数の上限(履歴・定型文・マクロそれぞれの区分ごとに個別指定)
  const handleCommandPaletteMaxPerSectionChange = async (
    category: CommandPalettePerSectionCategory,
    value: number
  ): Promise<void> => {
    if (!Number.isFinite(value)) return
    setCommandPaletteMaxPerSection((prev) => ({ ...prev, [category]: value }))
    const settings = await window.api.setCommandPaletteMaxPerSection(category, value)
    setCommandPaletteMaxPerSection(settings.commandPaletteMaxPerSection)
  }

  // Ditto Remote(スマホ連携)。ペアリングコード表示・ペアリング済みデバイスの失効
  const openRemotePairing = async (): Promise<void> => {
    setShowRemotePairing(true)
    setPairingLoading(true)
    const info = await window.api.getRemotePairingInfo()
    setPairingInfo(info)
    const remaining = Math.max(0, info.expiresAtMs - Date.now())
    setPairingTotalMs(remaining)
    setPairingRemainingMs(remaining)
    setPairingLoading(false)
  }

  // モーダル表示中、コードの残り有効時間を一定間隔で更新してバーに反映する
  useEffect(() => {
    if (!showRemotePairing || !pairingInfo) return
    const timer = setInterval(() => {
      setPairingRemainingMs(Math.max(0, pairingInfo.expiresAtMs - Date.now()))
    }, 250)
    return () => clearInterval(timer)
  }, [showRemotePairing, pairingInfo])

  const revokeRemoteDevice = async (deviceId: string): Promise<void> => {
    const devices = await window.api.revokeRemoteDevice(deviceId)
    setRemoteDevices(devices)
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
    const settings = await window.api.setWindowSizeLocked(locked)
    // 固定に切り替えた際、その時点のウィンドウサイズがmain側で自動反映されるため、
    // 入力欄の表示もそれに合わせて更新する
    if (settings.fixedWindowSize) {
      setFixedWidth(String(settings.fixedWindowSize.width))
      setFixedHeight(String(settings.fixedWindowSize.height))
    }
  }

  const commitFixedWindowSize = async (width: string, height: string): Promise<void> => {
    const w = Math.max(300, Math.round(Number(width)) || 300)
    const h = Math.max(420, Math.round(Number(height)) || 420)
    setFixedWidth(String(w))
    setFixedHeight(String(h))
    await window.api.setFixedWindowSize({ width: w, height: h })
  }

  const handleAlwaysOnTopChange = async (value: boolean): Promise<void> => {
    setAlwaysOnTop(value)
    await window.api.setAlwaysOnTop(value)
  }

  const handleTextExpansionEnabledChange = async (value: boolean): Promise<void> => {
    setTextExpansionEnabled(value)
    await window.api.setTextExpansionEnabled(value)
  }

  const handleAutoMaskEnabledChange = async (value: boolean): Promise<void> => {
    setAutoMaskSensitiveInfo((prev) => ({ ...prev, enabled: value }))
    await window.api.setAutoMaskEnabled(value)
  }

  const handleAutoMaskCategoryChange = async (category: AutoMaskCategory, value: boolean): Promise<void> => {
    setAutoMaskSensitiveInfo((prev) => ({ ...prev, categories: { ...prev.categories, [category]: value } }))
    await window.api.setAutoMaskSensitiveInfo(category, value)
  }

  const handleClipboardPiiEnabledChange = async (value: boolean): Promise<void> => {
    setClipboardPiiProtection((prev) => ({ ...prev, enabled: value }))
    await window.api.setClipboardPiiProtectionEnabled(value)
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
  const flatMacroFolders = flattenFolders(macroFolders)

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
        <optgroup label="クリップ">
          <option value={encodeNavigationTarget({ kind: 'clipboard', folderId: null })}>home</option>
          {flatClipboardFolders.map(({ folder, depth }) => (
            <option key={folder.id} value={encodeNavigationTarget({ kind: 'clipboard', folderId: folder.id })}>
              {'　'.repeat(depth + 1)}
              {folder.name}
            </option>
          ))}
        </optgroup>
        <optgroup label="マクロ">
          <option value={encodeNavigationTarget({ kind: 'macro', folderId: null })}>home</option>
          {flatMacroFolders.map(({ folder, depth }) => (
            <option key={folder.id} value={encodeNavigationTarget({ kind: 'macro', folderId: folder.id })}>
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
            <span className="settings-item-label">
              コマンドパレット
              <HelpIcon
                text={
                  'ホットキーでDitto以外のどのアプリからでも小さな検索窓を呼び出せます。\n' +
                  '未入力時はコマンドパレットに固定指定した定型文・マクロのみを表示し、\n' +
                  '文字を入力するとクリップボード履歴・定型文・マクロすべてをあいまい検索できます。\n' +
                  '履歴/定型文はEnterで元のウィンドウへ直接入力します(同じ内容がクリップボードにも\n' +
                  'コピーされます)。マクロはEnterでその再生画面を開きます(実行はボタンを押すまで\n' +
                  '開始しません)。ホットキーを「×」で未設定にすると機能自体を無効化できます。'
                }
              />
            </span>
            {capturingId === COMMAND_PALETTE_CAPTURE_ID ? (
              <div className="settings-item-control">
                <span className="hotkey-preview">{previewLabel}</span>
                <button className="settings-action-btn" onClick={cancelCapture}>
                  キャンセル
                </button>
              </div>
            ) : (
              <div className="settings-item-control">
                <button className="settings-action-btn" onClick={() => startCapture(COMMAND_PALETTE_CAPTURE_ID)}>
                  {commandPaletteHotkey?.label ?? '未設定'}
                </button>
                <button
                  className="hotkey-binding-delete-btn"
                  onClick={clearCommandPaletteHotkey}
                  title="ホットキーを未設定にして無効化"
                >
                  ×
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-row">
            <span className="settings-item-label">
              コマンドパレットの表示件数
              <HelpIcon
                text={
                  'コマンドパレットに一度に表示する件数の上限を、履歴・定型文・マクロそれぞれ\n' +
                  '個別に指定できます。固定指定した定型文・マクロがこの件数を超える場合、\n' +
                  '超えた分は未入力時の一覧には表示されませんが、検索すれば見つけて選択できます。'
                }
              />
            </span>
          </div>

          <div className="settings-subitem-list">
            {(
              [
                { key: 'history', label: '履歴' },
                { key: 'templates', label: '定型文' },
                { key: 'macros', label: 'マクロ' },
                { key: 'notes', label: 'メモ' }
              ] as { key: CommandPalettePerSectionCategory; label: string }[]
            ).map(({ key, label }) => (
              <div className="settings-subitem-row" key={key}>
                <span className="settings-subitem-label">{label}</span>
                <div className="settings-item-control">
                  <input
                    type="number"
                    className="command-palette-max-input"
                    min={1}
                    max={30}
                    value={commandPaletteMaxPerSection[key]}
                    onChange={(e) =>
                      setCommandPaletteMaxPerSection((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                    }
                    onBlur={(e) => handleCommandPaletteMaxPerSectionChange(key, Number(e.target.value))}
                  />
                  <span className="hint">件</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {DITTO_REMOTE_ENABLED && (
          <div className="settings-item">
            <div className="settings-item-row">
              <span className="settings-item-label">
                スマホ連携(Ditto Remote)
                <HelpIcon
                  text={
                    '同一Wi-Fi内のAndroidアプリから、PC側の定型文入力・マクロ実行を\n' +
                    'ワンタップで起動できます。「接続」でQRコード/数字コードを\n' +
                    '表示し、スマホ側アプリで読み取ってください。連携にはPC側での明示的な\n' +
                    '許可(ダイアログ表示)が必要です。'
                  }
                />
              </span>
              <button className="settings-action-btn" onClick={openRemotePairing}>
                接続
              </button>
            </div>

            {remoteDevices.length === 0 ? (
              <p className="hint">ペアリング済みのデバイスはありません。</p>
            ) : (
              <div className="settings-subitem-list">
                {remoteDevices.map((device) => (
                  <div className="settings-subitem-row" key={device.id}>
                    <span className="settings-subitem-label">{device.name}</span>
                    <button
                      className="hotkey-binding-delete-btn"
                      onClick={() => revokeRemoteDevice(device.id)}
                      title="このデバイスの連携を解除"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
              固定サイズ
              <HelpIcon text={'「ウィンドウサイズ」が固定の場合のみ、ここで指定した幅・高さでDittoのウィンドウが固定されます。'} />
            </span>
            <div className="settings-item-control fixed-window-size-control">
              <input
                type="number"
                min={300}
                value={fixedWidth}
                disabled={!windowSizeLocked}
                onChange={(e) => setFixedWidth(e.target.value)}
                onBlur={() => commitFixedWindowSize(fixedWidth, fixedHeight)}
                aria-label="固定する幅"
                title="幅"
              />
              <span className="fixed-window-size-sep">×</span>
              <input
                type="number"
                min={420}
                value={fixedHeight}
                disabled={!windowSizeLocked}
                onChange={(e) => setFixedHeight(e.target.value)}
                onBlur={() => commitFixedWindowSize(fixedWidth, fixedHeight)}
                aria-label="固定する高さ"
                title="高さ"
              />
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
              定型文のトリガー展開
              <HelpIcon
                text={
                  'ONにすると、定型文に設定した「トリガー」文字列(例: ;greeting)を、\n' +
                  'Ditto以外のどのアプリでも直接入力するだけで本文へ自動的に置き換えます。\n' +
                  '半角英数字と一部記号のみ対応です。IMEで日本語変換中の入力には反応しないため、\n' +
                  'トリガーは半角/直接入力モードで入力してください。'
                }
              />
            </span>
            <div className="settings-item-control">
              <span className="toggle-state-label">{textExpansionEnabled ? 'ON' : 'OFF'}</span>
              <label className="theme-toggle-switch">
                <input
                  type="checkbox"
                  checked={textExpansionEnabled}
                  onChange={(e) => handleTextExpansionEnabledChange(e.target.checked)}
                />
                <span className="theme-toggle-slider" />
              </label>
            </div>
          </div>
        </div>

        <div className="settings-item">
          <div className="settings-item-row">
            <span className="settings-item-label">
              機密情報の保護
              <HelpIcon
                text={
                  '電話番号・郵便番号・メールアドレス・クレジットカード番号らしき内容をOCR/文字列検出し、\n' +
                  '保護する対象をON/OFFで選べます。\n' +
                  '「スクリーンショット」: 撮影画像・マクロ失敗時のエビデンス画像内の該当箇所を自動で黒塗りします。\n' +
                  '「クリップボード履歴」: コピーされた内容がDittoの履歴に記録される前に、\n' +
                  '「マスキング」(該当箇所を*に置き換えて保存。コピーした内容自体は変わりません)か\n' +
                  '「自動消去」(履歴に一切保存しません)のどちらかで保護します。\n' +
                  'いずれも項目ごとにON/OFFを切り替えられます。'
                }
              />
            </span>
          </div>

          <div className="settings-subitem-list">
            <div className="settings-subitem-row">
              <span className="settings-subitem-label">クリップボード履歴</span>
              <div className="settings-item-control">
                <span className="toggle-state-label">{clipboardPiiProtection.enabled ? 'ON' : 'OFF'}</span>
                <label className="theme-toggle-switch">
                  <input
                    type="checkbox"
                    checked={clipboardPiiProtection.enabled}
                    onChange={(e) => handleClipboardPiiEnabledChange(e.target.checked)}
                  />
                  <span className="theme-toggle-slider" />
                </label>
              </div>
            </div>
            {clipboardPiiProtection.enabled && (
              <div className="settings-subitem-row settings-subitem-row--nested">
                <span className="settings-subitem-label">保護方法</span>
                <div className="settings-item-control">
                  <select
                    className="settings-select"
                    value={clipboardPiiProtection.mode}
                    onChange={(e) => handleClipboardPiiModeChange(e.target.value as ClipboardPiiProtectionMode)}
                  >
                    <option value="mask">マスキング</option>
                    <option value="delete">自動消去</option>
                  </select>
                </div>
              </div>
            )}
            {clipboardPiiProtection.enabled &&
              AUTO_MASK_CATEGORIES.map(({ key, label }) => (
                <div className="settings-subitem-row settings-subitem-row--nested" key={`clipboard-${key}`}>
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

            <div className="settings-subitem-row">
              <span className="settings-subitem-label">スクリーンショット</span>
              <div className="settings-item-control">
                <span className="toggle-state-label">{autoMaskSensitiveInfo.enabled ? 'ON' : 'OFF'}</span>
                <label className="theme-toggle-switch">
                  <input
                    type="checkbox"
                    checked={autoMaskSensitiveInfo.enabled}
                    onChange={(e) => handleAutoMaskEnabledChange(e.target.checked)}
                  />
                  <span className="theme-toggle-slider" />
                </label>
              </div>
            </div>
            {autoMaskSensitiveInfo.enabled &&
              AUTO_MASK_CATEGORIES.map(({ key, label }) => (
                <div className="settings-subitem-row settings-subitem-row--nested" key={`screenshot-${key}`}>
                  <span className="settings-subitem-label">{label}</span>
                  <div className="settings-item-control">
                    <span className="toggle-state-label">{autoMaskSensitiveInfo.categories[key] ? 'ON' : 'OFF'}</span>
                    <label className="theme-toggle-switch">
                      <input
                        type="checkbox"
                        checked={autoMaskSensitiveInfo.categories[key]}
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

      {showRemotePairing && (
        <div className="debug-log-overlay" onClick={() => setShowRemotePairing(false)}>
          <div className="remote-pairing-modal" onClick={(e) => e.stopPropagation()}>
            <div className="remote-pairing-modal-body">
              {pairingLoading || !pairingInfo ? (
                <p className="hint">コードを生成しています...</p>
              ) : (
                <>
                  <img className="remote-pairing-qr" src={pairingInfo.qrDataUrl} alt="ペアリング用QRコード" />
                  <p className="remote-pairing-code">{pairingInfo.code}</p>
                  <div className="remote-pairing-progress">
                    <div
                      className="remote-pairing-progress-fill"
                      style={{
                        width: `${pairingTotalMs > 0 ? Math.min(100, (pairingRemainingMs / pairingTotalMs) * 100) : 0}%`
                      }}
                    />
                  </div>
                  <p className="remote-pairing-hint">
                    {'スマホアプリでQRコードを読み取るか、コードを入力してください。\n' +
                      '2分間有効です。\n\n' +
                      '読み取り後、このPC側で表示される確認ダイアログで「許可」を押すと連携が完了します。'}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
