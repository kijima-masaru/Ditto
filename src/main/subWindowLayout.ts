import { BrowserWindow, screen } from 'electron'

/**
 * Ditto本体(メインウィンドウ)に付随して開くサブウィンドウ(コマンドパレット・
 * マクロ再生画面)の見た目を本体に揃えるためのユーティリティ。
 */

/**
 * サブウィンドウの幅をDitto本体と同じ幅にする。本体はユーザーがリサイズしたり、
 * 設定でサイズを固定したりできるため、表示のたびにその時点の幅を取得して使う。
 *
 * 枠なしのサブウィンドウと枠ありの本体で見た目の幅を揃えるため、どちらも外枠基準
 * (getSize)で合わせる。本体を最大化している場合などに画面からはみ出さないよう、
 * カーソルのあるディスプレイの作業領域の幅でクランプする。
 * 本体が取得できない場合(起動直後の事前生成時など)はfallbackWidthを使う。
 */
export function widthMatchingMainWindow(main: BrowserWindow | null, fallbackWidth: number): number {
  const width = !main || main.isDestroyed() ? fallbackWidth : main.getSize()[0]
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  return Math.min(width, workArea.width)
}

/**
 * カーソルのあるディスプレイの作業領域に収まる形で、ウィンドウの矩形(位置とサイズ)を返す。
 * カーソルが中心に来るように置き、作業領域からはみ出す分は押し戻す。
 *
 * 位置だけでなくサイズもクランプするのは、作業領域より大きいウィンドウを置こうとすると
 * 計算上マイナス側へ回り込み、画面外に出てしまうため
 * (例: 高さ640のウィンドウを、タスクバーを除いた高さ560の作業領域へ置くと y = -80 になる)。
 *
 * 複数ディスプレイでは、この矩形をウィンドウの「生成時」に渡すことが重要になる。
 * 先に既定位置(プライマリ側)で作ってから別のディスプレイへ動かす形だと、
 * まだ表示していないウィンドウの移動をWindowsが元のディスプレイ側へ押し戻すことがあり、
 * 「選んでも目的のディスプレイに出てこない」状態になりうる。
 */
export function boundsAtCursor(width: number, height: number): {
  x: number
  y: number
  width: number
  height: number
} {
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const w = Math.min(width, workArea.width)
  const h = Math.min(height, workArea.height)
  const x = Math.min(Math.max(cursor.x - Math.round(w / 2), workArea.x), workArea.x + workArea.width - w)
  const y = Math.min(Math.max(cursor.y - Math.round(h / 2), workArea.y), workArea.y + workArea.height - h)
  return { x, y, width: w, height: h }
}
