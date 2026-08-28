import activeWin from 'active-win'
import { BrowserWindow, clipboard } from 'electron'
import log from './logger'
import { injectText } from './textInjector'
import * as win32 from './win32'

/**
 * 「直前に使っていたアプリ」を覚えておき、そこへテキストを入力する。
 *
 * コマンドパレットは開いた瞬間にフォーカスを奪うため、開く直前のウィンドウを
 * その場で1回だけ記録すれば足りる(commandPalette.ts参照)。一方メモの編集ウィンドウは
 * 利用者がそこで書き続けるため、同じやり方では「対象アプリ」を取り逃がす。
 * そこで、Dittoのどのウィンドウにもフォーカスが無い間だけ前面のウィンドウを
 * 定期的に見て覚えておく(Dittoを使っている間は対象アプリは変わらないため見に行かない)。
 */

/** 前面のウィンドウを見に行く間隔。Dittoにフォーカスが無い間だけ動く */
const SAMPLE_INTERVAL_MS = 1000
/** 対象ウィンドウを前面に出してから入力を始めるまでの待ち時間(パレットと同じ) */
const ACTIVATE_WAIT_MS = 200

let lastWindowId: number | null = null
let lastTitle = ''
let timer: NodeJS.Timeout | null = null

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function dittoHasFocus(): boolean {
  return BrowserWindow.getAllWindows().some((w) => !w.isDestroyed() && w.isFocused())
}

export function initLastForegroundApp(): void {
  if (timer) return
  timer = setInterval(() => {
    if (dittoHasFocus()) return
    try {
      const active = activeWin.sync()
      if (!active || active.owner?.processId === process.pid) return
      lastWindowId = active.id ?? null
      lastTitle = active.title ?? active.owner?.name ?? ''
    } catch (err) {
      log.warn('lastForegroundApp: failed to read foreground window', err)
    }
  }, SAMPLE_INTERVAL_MS)
  timer.unref()
}

export function getLastAppTitle(): string | null {
  return lastWindowId === null ? null : lastTitle
}

/**
 * 直前に使っていたアプリを前面に出してテキストを入力する。
 * 入力に加えてクリップボードにも同じ内容を入れておき、入力が効かないアプリでも
 * Ctrl+Vで貼り付けられるようにする(コマンドパレットと同じ扱い)。
 * 対象が分からなかった場合はfalseを返す
 */
export async function insertToLastApp(text: string): Promise<boolean> {
  if (!text) return false
  clipboard.writeText(text)
  if (lastWindowId === null) return false
  try {
    // 最大化されていた対象ウィンドウの状態を崩さないよう、最小化時のみ復元する版を使う
    win32.activateWindowKeepState(win32.idToHandle(lastWindowId))
  } catch (err) {
    log.warn('lastForegroundApp: failed to activate window', err)
    return false
  }
  await wait(ACTIVATE_WAIT_MS)
  await injectText(text)
  return true
}
