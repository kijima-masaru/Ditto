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
