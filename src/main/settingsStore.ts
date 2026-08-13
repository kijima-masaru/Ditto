import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { AppSettings, HotkeyCombo, ThemeMode, TopPage } from '../shared/types'

const DEFAULT_SETTINGS: AppSettings = {
  hotkey: { ctrl: true, shift: false, alt: false, meta: false, keycode: null, label: 'Ctrl 2回' },
  theme: 'light',
  topPage: null,
  windowSizeLocked: false
}

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      hotkey: parsed.hotkey ?? DEFAULT_SETTINGS.hotkey,
      theme: parsed.theme ?? DEFAULT_SETTINGS.theme,
      topPage: parsed.topPage ?? DEFAULT_SETTINGS.topPage,
      windowSizeLocked: parsed.windowSizeLocked ?? DEFAULT_SETTINGS.windowSizeLocked
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  await fs.writeFile(settingsFilePath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export async function setHotkey(hotkey: HotkeyCombo): Promise<AppSettings> {
  const settings = await getSettings()
  settings.hotkey = hotkey
  await writeSettings(settings)
  return settings
}

export async function setTheme(theme: ThemeMode): Promise<AppSettings> {
  const settings = await getSettings()
  settings.theme = theme
  await writeSettings(settings)
  return settings
}

export async function setTopPage(topPage: TopPage | null): Promise<AppSettings> {
  const settings = await getSettings()
  settings.topPage = topPage
  await writeSettings(settings)
  return settings
}

export async function setWindowSizeLocked(locked: boolean): Promise<AppSettings> {
  const settings = await getSettings()
  settings.windowSizeLocked = locked
  await writeSettings(settings)
  return settings
}
