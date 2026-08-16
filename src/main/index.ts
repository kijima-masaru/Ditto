import { app, shell, BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { IPC, type NavigationTarget } from '../shared/types'
import { registerIpcHandlers } from './ipcHandlers'
import { setupAutoUpdater, checkForUpdates } from './autoUpdater'
import * as recordingFrame from './recordingFrame'
import * as clickHighlight from './clickHighlight'
import { createTray } from './tray'
import { setupGlobalHotkeys } from './hotkey'
import { startClipboardWatcher } from './clipboardWatcher'
import * as settingsStore from './settingsStore'
import { initPreviewWindows } from './previewWindow'
import { initScreenshotEditorWindow } from './screenshotEditorWindow'
import * as textExpansion from './textExpansion'
import { initCommandPalette, setEnabled as setCommandPaletteEnabled } from './commandPalette'
import log from './logger'
import { pruneOldLogs } from './debugLog'

// 表示名は"Ditto"だが、内部的な名前(userDataの保存先フォルダ名等に影響)は
// 旧アプリ名のまま固定し、既存インストールのマクロデータ・設定を引き継ぐ
app.setName('auto-test-tool')

// 複数プロセスが同時に起動していると、ホットキーのグローバルフックがプロセスごとに
// 別々に登録され、それぞれが起動時点の設定を保持し続けてしまう(設定画面でホットキーを
// 変更しても、古いまま残っているプロセスは古いホットキーに反応し続ける等の不整合が起きる)。
// ログイン時自動起動とユーザーの手動起動が重なるケース等もあるため、単一インスタンスに強制する
if (!app.requestSingleInstanceLock()) {
  // app.quit()だけでは非同期でしか終了せず、その間にready イベントが発火して
  // whenReady()以下の初期化(トレイ・ホットキー登録等)がそのまま実行されてしまうため、
  // ここで即座にプロセスを終了させる
  app.quit()
  process.exit(0)
}
app.on('second-instance', () => {
  void showMainWindow()
})

let mainWindow: BrowserWindow | null = null
// トレイに常駐させるため、ウィンドウを閉じても既定ではアプリを終了しない。
// トレイメニューの「終了」からのみ本当に終了する。
let isQuitting = false

// ウィンドウをマウスカーソル位置(中心が合うよう)に移動する。カーソルがいる
// ディスプレイの作業領域からはみ出さないようクランプする
function positionAtCursor(win: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const [width, height] = win.getSize()
  const x = Math.min(Math.max(cursor.x - Math.round(width / 2), workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(cursor.y - Math.round(height / 2), workArea.y), workArea.y + workArea.height - height)
  win.setPosition(x, y)
}

async function showMainWindow(): Promise<BrowserWindow | undefined> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    await createWindow()
  }
  if (!mainWindow || mainWindow.isDestroyed()) return undefined
  if (mainWindow.isMinimized()) mainWindow.restore()
  positionAtCursor(mainWindow)
  mainWindow.show()
  mainWindow.focus()
  return mainWindow
}

// ホットキーでの自動表示は「常に最前面に表示」設定がOFFでも確実に最前面へ出したいため、
// 一時的にscreen-saverレベルのalwaysOnTopへ切り替えて強制的に最前面へ出し、
// 直後に元の設定値へ戻す(設定がONの場合はそのまま維持される)
async function forceToFront(win: BrowserWindow): Promise<void> {
  const settings = await settingsStore.getSettings()
  win.setAlwaysOnTop(true, 'screen-saver')
  win.moveTop()
  win.focus()
  setTimeout(() => {
    if (!win.isDestroyed()) win.setAlwaysOnTop(settings.alwaysOnTop)
  }, 250)
}

// ウィンドウ表示ホットキーで表示した際、そのホットキーに紐づく遷移先
// (クリップボード/マクロの特定フォルダ)へジャンプする。targetがnull(未設定)の場合は
// ウィンドウ表示のみ行う。ウィンドウ生成直後でレンダラーの読み込みが終わっていない
// 場合は、読み込み完了を待ってから送る
async function showMainWindowAndNavigate(target: NavigationTarget | null): Promise<void> {
  const win = await showMainWindow()
  if (!win) return
  await forceToFront(win)

  if (!target) return
  const send = (): void => win.webContents.send(IPC.navigateToHotkeyTarget, target)
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

// コマンドパレットでマクロを選択した際、メインウィンドウを表示してその再生画面(idle状態、
// 実行はユーザーがボタンを押すまで開始しない)を開く
async function openMacroForPlayback(macroId: string): Promise<void> {
  const win = await showMainWindow()
  if (!win) return
  await forceToFront(win)
  const send = (): void => win.webContents.send(IPC.openMacroForPlayback, macroId)
  if (win.webContents.isLoading()) {
    win.webContents.once('did-finish-load', send)
  } else {
    send()
  }
}

async function createWindow(): Promise<void> {
  const settings = await settingsStore.getSettings()
  mainWindow = new BrowserWindow({
    width: 360,
    height: 640,
    minWidth: 300,
    minHeight: 420,
    resizable: !settings.windowSizeLocked,
    maximizable: !settings.windowSizeLocked,
    alwaysOnTop: settings.alwaysOnTop,
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

app.whenReady().then(async () => {
  log.info(`[main] app ready. version=${app.getVersion()}`)
  electronApp.setAppUserModelId('com.flatline.autotesttool')
  pruneOldLogs()

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // レンダラーやGPU/ユーティリティプロセスが落ちた場合、mainプロセスの
  // uncaughtExceptionでは捕捉できないため個別にログへ残す
  app.on('render-process-gone', (_event, _webContents, details) => {
    log.error('[main] render-process-gone:', details)
  })
  app.on('child-process-gone', (_event, details) => {
    log.error('[main] child-process-gone:', details)
  })

  createWindow()
  registerIpcHandlers(() => mainWindow)
  initPreviewWindows(() => mainWindow)
  initScreenshotEditorWindow(() => mainWindow)

  setupAutoUpdater(() => mainWindow)
  if (app.isPackaged) {
    // 起動時に自動でアップデートを確認する(パッケージ化されたビルドのみ。開発時は行わない)
    checkForUpdates()
    // ホットキーをいつでも使えるよう、ログイン時に自動起動しておく
    app.setLoginItemSettings({ openAtLogin: true })
  }

  createTray(
    () => void showMainWindow(),
    () => {
      isQuitting = true
      app.quit()
    }
  )
  const settings = await settingsStore.getSettings()
  setupGlobalHotkeys(settings.hotkeyBindings, (target) => {
    void showMainWindowAndNavigate(target)
  })
  textExpansion.initTextExpansion()
  textExpansion.setEnabled(settings.textExpansionEnabled)
  initCommandPalette((macroId) => void openMacroForPlayback(macroId))
  setCommandPaletteEnabled(settings.commandPaletteEnabled)

  // ウィンドウが閉じられていてもクリップボード履歴を記録し続けるため、常時監視する
  startClipboardWatcher((entry) => {
    mainWindow?.webContents.send(IPC.clipboardDataChanged, entry)
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
    else void showMainWindow()
  })
})

app.on('window-all-closed', () => {
  // トレイに常駐するため、ウィンドウが全て閉じてもアプリは終了しない(Windows/Linux含む)
})

app.on('before-quit', () => {
  isQuitting = true
  recordingFrame.destroy()
  clickHighlight.stop()
})
