import { nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import log from './logger'
import * as settingsStore from './settingsStore'
import { runOcrOnImage, type OcrWord } from './ocr'
import type { AutoMaskCategory, AutoMaskSettings } from '../shared/types'

/**
 * スクリーンショット・失敗時エビデンス画像を保存する前に、電話番号やメールアドレスなど
 * 個人情報・機密情報らしき文字列が写り込んでいれば自動で黒塗りする機能。
 * 設定でON/OFFを切り替えられ、OFFの場合や検出に失敗した場合は元の画像をそのまま返す
 * (この機能自体が保存処理を止めてしまわないようにするため)。
 *
 * OCR自体はWindows標準のOCRエンジンをPowerShell経由で呼び出す共通処理(./ocr)を使う。
 */

// 電話番号・郵便番号・メールアドレス・クレジットカード/マイナンバー(12桁)らしき文字列を検出する。
// OCRは単語単位(空白区切り)で認識されることが多いため、単語全体の完全一致ではなく
// 部分一致で判定する(「TEL:090-1234-5678」のように前置きが付いた1単語になる場合もあるため)。
// 項目ごとに設定でON/OFFを切り替えられるよう、カテゴリ付きで保持する。
const PII_PATTERNS: { category: AutoMaskCategory; pattern: RegExp }[] = [
  { category: 'phone', pattern: /0\d{1,4}-?\d{1,4}-?\d{3,4}/ },
  // 郵便番号(ハイフン必須。単なる4桁数字等の誤検出を避けるため)
  { category: 'postalCode', pattern: /\b\d{3}-\d{4}\b/ },
  { category: 'email', pattern: /[\w.+-]+@[\w-]+\.[\w.-]+/ },
  // クレジットカード番号/マイナンバー(12〜16桁)
  { category: 'creditCard', pattern: /\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/ }
]

// OCRは数字やハイフンの並びを1文字ずつ別単語として認識することが多く(実機検証で確認済み)、
// 単語単体では「090-1234-5678」のような並びにマッチしない。そのため行(Line)単位でテキストを
// 連結してからPIIパターンを判定する。空白除去版でも判定することで、OCRが単語間に余分な
// 空白を挟んだ場合(「0 9 0 -1234-5678」等)も拾えるようにする。
function looksLikePii(lineText: string, categories: AutoMaskSettings): boolean {
  const trimmed = lineText.trim()
  if (trimmed.length < 4) return false
  const activePatterns = PII_PATTERNS.filter((p) => categories[p.category]).map((p) => p.pattern)
  if (activePatterns.some((re) => re.test(trimmed))) return true
  const noSpace = trimmed.replace(/\s+/g, '')
  return activePatterns.some((re) => re.test(noSpace))
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

// 行内の各単語のバウンディングボックスを1つに統合した矩形を返す。
// 単語単位でなく行単位で塗る(該当行の一部だけが機密情報でも行全体を塗る)ことで、
// 数字・記号がOCR上1文字ずつ別単語に分割されるケースでも塗り漏れが出ないようにする。
function unionRect(words: OcrWord[]): Rect | null {
  if (words.length === 0) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const w of words) {
    x0 = Math.min(x0, w.x)
    y0 = Math.min(y0, w.y)
    x1 = Math.max(x1, w.x + w.width)
    y1 = Math.max(y1, w.y + w.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

function blackOutRegions(image: NativeImage, regions: Rect[]): NativeImage {
  const { width, height } = image.getSize()
  const bitmap = image.toBitmap()
  // 枠ぴったりだと文字がわずかにはみ出て残ることがあるため、少し余白を持たせて塗る
  const MARGIN = 4
  for (const r of regions) {
    const x0 = Math.max(0, Math.floor(r.x - MARGIN))
    const y0 = Math.max(0, Math.floor(r.y - MARGIN))
    const x1 = Math.min(width, Math.ceil(r.x + r.width + MARGIN))
    const y1 = Math.min(height, Math.ceil(r.y + r.height + MARGIN))
    for (let y = y0; y < y1; y++) {
      const rowStart = (y * width + x0) * 4
      const rowLen = (x1 - x0) * 4
      bitmap.fill(0, rowStart, rowStart + rowLen)
      // アルファチャンネルは不透明(255)のままにする(fillで0にしてしまった分を戻す)
      for (let x = x0; x < x1; x++) {
        bitmap[(y * width + x) * 4 + 3] = 255
      }
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width, height })
}

/** いずれか1項目でもONになっている設定を返す。全項目OFFならnull(OCR自体を省略する) */
async function getEnabledCategories(): Promise<AutoMaskSettings | null> {
  try {
    const settings = await settingsStore.getSettings()
    const { autoMaskSensitiveInfo } = settings
    const anyEnabled = Object.values(autoMaskSensitiveInfo).some(Boolean)
    return anyEnabled ? autoMaskSensitiveInfo : null
  } catch {
    return null
  }
}

async function detectAndMask(image: NativeImage, categories: AutoMaskSettings): Promise<NativeImage> {
  try {
    const lines = await runOcrOnImage(image)
    const piiRegions = lines
      .filter((l) => looksLikePii(l.text, categories))
      .map((l) => unionRect(l.words))
      .filter((r): r is Rect => r !== null)
    if (piiRegions.length === 0) return image
    return blackOutRegions(image, piiRegions)
  } catch (err) {
    log.warn('piiMask detectAndMask failed', err)
    return image
  }
}

/** 項目が1つでもONの場合のみ、PNGバイト列を検査してマスキング済みのPNGバイト列を返す */
export async function maskPngIfEnabled(png: Buffer): Promise<Buffer> {
  const categories = await getEnabledCategories()
  if (!categories) return png
  try {
    const image = nativeImage.createFromBuffer(png)
    const masked = await detectAndMask(image, categories)
    return masked.toPNG()
  } catch (err) {
    log.warn('maskPngIfEnabled failed, using original image', err)
    return png
  }
}

/** 項目が1つでもONの場合のみ、data URL(PNG)を検査してマスキング済みのdata URLを返す */
export async function maskDataUrlIfEnabled(dataUrl: string): Promise<string> {
  const categories = await getEnabledCategories()
  if (!categories) return dataUrl
  try {
    const image = nativeImage.createFromDataURL(dataUrl)
    const masked = await detectAndMask(image, categories)
    return masked.toDataURL()
  } catch (err) {
    log.warn('maskDataUrlIfEnabled failed, using original image', err)
    return dataUrl
  }
}
