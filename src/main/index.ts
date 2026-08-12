import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC } from '../shared/types'
import { registerIpcHandlers } from './ipcHandlers'
import { setupAutoUpdater, checkForUpdates } from './autoUpdater'
import * as recordingFrame from './recordingFrame'
import { createTray } from './tray'
import { setupGlobalHotkey } from './hotkey'
import { startClipboardWatcher } from './clipboardWatcher'

// 表示名は"Ditto"だが、内部的な名前(userDataの保存先フォルダ名等に影響)は
// 旧アプリ名のまま固定し、既存インストールのテストデータ・設定を引き継ぐ
app.setName('auto-test-tool')

let mainWindow: BrowserWindow | null = null
// トレイに常駐させるため、ウィンドウを閉じても既定ではアプリを終了しない。
// トレイメニューの「終了」からのみ本当に終了する。
let isQuitting = false

function showMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 360,
    height: 640,
    minWidth: 300,
    minHeight: 420,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // クリップボード履歴の監視等をバックグラウンドで継続するため、Xボタンでは終了せず
  // トレイに常駐させる(実際の終了はトレイメニューの「終了」から)
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault()
      mainWindow?.hide()
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.flatline.autotesttool')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()
  registerIpcHandlers(() => mainWindow)

  setupAutoUpdater(() => mainWindow)
  if (app.isPackaged) {
    // 起動時に自動でアップデートを確認する(パッケージ化されたビルドのみ。開発時は行わない)
    checkForUpdates()
    // Ctrl2回押しのホットキーをいつでも使えるよう、ログイン時に自動起動しておく
    app.setLoginItemSettings({ openAtLogin: true })
  }

  createTray(showMainWindow, () => {
    isQuitting = true
    app.quit()
  })
  setupGlobalHotkey(showMainWindow)

  // ウィンドウが閉じられていてもクリップボード履歴を記録し続けるため、常時監視する
  startClipboardWatcher((entry) => {
    mainWindow?.webContents.send(IPC.clipboardDataChanged, entry)
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
    else showMainWindow()
  })
})

app.on('window-all-closed', () => {
  // トレイに常駐するため、ウィンドウが全て閉じてもアプリは終了しない(Windows/Linux含む)
})

app.on('before-quit', () => {
  isQuitting = true
  recordingFrame.destroy()
})
