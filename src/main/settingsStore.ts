import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { AppSettings, HotkeyBinding, ThemeMode } from '../shared/types'

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
  alwaysOnTop: false
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
      alwaysOnTop: parsed.alwaysOnTop ?? DEFAULT_SETTINGS.alwaysOnTop
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
