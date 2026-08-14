import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { AppSettings, AutoMaskCategory, AutoMaskSettings, HotkeyBinding, ThemeMode } from '../shared/types'

const DEFAULT_AUTO_MASK_SETTINGS: AutoMaskSettings = {
  phone: false,
  postalCode: false,
  email: false,
  creditCard: false
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
  autoMaskSensitiveInfo: DEFAULT_AUTO_MASK_SETTINGS
}

// v1.24.9までは単一のboolean(autoMaskSensitiveInfo: true/false)だったため、
// 旧形式の設定ファイルを読み込んだ場合は全項目に同じ値を適用して変換する
function normalizeAutoMaskSettings(value: unknown): AutoMaskSettings {
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
      autoMaskSensitiveInfo: normalizeAutoMaskSettings(parsed.autoMaskSensitiveInfo)
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

export async function setAutoMaskCategory(category: AutoMaskCategory, enabled: boolean): Promise<AppSettings> {
  const settings = await getSettings()
  settings.autoMaskSensitiveInfo = { ...settings.autoMaskSensitiveInfo, [category]: enabled }
  await writeSettings(settings)
  return settings
}
