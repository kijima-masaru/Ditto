import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { anyCategoryEnabled } from './piiDetect'
import type {
  NoteEditorAppearance,
  AppSettings,
  AutoMaskCategory,
  AutoMaskSettings,
  ClipboardPiiProtectionMode,
  ClipboardPiiProtectionSettings,
  CommandPaletteMaxPerSection,
  CommandPalettePerSectionCategory,
  HotkeyBinding,
  HotkeyCombo,
  PairedDevice,
  ScreenshotMaskSettings,
  ThemeMode
} from '../shared/types'

const DEFAULT_AUTO_MASK_SETTINGS: AutoMaskSettings = {
  phone: false,
  postalCode: false,
  email: false,
  creditCard: false
}

const DEFAULT_SCREENSHOT_MASK_SETTINGS: ScreenshotMaskSettings = {
  enabled: false,
  categories: { ...DEFAULT_AUTO_MASK_SETTINGS }
}

const DEFAULT_CLIPBOARD_PII_PROTECTION: ClipboardPiiProtectionSettings = {
  enabled: false,
  mode: 'mask',
  categories: { ...DEFAULT_AUTO_MASK_SETTINGS }
}

const DEFAULT_SETTINGS: AppSettings = {
  // 従来の「ウィンドウ表示ホットキー(Ctrl 2回)」+「トップページ未設定」相当の初期値。
  // targetがnullなので、押してもウィンドウを表示するだけでジャンプはしない
  hotkeyBindings: [
    {
      id: 'default',
      hotkey: { ctrl: true, shift: false, alt: false, meta: false, keycode: null, label: 'Ctrl 2回' },
      target: null
    }
  ],
  theme: 'light',
  windowSizeLocked: false,
  fixedWindowSize: null,
  alwaysOnTop: false,
  autoMaskSensitiveInfo: DEFAULT_SCREENSHOT_MASK_SETTINGS,
  clipboardPiiProtection: DEFAULT_CLIPBOARD_PII_PROTECTION,
  textExpansionEnabled: false,
  // keycode 57はuiohook-napiのUiohookKey.Space。commandPalette.tsに依存を追加しないよう
  // ここでは数値をそのまま持つ(hotkey.tsのformatComboLabelでも'Space'として表示される)
  commandPaletteHotkey: { ctrl: true, shift: true, alt: false, meta: false, keycode: 57, label: 'Ctrl+Shift+Space' },
  commandPaletteMaxPerSection: { history: 6, templates: 6, macros: 6, notes: 6 },
  noteEditorAppearance: { fontSize: 14, lineNumbers: true, highlightCurrentLine: true, wordWrap: true },
  pairedDevices: [],
  windowPosition: null
}

// メモの文字サイズとして許容する範囲。小さすぎて読めない・大きすぎて使えない値を防ぐ
const NOTE_FONT_SIZE_MIN = 10
const NOTE_FONT_SIZE_MAX = 32

function normalizeNoteEditorAppearance(value: unknown): NoteEditorAppearance {
  const d = DEFAULT_SETTINGS.noteEditorAppearance
  if (!value || typeof value !== 'object') return { ...d }
  const v = value as Partial<NoteEditorAppearance>
  const fontSize =
    typeof v.fontSize === 'number' && Number.isFinite(v.fontSize)
      ? Math.min(NOTE_FONT_SIZE_MAX, Math.max(NOTE_FONT_SIZE_MIN, Math.round(v.fontSize)))
      : d.fontSize
  const flag = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback)
  // v1.29.0まではここに太字・文字色・背景色があり、メモ全体に一律で掛かっていた。
  // それらは文字単位の装飾としてメモ本文側(notes/<id>.html)へ移したため読み捨てる
  return {
    fontSize,
    lineNumbers: flag(v.lineNumbers, d.lineNumbers),
    highlightCurrentLine: flag(v.highlightCurrentLine, d.highlightCurrentLine),
    wordWrap: flag(v.wordWrap, d.wordWrap)
  }
}

