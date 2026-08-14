import { clipboard, type NativeImage } from 'electron'
import { createHash } from 'crypto'
import * as clipboardStore from './clipboardStore'
import * as settingsStore from './settingsStore'
import { runOcrOnImage } from './ocr'
import { containsPii, maskText, looksLikePii, anyCategoryEnabled, unionRect, blackOutRegions, type Rect } from './piiDetect'
import type { ClipboardHistoryEntry, ClipboardPiiProtectionSettings } from '../shared/types'

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

/** 保護設定を返す。項目が1つもONでなければnull(保護処理自体を省略する) */
async function getPiiProtection(): Promise<ClipboardPiiProtectionSettings | null> {
  try {
    const { clipboardPiiProtection } = await settingsStore.getSettings()
    return anyCategoryEnabled(clipboardPiiProtection.categories) ? clipboardPiiProtection : null
  } catch {
    return null
  }
}

async function handleNewText(
  text: string,
  onNewEntry: (entry: ClipboardHistoryEntry) => void
): Promise<void> {
  const protection = await getPiiProtection()
  if (protection && containsPii(text, protection.categories)) {
    if (protection.mode === 'delete') return // 履歴に一切残さない
    const entry = await clipboardStore.appendHistory(maskText(text, protection.categories))
    onNewEntry(entry)
    return
  }
  const entry = await clipboardStore.appendHistory(text)
  onNewEntry(entry)
}

async function handleNewImage(
  image: NativeImage,
  onNewEntry: (entry: ClipboardHistoryEntry) => void
): Promise<void> {
  const protection = await getPiiProtection()

  if (!protection) {
    // 保護設定が無効な場合は、画像をすぐ一覧に出してからOCRを後追いで反映する(体感速度優先)
    const entry = await clipboardStore.appendImageHistory(image.toDataURL())
    onNewEntry(entry)
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
    return
  }

  // 保護設定が有効な場合は、機密情報を一瞬でも未加工のまま一覧に出さないよう、
  // OCRとPII判定が終わってから初めて履歴に追加する(その分、一覧への反映が数秒遅れる)
  try {
    const lines = await runOcrOnImage(image)
    const piiLines = lines.filter((l) => looksLikePii(l.text, protection.categories))
    if (piiLines.length > 0 && protection.mode === 'delete') return // 履歴に一切残さない

    let finalImage = image
    if (piiLines.length > 0) {
      const regions = piiLines.map((l) => unionRect(l.words)).filter((r): r is Rect => r !== null)
      finalImage = blackOutRegions(image, regions)
    }
    const ocrText = lines
      .map((l) => (looksLikePii(l.text, protection.categories) ? maskText(l.text, protection.categories) : l.text))
      .join('\n')
      .trim()

    const entry = await clipboardStore.appendImageHistory(finalImage.toDataURL())
    onNewEntry(entry)
    if (ocrText) {
      const updated = await clipboardStore.setHistoryEntryOcrText(entry.id, ocrText)
      if (updated) onNewEntry(updated)
    }
  } catch {
    // OCR自体に失敗するとPIIの有無を判定できず安全に保護できないため、この画像は記録しない
  }
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
      await handleNewText(text, onNewEntry)
      // テキストと画像が同時に変化することは通常ないため、この回はここで終える
      return
    }

    const image = clipboard.readImage()
    if (image.isEmpty()) return
    const hash = hashPng(image.toPNG())
    if (hash === lastSeenImageHash) return
    lastSeenImageHash = hash

    await handleNewImage(image, onNewEntry)
  }, POLL_INTERVAL_MS)
}

export function stopClipboardWatcher(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}
