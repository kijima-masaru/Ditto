import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '../shared/types'
import { widthMatchingMainWindow } from './subWindowLayout'

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

// メインウィンドウが取得できない場合に使う幅。通常はDitto本体と同じ幅にする(playbackWidth参照)
const FALLBACK_WIDTH = 480
const HEIGHT = 560

let win: BrowserWindow | null = null
// Ditto本体(メインウィンドウ)。再生ウィンドウの幅を本体に合わせるために参照する
let getMainWindow: (() => BrowserWindow | null) | null = null

/** Ditto本体の参照を渡す(index.tsから起動時に一度だけ呼ぶ) */
export function initMacroPlaybackWindow(getMainWindowFn: () => BrowserWindow | null): void {
  getMainWindow = getMainWindowFn
}

/** 再生ウィンドウの幅。Ditto本体と同じ幅にする(詳細はwidthMatchingMainWindowのコメント参照) */
function playbackWidth(): number {
  return widthMatchingMainWindow(getMainWindow?.() ?? null, FALLBACK_WIDTH)
}

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

/** 既に開いているウィンドウの表示対象を差し替える。読み込み済みのウィンドウにしか
 *  使わない(新規作成時はクエリ文字列でマクロIDを渡す。理由はopen()のコメント参照) */
function sendMacroId(w: BrowserWindow, macroId: string): void {
  if (!w.isDestroyed()) w.webContents.send(IPC.openMacroForPlayback, macroId)
}

/** 指定したマクロの再生画面(idle状態。実行はユーザーがボタンを押すまで開始しない)を開く */
export function open(macroId: string): void {
  if (win && !win.isDestroyed()) {
    win.setSize(playbackWidth(), win.getSize()[1])
    positionAtCursor(win)
    sendMacroId(win, macroId)
    win.show()
    win.focus()
    win.moveTop()
    return
  }

  win = new BrowserWindow({
    width: playbackWidth(),
    height: HEIGHT,
    // Ditto本体の最小幅(300)と揃える。ここが本体より大きいと、本体を細くした際に
    // 幅を合わせられなくなる
    minWidth: 300,
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

  // 新規作成時のマクロIDはIPCではなくクエリ文字列で渡す。
  // IPCで渡そうとすると、送信側(main)と受信側(rendererのReactがマウントしてlistenerを
  // 登録するまで)のタイミング勝負になり、送信が早すぎるとメッセージが捨てられて
  // 画面が「読み込み中」のまま止まる。クエリ文字列ならrenderer側が起動時に自分で読めるため、
  // タイミングに依存しない
  const search = `?macroPlayback=1&macroId=${encodeURIComponent(macroId)}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/' + search)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
}
