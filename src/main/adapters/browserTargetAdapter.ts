import { shell } from 'electron'
import activeWin from 'active-win'
import * as win32 from '../win32'
import type { TargetAdapter, MacroTarget } from '../../shared/types'
import { WindowTargetAdapterBase, sleep } from './windowTargetBase'

/**
 * WEBアプリ対象のアダプタ。
 * URLをこのアプリの中で開く(埋め込み表示する)のではなく、ユーザーの既定ブラウザで
 * 外部ウィンドウとして開く。ログイン等でパスワードを入力する場面が想定されるため、
 * このアプリがページの内容やフォームの値を読み取れる状態を避け、記録もデスクトップ
 * アプリと同じ「対象ウィンドウ内の座標クリック/キー入力」のみで行う設計にしている。
 *
 * 開いたブラウザのウィンドウはユーザー自身のものなので、デスクトップアプリのように
 * プロセスを起動して追跡するのではなく、「URLを開いた直後に現れた/最前面になった
 * ウィンドウ」を対象として特定する。dispose時もプロセスの終了は行わない
 * (ユーザーのブラウザを勝手に閉じないため)。
 */

/**
 * shell.openExternal実行前後のウィンドウ一覧の差分で、新しく開いたウィンドウを探す。
 * (例: ブラウザが起動していなかった、新規ウィンドウとして開く設定の場合)
 * 新規ウィンドウが見つからない場合(既存ブラウザの新規タブとして開かれた等)は、
 * 現在の最前面ウィンドウをベストエフォートで対象とみなす。
 */
async function findBrowserWindowAfterOpen(url: string, timeoutMs = 8000): Promise<number | null> {
  const before = new Set((await activeWin.getOpenWindows()).map((w) => w.id))
  await shell.openExternal(url)

  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(300)
    const windows = await activeWin.getOpenWindows()
    const fresh = windows.find((w) => !before.has(w.id))
    if (fresh) return fresh.id
  }

  const fg = await activeWin()
  return fg ? fg.id : null
}

export class BrowserTargetAdapter extends WindowTargetAdapterBase {
  private readonly target: MacroTarget

  constructor(target: MacroTarget) {
    super()
    this.target = target
  }

  async init(): Promise<void> {
    if (!this.target.url) throw new Error('URLが指定されていません')

    const windowId = await findBrowserWindowAfterOpen(this.target.url)
    if (windowId === null) {
      throw new Error(`ブラウザのウィンドウが見つかりませんでした: ${this.target.url}`)
    }
    this.windowId = windowId
    this.hwnd = win32.idToHandle(windowId)
    win32.minimizeWindow(this.hwnd)
  }

  async dispose(): Promise<void> {
    // ユーザー自身のブラウザなので、記録・再生が終わってもプロセスやウィンドウは
    // 終了させない(勝手に閉じない)。フックの解除のみ行う。
    await this.stopRecording()
    this.hwnd = null
    this.windowId = null
  }
}

export function createBrowserAdapter(target: MacroTarget): TargetAdapter {
  return new BrowserTargetAdapter(target)
}
