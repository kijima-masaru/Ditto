import { readFile } from 'fs/promises'
import { shell } from 'electron'
import log from './logger'

// 画面に一度に読み込む量が大きくなりすぎないよう末尾の一定サイズだけを対象にする
const MAX_CHARS = 200_000

function getLogFilePath(): string {
  return log.transports.file.getFile().path
}

export async function readLog(): Promise<string> {
  try {
    const content = await readFile(getLogFilePath(), 'utf-8')
    return content.length > MAX_CHARS ? content.slice(content.length - MAX_CHARS) : content
  } catch {
    return ''
  }
}

export function openLogFolder(): void {
  shell.showItemInFolder(getLogFilePath())
}