// コマンドパレットの表示件数上限として許容する範囲。0や負数、極端に大きい値を防ぐ
const COMMAND_PALETTE_MAX_PER_SECTION_MIN = 1
const COMMAND_PALETTE_MAX_PER_SECTION_MAX = 30

function clampCommandPaletteMaxPerSection(value: number): number {
  const rounded = Math.round(value)
  return Math.min(Math.max(rounded, COMMAND_PALETTE_MAX_PER_SECTION_MIN), COMMAND_PALETTE_MAX_PER_SECTION_MAX)
}

// v1.27.17までは履歴・定型文・マクロで共通の単一値(number)だった。区分ごとに個別指定できる
// { history, templates, macros } 形式へ移行するため、旧形式の設定ファイルを読み込んだ場合は
// その値を全区分の初期値として引き継ぐ
function normalizeCommandPaletteMaxPerSection(value: unknown): CommandPaletteMaxPerSection {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const clamped = clampCommandPaletteMaxPerSection(value)
    return { history: clamped, templates: clamped, macros: clamped, notes: clamped }
  }
  if (value && typeof value === 'object') {
    const v = value as Partial<CommandPaletteMaxPerSection>
    return {
      history:
        typeof v.history === 'number' && Number.isFinite(v.history)
          ? clampCommandPaletteMaxPerSection(v.history)
          : DEFAULT_SETTINGS.commandPaletteMaxPerSection.history,
      templates:
        typeof v.templates === 'number' && Number.isFinite(v.templates)
          ? clampCommandPaletteMaxPerSection(v.templates)
          : DEFAULT_SETTINGS.commandPaletteMaxPerSection.templates,
      macros:
        typeof v.macros === 'number' && Number.isFinite(v.macros)
          ? clampCommandPaletteMaxPerSection(v.macros)
          : DEFAULT_SETTINGS.commandPaletteMaxPerSection.macros,
      // メモはv1.28.1で追加した項目のため、旧設定ファイルには入っていない
      notes:
        typeof v.notes === 'number' && Number.isFinite(v.notes)
          ? clampCommandPaletteMaxPerSection(v.notes)
          : DEFAULT_SETTINGS.commandPaletteMaxPerSection.notes
    }
  }
  return { ...DEFAULT_SETTINGS.commandPaletteMaxPerSection }
}

// v1.24.9までは単一のboolean(true/false)、v1.24.10〜v1.24.13まではカテゴリだけの
// フラットなオブジェクトだったため、旧形式の設定ファイルを読み込んだ場合はここで変換する
function normalizeAutoMaskCategories(value: unknown): AutoMaskSettings {
  if (typeof value === 'boolean') {
    return { phone: value, postalCode: value, email: value, creditCard: value }
  }
  if (value && typeof value === 'object') {
    const v = value as Partial<AutoMaskSettings>
    return {
      phone: v.phone ?? false,
      postalCode: v.postalCode ?? false,
      email: v.email ?? false,
      creditCard: v.creditCard ?? false
    }
  }
  return { ...DEFAULT_AUTO_MASK_SETTINGS }
}

// v1.24.13までのautoMaskSensitiveInfoは { phone, postalCode, email, creditCard } という
// カテゴリだけのフラットな形だった。新形式は { enabled, categories } でラップし、機能全体の
// ON/OFFをカテゴリ選択と切り離して保持する(OFFにしてもカテゴリ選択を覚えておけるように)。
// 旧形式のデータにはenabledが存在しないため、その場合はカテゴリが1つでも選択されていれば
// enabled相当とみなして移行する
function normalizeScreenshotMaskSettings(value: unknown): ScreenshotMaskSettings {
  const hasWrapper = !!value && typeof value === 'object' && ('categories' in value || 'enabled' in value)
  const categories = normalizeAutoMaskCategories(hasWrapper ? (value as Partial<ScreenshotMaskSettings>).categories : value)
  const enabled = hasWrapper
    ? ((value as Partial<ScreenshotMaskSettings>).enabled ?? anyCategoryEnabled(categories))
    : anyCategoryEnabled(categories)
  return { enabled, categories }
}

