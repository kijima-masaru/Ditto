import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '../shared/types'

/**
 * コマンドパレットで選んだマクロの再生画面だけを表示する専用の別ウィンドウ。
 *
 * 以前はメインウィンドウ(クリップボード・マクロ一覧・設定を含むDitto本体)をカーソル位置へ
 * 移動させて再生モーダルを開いていたため、パレットからマクロを選ぶたびにDitto本体が
 * 作業中の画面に割り込んでくる形になっていた。再生に必要なのは再生画面だけなので、
 * メインウィンドウとは独立した小さなウィンドウとして開き、Ditto本体は元の位置・
 * 表示状態のままにしておく。
 *
 * メインウィンドウと同じrenderer bundleを`?macroPlayback=1`付きで読み込み、
 * 対象のマクロIDは読み込み完了後にIPCで渡す(既に開いているウィンドウを再利用する
 * 場合も同じIPCで対象を差し替える)。
 */

const WIDTH = 480
const HEIGHT = 560

let win: BrowserWindow | null = null

// ウィンドウをマウスカーソル位置(中心が合うよう)に移動する。カーソルがいる
// ディスプレイの作業領域からはみ出さないようクランプする
function positionAtCursor(w: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const [width, height] = w.getSize()
  const x = Math.min(Math.max(cursor.x - Math.round(width / 2), workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(cursor.y - Math.round(height / 2), workArea.y), workArea.y + workArea.height - height)
  w.setPosition(x, y)
}

function sendMacroId(w: BrowserWindow, macroId: string): void {
  const send = (): void => {
    if (!w.isDestroyed()) w.webContents.send(IPC.openMacroForPlayback, macroId)
  }
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

/** 指定したマクロの再生画面(idle状態。実行はユーザーがボタンを押すまで開始しない)を開く */
export function open(macroId: string): void {
  if (win && !win.isDestroyed()) {
    positionAtCursor(win)
    sendMacroId(win, macroId)
    win.show()
    win.focus()
    win.moveTop()
    return
  }

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 360,
    minHeight: 320,
    // タイトルバーの分だけ縦に伸びるのを避けるため枠なしにし、閉じる・移動は
    // renderer側のヘッダー(MacroPlaybackWindowRoot)で行う
    frame: false,
    // 再生中は操作対象のアプリが最前面になるため、進捗を見続けられるよう最前面固定にする
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return
    positionAtCursor(win)
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    win = null
  })

  sendMacroId(win, macroId)

  const search = '?macroPlayback=1'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/' + search)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
}
