import { nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import log from './logger'
import * as settingsStore from './settingsStore'
import { runOcrOnImage } from './ocr'
import { looksLikePii, unionRect, blackOutRegions, anyCategoryEnabled, type Rect } from './piiDetect'
import type { AutoMaskSettings } from '../shared/types'

/**
 * スクリーンショット・失敗時エビデンス画像を保存する前に、電話番号やメールアドレスなど
 * 個人情報・機密情報らしき文字列が写り込んでいれば自動で黒塗りする機能。
 * 設定でON/OFFを切り替えられ、OFFの場合や検出に失敗した場合は元の画像をそのまま返す
 * (この機能自体が保存処理を止めてしまわないようにするため)。
 *
 * OCR自体はWindows標準のOCRエンジンをPowerShell経由で呼び出す共通処理(./ocr)、
 * PII検出・黒塗りロジックは共通処理(./piiDetect)を使う。
 */

/** 機能自体がONかつ、いずれか1項目でも選択されている設定を返す。それ以外はnull(OCR自体を省略する) */
async function getEnabledCategories(): Promise<AutoMaskSettings | null> {
  try {
    const { autoMaskSensitiveInfo } = await settingsStore.getSettings()
    if (!autoMaskSensitiveInfo.enabled) return null
    return anyCategoryEnabled(autoMaskSensitiveInfo.categories) ? autoMaskSensitiveInfo.categories : null
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