function normalizeClipboardPiiProtection(value: unknown): ClipboardPiiProtectionSettings {
  if (value && typeof value === 'object') {
    const v = value as Partial<ClipboardPiiProtectionSettings>
    const categories = normalizeAutoMaskCategories(v.categories)
    return {
      enabled: v.enabled ?? anyCategoryEnabled(categories),
      mode: v.mode === 'delete' ? 'delete' : 'mask',
      categories
    }
  }
  return { ...DEFAULT_CLIPBOARD_PII_PROTECTION, categories: { ...DEFAULT_AUTO_MASK_SETTINGS } }
}

function normalizeHotkeyCombo(value: unknown): HotkeyCombo {
  if (!value || typeof value !== 'object') return DEFAULT_SETTINGS.commandPaletteHotkey
  const v = value as Partial<HotkeyCombo>
  if (typeof v.label !== 'string') return DEFAULT_SETTINGS.commandPaletteHotkey
  return {
    ctrl: !!v.ctrl,
    shift: !!v.shift,
    alt: !!v.alt,
    meta: !!v.meta,
    keycode: typeof v.keycode === 'number' ? v.keycode : null,
    label: v.label
  }
}

function normalizeWindowPosition(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<{ x: number; y: number }>
  if (typeof v.x !== 'number' || typeof v.y !== 'number' || !Number.isFinite(v.x) || !Number.isFinite(v.y)) return null
  return { x: v.x, y: v.y }
}

