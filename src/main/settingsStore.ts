import { app } from 'electron'
import fs from 'fs/promises'
import path from 'path'
import type { AppSettings, HotkeyModifier } from '../shared/types'

const DEFAULT_SETTINGS: AppSettings = { hotkeyModifier: 'Ctrl' }

function settingsFilePath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

export async function getSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsFilePath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export async function setHotkeyModifier(modifier: HotkeyModifier): Promise<AppSettings> {
  const settings = await getSettings()
  settings.hotkeyModifier = modifier
  await fs.writeFile(settingsFilePath(), JSON.stringify(settings, null, 2), 'utf-8')
  return settings
}
