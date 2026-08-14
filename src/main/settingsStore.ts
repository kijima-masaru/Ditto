import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import { anyCategoryEnabled } from './piiDetect'
import type {
  AppSettings,
  AutoMaskCategory,
  AutoMaskSettings,
  ClipboardPiiProtectionMode,
  ClipboardPiiProtectionSettings,
  HotkeyBinding,
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
  alwaysOnTop: false,
  autoMaskSensitiveInfo: DEFAULT_SCREENSHOT_MASK_SETTINGS,
  clipboardPiiProtection: DEFAULT_CLIPBOARD_PII_PROTECTION
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
      alwaysOnTop: parsed.alwaysOnTop ?? DEFAULT_SETTINGS.alwaysOnTop,
      autoMaskSensitiveInfo: normalizeScreenshotMaskSettings(parsed.autoMaskSensitiveInfo),
      clipboardPiiProtection: normalizeClipboardPiiProtection(parsed.clipboardPiiProtection)
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

export async function setAlwaysOnTop(alwaysOnTop: boolean): Promise<AppSettings> {
  const settings = await getSettings()
  settings.alwaysOnTop = alwaysOnTop
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
