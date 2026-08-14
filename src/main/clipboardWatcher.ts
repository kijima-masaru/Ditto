import { clipboard } from 'electron'
import { createHash } from 'crypto'
import * as clipboardStore from './clipboardStore'
import { runOcrOnImage } from './ocr'
import type { ClipboardHistoryEntry } from '../shared/types'

/**
 * トレイ常駐中も含め、アプリ起動中は常にクリップボードをポーリングして変化を検知する。
 * uiohook等のフックではクリップボードの変更自体を検知できないため、短い間隔でのポーリング方式を取る。
 */
const POLL_INTERVAL_MS = 700

let timer: NodeJS.Timeout | null = null
let lastSeenText = ''
let lastSeenImageHash: string | null = null

function hashPng(png: Buffer): string {
  return createHash('sha1').update(png).digest('hex')
}

export function startClipboardWatcher(onNewEntry: (entry: ClipboardHistoryEntry) => void): void {
  if (timer) return
  // 起動前から入っていた内容を初回エントリとして記録しないよう、現在値を既知として扱う
  lastSeenText = clipboard.readText()
  const initialImage = clipboard.readImage()
  lastSeenImageHash = initialImage.isEmpty() ? null : hashPng(initialImage.toPNG())

  timer = setInterval(async () => {
    const text = clipboard.readText()
    if (text && text !== lastSeenText) {
      lastSeenText = text
      const entry = await clipboardStore.appendHistory(text)
      onNewEntry(entry)
      // テキストと画像が同時に変化することは通常ないため、この回はここで終える
      return
    }

    const image = clipboard.readImage()
    if (image.isEmpty()) return
    const hash = hashPng(image.toPNG())
    if (hash === lastSeenImageHash) return
    lastSeenImageHash = hash

    // 画像はすぐ一覧に出せるよう、OCR結果なしでまず記録する
    const entry = await clipboardStore.appendImageHistory(image.toDataURL())
    onNewEntry(entry)

    // OCRは数秒かかることがあるためポーリングをブロックせず、完了したら検索用テキストを後追いで反映する
    runOcrOnImage(image)
      .then(async (lines) => {
        const ocrText = lines
          .map((l) => l.text)
          .join('\n')
          .trim()
        if (!ocrText) return
        const updated = await clipboardStore.setHistoryEntryOcrText(entry.id, ocrText)
        if (updated) onNewEntry(updated)
      })
      .catch(() => {})
  }, POLL_INTERVAL_MS)
}

export function stopClipboardWatcher(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
