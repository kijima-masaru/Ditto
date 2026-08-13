import { BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { IPC } from '../shared/types'

/**
 * スクリーンショットの確認・注釈編集画面。Ditto本体(小さなサイドバー的ウィンドウ)の中に
 * 収めると作業しづらいため、別のOSウィンドウとしてPC画面いっぱいに最大化して表示する。
 * メインウィンドウと同じrenderer bundleを`?screenshotEditor=1`付きで読み込む。
 */
let win: BrowserWindow | null = null

export function open(dataUrl: string): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.screenshotEditorImage, dataUrl)
    if (!win.isMaximized()) win.maximize()
    win.show()
    win.focus()
    return
  }

  win = new BrowserWindow({
    show: false,
    title: 'スクリーンショットを確認',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  win.maximize()
  win.once('ready-to-show', () => win?.show())
  win.webContents.once('did-finish-load', () => {
    win?.webContents.send(IPC.screenshotEditorImage, dataUrl)
  })
  win.on('closed', () => {
    win = null
  })

  const search = '?screenshotEditor=1'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/' + search)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
}

export function initScreenshotEditorWindow(getMainWindow: () => BrowserWindow | null): void {
  ipcMain.handle(IPC.openScreenshotEditor, (_e, dataUrl: string) => open(dataUrl))

  ipcMain.on(IPC.notifyScreenshotSaved, (_e, path: string) => {
    getMainWindow()?.webContents.send(IPC.screenshotEditorSaved, path)
  })
}
