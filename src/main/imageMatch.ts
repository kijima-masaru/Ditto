import { desktopCapturer, nativeImage, screen } from 'electron'
import type { NativeImage } from 'electron'
import log from './logger'

/**
 * クリック位置を中心とした小さな画像を記録しておき、再生時に同じ見た目の場所を
 * 画面内から探して座標を補正する仕組み。ウィンドウサイズやレイアウトが記録時と
 * 多少ずれていても、座標だけに頼るより実際のクリック対象を当てやすくするのが狙い。
 * マッチに失敗した場合は呼び出し側が座標クリックにフォールバックする設計とし、
 * このモジュール自体は例外を投げず null を返すだけに留める。
 */

const TEMPLATE_HALF = 24
// 実機検証で、電話キーパッドのように見た目がほぼ同じボタンが並ぶUIにおいて、
// 探索範囲の端(旧40px)で隣接する別ボタンを誤って「一致」と検出し、正しい記録座標を
// 大きくズレた位置へ上書きしてしまう不具合を確認した(例: 記録位置から38px離れた
// 隣の行のボタンを誤検出)。軽微なレイアウトのずれを補正するだけであれば数px程度で
// 十分なため、誤検出を防ぐ目的で探索範囲を縮小している
const SEARCH_MARGIN = 15
/**
 * チャネル平均絶対差(0〜255)。この値以下なら十分一致しているとみなす。
 * 実機検証では同一アプリの別インスタンス間でも(アンチエイリアシングやカーソル点滅等の
 * 微差により)スコア30前後になるケースを確認したため、明らかに違う場所を弾ける範囲で
 * 余裕を持たせた値にしている
 */
const MATCH_THRESHOLD = 40

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface MatchResult {
  x: number
  y: number
  score: number
}

function clampRect(rect: Rect, bounds: { width: number; height: number }): Rect {
  const x = Math.max(0, Math.round(rect.x))
  const y = Math.max(0, Math.round(rect.y))
  const right = Math.min(bounds.width, Math.round(rect.x + rect.width))
  const bottom = Math.min(bounds.height, Math.round(rect.y + rect.height))
  return { x, y, width: Math.max(0, right - x), height: Math.max(0, bottom - y) }
}

async function captureDisplayImage(display: Electron.Display): Promise<NativeImage | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(display.size.width * display.scaleFactor),
      height: Math.round(display.size.height * display.scaleFactor)
    }
  })
  if (sources.length === 0) return null
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  return source.thumbnail
}

/** 記録時: 画面座標(screenX, screenY)を中心とした小さな画像を切り出しbase64 PNGで返す */
export async function captureTemplateAt(screenX: number, screenY: number): Promise<string | null> {
  try {
    const display = screen.getDisplayNearestPoint({ x: screenX, y: screenY })
    const full = await captureDisplayImage(display)
    if (!full) return null
    const sf = display.scaleFactor
    const rect = clampRect(
      {
        x: (screenX - display.bounds.x - TEMPLATE_HALF) * sf,
        y: (screenY - display.bounds.y - TEMPLATE_HALF) * sf,
        width: TEMPLATE_HALF * 2 * sf,
        height: TEMPLATE_HALF * 2 * sf
      },
      full.getSize()
    )
    if (rect.width < 4 || rect.height < 4) return null
    return full.crop(rect).toDataURL()
  } catch (err) {
    log.warn('captureTemplateAt failed', err)
    return null
  }
}

function averageChannelDiff(
  templateBitmap: Buffer,
  templateW: number,
  templateH: number,
  searchBitmap: Buffer,
  searchStrideW: number,
  offsetX: number,
  offsetY: number
): number {
  let sum = 0
  for (let y = 0; y < templateH; y++) {
    const tRow = y * templateW * 4
    const sRow = ((y + offsetY) * searchStrideW + offsetX) * 4
    for (let x = 0; x < templateW; x++) {
      const ti = tRow + x * 4
      const si = sRow + x * 4
      sum += Math.abs(templateBitmap[ti] - searchBitmap[si])
      sum += Math.abs(templateBitmap[ti + 1] - searchBitmap[si + 1])
      sum += Math.abs(templateBitmap[ti + 2] - searchBitmap[si + 2])
    }
  }
  return sum / (templateW * templateH * 3)
}

/**
 * 再生時: 記録したテンプレート画像を期待座標(expectedX, expectedY / 画面座標)付近で
 * 探索し、最も一致する位置の中心座標を返す。十分一致する場所が見つからなければnull
 */
export async function findTemplateMatch(
  templateDataUrl: string,
  expectedX: number,
  expectedY: number
): Promise<MatchResult | null> {
  try {
    const template = nativeImage.createFromDataURL(templateDataUrl)
    const tSize = template.getSize()
    if (tSize.width < 4 || tSize.height < 4) return null

    const display = screen.getDisplayNearestPoint({ x: expectedX, y: expectedY })
    const full = await captureDisplayImage(display)
    if (!full) return null

    const sf = display.scaleFactor
    const centerPhysX = (expectedX - display.bounds.x) * sf
    const centerPhysY = (expectedY - display.bounds.y) * sf
    const marginPhys = SEARCH_MARGIN * sf

    const searchRect = clampRect(
      {
        x: centerPhysX - tSize.width / 2 - marginPhys,
        y: centerPhysY - tSize.height / 2 - marginPhys,
        width: tSize.width + marginPhys * 2,
        height: tSize.height + marginPhys * 2
      },
      full.getSize()
    )
    if (searchRect.width < tSize.width || searchRect.height < tSize.height) return null

    const searchImage = full.crop(searchRect)
    const searchSize = searchImage.getSize()
    const searchBitmap = searchImage.toBitmap()
    const templateBitmap = template.toBitmap()

    let bestScore = Infinity
    let bestOffsetX = 0
    let bestOffsetY = 0
    const maxOffsetX = searchSize.width - tSize.width
    const maxOffsetY = searchSize.height - tSize.height
    for (let oy = 0; oy <= maxOffsetY; oy++) {
      for (let ox = 0; ox <= maxOffsetX; ox++) {
        const score = averageChannelDiff(templateBitmap, tSize.width, tSize.height, searchBitmap, searchSize.width, ox, oy)
        if (score < bestScore) {
          bestScore = score
          bestOffsetX = ox
          bestOffsetY = oy
        }
      }
    }

    if (bestScore > MATCH_THRESHOLD) return null

    const matchPhysX = searchRect.x + bestOffsetX + tSize.width / 2
    const matchPhysY = searchRect.y + bestOffsetY + tSize.height / 2
    return {
      x: display.bounds.x + matchPhysX / sf,
      y: display.bounds.y + matchPhysY / sf,
      score: bestScore
    }
  } catch (err) {
    log.warn('findTemplateMatch failed', err)
    return null
  }
}
