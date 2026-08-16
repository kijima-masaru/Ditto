import { desktopCapturer, screen } from 'electron'
import log from './logger'
import * as screenCapture from './screenCapture'
import * as piiMask from './piiMask'
import type { WindowBounds } from './adapters/windowTargetBase'

/**
 * マクロ再生中にステップが失敗した際、その時点の画面をエビデンスとして
 * 自動的にスクリーンショット保存する。renderer側のdesktopCapturer+getUserMediaの
 * パイプライン(useScreenshot.ts等)は使わず、mainプロセスのdesktopCapturerだけで
 * 完結させる(失敗時に別ウィンドウを経由させたくないため)。
 *
 * 失敗しても再生処理自体を止めたくないので、このモジュール内で例外を握りつぶし、
 * 取得できなければnullを返す。
 */

function sanitizeForFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').trim()
}

/**
 * 対象ウィンドウの中心点に最も近いディスプレイを選ぶ。ウィンドウの座標が分からない場合は、
 * 直前の操作でマウスが対象付近にあるはずなので現在のカーソル位置から推測する
 * (それも取れなければプライマリディスプレイにフォールバック)
 */
function pickDisplay(bounds: WindowBounds | null | undefined): Electron.Display {
  if (bounds) {
    const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
    return screen.getDisplayNearestPoint(center)
  }
  try {
    return screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  } catch {
    return screen.getPrimaryDisplay()
  }
}

export async function captureFailureEvidence(
  macroCaseName: string,
  stepIndex: number,
  targetBounds?: WindowBounds | null
): Promise<string | null> {
  try {
    const display = pickDisplay(targetBounds)
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      // ディスプレイの実ピクセルサイズを指定し、縮小されたサムネイルではなく
      // 実質的なフルサイズの画像を取得する
      thumbnailSize: { width: display.size.width * display.scaleFactor, height: display.size.height * display.scaleFactor }
    })
    if (sources.length === 0) return null
    const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
    let bytes = source.thumbnail.toPNG()
    if (bytes.length === 0) return null
    bytes = await piiMask.maskPngIfEnabled(bytes)

    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `失敗-${sanitizeForFileName(macroCaseName)}-step${stepIndex + 1}-${stamp}`
    return await screenCapture.saveScreenshot(bytes, fileName)
  } catch (err) {
    log.warn('failure evidence capture failed', err)
    return null
  }
}
