import { readdir, unlink } from 'fs/promises'
import path from 'path'
import { shell } from 'electron'
import log, { LOG_FILE_PATTERN } from './logger'

// 画面に一度に読み込む量が大きくなりすぎないよう末尾の一定サイズだけを対象にする
const MAX_CHARS = 200_000
const RETENTION_DAYS = 3

function getLogFilePath(): string {
  return log.transports.file.getFile().path
}

function getLogsDir(): string {
  return path.dirname(getLogFilePath())
}

/**
 * 3日より古いログファイルを削除する。起動時に一度呼び出す想定
 */
export async function pruneOldLogs(): Promise<void> {
  let entries: string[]
  try {
    entries = await readdir(getLogsDir())
  } catch {
    return
  }
  const now = new Date()
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (RETENTION_DAYS - 1))
  for (const entry of entries) {
    const match = LOG_FILE_PATTERN.exec(entry)
    if (!match) continue
    const fileDate = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    if (fileDate < cutoff) {
      await unlink(path.join(getLogsDir(), entry)).catch(() => {})
    }
  }
}

export async function readLog(): Promise<string> {
  try {
    const files = log.transports.file.readAllLogs({ fileFilter: (f) => LOG_FILE_PATTERN.test(path.basename(f)) })
    const content = files.map((f) => f.lines.join('\n')).join('\n')
    return content.length > MAX_CHARS ? content.slice(content.length - MAX_CHARS) : content
  } catch {
    return ''
  }
}

export function openLogFolder(): void {
  shell.showItemInFolder(getLogFilePath())
}
