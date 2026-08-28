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
// 編集ウィンドウが今どのメモを表示しているか。rendererから通知を受けて保持する。
// 「クリップボード履歴からメモへ追記」した時に、そのメモを開いているウィンドウがあれば
// ファイルを直接書き換えずウィンドウ側に追記させるために使う(下記appendIfOpen参照)
let showingNoteId: string | null = null

/** ダイアログの親にするために、開いていれば編集ウィンドウを返す */
export function getWindow(): BrowserWindow | null {
  return win && !win.isDestroyed() ? win : null
}

/** 編集ウィンドウから「今このメモを表示している」と通知を受ける */
export function setShowingNote(noteId: string): void {
  showingNoteId = noteId
}

/**
 * 指定のメモを編集ウィンドウが開いていれば、そのウィンドウに追記させてtrueを返す。
 *
 * 開いているメモの本文はウィンドウ側が持っており、ファイルだけを書き換えても画面に
 * 反映されない。さらに、その後ウィンドウが自動保存すると画面上の(追記前の)内容で
 * 上書きされ、追記が失われてしまう。そのため「開いている間はウィンドウが持ち主」と
 * 決め、追記もウィンドウ自身に行わせる
 */
export function appendIfOpen(noteId: string, text: string): boolean {
  if (!win || win.isDestroyed() || showingNoteId !== noteId) return false
  win.webContents.send(IPC.appendToOpenNote, text)
  return true
}

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
    showingNoteId = null
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
