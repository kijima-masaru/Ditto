import { clipboard } from 'electron'
import * as clipboardStore from './clipboardStore'
import type { ClipboardHistoryEntry } from '../shared/types'

/**
 * トレイ常駐中も含め、アプリ起動中は常にクリップボードをポーリングして変化を検知する。
 * uiohook等のフックではクリップボードの変更自体を検知できないため、短い間隔でのポーリング方式を取る。
 */
const POLL_INTERVAL_MS = 700

let timer: NodeJS.Timeout | null = null
let lastSeenText = ''

export function startClipboardWatcher(onNewEntry: (entry: ClipboardHistoryEntry) => void): void {
  if (timer) return
  // 起動前から入っていた内容を初回エントリとして記録しないよう、現在値を既知として扱う
  lastSeenText = clipboard.readText()

  timer = setInterval(async () => {
    const text = clipboard.readText()
    if (!text || text === lastSeenText) return
    lastSeenText = text
    const entry = await clipboardStore.appendHistory(text)
    onNewEntry(entry)
  }, POLL_INTERVAL_MS)
}

export function stopClipboardWatcher(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
