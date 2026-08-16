import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { uIOhook, UiohookKey, type UiohookKeyboardEvent } from 'uiohook-napi'
import activeWin from 'active-win'
import { ensureGlobalHookStarted, keepGlobalHookAlive } from './adapters/windowTargetBase'
import * as win32 from './win32'
import * as settingsStore from './settingsStore'
import { IPC } from '../shared/types'

/**
 * コマンドパレット。固定ホットキー(Ctrl+Shift+Space)でどのアプリからでも呼び出せる、
 * クリップボード履歴・定型文・マクロを横断検索する小さなオーバーレイウィンドウ。
 * 検索対象データ自体は既存のlistClipboardHistory等をパレット側のrendererから直接
 * 呼び出して取得し、絞り込みもrenderer側で行う(このモジュールはウィンドウの表示制御と、
 * 選択項目の実行(元のウィンドウへの入力・マクロ再生画面を開く)のみを担当する)。
 */

const WIDTH = 480
const HEIGHT = 420

let win: BrowserWindow | null = null
let enabled = false
// パレットを開く直前にフォーカスされていたウィンドウ。定型文/履歴のテキストを
// 入力する際、パレット自身ではなくこの元のウィンドウへ戻してから入力する
let lastFocusedWindowId: number | null = null

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function positionAtCursor(w: BrowserWindow): void {
  const cursor = screen.getCursorScreenPoint()
  const { workArea } = screen.getDisplayNearestPoint(cursor)
  const [width, height] = w.getSize()
  const x = Math.min(Math.max(cursor.x - Math.round(width / 2), workArea.x), workArea.x + workArea.width - width)
  const y = Math.min(Math.max(cursor.y - Math.round(height / 2), workArea.y), workArea.y + workArea.height - height)
  w.setPosition(x, y)
}

function ensureWindow(): BrowserWindow {
  if (win && !win.isDestroyed()) return win

  win = new BrowserWindow({
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
  win.on('blur', () => hide())
  win.on('closed', () => {
    win = null
  })

  const search = '?commandPalette=1'
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] + '/' + search)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
  return win
}

function show(): void {
  lastFocusedWindowId = activeWin.sync()?.id ?? null
  const w = ensureWindow()
  positionAtCursor(w)
  const send = (): void => w.webContents.send(IPC.commandPaletteShown)
  if (w.webContents.isLoading()) {
    w.webContents.once('did-finish-load', send)
  } else {
    send()
  }
  w.show()
  w.focus()
}

function hide(): void {
  if (win && !win.isDestroyed() && win.isVisible()) win.hide()
}

function toggle(): void {
  if (win && !win.isDestroyed() && win.isVisible()) hide()
  else show()
}

/** パレットで選択した履歴/定型文のテキストを、パレットを開く前にフォーカスされていた
 *  ウィンドウへ直接入力する。文字化けを避けるためSendInput+KEYEVENTF_UNICODEで
 *  直接注入する(textExpansion.tsと同じ方式)。自プロセスのグローバルフックが自ら
 *  注入したイベントを拾ってしまう競合を避けるため、注入中はフックを一時停止する */
async function insertText(text: string): Promise<void> {
  hide()
  if (lastFocusedWindowId !== null) {
    try {
      win32.activateWindow(win32.idToHandle(lastFocusedWindowId))
    } catch {
      // 元のウィンドウが既に閉じられている等は無視し、フォーカスされている場所にそのまま入力する
    }
  }
  await wait(150)
  uIOhook.stop()
  try {
    win32.typeUnicodeText(text)
    await wait(100)
  } finally {
    uIOhook.start()
  }
}

let spaceHeld = false
function handleKeydown(e: UiohookKeyboardEvent): void {
  if (e.keycode !== UiohookKey.Space) return
  const isRepeat = spaceHeld
  spaceHeld = true
  if (isRepeat) return
  if (enabled && e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey) toggle()
}

function handleKeyup(e: UiohookKeyboardEvent): void {
  if (e.keycode === UiohookKey.Space) spaceHeld = false
}

export function setEnabled(value: boolean): void {
  enabled = value
  if (!enabled) hide()
}

export function initCommandPalette(openMacroForPlayback: (macroId: string) => void): void {
  ensureGlobalHookStarted()
  keepGlobalHookAlive()
  uIOhook.on('keydown', handleKeydown)
  uIOhook.on('keyup', handleKeyup)

  ipcMain.on(IPC.hideCommandPalette, () => hide())

  ipcMain.handle(IPC.commandPaletteInsertText, async (_e, text: string) => {
    await insertText(text)
  })

  ipcMain.handle(IPC.commandPaletteOpenMacro, (_e, macroId: string) => {
    hide()
    openMacroForPlayback(macroId)
  })

  ipcMain.handle(IPC.setCommandPaletteEnabled, async (_e, value: boolean) => {
    const settings = await settingsStore.setCommandPaletteEnabled(value)
    setEnabled(value)
    return settings
  })
}