function normalizeFixedWindowSize(value: unknown): { width: number; height: number } | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<{ width: number; height: number }>
  if (typeof v.width !== 'number' || typeof v.height !== 'number' || !Number.isFinite(v.width) || !Number.isFinite(v.height)) {
    return null
  }
  return { width: v.width, height: v.height }
}

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsFilePath(), 'utf-8')
    // 古い設定ファイルには単一の hotkey/topPage フィールドが残っている場合があるが、
    // ここではそれらを読まず、新しい hotkeyBindings のみを見る(存在しない/不正な形式なら
    // デフォルト値にフォールバックし、クラッシュしないようにする)
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      hotkeyBindings: Array.isArray(parsed.hotkeyBindings) ? parsed.hotkeyBindings : DEFAULT_SETTINGS.hotkeyBindings,
      theme: parsed.theme ?? DEFAULT_SETTINGS.theme,
      windowSizeLocked: parsed.windowSizeLocked ?? DEFAULT_SETTINGS.windowSizeLocked,
      fixedWindowSize: normalizeFixedWindowSize(parsed.fixedWindowSize),
      alwaysOnTop: parsed.alwaysOnTop ?? DEFAULT_SETTINGS.alwaysOnTop,
      autoMaskSensitiveInfo: normalizeScreenshotMaskSettings(parsed.autoMaskSensitiveInfo),
      clipboardPiiProtection: normalizeClipboardPiiProtection(parsed.clipboardPiiProtection),
      textExpansionEnabled: parsed.textExpansionEnabled ?? DEFAULT_SETTINGS.textExpansionEnabled,
      commandPaletteHotkey: normalizeHotkeyCombo(parsed.commandPaletteHotkey),
      commandPaletteMaxPerSection: normalizeCommandPaletteMaxPerSection(parsed.commandPaletteMaxPerSection),
      // v1.29.0で追加。旧い設定ファイルには無いため既定値を補う
      noteEditorAppearance: normalizeNoteEditorAppearance(parsed.noteEditorAppearance),
      pairedDevices: Array.isArray(parsed.pairedDevices) ? parsed.pairedDevices : [],
      windowPosition: normalizeWindowPosition(parsed.windowPosition)
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  await fs.writeFile(settingsFilePath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export async function setHotkeyBindings(hotkeyBindings: HotkeyBinding[]): Promise<AppSettings> {
  const settings = await getSettings()
  settings.hotkeyBindings = hotkeyBindings
  await writeSettings(settings)
  return settings
}

export async function setPairedDevices(pairedDevices: PairedDevice[]): Promise<AppSettings> {
  const settings = await getSettings()
  settings.pairedDevices = pairedDevices
  await writeSettings(settings)
  return settings
}

export async function setTheme(theme: ThemeMode): Promise<AppSettings> {
  const settings = await getSettings()
  settings.theme = theme
  await writeSettings(settings)
  return settings
}

export async function setWindowSizeLocked(locked: boolean): Promise<AppSettings> {
  const settings = await getSettings()
  settings.windowSizeLocked = locked
  await writeSettings(settings)
  return settings
}

export async function setFixedWindowSize(size: { width: number; height: number } | null): Promise<AppSettings> {
  const settings = await getSettings()
  settings.fixedWindowSize = size
  await writeSettings(settings)
  return settings
}

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<AppSettings> {
  const settings = await getSettings()
  settings.alwaysOnTop = alwaysOnTop
  await writeSettings(settings)
  return settings
}

export async function setTextExpansionEnabled(enabled: boolean): Promise<AppSettings> {
  const settings = await getSettings()
  settings.textExpansionEnabled = enabled
  await writeSettings(settings)
  return settings
}

export async function setCommandPaletteHotkey(hotkey: HotkeyCombo): Promise<AppSettings> {
  const settings = await getSettings()
  settings.commandPaletteHotkey = hotkey
  await writeSettings(settings)
  return settings
}

export async function setCommandPaletteMaxPerSection(
  category: CommandPalettePerSectionCategory,
  value: number
): Promise<AppSettings> {
  const settings = await getSettings()
  settings.commandPaletteMaxPerSection = {
    ...settings.commandPaletteMaxPerSection,
    [category]: clampCommandPaletteMaxPerSection(value)
  }
  await writeSettings(settings)
  return settings
}

/** メモの編集画面の見た目を保存する。壊れた値が入らないよう正規化してから書き込む */
export async function setNoteEditorAppearance(appearance: NoteEditorAppearance): Promise<AppSettings> {
  const settings = await getSettings()
  settings.noteEditorAppearance = normalizeNoteEditorAppearance(appearance)
  await writeSettings(settings)
  return settings
}

export async function setAutoMaskEnabled(enabled: boolean): Promise<AppSettings> {
  const settings = await getSettings()
  settings.autoMaskSensitiveInfo = { ...settings.autoMaskSensitiveInfo, enabled }
  await writeSettings(settings)
  return settings
}

export async function setAutoMaskCategory(category: AutoMaskCategory, enabled: boolean): Promise<AppSettings> {
  const settings = await getSettings()
  settings.autoMaskSensitiveInfo = {
    ...settings.autoMaskSensitiveInfo,
    categories: { ...settings.autoMaskSensitiveInfo.categories, [category]: enabled }
  }
  await writeSettings(settings)
  return settings
}

export async function setClipboardPiiProtectionEnabled(enabled: boolean): Promise<AppSettings> {
  const settings = await getSettings()
  settings.clipboardPiiProtection = { ...settings.clipboardPiiProtection, enabled }
  await writeSettings(settings)
  return settings
}

export async function setClipboardPiiProtectionCategory(
  category: AutoMaskCategory,
  enabled: boolean
): Promise<AppSettings> {
  const settings = await getSettings()
  settings.clipboardPiiProtection = {
    ...settings.clipboardPiiProtection,
    categories: { ...settings.clipboardPiiProtection.categories, [category]: enabled }
  }
  await writeSettings(settings)
  return settings
}

export async function setClipboardPiiProtectionMode(mode: ClipboardPiiProtectionMode): Promise<AppSettings> {
  const settings = await getSettings()
  settings.clipboardPiiProtection = { ...settings.clipboardPiiProtection, mode }
  await writeSettings(settings)
  return settings
}

export async function setWindowPosition(position: { x: number; y: number } | null): Promise<AppSettings> {
  const settings = await getSettings()
  settings.windowPosition = position
  await writeSettings(settings)
  return settings
}
