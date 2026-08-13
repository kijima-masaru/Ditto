import { BrowserWindow, ipcMain, screen, type IpcMainInvokeEvent, type Rectangle } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC, type PreviewKind } from '../shared/types'

/**
 * ネストしたフォルダ(サブフォルダの中のサブフォルダ...)のプレビューを、メインウィンドウの
 * 中にではなく、その右側に連鎖する別ウィンドウとして表示する。
 *
 * メインウィンドウは幅が狭い(300〜360px)サイドバー的なウィンドウで、1階層目のプレビュー
 * (フォルダカードにカーソルを乗せた時の中身)は既にウィンドウの右端いっぱいに開いている。
 * そこにさらにネストしたサブフォルダのプレビューを重ねて表示すると、ウィンドウ内では
 * 表示しきれず重なってしまう。実際のOSウィンドウとして独立させ、送信元ウィンドウの
 * すぐ右に隙間なく開くことで、重ならずカスケード表示できるようにしている。
 *
 * depth(何階層目のプレビューか)をキーに開いているウィンドウを管理し、同じdepth以降を
 * 一括で片付けられるようにする(別の行にカーソルが移った時に置き換える・カーソルが
 * 離れた時に子階層ごと閉じる、の両方に対応するため)。
 *
 * 「閉じる」判定はレンダラー側のmouseenter/mouseleaveイベントを信用せず、実際に閉じる
 * 直前にOSのカーソル位置を確認する方式にしている。子ウィンドウを新規作成した際、
 * 作成元のウィンドウへブラウザが誤ってmouseleaveを送ってしまうことがあり(カーソルは
 * 実際には動いていない)、レンダラー側のイベントだけを信用すると、サブフォルダに
 * カーソルを合わせた瞬間に階層全体が閉じてしまう不具合が起きていたため。
 */
const WIDTH = 260
const HEIGHT = 340
const CLOSE_CHECK_MS = 250

const windows = new Map<number, BrowserWindow>()
const pendingCloseTimers = new Map<number, ReturnType<typeof setTimeout>>()

function rectContainsPoint(rect: Rectangle, x: number, y: number, pad = 4): boolean {
  return x >= rect.x - pad && x <= rect.x + rect.width + pad && y >= rect.y - pad && y <= rect.y + rect.height + pad
}

function closeFromDepth(depth: number): void {
  for (const [d, timer] of [...pendingCloseTimers.entries()]) {
    if (d >= depth) {
      clearTimeout(timer)
      pendingCloseTimers.delete(d)
    }
  }
  for (const [d, w] of [...windows.entries()]) {
    if (d >= depth) {
      windows.delete(d)
      if (!w.isDestroyed()) w.close()
    }
  }
}

/**
 * depth以降のウィンドウを閉じる予約をする。実行時、カーソルがdepth以降のいずれかの
 * ウィンドウの上にまだあれば(mouseleaveが誤送信だった場合)閉じずに再度後で確認する
 */
function scheduleClose(depth: number): void {
  const existing = pendingCloseTimers.get(depth)
  if (existing) clearTimeout(existing)

  const check = (): void => {
    pendingCloseTimers.delete(depth)
    const cursor = screen.getCursorScreenPoint()
    const stillInUse = [...windows.entries()]
      .filter(([d]) => d >= depth)
      .some(([, w]) => !w.isDestroyed() && rectContainsPoint(w.getBounds(), cursor.x, cursor.y))
    if (stillInUse) {
      pendingCloseTimers.set(depth, setTimeout(check, CLOSE_CHECK_MS))
      return
    }
    closeFromDepth(depth)
  }
  pendingCloseTimers.set(depth, setTimeout(check, CLOSE_CHECK_MS))
}

function openPreview(
  event: IpcMainInvokeEvent,
  payload: { kind: PreviewKind; folderId: string; depth: number; rowTop: number }
): void {
  const senderWindow = BrowserWindow.fromWebContents(event.sender)
  if (!senderWindow) return
  // 同じ深さ(または、それより深い階層)に既に開いているものがあれば片付けてから開き直す
  closeFromDepth(payload.depth)

  // 幅の計算(左右)はウィンドウ全体の外枠基準、高さの位置合わせ(送信元の行と同じ高さに
  // 開く)はタイトルバーを含まないコンテンツ領域基準で計算する(rowTopはコンテンツ領域内での
  // 相対位置のため)
  const senderBounds = senderWindow.getBounds()
  const senderContentBounds = senderWindow.getContentBounds()
  const display = screen.getDisplayMatching(senderBounds)
  let x = senderBounds.x + senderBounds.width
  if (x + WIDTH > display.workArea.x + display.workArea.width) {
    // 画面右端に入らない場合は送信元ウィンドウの左側に開く
    x = senderBounds.x - WIDTH
  }
  const y = Math.min(
    Math.max(senderContentBounds.y + payload.rowTop, display.workArea.y),
    display.workArea.y + display.workArea.height - HEIGHT
  )

  const win = new BrowserWindow({
    x,
    y,
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.setAlwaysOnTop(true, 'screen-saver')
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    if (windows.get(payload.depth) === win) windows.delete(payload.depth)
  })

  const search = `?preview=1&kind=${payload.kind}&folder=${encodeURIComponent(payload.folderId)}&depth=${payload.depth}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/' + search)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }

  windows.set(payload.depth, win)
}

/**
 * カーソルが現在いずれかのプレビュー別ウィンドウの上にあるかどうか。
 * メインウィンドウ側の1階層目プレビュー(フォルダカードの中身、in-page表示)は、
 * カーソルが別ウィンドウ(2階層目以降)に移った時点でDOM的には「離れた」ことになり
 * 通常のmouseleaveで閉じてしまう。それを防ぐため、1階層目プレビューを閉じる前にも
 * この判定を使って「実は子の別ウィンドウの中にいるだけ」かどうかを確認する
 */
function isCursorOverAnyPreviewWindow(): boolean {
  const cursor = screen.getCursorScreenPoint()
  return [...windows.values()].some((w) => !w.isDestroyed() && rectContainsPoint(w.getBounds(), cursor.x, cursor.y))
}

export function initPreviewWindows(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.openPreviewWindow, (event, payload) => openPreview(event, payload))

  ipcMain.handle(IPC.isCursorOverPreviewWindow, () => isCursorOverAnyPreviewWindow())

  ipcMain.on(IPC.scheduleClosePreviewWindow, (_e, depth: number) => scheduleClose(depth))

  ipcMain.on(IPC.navigateToFolder, (_e, payload: { kind: PreviewKind; folderId: string }) => {
    closeFromDepth(1)
    const main = getMainWindow()
    if (main) {
      main.show()
      main.focus()
      main.webContents.send(IPC.navigateToFolderPush, payload)
    }
  })
}
