import { BrowserWindow } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '../shared/types'

/**
 * メモの編集専用の別ウィンドウ。
 *
 * Ditto本体は幅360px程度のサイドバー的なウィンドウで、文章を書くには狭すぎる。
 * そのため一覧と検索だけを本体に置き、書く作業はこの広い別ウィンドウへ逃がす。
 * メインウィンドウと同じrenderer bundleを`?noteEditor=1`付きで読み込む
 * (プレビュー・スクリーンショット編集・コマンドパレットと同じ方式)。
 *
 * パレットや再生ウィンドウと違い、本体の幅には合わせない。ここは「広く使うための
 * ウィンドウ」であり、本体の幅に合わせると目的を損なうため。
 */

const WIDTH = 900
const HEIGHT = 680

let win: BrowserWindow | null = null

/** 指定したメモの編集画面を開く(既に開いていれば対象を差し替えて前面に出す) */
export function open(noteId: string): void {
  if (win && !win.isDestroyed()) {
    // 読み込み済みのウィンドウなので、対象の差し替えはIPCで取りこぼしなく届く
    win.webContents.send(IPC.openNoteInEditor, noteId)
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    return
  }

  win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    minWidth: 480,
    minHeight: 320,
    title: 'メモ',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.once('ready-to-show', () => {
    if (!win || win.isDestroyed()) return
    win.show()
    win.focus()
  })
  win.on('closed', () => {
    win = null
  })

  // 新規作成時の対象メモIDはIPCではなくクエリ文字列で渡す。
  // IPCで渡そうとすると、送信(main)がrenderer側のlistener登録より早い場合に
  // メッセージが捨てられ、画面が「読み込み中」のまま止まってしまう
  const search = `?noteEditor=1&noteId=${encodeURIComponent(noteId)}`
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/' + search)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
}
