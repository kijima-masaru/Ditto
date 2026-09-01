import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import log from './logger'
import { IPC } from '../shared/types'
import { boundsAtCursor, widthMatchingMainWindow } from './subWindowLayout'

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

/**
 * ウィンドウをマウスカーソルのいるディスプレイへ、カーソルを中心にして置き直す。
 *
 * setPositionではなくsetBoundsで位置とサイズを一度に指定する。位置だけを動かすと、
 * 移動先のディスプレイに収まらないサイズのままになり、はみ出した状態になるため。
 *
 * 置いたあと実際の位置を読み直してログに残す。複数ディスプレイでは、要求した座標が
 * そのまま通らずWindows側で押し戻されることがあり、その場合ここの「希望」と「実際」が
 * 食い違う。「選んでも出てこない」という報告を、次のログで切り分けられるようにしておく
 */
function positionAtCursor(w: BrowserWindow): void {
  const want = boundsAtCursor(...(w.getSize() as [number, number]))
  w.setBounds(want)
  const got = w.getBounds()
  if (got.x !== want.x || got.y !== want.y) {
    log.warn('macroPlaybackWindow: 位置が要求どおりにならなかった 希望=', want, '実際=', got)
  }
}

/** 既に開いているウィンドウの表示対象を差し替える。読み込み済みのウィンドウにしか
 *  使わない(新規作成時はクエリ文字列でマクロIDを渡す。理由はopen()のコメント参照) */
function sendMacroId(w: BrowserWindow, macroId: string): void {
  if (!w.isDestroyed()) w.webContents.send(IPC.openMacroForPlayback, macroId)
}

/**
 * 位置合わせに失敗しても表示自体は必ず行う。
 * ready-to-showの中で例外が起きるとshow()まで到達せず、
 * 「選んでも何も出てこない」状態になってしまうため
 */
function showSafely(w: BrowserWindow): void {
  try {
    positionAtCursor(w)
  } catch (err) {
    log.error('macroPlaybackWindow: failed to position window', err)
  }
  w.show()
  w.focus()
  w.moveTop()
  // 表示してからもう一度置き直す。非表示のウィンドウを別のディスプレイへ動かす指示は
  // Windowsに無視されることがあり、その場合ここで初めて目的の位置へ移る
  try {
    positionAtCursor(w)
  } catch (err) {
    log.error('macroPlaybackWindow: failed to reposition after show', err)
  }
  log.info('macroPlaybackWindow: 表示した bounds=', w.getBounds(), 'visible=', w.isVisible())
}

/** 指定したマクロの再生画面(idle状態。実行はユーザーがボタンを押すまで開始しない)を開く */
export function open(macroId: string): void {
  log.info('macroPlaybackWindow: open', macroId, 'existing=', Boolean(win && !win.isDestroyed()))
  if (win && !win.isDestroyed()) {
    // 幅だけ本体に合わせ、位置と最終的なサイズはshowSafely内のpositionAtCursorが決める
    win.setSize(playbackWidth(), win.getSize()[1])
    sendMacroId(win, macroId)
    showSafely(win)
    return
  }

  // 生成の時点でカーソルのあるディスプレイへ置く。既定位置(プライマリ)で作ってから
  // 動かす形だと、表示前の移動をWindowsが元のディスプレイへ押し戻すことがあり、
  // 複数ディスプレイで「選んでも出てこない」状態になりうる
  const initial = boundsAtCursor(playbackWidth(), HEIGHT)
  log.info('macroPlaybackWindow: 生成位置=', initial)
  win = new BrowserWindow({
    x: initial.x,
    y: initial.y,
    width: initial.width,
    height: initial.height,
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
  // 常に最前面へ。再生中は操作対象のアプリが前面に来るため、パレットと同じ
  // screen-saverレベルにして進捗を見続けられるようにする
  win.setAlwaysOnTop(true, 'screen-saver')
  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return
    showSafely(win)
  })
  // ready-to-showは通常必ず発火するが、万一届かなかった場合に「選んでも何も出ない」状態で
  // 止まらないよう、少し待ってまだ表示されていなければ出す。
  // did-finish-loadで代用しないのは、そちらがready-to-showより先に来ることがあり、
  // 描画前に表示して白い画面が一瞬見えてしまうため
  const showFallback = setTimeout(() => {
    if (win && !win.isDestroyed() && !win.isVisible()) {
      log.warn('macroPlaybackWindow: ready-to-show did not fire, showing anyway')
      showSafely(win)
    }
  }, 3000)
  win.on('closed', () => clearTimeout(showFallback))
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    log.error('macroPlaybackWindow: did-fail-load', code, desc)
  })
  win.on('closed', () => {
    log.info('macroPlaybackWindow: closed')
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
